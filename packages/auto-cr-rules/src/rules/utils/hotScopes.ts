import { HOT_CALLBACK_METHODS } from '../../analysis'
import type { RuleAnalysis } from '../../types'
import {
  asMember,
  collectPatternNames,
  forEachTargetLeaf,
  getCalledMethodName,
  collectDeclaredNames,
  getFunctionParams,
  getPropertyName,
  getQualifiedName,
  getRootName,
  getScopeDeclaredNames,
  isFunctionNode,
  isReferencePosition,
  stripWrappers,
  walkAst,
  walkWithAncestors,
  type AncestorVisitor,
  type CallNode,
  type TypedNode,
} from './ast'

// 热路径作用域：共享分析里的每个循环、每个数组高阶回调都是一个作用域。
// 规则需要知道“某个节点在哪一层循环/回调里、这一层每轮会变化的是哪些名字”，
// 只有 inHot 标记不够用，因此在共享索引之上按作用域重新组织。
export type HotScope = {
  node: TypedNode
  // 每轮迭代新绑定的名字：循环头声明的变量、回调参数（function 回调还有 arguments）。
  bindings: ReadonlySet<string>
  // 每轮都会执行的部分：for 的 test/update/body，while 的 test/body，for-in/of 的 body，回调的 body。
  regions: ReadonlyArray<unknown>
  // 驱动迭代的表达式：for-in/of 的 right、for / while 的条件、数组回调的接收者（items.map(...) 的 items）。
  driver: unknown
}

type LoopShape = TypedNode & {
  init?: unknown
  test?: unknown
  update?: unknown
  body?: unknown
  left?: unknown
  right?: unknown
  // for await：运行时为布尔值（类型声明里是 Span），只按真假判断。
  await?: unknown
}

type CallbackShape = TypedNode & { params?: unknown[]; body?: unknown }

