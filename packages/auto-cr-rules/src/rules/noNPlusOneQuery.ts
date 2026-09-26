import { RuleSeverity, defineRule } from '../types'
import {
  asMember,
  collectPatternNames,
  describeExpression,
  getCalledMethodName,
  getNameChain,
  getPropertyName,
  getQualifiedName,
  getRootName,
  isFunctionNode,
  stripWrappers,
  walkAst,
  type CallNode,
  type MemberNode,
  type TypedNode,
} from './utils/ast'
import { collectHotScopes, walkScopeIteration, type HotScope } from './utils/hotScopes'

// 检测热路径（循环体、数组回调）里逐条执行的数据访问，即 N+1 查询：
//   for (const user of users) { await prisma.post.findMany({ where: { authorId: user.id } }) }
//   await Promise.all(ids.map((id) => User.findById(id)))
// 集合有 N 条就产生 N 次数据库/缓存往返，数据量一大，延迟与连接池占用都随之线性放大。
// 用 Promise.all 并发并不能解决问题：往返次数不变，还会瞬间占满连接池。正确的做法是一次批量查询。
// 识别依据是 ORM / 驱动里辨识度高的 API 形态，不做类型推断：
// - 方法名本身足够独特（findUnique、findById、findByPk、findOneAndUpdate、insertOne、countDocuments ...）；
// - Prisma 风格的 <prisma|db|tx|*prisma*>.<model>.<method> 读写方法，以及 prisma.$queryRaw`...` 模板查询；
// - 名字以 repo / repository 结尾的仓储对象上的 find / save / update 等方法；
// - db / pool / client / pgPool / dbClient 等连接对象上、参数像一条 SQL 的 query / execute；
// - redis / redisClient 等 Redis 客户端上的单键命令（mget / pipeline 等批量命令除外）；
// - ruleOptions 中额外声明的方法名与接收者名。
// 以下情况不报：参数里有作用于变量的批量条件（in / $in / [Op.in] / In(ids) / IN ($1) / ANY($1)），
// 参数本身就是一批数据（chunk、xs.slice(i, i + n)）；while 循环（分页、轮询）与遍历固定常量集合的循环。
export const noNPlusOneQuery = defineRule(
  'no-n-plus-one-query',
  { tag: 'performance', severity: RuleSeverity.Optimizing },
  ({ analysis, ast, helpers, language, messages, options, source }) => {
    const config = parseOptions(options)
    // 先在共享的热路径调用索引里找候选：绝大多数文件没有数据访问调用，直接结束。
    // prisma.$queryRaw`...` 是 tagged template 而不是调用，源码里出现时才在遍历作用域时顺带识别。
    const candidates = new Map<unknown, string>()
    for (const callExpression of analysis.hotPath.callExpressions) {
      const api = matchDataAccess(callExpression as CallNode, config)
      if (api) {
        candidates.set(callExpression, api)
      }
    }
    const mayHaveRawTemplate = RAW_TEMPLATE_SOURCE.test(source)
    if (candidates.size === 0 && !mayHaveRawTemplate) {
      return
    }

    const suggestions =
      language === 'zh'
        ? [
            {
              text: '先收集 id，再用一次批量查询取回（findMany({ where: { id: { in: ids } } })、$in、WHERE id IN (...)、mget 等），在内存中用 Map 按 key 分发。',
            },
            {
              text: '请求内多处零散查询可用 DataLoader 合并；批量写入改用 createMany / insertMany / 批量 SQL。',
            },
          ]
        : [
            {
              text: 'Collect the ids and fetch them with one batched query (findMany({ where: { id: { in: ids } } }), $in, WHERE id IN (...), mget, ...), then distribute the results with a Map.',
            },
            {
              text: 'Use DataLoader to coalesce scattered lookups within a request; batch writes with createMany / insertMany / bulk SQL.',
            },
          ]

    const scopes = collectHotScopes(analysis)
    const scopeNodes = new Set<unknown>(scopes.map((scope) => scope.node))
    const reported = new Set<unknown>()
    let fixedNames: Set<string> | null = null
    const getFixedNames = (): Set<string> => {
      fixedNames ??= collectFixedCollectionNames(ast)
      return fixedNames
    }

    for (const scope of scopes) {
      if (!isDataDriven(scope, getFixedNames)) {
        continue
      }
      // 按“一轮迭代内会执行的全部代码”查找：外层按数据迭代、内层遍历常量的嵌套写法同样是 N+1。
      walkScopeIteration(scope, scopeNodes, (node) => {
        const api = candidates.get(node) ?? (mayHaveRawTemplate ? matchRawTemplate(node) : null)
        if (!api || reported.has(node)) {
          return true
        }
        reported.add(node)
        helpers.reportViolation(
          {
            description: messages.noNPlusOneQuery({ api }),
            code: `${api}(...)`,
            suggestions,
            span: node.span,
          },
          node.span
        )
        return true
      })
    }
  }
)

