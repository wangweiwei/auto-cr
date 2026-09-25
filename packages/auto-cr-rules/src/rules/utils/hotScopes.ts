import type { RuleAnalysis } from '../../types'
import {
  TYPE_ONLY_KEYS,
  asMember,
  collectPatternNames,
  getCalledMethodName,
  getNameChain,
  getPropertyName,
  getRootName,
  isFunctionNode,
  stripWrappers,
  walkAst,
  walkWithAncestors,
  type CallNode,
  type TypedNode,
} from './ast'

// 热路径作用域：共享分析里的每个循环、每个数组高阶回调都是一个作用域。
// 规则需要知道“某个节点在哪一层循环/回调里、这一层每轮会变化的是哪些名字”，
// 只有 inHot 标记不够用，因此在共享索引之上按作用域重新组织。
export type HotScope = {
  kind: 'loop' | 'callback'
  node: TypedNode
  // 每轮迭代新绑定的名字：循环头声明的变量、回调参数。
  bindings: ReadonlySet<string>
  // 每轮都会执行的部分：for 的 test/update/body，while 的 test/body，for-in/of 的 body，回调的 body。
  regions: ReadonlyArray<unknown>
  // while / do-while 的条件：只有随迭代变化才能让循环终止，据此推断“不变”并不可靠。
  conditions: ReadonlySet<unknown>
  // 驱动迭代的表达式：for-in/of 的 right、for / while 的条件、数组回调的接收者（items.map(...) 的 items）。
  driver: unknown
}

export type HotScopeVisitor = (
  node: TypedNode,
  ancestors: ReadonlyArray<TypedNode>
) => boolean | void

type LoopShape = TypedNode & {
  init?: unknown
  test?: unknown
  update?: unknown
  body?: unknown
  left?: unknown
  right?: unknown
}

type CallbackShape = TypedNode & { params?: unknown[]; body?: unknown }

// 直接复用共享分析的 loops / callbacks：什么算热路径只有一个来源，与其它热路径规则保持一致。
export const collectHotScopes = (analysis: RuleAnalysis): HotScope[] => {
  const scopes: HotScope[] = []

  for (const loop of analysis.loops) {
    const node = loop.node as LoopShape
    const bindings = new Set<string>()
    switch (loop.type) {
      case 'ForStatement':
        if ((node.init as TypedNode | undefined)?.type === 'VariableDeclaration') {
          collectPatternNames(node.init, bindings)
        }
        scopes.push({
          kind: 'loop',
          node,
          bindings,
          regions: [node.test, node.update, node.body],
          conditions: new Set(),
          driver: node.test,
        })
        break
      case 'WhileStatement':
      case 'DoWhileStatement':
        scopes.push({
          kind: 'loop',
          node,
          bindings,
          regions: [node.test, node.body],
          conditions: new Set([node.test]),
          driver: node.test,
        })
        break
      case 'ForInStatement':
      case 'ForOfStatement':
        // 左侧无论是声明还是对既有变量的赋值，每轮都会换值。
        collectPatternNames(node.left, bindings)
        scopes.push({
          kind: 'loop',
          node,
          bindings,
          regions: [node.body],
          conditions: new Set(),
          driver: node.right,
        })
        break
      default:
        break
    }
  }

  for (const entry of analysis.callbacks) {
    const callback = entry.callback as unknown as CallbackShape
    const bindings = new Set<string>()
    callback.params?.forEach((param) => collectPatternNames(param, bindings))
    scopes.push({
      kind: 'callback',
      node: callback,
      bindings,
      regions: [callback.body],
      conditions: new Set(),
      driver: asMember(entry.callExpression.callee)?.object ?? null,
    })
  }

  return scopes
}

