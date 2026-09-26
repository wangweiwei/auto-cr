import { RuleSeverity, defineRule } from '../types'
import {
  asMember,
  describeExpression,
  findConsumer,
  getCalledMethodName,
  getPropertyName,
  getQualifiedName,
  isReferencePosition,
  isWriteTarget,
  stripWrappers,
  walkAst,
  walkWithAncestors,
  type CallNode,
  type MemberNode,
  type TypedNode,
} from './utils/ast'
import {
  FRESH_COLLECTION_METHODS,
  collectHotScopes,
  createInvarianceChecker,
  isInLoopCondition,
  isLeavingScope,
  walkScopeOwnRegion,
  type HotScope,
} from './utils/hotScopes'

// 检测热路径里“每轮都重新构建一个其实不变的集合”：
//   users.filter((u) => admins.map((a) => a.id).includes(u.id))
//   items.filter((item) => new Set(ids).has(item.id))
// admins / ids 在迭代之间没有变化，集合却在每一轮都重新分配、遍历一遍，n 次迭代就是 n 份重复工作；
// 用来做成员判断时还叠加了线性查找，整体从 O(n + m) 变成 O(n·m)。
// 只报两类只读消费方式，避免误伤“每轮需要一份新副本”的写法：
// - 构建结果立刻被查找/取长度/按下标读取（.has / .includes / .length / [0] ...）；
// - 构建结果赋给本轮的 const，且该常量在本作用域内只被上述方式读取。
// throw 里、循环中 return 里的构建每次进入作用域至多执行一次，不报。
export const noCollectionRebuildInHotPath = defineRule(
  'no-collection-rebuild-in-hot-path',
  { tag: 'performance', severity: RuleSeverity.Optimizing },
  ({ analysis, helpers, language, messages }) => {
    const scopes = collectHotScopes(analysis)
    if (scopes.length === 0) {
      return
    }

    const scopeNodes = new Set<unknown>(scopes.map((scope) => scope.node))
    const checker = createInvarianceChecker(analysis)

    for (const scope of scopes) {
      walkScopeOwnRegion(scope, scopeNodes, (node, ancestors) => {
        if (
          !isBuilderNode(node) ||
          isInLoopCondition(scope, node, ancestors) ||
          isLeavingScope(scope, ancestors)
        ) {
          return true
        }
        // 先做局部的消费方式判断，再做代价更高的不变性分析。
        // 未上报时继续检查它的接收者/参数：内层构建直接作为接收者或参数，不会被只读消费，不会重复上报。
        if (
          !isConsumedReadOnly(node, ancestors, scope) ||
          !checker.isInvariant(node, scope, { allowCall: isInvariantCall })
        ) {
          return true
        }
        const code = describeBuilder(node)
        helpers.reportViolation(
          {
            description: messages.noCollectionRebuildInHotPath({ code }),
            code,
            suggestions: buildSuggestions(language, code),
            span: node.span,
          },
          node.span
        )
        // 已上报的外层构建不再深入：new Set(admins.map(...)) 只报 new Set。
        return false
      })
    }
  }
)

// sort / reverse 会原地修改接收者：只有接收者本身就是新建的集合时，整个表达式才是“构建”。
const IN_PLACE_BUILDERS = new Set(['sort', 'reverse'])
const STATIC_BUILDERS = new Set([
  'Object.keys',
  'Object.values',
  'Object.entries',
  'Object.fromEntries',
  'Array.from',
])
const CONSTRUCTOR_BUILDERS = new Set(['Set', 'Map'])
// 无参的 keys() / values() / entries() 只是把 Map / Set / 数组转成迭代器：[...byId.keys()] 与 [...seen] 等价。
const ITERATOR_METHODS = new Set(['keys', 'values', 'entries'])

// 只读消费：查找、判断、取长度、拼接成字符串。遍历（for...of / forEach）本身就是 O(m)，重建只多一个常数因子，不在范围内。
const READ_METHODS = new Set([
  'has',
  'includes',
  'indexOf',
  'lastIndexOf',
  'findIndex',
  'findLastIndex',
  'some',
  'every',
  'join',
])
// 取出元素的读取：元素若是每轮新建的对象（map 回调返回 [] / {}），取出后可能被修改或传出，不能算只读。
const ELEMENT_READ_METHODS = new Set(['get', 'find', 'findLast', 'at'])
const READ_PROPERTIES = new Set(['length', 'size'])

