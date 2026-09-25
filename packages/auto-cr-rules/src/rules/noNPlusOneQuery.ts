import type { Span } from '@swc/types'
import { RuleSeverity, defineRule } from '../types'
import {
  asMember,
  getNameChain,
  getPropertyName,
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
// - 方法名本身足够独特（findUnique、findById、findByPk、findOneAndUpdate、countDocuments ...）；
// - Prisma 风格的 <prisma|db|tx>.<model>.<method> 读写方法；
// - 名字以 repo / repository 结尾的仓储对象上的 find / save / update 等方法；
// - db / pool / client / connection / knex 等连接对象上、参数像一条查询的 query / execute；
// - redis / redisClient 等 Redis 客户端上的单键命令（mget / pipeline 等批量命令除外）；
// - ruleOptions 中额外声明的方法名与接收者名。
// 参数里已经出现 in / $in / IN (...) / ANY(...) 等批量条件时视为分批查询，不再上报；
// while 循环（分页、轮询）与遍历固定常量集合的循环不算“按数据逐条迭代”。
export const noNPlusOneQuery = defineRule(
  'no-n-plus-one-query',
  { tag: 'performance', severity: RuleSeverity.Optimizing },
  ({ analysis, ast, helpers, language, messages, options }) => {
    const config = parseOptions(options)
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

    // 先在共享的热路径调用索引里找候选：绝大多数文件没有数据访问调用，直接结束。
    const candidates = new Map<unknown, string>()
    for (const callExpression of analysis.hotPath.callExpressions) {
      const call = callExpression as unknown as CallNode
      const api = matchDataAccess(call, config)
      if (api && !isBatchedQuery(call)) {
        candidates.set(callExpression, api)
      }
    }
    if (candidates.size === 0) {
      return
    }

    const scopes = collectHotScopes(analysis)
    const scopeNodes = new Set<unknown>(scopes.map((scope) => scope.node))
    const reported = new Set<unknown>()
    let constantArrays: Set<string> | null = null
    const getConstantArrays = (): Set<string> => {
      constantArrays ??= collectConstantArrayNames(ast)
      return constantArrays
    }

    for (const scope of scopes) {
      if (!isDataDriven(scope, getConstantArrays)) {
        continue
      }
      // 按“一轮迭代内会执行的全部代码”查找：外层按数据迭代、内层遍历常量的嵌套写法同样是 N+1。
      walkScopeIteration(scope, scopeNodes, (node) => {
        const api = candidates.get(node)
        if (!api || reported.has(node)) {
          return true
        }
        reported.add(node)
        const span = (node as { span?: Span }).span
        helpers.reportViolation(
          {
            description: messages.noNPlusOneQuery({ api }),
            code: `${api}(...)`,
            suggestions,
            span,
          },
          span
        )
        return true
      })
    }
  }
)

// 只有“按数据逐条迭代”的作用域才构成 N+1：
// - while / do-while 多为分页、轮询、重试，每轮一次查询正是预期行为；
// - for 循环只认条件里出现 .length / .size 的（按集合下标迭代），for (let page = 0; page < pages; page++) 这类分页不算；
// - 遍历数组字面量（含 const xs = [...] 声明的常量）、全大写常量（ROLES、SCHEDULED_RESOURCES）
//   或其 Object.keys/values/entries 时，迭代次数固定且很小，不算。
const isDataDriven = (scope: HotScope, getConstantArrays: () => ReadonlySet<string>): boolean => {
  const type = scope.node.type
  if (type === 'WhileStatement' || type === 'DoWhileStatement') {
    return false
  }
  if (type === 'ForStatement') {
    return referencesCollectionSize(scope.driver)
  }
  return !isFixedCollection(scope.driver, getConstantArrays)
}

// 文件内以数组字面量初始化的 const：const candidates = ['postgres', 'template1']。
const collectConstantArrayNames = (ast: unknown): Set<string> => {
  const names = new Set<string>()
  walkAst(ast, (node) => {
    if (node.type !== 'VariableDeclaration' || (node as { kind?: string }).kind !== 'const') {
      return true
    }
    for (const declarator of (
      node as { declarations?: Array<{ id?: TypedNode & { value?: string }; init?: unknown }> }
    ).declarations ?? []) {
      const init = stripWrappers(declarator.init) as
        | (TypedNode & { elements?: Array<{ spread?: unknown } | null> })
        | null
      if (
        declarator.id?.type === 'Identifier' &&
        declarator.id.value &&
        init?.type === 'ArrayExpression' &&
        !(init.elements ?? []).some((element) => element?.spread)
      ) {
        names.add(declarator.id.value)
      }
    }
    return true
  })
  return names
}

const referencesCollectionSize = (test: unknown): boolean => {
  let found = false
  walkAst(test, (node) => {
    if (node.type === 'MemberExpression') {
      const name = getPropertyName(node as MemberNode)
      found = name === 'length' || name === 'size'
    }
    return !found
  })
  return found
}

const CONSTANT_NAME = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$|^[A-Z]{2,}[0-9]*$/
const OBJECT_ITERATORS = new Set(['Object.keys', 'Object.values', 'Object.entries'])

const isFixedCollection = (
  expression: unknown,
  getConstantArrays: () => ReadonlySet<string>
): boolean => {
  const node = stripWrappers(expression) as
    | (TypedNode & { elements?: Array<{ spread?: unknown } | null> })
    | null
  if (!node) {
    return false
  }
  if (node.type === 'ArrayExpression') {
    return !(node.elements ?? []).some((element) => element?.spread)
  }
  if (node.type === 'StringLiteral') {
    return true
  }
  if (node.type === 'CallExpression') {
    const call = node as CallNode
    const chain = getNameChain(call.callee)
    if (chain && OBJECT_ITERATORS.has(chain.join('.'))) {
      const target = stripWrappers(call.arguments?.[0]?.expression)
      return target?.type === 'ObjectExpression' || isFixedCollection(target, getConstantArrays)
    }
    return false
  }
  const chain = getNameChain(node)
  if (!chain) {
    return false
  }
  return (
    CONSTANT_NAME.test(chain[chain.length - 1]) ||
    (chain.length === 1 && getConstantArrays().has(chain[0]))
  )
}

// ORM / 驱动里辨识度足够高的查询方法：Prisma、Mongoose、Sequelize、TypeORM、MikroORM、MongoDB 驱动。
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
  '$queryRaw',
  '$queryRawUnsafe',
  '$executeRaw',
  '$executeRawUnsafe',
])

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
  'knex',
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