// 遍历作用域“本层”每轮都会执行的节点。
// - 普通嵌套函数不进入：定义在循环里不等于每轮都执行；
// - 嵌套的热路径作用域只遍历它在本层按轮求值的部分（for 的 init、for-in/of 的 right），其余交给内层作用域自己判定。
export const walkScopeOwnRegion = (
  scope: HotScope,
  scopeNodes: ReadonlySet<unknown>,
  visitor: HotScopeVisitor
): void => {
  const guard: HotScopeVisitor = (node, ancestors) => {
    if (scopeNodes.has(node)) {
      if (visitor(node, ancestors) === false) {
        return false
      }
      const nested = node as LoopShape
      const nextAncestors = [...ancestors, node]
      if (nested.type === 'ForStatement') {
        walkWithAncestors(nested.init, guard, nextAncestors)
      } else if (nested.type === 'ForOfStatement' || nested.type === 'ForInStatement') {
        walkWithAncestors(nested.right, guard, nextAncestors)
      }
      return false
    }
    if (isFunctionNode(node)) {
      return false
    }
    return visitor(node, ancestors)
  }

  for (const region of scope.regions) {
    walkWithAncestors(region, guard, [scope.node])
  }
}

// 遍历一轮迭代内会执行的全部节点：嵌套循环、嵌套数组回调都算在内，普通嵌套函数不算。
export const walkScopeIteration = (
  scope: HotScope,
  scopeNodes: ReadonlySet<unknown>,
  visitor: HotScopeVisitor
): void => {
  const guard: HotScopeVisitor = (node, ancestors) => {
    if (isFunctionNode(node) && !scopeNodes.has(node)) {
      return false
    }
    return visitor(node, ancestors)
  }

  for (const region of scope.regions) {
    walkWithAncestors(region, guard, [scope.node])
  }
}

// 节点是否位于 while / do-while 的条件里（节点本身或任一祖先是条件表达式）。
export const isInLoopCondition = (
  scope: HotScope,
  node: TypedNode,
  ancestors: ReadonlyArray<TypedNode>
): boolean => {
  if (scope.conditions.size === 0) {
    return false
  }
  return scope.conditions.has(node) || ancestors.some((ancestor) => scope.conditions.has(ancestor))
}

// 会原地修改接收者的方法：数组、Map、Set 上最常见的变更操作。
const MUTATING_METHODS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
  'set',
  'add',
  'delete',
  'clear',
])

// 不修改接收者的常见方法：数组/字符串/Map/Set 的查询与派生、数值格式化、Promise 链。
// 作用域里对某个对象调用了这之外的方法，就当作它可能在迭代中被改变。
const READ_ONLY_METHODS = new Set([
  'map',
  'filter',
  'flatMap',
  'flat',
  'reduce',
  'reduceRight',
  'forEach',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'some',
  'every',
  'includes',
  'indexOf',
  'lastIndexOf',
  'slice',
  'concat',
  'join',
  'at',
  'keys',
  'values',
  'entries',
  'has',
  'get',
  'toSorted',
  'toReversed',
  'toSpliced',
  'with',
  'toString',
  'toLocaleString',
  'toFixed',
  'toPrecision',
  'valueOf',
  'toLowerCase',
  'toUpperCase',
  'trim',
  'trimStart',
  'trimEnd',
  'split',
  'startsWith',
  'endsWith',
  'charAt',
  'charCodeAt',
  'codePointAt',
  'substring',
  'substr',
  'padStart',
  'padEnd',
  'repeat',
  'replace',
  'replaceAll',
  'match',
  'matchAll',
  'search',
  'localeCompare',
  'normalize',
  'hasOwnProperty',
  'getTime',
  'format',
  'then',
  'catch',
  'finally',
])

// 全局命名空间对象：Object.assign(...)、JSON.stringify(...) 之类的调用不会让 Object / JSON 本身“变化”。
const GLOBAL_NAMESPACES = new Set([
  'Object',
  'Array',
  'JSON',
  'Math',
  'Number',
  'String',
  'Reflect',
  'Promise',
  'Date',
  'Intl',
  'Symbol',
  'console',
])

// 会修改第一个参数的静态方法。
const MUTATING_STATIC_CALLS = new Set([
  'Object.assign',
  'Object.defineProperty',
  'Object.defineProperties',
  'Object.setPrototypeOf',
])