// 直接复用共享分析的 loops / callbacks：什么算热路径只有一个来源，与其它热路径规则保持一致。
export const collectHotScopes = (analysis: RuleAnalysis): HotScope[] => {
  const scopes: HotScope[] = []

  for (const loop of analysis.loops) {
    const node: LoopShape = loop.node
    const bindings = new Set<string>()
    switch (loop.type) {
      case 'ForStatement':
        if ((node.init as TypedNode | undefined)?.type === 'VariableDeclaration') {
          collectPatternNames(node.init, bindings)
        }
        scopes.push({
          node,
          bindings,
          regions: [node.test, node.update, node.body],
          driver: node.test,
        })
        break
      case 'WhileStatement':
      case 'DoWhileStatement':
        scopes.push({ node, bindings, regions: [node.test, node.body], driver: node.test })
        break
      case 'ForInStatement':
      case 'ForOfStatement':
        // 左侧无论是声明还是对既有变量的赋值，每轮都会换值。
        collectPatternNames(node.left, bindings)
        scopes.push({ node, bindings, regions: [node.body], driver: node.right })
        break
      default:
        break
    }
  }

  for (const entry of analysis.callbacks) {
    const callback: CallbackShape = entry.callback
    const bindings = new Set<string>()
    callback.params?.forEach((param) => collectPatternNames(param, bindings))
    // function 回调每次调用都有新的 arguments 对象；箭头函数沿用外层的 arguments，不算。
    if (callback.type === 'FunctionExpression') {
      bindings.add('arguments')
    }
    scopes.push({
      node: callback,
      bindings,
      regions: [callback.body],
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
  visitor: AncestorVisitor
): void => {
  const guard: AncestorVisitor = (node, ancestors) => {
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
  visitor: AncestorVisitor
): void => {
  const guard: AncestorVisitor = (node, ancestors) => {
    if (isFunctionNode(node) && !scopeNodes.has(node)) {
      return false
    }
    return visitor(node, ancestors)
  }

  for (const region of scope.regions) {
    walkWithAncestors(region, guard, [scope.node])
  }
}

// 节点是否位于 while / do-while / 没有更新子句的 for 的条件里：
// 这类条件只有随迭代变化才能让循环终止，据此推断“不变”并不可靠。
export const isInLoopCondition = (
  scope: HotScope,
  node: TypedNode,
  ancestors: ReadonlyArray<TypedNode>
): boolean => {
  const loop = scope.node as LoopShape
  const conditionDriven =
    loop.type === 'WhileStatement' ||
    loop.type === 'DoWhileStatement' ||
    (loop.type === 'ForStatement' && !loop.update)
  const test = loop.test as TypedNode | undefined
  return Boolean(conditionDriven && test && (node === test || ancestors.includes(test)))
}

// 节点是否位于“离开本作用域”的语句里：throw（作用域内没有 try 包裹时），或循环中的 return。
// 这类代码每次进入作用域至多执行一次，不属于热路径；async 回调里的 throw 只让当次 Promise 失败，仍按热路径处理。
export const isLeavingScope = (scope: HotScope, ancestors: ReadonlyArray<TypedNode>): boolean => {
  const isLoop = !isFunctionNode(scope.node)
  const asyncCallback = !isLoop && Boolean((scope.node as { async?: boolean }).async)
  let leaving = false
  for (const ancestor of ancestors) {
    if (ancestor.type === 'TryStatement') {
      return false
    }
    if (
      (ancestor.type === 'ThrowStatement' && !asyncCallback) ||
      (ancestor.type === 'ReturnStatement' && isLoop)
    ) {
      leaving = true
    }
  }
  return leaving
}

// 会原地修改接收者、但不会修改参数的集合方法：push(item) 只是把 item 存起来。
const COLLECTION_MUTATORS = new Set([
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

// 由已有数据派生出新集合的方法：结果是一份新副本，对副本调用 sort / reverse 不会影响原数据。
export const FRESH_COLLECTION_METHODS: ReadonlySet<string> = new Set([
  'map',
  'filter',
  'flatMap',
  'flat',
  'split',
  'concat',
  'slice',
  'toSorted',
  'toReversed',
  'toSpliced',
  'with',
])

// 不修改接收者的常见方法：数组/字符串/Map/Set 的查询与派生、数值与日期格式化、Promise 链。
// 作用域里对某个对象调用了这之外的方法，就当作它可能在迭代中被改变。
const READ_ONLY_METHODS: ReadonlySet<string> = new Set([
  ...FRESH_COLLECTION_METHODS,
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
  'join',
  'at',
  'keys',
  'values',
  'entries',
  'has',
  'get',
  'toString',
  'toLocaleString',
  'toLocaleDateString',
  'toLocaleTimeString',
  'toFixed',
  'toPrecision',
  'valueOf',
  'toLowerCase',
  'toUpperCase',
  'trim',
  'trimStart',
  'trimEnd',
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
  'bind',
  'then',
  'catch',
  'finally',
])

// 全局命名空间对象：Object.keys(...)、JSON.stringify(...)、console.log(...) 之类的调用不修改命名空间本身，也不修改参数。
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

// 不修改参数的全局函数。
const PURE_FUNCTIONS = new Set([
  'String',
  'Number',
  'Boolean',
  'BigInt',
  'Symbol',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURIComponent',
  'decodeURIComponent',
  'encodeURI',
  'decodeURI',
  'structuredClone',
])

// 会修改第一个参数的静态方法。
const MUTATING_STATIC_CALLS = new Set([
  'Object.assign',
  'Object.defineProperty',
  'Object.defineProperties',
  'Object.setPrototypeOf',
  'Reflect.set',
  'Reflect.deleteProperty',
  'Reflect.defineProperty',
  'Reflect.setPrototypeOf',
])

// 每次调用结果都不同的函数：出现在表达式里就谈不上“迭代间不变”。
const NONDETERMINISTIC_CALLS = new Set([
  'Math.random',
  'Date.now',
  'performance.now',
  'crypto.randomUUID',
  'crypto.getRandomValues',
])

const FRESH_STATIC_CALLS = new Set([
  'Object.keys',
  'Object.values',
  'Object.entries',
  'Array.from',
  'Array.of',
])

// 新建的集合字面量或派生副本：对它调用 sort() 等只改临时对象。
const isFreshCollection = (expression: unknown): boolean => {
  const node = stripWrappers(expression)
  switch (node?.type) {
    case 'ArrayExpression':
    case 'ObjectExpression':
    case 'NewExpression':
      return true
    case 'CallExpression': {
      const call = node as CallNode
      const method = getCalledMethodName(call)
      return Boolean(
        (method && FRESH_COLLECTION_METHODS.has(method)) ||
        FRESH_STATIC_CALLS.has(getQualifiedName(call.callee) ?? '')
      )
    }
    default:
      return false
  }
}

type ScopeFacts = {
  // 本作用域内每轮可能变化的名字：迭代绑定、作用域内的声明、赋值/自增目标、被原地修改或传给未知函数的对象。
  variant: Set<string>
  // 作用域内是否改写了来历不明的对象属性（外部对象的字段、取不到根名的接收者）：可能经由别名改到任何集合元素上。
  memberMutation: boolean
  // 被修改的局部对象（当前元素及其派生值）取自哪些外部名字：读取这些名字的元素时结果会变。
  mutatedSources: ReadonlySet<string>
  // 作用域内是否有 await / yield / for await：挂起期间其它代码可能修改任何数据。
  suspends: boolean
}

type ExpressionFacts = {
  free: Set<string>
  pure: boolean
  // 表达式里的回调是否依赖集合元素（带参数的回调、函数引用）：此时元素字段被改写也会让结果变化。
  readsElementProps: boolean
}

export type InvarianceOptions = {
  // 数据部分允许出现的调用（例如构建集合的 map / filter / new Set）；未允许的调用一律视为可能有副作用或结果会变。
  allowCall?: (call: CallNode) => boolean
}

export type InvarianceChecker = {
  isInvariant(expression: unknown, scope: HotScope, options?: InvarianceOptions): boolean
}

// 判断表达式在某个热路径作用域内是否“迭代间不变”。表达式须来自 walkScopeOwnRegion(scope)，不在嵌套函数里。
// 保守起见，满足以下全部条件才算不变：
// - 只由标识符、成员访问、字面量与被允许的调用组成，回调里没有 await / 随机数 / 对外部变量的写入；
// - 引用到的名字在本作用域内既没有重新绑定，也没有被赋值、原地修改或传给未知函数；
// - 引用到的名字在整个文件里没有被重新赋值过（避免循环中调用的函数悄悄替换它）；
// - 作用域内没有 await / yield（挂起期间别的代码可能修改数据）；
// - 若回调依赖元素，本作用域内不能改写来历不明的对象属性，也不能修改取自这些集合的局部对象（当前元素等）。
// 经由别名的修改（const q = seen; q.push(...)）看不到，这是文档中列出的已知局限。
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
      if (scopeFacts.suspends && facts.free.size > 0) {
        return false
      }
      for (const name of facts.free) {
        if (scopeFacts.variant.has(name) || analysis.reassignedNames.has(name)) {
          return false
        }
      }
      if (!facts.readsElementProps) {
        return true
      }
      return (
        !scopeFacts.memberMutation &&
        ![...facts.free].some((name) => scopeFacts.mutatedSources.has(name))
      )
    },
  }
}

type AnyNode = TypedNode & Record<string, unknown>

const collectScopeFacts = (scope: HotScope): ScopeFacts => {
  const variant = new Set<string>(scope.bindings)
  // 每轮新绑定或在本层声明的名字：修改它们，改的是当前元素（或由它派生的对象）。
  const locals = new Set<string>(scope.bindings)
  // 局部名字的取值来源：迭代绑定来自驱动表达式（for 为 init），声明与赋值来自右侧表达式。
  const sources = new Map<string, unknown[]>()
  // 被修改的对象：root 为根名（取不到时为 null），field 表示改的是对象字段而不只是集合内容。
  const writes: Array<{ root: string | null; field: boolean }> = []
  let suspends = Boolean((scope.node as LoopShape).await)

  const addSource = (names: Iterable<string>, expression: unknown): void => {
    if (!expression) {
      return
    }
    for (const name of names) {
      sources.set(name, [...(sources.get(name) ?? []), expression])
    }
  }

  // 被修改的对象：能取到根名时记根名；三元、||/?? 等没有单一根名的接收者，保守地把其中出现的名字都记为可变。
  const markReceiver = (receiver: unknown, field: boolean): void => {
    const root = getRootName(receiver)
    writes.push({ root, field })
    if (root) {
      variant.add(root)
      return
    }
    walkAst(receiver, (node) => {
      if (node.type === 'Identifier') {
        variant.add(String((node as AnyNode).value))
      } else if (node.type === 'ThisExpression' || node.type === 'Super') {
        variant.add('this')
      }
      return !isFunctionNode(node)
    })
  }

  // 赋值 / 自增 / delete 的目标：标识符是重新绑定（取值来自 value），成员（含解构里的成员）是字段写入。
  const markTarget = (target: unknown, value?: unknown): void => {
    forEachTargetLeaf(target, (leaf) => {
      if (leaf.type === 'Identifier') {
        const name = String((leaf as AnyNode).value)
        variant.add(name)
        addSource([name], value)
      } else {
        markReceiver(leaf, true)
      }
    })
  }

  // 传给未知函数 / 未知方法的对象可能被修改（admins.forEach(normalize) 之外，normalize(admin) 同样会改元素）。
  const markArguments = (call: CallNode): void => {
    for (const argument of call.arguments ?? []) {
      const node = stripWrappers(argument.expression)
      if (
        node?.type === 'Identifier' ||
        node?.type === 'MemberExpression' ||
        node?.type === 'ThisExpression'
      ) {
        markReceiver(node, false)
      }
    }
  }

  const markCall = (call: CallNode): void => {
    const callee = stripWrappers(call.callee) as AnyNode | null
    if (MUTATING_STATIC_CALLS.has(getQualifiedName(call.callee) ?? '')) {
      markReceiver(call.arguments?.[0]?.expression, true)
      return
    }
    if (callee?.type === 'SuperPropExpression') {
      markReceiver(callee, true)
      return
    }
    const member = asMember(call.callee)
    if (!member) {
      if (!(callee?.type === 'Identifier' && PURE_FUNCTIONS.has(String(callee.value)))) {
        markArguments(call)
      }
      return
    }
    const method = getPropertyName(member)
    // Array.prototype.push.apply(target, items)：借用的方法修改的是第一个参数。
    if (method === 'call' || method === 'apply') {
      const borrowed = asMember(member.object)
      const borrowedName = borrowed ? getPropertyName(borrowed) : null
      if (!borrowedName || !READ_ONLY_METHODS.has(borrowedName)) {
        markReceiver(call.arguments?.[0]?.expression, true)
      }
      return
    }
    const root = getRootName(member.object)
    if ((method && READ_ONLY_METHODS.has(method)) || (root && GLOBAL_NAMESPACES.has(root))) {
      return
    }
    // ids.slice().sort()：修改的是新建的副本，原数据不变。
    if (isFreshCollection(member.object)) {
      return
    }
    // admin.tags.push(...)：修改的是某个对象的字段；items.push(...)：修改的是 items 本身。
    markReceiver(member.object, Boolean(asMember(member.object)))
    // 自定义方法可能修改传入的参数；push / set 等集合方法只是把参数存起来。
    if (!method || !COLLECTION_MUTATORS.has(method)) {
      markArguments(call)
    }
  }

  const visit: AncestorVisitor = (raw, ancestors) => {
    const node = raw as AnyNode
    // 嵌套函数内部声明的名字只在那个函数里可见；但其中的写入可能在本轮被调用时发生，仍然计入。
    const nested = ancestors.some(isFunctionNode)
    if (!nested) {
      collectDeclaredNames(node, variant)
      collectDeclaredNames(node, locals)
      if (node.type === 'VariableDeclarator') {
        const names = new Set<string>()
        collectPatternNames(node.id, names)
        addSource(names, node.init)
      }
    }
    switch (node.type) {
      case 'AssignmentExpression':
        markTarget(node.left, node.right)
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
      case 'ForOfStatement': {
        const left = node.left as TypedNode | undefined
        if (left?.type !== 'VariableDeclaration' && left?.type !== 'UsingDeclaration') {
          markTarget(left, node.right)
        } else if (!nested) {
          const names = new Set<string>()
          collectPatternNames(left, names)
          addSource(names, node.right)
        }
        if (node.await && !nested) {
          suspends = true
        }
        break
      }
      case 'AwaitExpression':
      case 'YieldExpression':
        if (!nested) {
          suspends = true
        }
        break
      case 'CallExpression':
        markCall(node as unknown as CallNode)
        break
      default:
        break
    }
    return true
  }

  // 作用域自身：迭代绑定取自驱动表达式；for (state.current of items) 这种成员形式的迭代目标同样是每轮写入。
  const head = scope.node as LoopShape
  addSource(scope.bindings, head.type === 'ForStatement' ? head.init : scope.driver)
  const headType = (head.left as TypedNode | undefined)?.type
  if (
    (head.type === 'ForOfStatement' || head.type === 'ForInStatement') &&
    headType !== 'VariableDeclaration' &&
    headType !== 'UsingDeclaration'
  ) {
    markTarget(head.left)
  }
  for (const region of scope.regions) {
    walkWithAncestors(region, visit, [])
  }

  // 确定的字段写入（x.a = 1、admin.tags.push()）与来历不明的接收者：可能经由别名改到任何元素上。
  // 把局部对象传给未知函数、对局部集合调用 push 等：只影响它的来源集合（normalize(admin) 影响 admins）。
  let memberMutation = false
  const mutatedLocals: string[] = []
  for (const { root, field } of writes) {
    if (field || !root) {
      memberMutation = true
    } else if (locals.has(root)) {
      mutatedLocals.push(root)
    }
  }
  return {
    variant,
    memberMutation,
    mutatedSources: resolveSources(mutatedLocals, sources),
    suspends,
  }
}

// 沿着局部名字的取值来源向外追溯，得到它们最终取自的外部名字（含 this）。
const resolveSources = (names: string[], sources: ReadonlyMap<string, unknown[]>): Set<string> => {
  const outer = new Set<string>()
  const seen = new Set(names)
  const pending = [...seen]
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    walkAst(sources.get(name), (node) => {
      const ref =
        node.type === 'Identifier'
          ? String((node as AnyNode).value)
          : node.type === 'ThisExpression'
            ? 'this'
            : null
      if (ref && sources.has(ref)) {
        if (!seen.has(ref)) {
          seen.add(ref)
          pending.push(ref)
        }
      } else if (ref) {
        outer.add(ref)
      }
      return !isFunctionNode(node)
    })
  }
  return outer
}

// 接收回调的数组方法：回调在第一个参数（Array.from 在第二个）。
const CALLBACK_METHODS = new Set([
  ...HOT_CALLBACK_METHODS,
  'sort',
  'toSorted',
  'findLast',
  'findLastIndex',
])

const getCallbackIndex = (call: CallNode): number => {
  if (getQualifiedName(call.callee) === 'Array.from') {
    return 1
  }
  return CALLBACK_METHODS.has(getCalledMethodName(call) ?? '') ? 0 : -1
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
        const callbackIndex = getCallbackIndex(call)
        call.arguments?.forEach((argument, index) => {
          const argumentNode = stripWrappers(argument.expression)
          if (!argument.spread && isFunctionNode(argumentNode)) {
            visitCallback(argumentNode as AnyNode)
            return
          }
          // admins.map(getId)：回调位置上的函数引用同样按元素计算。
          if (index === callbackIndex) {
            facts.readsElementProps = true
          }
          visitData(argument.expression)
        })
        return
      }
      default:
        facts.pure = false
    }
  }

  // 回调部分：允许任意调用（通常是纯函数），但不允许 await、随机数与对外部变量的写入。
  // 名字按词法作用域解析：回调内部（含嵌套函数、块）声明的同名变量只遮蔽它自己的作用域。
  const visitCallback = (fn: AnyNode): void => {
    if (getScopeDeclaredNames(fn).size > 0) {
      // 回调有参数（或 arguments）：结果依赖集合元素。
      facts.readsElementProps = true
    }
    const isLocal = (name: string, ancestors: ReadonlyArray<TypedNode>): boolean =>
      ancestors.some((ancestor) => getScopeDeclaredNames(ancestor).has(name))

    const isLocalTarget = (target: unknown, ancestors: ReadonlyArray<TypedNode>): boolean => {
      let local = true
      forEachTargetLeaf(target, (leaf) => {
        const name =
          leaf.type === 'Identifier' ? String((leaf as AnyNode).value) : getRootName(leaf)
        if (!name || !isLocal(name, ancestors)) {
          local = false
        }
      })
      return local
    }

    const visitor: AncestorVisitor = (raw, ancestors) => {
      if (!facts.pure) {
        return false
      }
      const node = raw as AnyNode
      switch (node.type) {
        case 'Identifier':
          if (isReferencePosition(node, ancestors) && !isLocal(String(node.value), ancestors)) {
            facts.free.add(String(node.value))
          }
          return false
        case 'ThisExpression':
          // 箭头回调里的 this 来自外层；嵌套的普通函数有自己的 this。
          if (
            !ancestors.some(
              (ancestor) => isFunctionNode(ancestor) && ancestor.type !== 'ArrowFunctionExpression'
            )
          ) {
            facts.free.add('this')
          }
          return false
        case 'AwaitExpression':
        case 'YieldExpression':
          facts.pure = false
          return false
        case 'AssignmentExpression':
          facts.pure = isLocalTarget(node.left, ancestors)
          return facts.pure
        case 'UpdateExpression':
          facts.pure = isLocalTarget(node.argument, ancestors)
          return facts.pure
        case 'UnaryExpression':
          if (node.operator === 'delete') {
            facts.pure = isLocalTarget(node.argument, ancestors)
          }
          return facts.pure
        case 'CallExpression': {
          const call = node as unknown as CallNode
          const qualified = getQualifiedName(call.callee) ?? ''
          const method = getCalledMethodName(call)
          if (NONDETERMINISTIC_CALLS.has(qualified) || MUTATING_STATIC_CALLS.has(qualified)) {
            facts.pure = false
          } else if (method && COLLECTION_MUTATORS.has(method)) {
            const root = getRootName(asMember(call.callee)?.object)
            facts.pure = Boolean(root && isLocal(root, ancestors))
          }
          return facts.pure
        }
        case 'NewExpression': {
          const call = node as unknown as CallNode
          const callee = stripWrappers(call.callee) as AnyNode | null
          if (callee?.type === 'Identifier' && callee.value === 'Date' && !call.arguments?.length) {
            facts.pure = false
          }
          return facts.pure
        }
        default:
          return true
      }
    }

    // 参数也要扫：默认值与计算键里可能引用外部变量（(r, max = limit) => ...、({ [field]: v }) => v）。
    // 回调自身放在祖先链首位，它的参数与 var 由 getScopeDeclaredNames(fn) 解析为局部名字。
    walkWithAncestors(getFunctionParams(fn), visitor, [fn])
    walkWithAncestors(fn.body, visitor, [fn])
  }

  visitData(expression)
  return facts
}