// 命中时返回用于展示的 API 名（例如 prisma.user.findUnique），否则返回 null。
const matchDataAccess = (call: CallNode, config: NPlusOneConfig): string | null => {
  const callee = stripWrappers(call.callee) as (TypedNode & { value?: string }) | null
  if (callee?.type === 'Identifier') {
    return callee.value && config.methods.has(callee.value) ? callee.value : null
  }

  const member = asMember(call.callee)
  const method = member ? getPropertyName(member) : null
  if (!member || !method) {
    return null
  }

  const receiverChain = getNameChain(member.object)
  const display = receiverChain ? `${receiverChain.join('.')}.${method}` : `....${method}`
  const receiverName = receiverChain?.[receiverChain.length - 1] ?? null

  if (DISTINCTIVE_QUERY_METHODS.has(method) || config.methods.has(method)) {
    return display
  }
  if (receiverName && config.receivers.has(receiverName)) {
    return display
  }
  // prisma.user.create / tx.order.update：客户端名 + 模型名 + 方法名三段。
  if (PRISMA_MODEL_METHODS.has(method) && receiverChain && receiverChain.length >= 2) {
    const clientName = receiverChain[receiverChain.length - 2]
    if (PRISMA_CLIENT_NAMES.has(clientName)) {
      return display
    }
  }
  if (!receiverName) {
    return null
  }
  if (REPOSITORY_METHODS.has(method) && REPOSITORY_NAME.test(receiverName)) {
    return display
  }
  if (
    RAW_QUERY_METHODS.has(method) &&
    CONNECTION_NAMES.has(receiverName) &&
    looksLikeQueryArgument(call)
  ) {
    return display
  }
  if (REDIS_CLIENT_NAME.test(receiverName) && !REDIS_NON_QUERY_METHODS.has(method)) {
    return display
  }
  return null
}

// query / execute 的第一个参数像一条查询：SQL 字符串、名字里带 sql / query 的变量，或带 text / sql / query 键的配置对象。
// strapi.db.query(uid) 这类“按模型取查询构造器”的调用不会产生往返，借此排除。
const QUERY_NAME = /sql|query|statement|stmt/i
const QUERY_OBJECT_KEYS = new Set(['text', 'sql', 'query'])

const looksLikeQueryArgument = (call: CallNode): boolean => {
  const first = stripWrappers(call.arguments?.[0]?.expression) as
    | (TypedNode & { properties?: Array<TypedNode & { key?: TypedNode & { value?: unknown } }> })
    | null
  if (!first) {
    return false
  }
  if (
    first.type === 'StringLiteral' ||
    first.type === 'TemplateLiteral' ||
    first.type === 'TaggedTemplateExpression'
  ) {
    return true
  }
  if (first.type === 'ObjectExpression') {
    return (first.properties ?? []).some((property) => {
      const key = property.type === 'Identifier' ? property : property.key
      return Boolean(key && QUERY_OBJECT_KEYS.has(String((key as { value?: unknown }).value)))
    })
  }
  const chain = getNameChain(first)
  return Boolean(chain && QUERY_NAME.test(chain[chain.length - 1]))
}

// 批量条件：Prisma 的 in / hasSome、Mongo 的 $in / $all、TypeORM 的 In()，以及 SQL 里的 IN (...) / ANY(...)。
const BATCH_KEYS = new Set(['in', '$in', '$all', 'hasSome', 'hasEvery'])
const BATCH_SQL = /\b(in|any)\s*\(/i

const isBatchedQuery = (call: CallNode): boolean => {
  let batched = false
  const inspect = (raw: TypedNode): boolean => {
    if (batched) {
      return false
    }
    const node = raw as TypedNode & {
      key?: TypedNode & { value?: string }
      value?: unknown
      callee?: unknown
      quasis?: Array<{ raw?: string; cooked?: string }>
    }
    switch (node.type) {
      case 'KeyValueProperty': {
        const key = node.key
        const name =
          key?.type === 'Identifier' || key?.type === 'StringLiteral'
            ? String((key as { value?: unknown }).value)
            : null
        if (name && BATCH_KEYS.has(name)) {
          batched = true
        }
        break
      }
      case 'CallExpression': {
        const chain = getNameChain(node.callee)
        const name = chain?.[chain.length - 1]
        if (name === 'In' || name === 'Any') {
          batched = true
        }
        break
      }
      case 'StringLiteral':
        if (typeof node.value === 'string' && BATCH_SQL.test(node.value)) {
          batched = true
        }
        break
      case 'TemplateLiteral':
        if (node.quasis?.some((quasi) => BATCH_SQL.test(quasi.cooked ?? quasi.raw ?? ''))) {
          batched = true
        }
        break
      default:
        break
    }
    return !batched
  }

  walkAst(call.arguments ?? [], inspect)
  return batched
}