// 每次调用结果都不同的函数：出现在表达式里就谈不上“迭代间不变”。
const NONDETERMINISTIC_CALLS = new Set([
  'Math.random',
  'Date.now',
  'performance.now',
  'crypto.randomUUID',
  'crypto.getRandomValues',
])

type ScopeFacts = {
  // 本作用域内每轮可能变化的名字：迭代绑定、作用域内的声明、赋值/自增目标、被原地修改的对象。
  variant: Set<string>
  // 作用域内是否写过任何对象属性。写属性可能经由别名改到集合元素的字段上。
  memberMutation: boolean
}

type ExpressionFacts = {
  free: Set<string>
  pure: boolean
  // 表达式里的回调是否读取了参数（集合元素）的属性：此时元素字段被改写也会让结果变化。
  readsElementProps: boolean
}

export type InvarianceOptions = {
  // 数据部分允许出现的调用（例如构建集合的 map / filter / new Set）；未允许的调用一律视为可能有副作用或结果会变。
  allowCall?: (call: CallNode) => boolean
}

export type InvarianceChecker = {
  isInvariant(expression: unknown, scope: HotScope, options?: InvarianceOptions): boolean
}

// 判断表达式在某个热路径作用域内是否“迭代间不变”。
// 保守起见，满足以下全部条件才算不变：
// - 只由标识符、成员访问、字面量与被允许的调用组成，回调里没有 await / 随机数 / 对外部变量的写入；
// - 引用到的名字在本作用域内既没有重新绑定，也没有被赋值或原地修改；
// - 引用到的名字在整个文件里没有被重新赋值过（避免循环中调用的函数悄悄替换它）；
// - 若回调读取了元素属性，本作用域内不能有任何属性写入（可能经由别名改到元素上）。
export const createInvarianceChecker = (analysis: RuleAnalysis): InvarianceChecker => {
  const scopeFactsCache = new Map<HotScope, ScopeFacts>()

  const getScopeFacts = (scope: HotScope): ScopeFacts => {
    const cached = scopeFactsCache.get(scope)
    if (cached) {
      return cached
    }
    const facts = collectScopeFacts(scope)
    scopeFactsCache.set(scope, facts)
    return facts
  }

  return {
    isInvariant(expression, scope, options = {}) {
      const facts = analyzeExpression(expression, options)
      if (!facts.pure) {
        return false
      }
      const scopeFacts = getScopeFacts(scope)
      for (const name of facts.free) {
        if (scopeFacts.variant.has(name)) {
          return false
        }
        if (name !== 'this' && analysis.reassignedNames.has(name)) {
          return false
        }
      }
      return !(facts.readsElementProps && scopeFacts.memberMutation)
    },
  }
}

type AnyNode = TypedNode & Record<string, unknown>