type BuilderShape = TypedNode & {
  callee?: TypedNode
  arguments?: Array<{ spread?: unknown; expression: TypedNode }>
  elements?: Array<{ spread?: unknown; expression: TypedNode } | null>
}

const isStaticBuilderCall = (call: CallNode): boolean =>
  STATIC_BUILDERS.has(getQualifiedName(call.callee) ?? '')

// 只看节点本身的形态，不剥包装：否则 (new Set(ids)) 的括号和里面的 new 会各判一次。
const isBuilderNode = (raw: TypedNode): boolean => {
  const node = raw as BuilderShape
  switch (node.type) {
    case 'NewExpression': {
      const callee = stripWrappers(node.callee) as (TypedNode & { value?: string }) | null
      const [first] = node.arguments ?? []
      return Boolean(
        callee?.type === 'Identifier' &&
        CONSTRUCTOR_BUILDERS.has(callee.value ?? '') &&
        first &&
        !first.spread
      )
    }
    case 'CallExpression': {
      const call = node as CallNode
      if (isStaticBuilderCall(call)) {
        return Boolean(call.arguments?.length)
      }
      const method = getCalledMethodName(call)
      if (method && FRESH_COLLECTION_METHODS.has(method)) {
        return true
      }
      if (method && IN_PLACE_BUILDERS.has(method)) {
        const receiver = stripWrappers(asMember(call.callee)?.object)
        return Boolean(receiver && isBuilderNode(receiver))
      }
      return false
    }
    case 'ArrayExpression': {
      // [...source]：拷贝一份数组。
      const elements = node.elements ?? []
      return elements.length === 1 && Boolean(elements[0]?.spread)
    }
    default:
      return false
  }
}

const isInvariantCall = (call: CallNode): boolean =>
  isBuilderNode(call) ||
  (call.type === 'CallExpression' &&
    !call.arguments?.length &&
    ITERATOR_METHODS.has(getCalledMethodName(call) ?? ''))

// 值是否每次求值都新建一个可变对象。条目模式下（new Map / Object.fromEntries 的 [key, value]）只看 value。
const isFreshValue = (expression: unknown, entries: boolean): boolean => {
  const node = stripWrappers(expression) as BuilderShape | null
  switch (node?.type) {
    case 'ObjectExpression':
    case 'NewExpression':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ClassExpression':
      return true
    case 'ArrayExpression': {
      const elements = node.elements ?? []
      if (entries && elements.length === 2 && !elements[1]?.spread) {
        return isFreshValue(elements[1]?.expression, false)
      }
      return true
    }
    default:
      return false
  }
}

// 构建出的元素是否每轮新建：map 回调返回 [] / {} / new X，Array.from({ length }, () => [])，
// new Map(keys.map((k) => [k, []]))，new Map([['open', []]])。
const yieldsFreshElements = (builder: TypedNode): boolean => {
  const call = builder as CallNode
  const entries =
    (builder.type === 'NewExpression' && getQualifiedName(call.callee) === 'Map') ||
    (builder.type === 'CallExpression' && getQualifiedName(call.callee) === 'Object.fromEntries')
  if (entries) {
    const literal = stripWrappers(call.arguments?.[0]?.expression) as BuilderShape | null
    if (
      literal?.type === 'ArrayExpression' &&
      (literal.elements ?? []).some((element) => isFreshValue(element?.expression, true))
    ) {
      return true
    }
  }
  let fresh = false
  walkAst(builder, (raw) => {
    const node = raw as TypedNode & { body?: TypedNode; argument?: unknown }
    if (node.type === 'ArrowFunctionExpression' && node.body?.type !== 'BlockStatement') {
      fresh ||= isFreshValue(node.body, entries)
    } else if (node.type === 'ReturnStatement') {
      fresh ||= isFreshValue(node.argument, entries)
    }
    return !fresh
  })
  return fresh
}