// 只有“按数据逐条迭代”的作用域才构成 N+1：
// - while / do-while 多为分页、轮询、重试，每轮一次查询正是预期行为；
// - for 循环只认条件里出现 xs.length / xs.size、且 xs 没有在循环中被整体换掉的（按集合下标迭代）；
//   for (let page = 0; page < pages; page++) 与 for (let rows = await find(); rows.length; rows = await find(...)) 都是分页；
// - 遍历数组 / 对象字面量（含以非空字面量初始化的 const、TS enum）、全大写常量（ROLES、SCHEDULED_RESOURCES）
//   或其 Object.keys/values/entries 时，迭代次数固定且很小，不算。
const isDataDriven = (scope: HotScope, getFixedNames: () => ReadonlySet<string>): boolean => {
  const type = scope.node.type
  if (type === 'WhileStatement' || type === 'DoWhileStatement') {
    return false
  }
  if (type === 'ForStatement') {
    return iteratesStableCollection(scope)
  }
  return !isFixedCollection(scope.driver, getFixedNames)
}

const iteratesStableCollection = (scope: HotScope): boolean => {
  const loop = scope.node as TypedNode & { test?: unknown; update?: unknown; body?: unknown }
  const roots = new Set<string>()
  walkAst(loop.test, (node) => {
    if (node.type === 'MemberExpression') {
      const name = getPropertyName(node as MemberNode)
      if (name === 'length' || name === 'size') {
        roots.add(getRootName((node as MemberNode).object) ?? '')
      }
    }
    return true
  })
  if (roots.size === 0) {
    return false
  }
  let replaced = false
  walkAst([loop.update, loop.body], (node) => {
    if (node.type === 'AssignmentExpression') {
      const names = new Set<string>()
      collectPatternNames((node as TypedNode & { left?: unknown }).left, names)
      replaced ||= [...names].some((name) => roots.has(name))
    }
    return !replaced
  })
  return !replaced
}

type LiteralShape = TypedNode & {
  elements?: Array<{ spread?: unknown; expression?: unknown } | null>
  properties?: TypedNode[]
}

const isLiteralCollection = (node: LiteralShape | null): boolean =>
  node?.type === 'ArrayExpression'
    ? !(node.elements ?? []).some((element) => element?.spread)
    : node?.type === 'ObjectExpression' &&
      !(node.properties ?? []).some((property) => property.type === 'SpreadElement')

// 文件内以非空数组/对象字面量初始化的 const，以及 TS enum：const candidates = ['postgres', 'template1']、enum Role {...}。
// 空字面量（const results = []）通常是累加器，不算。
const collectFixedCollectionNames = (ast: unknown): Set<string> => {
  const names = new Set<string>()
  walkAst(ast, (node) => {
    if (node.type === 'TsEnumDeclaration') {
      collectPatternNames((node as TypedNode & { id?: unknown }).id, names)
      return true
    }
    if (node.type !== 'VariableDeclaration' || (node as { kind?: string }).kind !== 'const') {
      return true
    }
    for (const declarator of (node as { declarations?: Array<{ id?: TypedNode; init?: unknown }> })
      .declarations ?? []) {
      const init = stripWrappers(declarator.init) as LiteralShape | null
      const size = (init?.elements ?? init?.properties ?? []).length
      if (declarator.id?.type === 'Identifier' && size > 0 && isLiteralCollection(init)) {
        collectPatternNames(declarator.id, names)
      }
    }
    return true
  })
  return names
}