const collectScopeFacts = (scope: HotScope): ScopeFacts => {
  const variant = new Set<string>(scope.bindings)
  let memberMutation = false

  const markTarget = (target: unknown): void => {
    const stripped = stripWrappers(target)
    if (stripped?.type === 'MemberExpression') {
      memberMutation = true
      const root = getRootName(stripped)
      if (root) {
        variant.add(root)
      }
      return
    }
    collectPatternNames(stripped, variant)
  }

  for (const region of scope.regions) {
    walkAst(region, (raw) => {
      const node = raw as AnyNode
      switch (node.type) {
        case 'VariableDeclarator':
          collectPatternNames(node.id, variant)
          break
        case 'FunctionDeclaration':
        case 'ClassDeclaration':
          collectPatternNames(node.identifier, variant)
          break
        case 'CatchClause':
          collectPatternNames(node.param, variant)
          break
        case 'AssignmentExpression':
          markTarget(node.left)
          break
        case 'UpdateExpression':
          markTarget(node.argument)
          break
        case 'UnaryExpression':
          if (node.operator === 'delete') {
            markTarget(node.argument)
          }
          break
        case 'ForInStatement':
        case 'ForOfStatement':
          collectPatternNames(node.left, variant)
          break
        case 'CallExpression': {
          const call = node as unknown as CallNode
          const member = asMember(call.callee)
          if (member) {
            // 除已知只读的方法外，任何方法调用（包括 stack[enqueueFn](...) 这类计算属性调用、自定义的 queue.enqueue(...)）
            // 都可能修改接收者；保守地把接收者的根视为每轮可变。
            const method = getPropertyName(member)
            const root = getRootName(member.object)
            if (
              (!method || !READ_ONLY_METHODS.has(method)) &&
              root &&
              !GLOBAL_NAMESPACES.has(root)
            ) {
              variant.add(root)
            }
          }
          const chain = getNameChain(call.callee)
          if (chain && MUTATING_STATIC_CALLS.has(chain.join('.'))) {
            const root = getRootName(call.arguments?.[0]?.expression)
            if (root) {
              variant.add(root)
            }
          }
          break
        }
        default:
          break
      }
      if (isFunctionNode(node)) {
        // 嵌套函数的参数同样是作用域内新绑定的名字；保守地计入，避免同名遮蔽造成误判。
        ;(node.params as unknown[] | undefined)?.forEach((param) =>
          collectPatternNames(param, variant)
        )
      }
      return true
    })
  }

  return { variant, memberMutation }
}

const LITERAL_TYPES = new Set([
  'StringLiteral',
  'NumericLiteral',
  'BooleanLiteral',
  'NullLiteral',
  'BigIntLiteral',
  'RegExpLiteral',
])