// 节点以只读方式被消费：作为 .has()/.includes() 等查找方法的接收者，或被读取 .length/.size/[i]。
// freshElements 为真时，取出元素的读取（.get / .find / .at / [i]）不算只读。
const isReadOnlyUse = (
  node: TypedNode,
  ancestors: ReadonlyArray<TypedNode>,
  fromIndex: number,
  freshElements: boolean
): boolean => {
  const { child, parent, index } = findConsumer(node, ancestors, fromIndex)
  if (parent?.type !== 'MemberExpression' || (parent as MemberNode).object !== child) {
    return false
  }

  const member = parent as MemberNode
  const name = getPropertyName(member)
  const outer = findConsumer(member, ancestors, index - 1)
  const isCallee =
    outer.parent?.type === 'CallExpression' &&
    stripWrappers((outer.parent as CallNode).callee) === member

  if (name && (READ_METHODS.has(name) || ELEMENT_READ_METHODS.has(name))) {
    return isCallee && !(freshElements && ELEMENT_READ_METHODS.has(name))
  }
  if (isCallee || isWriteTarget(outer.child, outer.parent)) {
    return false
  }
  if (name && READ_PROPERTIES.has(name)) {
    return true
  }
  // 按下标读取：list[0] / list[i]。
  return !freshElements && member.property.type === 'Computed' && name === null
}

// 构建结果的消费方式是否只读：直接查找，或赋给本轮的 const 后只被查找。
const isConsumedReadOnly = (
  node: TypedNode,
  ancestors: ReadonlyArray<TypedNode>,
  scope: HotScope
): boolean => {
  const freshElements = yieldsFreshElements(node)
  if (isReadOnlyUse(node, ancestors, ancestors.length - 1, freshElements)) {
    return true
  }

  const { child, parent, index } = findConsumer(node, ancestors)
  const declarator = parent as
    | (TypedNode & { id?: TypedNode & { value?: string }; init?: unknown })
    | undefined
  const declaration = ancestors[index - 1] as (TypedNode & { kind?: string }) | undefined
  if (
    declarator?.type !== 'VariableDeclarator' ||
    declarator.init !== child ||
    declarator.id?.type !== 'Identifier' ||
    declaration?.type !== 'VariableDeclaration' ||
    declaration.kind !== 'const'
  ) {
    return false
  }

  const name = declarator.id.value
  let references = 0
  let readOnly = true
  for (const region of scope.regions) {
    walkWithAncestors(
      region,
      (candidate, candidateAncestors) => {
        if (!readOnly) {
          return false
        }
        if (candidate.type !== 'Identifier' || (candidate as { value?: string }).value !== name) {
          return true
        }
        if (candidate === declarator.id || !isReferencePosition(candidate, candidateAncestors)) {
          return true
        }
        references += 1
        readOnly = isReadOnlyUse(
          candidate,
          candidateAncestors,
          candidateAncestors.length - 1,
          freshElements
        )
        return true
      },
      [scope.node]
    )
  }
  return readOnly && references > 0
}

// 报告中展示的构建形态：new Set(ids)、admins.map(...)、Object.keys(config)、[...source]。
const describeBuilder = (raw: TypedNode): string => {
  const node = raw as BuilderShape
  if (node.type === 'ArrayExpression') {
    const inner = describeExpression(node.elements?.[0]?.expression)
    return inner === '...' ? '[...]' : `[...${inner}]`
  }
  if (
    node.type === 'NewExpression' ||
    (node.type === 'CallExpression' && isStaticBuilderCall(node as CallNode))
  ) {
    const argument = node.arguments?.[0]?.expression
    const prefix = node.type === 'NewExpression' ? 'new ' : ''
    return `${prefix}${describeExpression(node.callee)}(${argument ? describeExpression(argument) : ''})`
  }
  return describeExpression(node)
}

const buildSuggestions = (language: string, code: string) =>
  language === 'zh'
    ? [
        { text: `把 ${code} 提升到循环/回调之前只构建一次，循环体内直接复用。` },
        {
          text: '若只用于成员判断，提升时顺便改成 Set / Map（例如 const adminIds = new Set(admins.map((a) => a.id))），每次查找从 O(m) 降到 O(1)。',
        },
      ]
    : [
        { text: `Build ${code} once before the loop/callback and reuse it inside.` },
        {
          text: 'If it is only used for membership checks, turn it into a Set/Map while hoisting (e.g. const adminIds = new Set(admins.map((a) => a.id))) so each lookup is O(1) instead of O(m).',
        },
      ]