// ROLES、SCHEDULED_RESOURCES、I18N、K8S_PODS：全大写（可含数字与下划线）、至少两个字符。
const CONSTANT_NAME = /^[A-Z](?:_?[A-Z0-9])+$/
const OBJECT_ITERATORS = new Set(['Object.keys', 'Object.values', 'Object.entries'])

const isFixedCollection = (
  expression: unknown,
  getFixedNames: () => ReadonlySet<string>
): boolean => {
  const node = stripWrappers(expression) as LiteralShape | null
  if (!node) {
    return false
  }
  if (node.type === 'ArrayExpression' || node.type === 'ObjectExpression') {
    return isLiteralCollection(node)
  }
  if (node.type === 'StringLiteral') {
    return true
  }
  if (node.type === 'CallExpression') {
    const call = node as CallNode
    return (
      OBJECT_ITERATORS.has(getQualifiedName(call.callee) ?? '') &&
      isFixedCollection(call.arguments?.[0]?.expression, getFixedNames)
    )
  }
  const chain = getNameChain(node)
  if (!chain) {
    return false
  }
  return (
    CONSTANT_NAME.test(chain[chain.length - 1]) ||
    (chain.length === 1 && getFixedNames().has(chain[0]))
  )
}

// ORM / 驱动里辨识度足够高的方法：Prisma、Mongoose、Sequelize、TypeORM、MikroORM、MongoDB 驱动。
// updateOne 不在其中：Redux Toolkit / NgRx 的 entityAdapter.updateOne(state, ...) 同名。
const DISTINCTIVE_QUERY_METHODS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findById',
  'findByIdAndUpdate',
  'findByIdAndDelete',
  'findByIdAndRemove',
  'findOne',
  'findOneOrFail',
  'findOneBy',
  'findOneByOrFail',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndRemove',
  'findByPk',
  'findAll',
  'findAndCount',
  'findAndCountAll',
  'findOrCreate',
  'countDocuments',
  'insertOne',
  'replaceOne',
  'deleteOne',
  // prisma.$queryRaw(Prisma.sql`...`)：调用形式；tagged template 形式见 RAW_TEMPLATE_METHODS。
  '$queryRaw',
  '$executeRaw',
  '$queryRawUnsafe',
  '$executeRawUnsafe',
])