const analyzeExpression = (expression: unknown, options: InvarianceOptions): ExpressionFacts => {
  const facts: ExpressionFacts = { free: new Set(), pure: true, readsElementProps: false }

  // 数据部分：决定表达式取值的接收者与参数。
  const visitData = (raw: unknown): void => {
    if (!facts.pure) {
      return
    }
    const node = stripWrappers(raw) as AnyNode | null
    if (!node) {
      return
    }
    if (node.type && LITERAL_TYPES.has(node.type)) {
      return
    }
    switch (node.type) {
      case 'Identifier':
        facts.free.add(String(node.value))
        return
      case 'ThisExpression':
        facts.free.add('this')
        return
      case 'TemplateLiteral':
        ;(node.expressions as unknown[]).forEach(visitData)
        return
      case 'MemberExpression': {
        visitData(node.object)
        const property = node.property as AnyNode
        if (property.type === 'Computed') {
          visitData(property.expression)
        }
        return
      }
      case 'ArrayExpression':
        for (const element of node.elements as Array<{ expression: unknown } | null>) {
          if (element) {
            visitData(element.expression)
          }
        }
        return
      case 'ObjectExpression':
        for (const property of node.properties as AnyNode[]) {
          if (property.type === 'KeyValueProperty') {
            const key = property.key as AnyNode
            if (key.type === 'Computed') {
              visitData(key.expression)
            }
            visitData(property.value)
          } else if (property.type === 'Identifier') {
            facts.free.add(String(property.value))
          } else if (property.type === 'SpreadElement') {
            visitData(property.arguments)
          } else {
            facts.pure = false
          }
        }
        return
      case 'UnaryExpression':
        if (node.operator === 'delete') {
          facts.pure = false
          return
        }
        visitData(node.argument)
        return
      case 'BinaryExpression':
        visitData(node.left)
        visitData(node.right)
        return
      case 'ConditionalExpression':
        visitData(node.test)
        visitData(node.consequent)
        visitData(node.alternate)
        return
      case 'CallExpression':
      case 'NewExpression': {
        const call = node as unknown as CallNode
        if (!options.allowCall?.(call)) {
          facts.pure = false
          return
        }
        // callee 是成员时只看接收者（方法名不是引用）；是标识符时（new Set）按引用记录，全局构造器不会被判为可变。
        visitData(call.callee)
        for (const argument of call.arguments ?? []) {
          const argumentNode = stripWrappers(argument.expression)
          if (
            !argument.spread &&
            (argumentNode?.type === 'ArrowFunctionExpression' ||
              argumentNode?.type === 'FunctionExpression')
          ) {
            visitCallback(argumentNode as AnyNode)
          } else {
            visitData(argument.expression)
          }
        }
        return
      }
      default:
        facts.pure = false
    }
  }

  // 回调部分：允许任意调用（通常是纯函数），但不允许 await、随机数与对外部变量的写入。
  const visitCallback = (fn: AnyNode): void => {
    const params = new Set<string>()
    ;(fn.params as unknown[] | undefined)?.forEach((param) => collectPatternNames(param, params))
    const local = new Set<string>(params)
    walkAst(fn.body, (raw) => {
      const node = raw as AnyNode
      if (node.type === 'VariableDeclarator') {
        collectPatternNames(node.id, local)
      } else if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
        collectPatternNames(node.identifier, local)
      } else if (node.type === 'CatchClause') {
        collectPatternNames(node.param, local)
      } else if (isFunctionNode(node)) {
        ;(node.params as unknown[] | undefined)?.forEach((param) =>
          collectPatternNames(param, local)
        )
      }
      return true
    })

    const isLocalTarget = (target: unknown): boolean => {
      const stripped = stripWrappers(target)
      if (stripped?.type === 'MemberExpression') {
        const root = getRootName(stripped)
        return Boolean(root && local.has(root))
      }
      const names = new Set<string>()
      collectPatternNames(stripped, names)
      return [...names].every((name) => local.has(name))
    }

    const scan = (raw: unknown): void => {
      if (!facts.pure || !raw || typeof raw !== 'object') {
        return
      }
      if (Array.isArray(raw)) {
        raw.forEach(scan)
        return
      }
      const node = raw as AnyNode
      switch (node.type) {
        case 'Identifier':
          if (!local.has(String(node.value))) {
            facts.free.add(String(node.value))
          }
          return
        case 'ThisExpression':
          if (fn.type === 'ArrowFunctionExpression') {
            facts.free.add('this')
          }
          return
        case 'MemberExpression': {
          const root = getRootName(node.object)
          if (root && params.has(root)) {
            facts.readsElementProps = true
          }
          scan(node.object)
          const property = node.property as AnyNode
          if (property.type === 'Computed') {
            scan(property.expression)
          }
          return
        }
        case 'KeyValueProperty': {
          const key = node.key as AnyNode
          if (key.type === 'Computed') {
            scan(key.expression)
          }
          scan(node.value)
          return
        }
        case 'AwaitExpression':
        case 'YieldExpression':
          facts.pure = false
          return
        case 'AssignmentExpression':
          if (!isLocalTarget(node.left)) {
            facts.pure = false
            return
          }
          break
        case 'UpdateExpression':
          if (!isLocalTarget(node.argument)) {
            facts.pure = false
            return
          }
          break
        case 'UnaryExpression':
          if (node.operator === 'delete' && !isLocalTarget(node.argument)) {
            facts.pure = false
            return
          }
          break
        case 'CallExpression': {
          const call = node as unknown as CallNode
          const chain = getNameChain(call.callee)
          if (chain && NONDETERMINISTIC_CALLS.has(chain.join('.'))) {
            facts.pure = false
            return
          }
          const method = getCalledMethodName(call)
          if (method && MUTATING_METHODS.has(method)) {
            const root = getRootName(asMember(call.callee)?.object)
            if (!root || !local.has(root)) {
              facts.pure = false
              return
            }
          }
          break
        }
        case 'NewExpression': {
          const call = node as unknown as CallNode
          const callee = stripWrappers(call.callee) as AnyNode | null
          if (callee?.type === 'Identifier' && callee.value === 'Date' && !call.arguments?.length) {
            facts.pure = false
            return
          }
          break
        }
        default:
          break
      }
      for (const [key, value] of Object.entries(node)) {
        if (TYPE_ONLY_KEYS.has(key)) {
          continue
        }
        scan(value)
      }
    }

    scan(fn.body)
  }

  visitData(expression)
  return facts
}