// prisma.$queryRaw`...` / prisma.$executeRaw`...`：Prisma 的模板查询写法。
const RAW_TEMPLATE_METHODS = new Set(['$queryRaw', '$executeRaw'])
const RAW_TEMPLATE_SOURCE = /\$(query|execute)Raw\s*`/

// prisma.<model>.<method> 形态下才算查询的通用方法名；*Many 批量写入本身就是修复手段，不在其中。
const PRISMA_MODEL_METHODS = new Set([
  'count',
  'aggregate',
  'groupBy',
  'create',
  'update',
  'upsert',
  'delete',
])
const PRISMA_CLIENT_NAMES = new Set(['prisma', 'db', 'tx'])
const PRISMA_CLIENT_NAME = /prisma/i

// TypeORM / MikroORM 仓储上的通用方法名：只认名字以 repo / repository 结尾的接收者，避免与数组的 find 等混淆。
const REPOSITORY_METHODS = new Set([
  'find',
  'findBy',
  'count',
  'countBy',
  'exists',
  'existsBy',
  'save',
  'insert',
  'update',
  'delete',
  'remove',
  'softDelete',
  'upsert',
])
const REPOSITORY_NAME = /repo(sitory)?$/i

// 连接对象上的原始查询。knex / drizzle 的 raw() 多用来拼 SQL 片段而不是执行查询，不在其中。
const RAW_QUERY_METHODS = new Set(['query', 'execute'])
const CONNECTION_NAMES = new Set([
  'db',
  'database',
  'pool',
  'client',
  'conn',
  'connection',
  'sequelize',
  'pg',
  'mysql',
  'sql',
  'trx',
  'tx',
  'queryRunner',
  'manager',
  'entityManager',
  'dataSource',
])
// pgPool、dbClient、mysqlConnection 这类“数据库名 + 连接类型”的命名。
const DB_CONNECTION_NAME =
  /^(pg|postgres|mysql|maria|mssql|sqlite|sql|db|database)(pool|client|conn|connection)$/i

// Redis 客户端上的批量/连接管理命令，不算单键往返。
const REDIS_NON_QUERY_METHODS = new Set([
  'pipeline',
  'multi',
  'exec',
  'mget',
  'mset',
  'batch',
  'connect',
  'disconnect',
  'quit',
  'duplicate',
  'on',
  'once',
  'off',
])
// redis、ioredis、cacheRedis、redisClient、redisConn 等客户端命名；redisKeys 这类数据变量不算。
const REDIS_CLIENT_NAME = /^(\w*redis|redis(client|conn|connection|cli|db))$/i

type NPlusOneConfig = {
  methods: ReadonlySet<string>
  receivers: ReadonlySet<string>
}

const parseOptions = (options: unknown): NPlusOneConfig => {
  const raw = (options && typeof options === 'object' ? options : {}) as {
    methods?: unknown
    receivers?: unknown
  }
  const toSet = (value: unknown): Set<string> =>
    new Set(
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : []
    )
  return { methods: toSet(raw.methods), receivers: toSet(raw.receivers) }
}

// 私有字段 this.#db 按 db 参与接收者名匹配。
const bareName = (name: string | undefined): string | null => name?.replace(/^#/, '') ?? null

// 命中时返回用于展示的 API 名（例如 prisma.user.findUnique），否则返回 null。
const matchDataAccess = (call: CallNode, config: NPlusOneConfig): string | null => {
  const callee = stripWrappers(call.callee) as (TypedNode & { value?: string }) | null
  if (callee?.type === 'Identifier') {
    return callee.value && config.methods.has(callee.value) && !isBatched(call)
      ? callee.value
      : null
  }

  const member = asMember(call.callee)
  const method = member ? getPropertyName(member) : null
  if (!member || !method || !isDataAccessShape(call, member, method, config) || isBatched(call)) {
    return null
  }
  return `${describeExpression(member.object)}.${method}`
}

const isDataAccessShape = (
  call: CallNode,
  member: MemberNode,
  method: string,
  config: NPlusOneConfig
): boolean => {
  const receiverChain = getNameChain(member.object)
  const receiverName = bareName(receiverChain?.[receiverChain.length - 1])

  if (config.methods.has(method) || (receiverName && config.receivers.has(receiverName))) {
    return true
  }
  if (DISTINCTIVE_QUERY_METHODS.has(method) && !isInMemoryLookup(call)) {
    return true
  }
  // prisma.user.create / tx.order.update / this.prismaService.post.update：客户端名 + 模型名 + 方法名。
  if (PRISMA_MODEL_METHODS.has(method) && receiverChain && receiverChain.length >= 2) {
    const clientName = bareName(receiverChain[receiverChain.length - 2]) ?? ''
    if (PRISMA_CLIENT_NAMES.has(clientName) || PRISMA_CLIENT_NAME.test(clientName)) {
      return true
    }
  }
  if (!receiverName) {
    return false
  }
  if (REPOSITORY_METHODS.has(method) && REPOSITORY_NAME.test(receiverName)) {
    return true
  }
  if (
    RAW_QUERY_METHODS.has(method) &&
    (CONNECTION_NAMES.has(receiverName) || DB_CONNECTION_NAME.test(receiverName)) &&
    looksLikeQueryArgument(call)
  ) {
    return true
  }
  return REDIS_CLIENT_NAME.test(receiverName) && !REDIS_NON_QUERY_METHODS.has(method)
}

// 内存里的同名查找：domutils 的 findOne(test, nodes) 以谓词函数开头，Vue Test Utils 的 findAll('td') 只传一个选择器字符串。
// ORM 的这些方法接收的是条件对象（或实体名 + 条件对象）。
const isInMemoryLookup = (call: CallNode): boolean => {
  const args = call.arguments ?? []
  const first = stripWrappers(args[0]?.expression)
  return isFunctionNode(first) || (first?.type === 'StringLiteral' && args.length === 1)
}

// prisma.$queryRaw`SELECT ...`：tagged template 形式的 Prisma 原始查询。
const matchRawTemplate = (node: TypedNode): string | null => {
  if (node.type !== 'TaggedTemplateExpression') {
    return null
  }
  const { tag, template } = node as TypedNode & { tag?: unknown; template?: TypedNode }
  const member = asMember(tag)
  const method = member ? getPropertyName(member) : null
  if (!member || !method || !RAW_TEMPLATE_METHODS.has(method) || containsBatchSql(template)) {
    return null
  }
  return `${describeExpression(member.object)}.${method}`
}

// query / execute 的第一个参数像一条查询：SQL 字符串（含拼接）、名字里带 sql / query 的变量，或带 text / sql / query 键的配置对象。
// 以下不算：strapi.db.query('api::article.article') 这类模型 UID（只取查询构造器，不产生往返）；
// GraphQL 文档（gql`...`、UserQuery、带 variables 的 { query }）——那是 HTTP 请求，不在本规则范围内。
const QUERY_NAME = /sql|query|statement|stmt/i
const QUERY_OBJECT_KEYS = new Set(['text', 'sql', 'query'])
const MODEL_UID = /^[\w-]+::[\w.-]+$/
const GRAPHQL_TAGS = new Set(['gql', 'graphql'])
const GRAPHQL_DOCUMENT_NAME = /^[A-Z]\w*(Query|Mutation|Subscription|Document)$/

type ArgumentShape = TypedNode & {
  value?: unknown
  tag?: TypedNode & { value?: string }
  operator?: string
  left?: unknown
  properties?: Array<TypedNode & { key?: TypedNode & { value?: unknown }; value?: unknown }>
}

const isGraphqlDocument = (node: ArgumentShape | null): boolean => {
  if (node?.type === 'TaggedTemplateExpression') {
    return node.tag?.type === 'Identifier' && GRAPHQL_TAGS.has(node.tag.value ?? '')
  }
  const chain = getNameChain(node)
  return Boolean(chain && GRAPHQL_DOCUMENT_NAME.test(chain[chain.length - 1]))
}

const looksLikeQueryArgument = (call: CallNode): boolean => {
  const first = stripWrappers(call.arguments?.[0]?.expression) as ArgumentShape | null
  if (!first || isGraphqlDocument(first)) {
    return false
  }
  switch (first.type) {
    case 'StringLiteral':
      return !MODEL_UID.test(String(first.value))
    case 'TemplateLiteral':
    case 'TaggedTemplateExpression':
      return true
    case 'BinaryExpression': {
      // 'SELECT ... = ' + id：最左侧是字符串。
      let left: ArgumentShape | null = first
      while (left?.type === 'BinaryExpression' && left.operator === '+') {
        left = stripWrappers(left.left) as ArgumentShape | null
      }
      return left?.type === 'StringLiteral' || left?.type === 'TemplateLiteral'
    }
    case 'ObjectExpression': {
      const keys = (first.properties ?? []).map((property) =>
        String((property.type === 'Identifier' ? property : property.key)?.value)
      )
      const queryValue = first.properties?.find(
        (property) => property.key?.value === 'query'
      )?.value
      if (
        keys.includes('variables') ||
        isGraphqlDocument(stripWrappers(queryValue) as ArgumentShape | null)
      ) {
        return false
      }
      return keys.some((key) => QUERY_OBJECT_KEYS.has(key))
    }
    default: {
      const chain = getNameChain(first)
      return Boolean(chain && QUERY_NAME.test(chain[chain.length - 1]))
    }
  }
}

// 批量条件：Prisma 的 in / hasSome、Mongo 的 $in、Sequelize 的 [Op.in] / [Op.any]、TypeORM 的 In(ids) / Any(ids)，
// 以及 SQL 里跟着占位符或插值的 IN (...) / ANY(...)。作用于常量列表的条件（status: { in: ['a', 'b'] }、IN ('a', 'b')）
// 只是普通过滤，查询仍然是逐条的。
const BATCH_KEYS = new Set(['in', '$in', 'hasSome', 'any'])
const BATCH_SQL = /\b(in|any)\s*\(\s*(\$\d|\?|:\w|$)/i
const LITERAL_TYPES = new Set([
  'StringLiteral',
  'NumericLiteral',
  'BooleanLiteral',
  'NullLiteral',
  'BigIntLiteral',
])

const isLiteralList = (expression: unknown): boolean => {
  const node = stripWrappers(expression) as LiteralShape | null
  return (
    node?.type === 'ArrayExpression' &&
    (node.elements ?? []).every(
      (element) =>
        element &&
        !element.spread &&
        LITERAL_TYPES.has(stripWrappers(element.expression)?.type ?? '')
    )
  )
}

// 对象键的静态名：in、'in'、['in']、[Op.in] → 'in'。
const getKeyName = (key: TypedNode | undefined): string | null => {
  if (key?.type === 'Computed') {
    const inner = stripWrappers((key as TypedNode & { expression?: unknown }).expression) as
      | (TypedNode & { value?: unknown })
      | null
    if (inner?.type === 'StringLiteral') {
      return String(inner.value)
    }
    const chain = getNameChain(inner)
    return chain ? chain[chain.length - 1] : null
  }
  return key?.type === 'Identifier' || key?.type === 'StringLiteral'
    ? String((key as { value?: unknown }).value)
    : null
}

const containsBatchSql = (node: unknown): boolean => {
  let found = false
  walkAst(node, (raw) => {
    const current = raw as TypedNode & {
      value?: unknown
      quasis?: Array<{ raw?: string; cooked?: string }>
    }
    if (current.type === 'StringLiteral') {
      found ||= BATCH_SQL.test(String(current.value))
    } else if (current.type === 'TemplateLiteral') {
      found ||= Boolean(
        current.quasis?.some((quasi) => BATCH_SQL.test(quasi.cooked ?? quasi.raw ?? ''))
      )
    }
    return !found
  })
  return found
}

// 参数本身就是一批数据：chunk / batch 变量（可展开传入），或 xs.slice(i, i + n)。
const CHUNK_NAME = /chunk|batch/i

const passesChunk = (call: CallNode): boolean =>
  (call.arguments ?? []).some(({ expression }) => {
    const node = stripWrappers(expression) as (TypedNode & { value?: string }) | null
    if (node?.type === 'Identifier') {
      return CHUNK_NAME.test(node.value ?? '')
    }
    return node?.type === 'CallExpression' && getCalledMethodName(node as CallNode) === 'slice'
  })

const isBatched = (call: CallNode): boolean => {
  if (passesChunk(call) || containsBatchSql(call.arguments)) {
    return true
  }
  let batched = false
  walkAst(call.arguments ?? [], (raw) => {
    const node = raw as TypedNode & {
      key?: TypedNode
      value?: unknown
      callee?: unknown
      arguments?: CallNode['arguments']
    }
    if (node.type === 'KeyValueProperty') {
      batched ||= BATCH_KEYS.has(getKeyName(node.key) ?? '') && !isLiteralList(node.value)
    } else if (node.type === 'CallExpression') {
      const chain = getNameChain(node.callee)
      const name = chain?.[chain.length - 1]
      batched ||=
        (name === 'In' || name === 'Any') && !isLiteralList(node.arguments?.[0]?.expression)
    }
    return !batched
  })
  return batched
}
