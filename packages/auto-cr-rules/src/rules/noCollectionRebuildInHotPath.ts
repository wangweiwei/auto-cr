import type { Span } from '@swc/types'
import { RuleSeverity, defineRule } from '../types'
import {
  describeExpression,
  getCalledMethodName,
  getNameChain,
  getPropertyName,
  isTransparentWrapper,
  stripWrappers,
  walkWithAncestors,
  type CallNode,
  type MemberNode,
  type TypedNode,
} from './utils/ast'
import {
  collectHotScopes,
  createInvarianceChecker,
  isInLoopCondition,
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
        if (!isBuilderNode(node)) {
          return true
        }
        // 只判定最外层的构建表达式：new Set(admins.map(...)) 报 new Set，不再单独报内层的 map。
        // 先做局部的消费方式判断，再做代价更高的不变性分析。
        if (
          !isInLoopCondition(scope, node, ancestors) &&
          isConsumedReadOnly(node, ancestors, scope) &&
          checker.isInvariant(node, scope, { allowCall: isBuilderNode })
        ) {
          const code = describeBuilder(node)
          helpers.reportViolation(
            {
              description: messages.noCollectionRebuildInHotPath({ code }),
              code,
              suggestions: buildSuggestions(language, code),
              span: (node as { span?: Span }).span,
            },
            (node as { span?: Span }).span
          )
        }
        return false
      })
    }
  }
)

// 由已有数据派生出新集合的方法。
const MEMBER_BUILDERS = new Set([
  'map',
  'filter',
  'flatMap',
  'flat',
  'split',
  'concat',
  'slice',
  'toSorted',
  'toReversed',
])
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

// 只读消费：查找、判断、取长度、拼接成字符串。遍历（for...of / forEach）本身就是 O(m)，重建只多一个常数因子，不在范围内。
const READ_METHODS = new Set([
  'has',
  'get',
  'includes',
  'indexOf',
  'lastIndexOf',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'some',
  'every',
  'at',
  'join',
])
const READ_PROPERTIES = new Set(['length', 'size'])

type BuilderShape = TypedNode & {
  callee?: TypedNode
  arguments?: Array<{ spread?: unknown; expression: TypedNode }>
  elements?: Array<{ spread?: unknown; expression: TypedNode } | null>
}

// 只看节点本身的形态，不剥包装：否则 (new Set(ids)) 的括号和里面的 new 会各判一次。
const isBuilderNode = (raw: TypedNode | CallNode): boolean => {
  const node = raw as BuilderShape
  switch (node.type) {
    case 'NewExpression': {
      const callee = stripWrappers(node.callee) as (TypedNode & { value?: string }) | null
      const [first] = node.arguments ?? []
      return Boolean(
        callee?.type === 'Identifier' &&
        callee.value &&
        CONSTRUCTOR_BUILDERS.has(callee.value) &&
        first &&
        !first.spread
      )
    }
    case 'CallExpression': {
      const call = node as CallNode
      const chain = getNameChain(call.callee)
      if (chain && STATIC_BUILDERS.has(chain.join('.'))) {
        return Boolean(call.arguments?.length)
      }
      const method = getCalledMethodName(call)
      if (!method) {
        return false
      }
      if (MEMBER_BUILDERS.has(method)) {
        return true
      }
      if (IN_PLACE_BUILDERS.has(method)) {
        const receiver = stripWrappers((stripWrappers(call.callee) as MemberNode).object)
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

// 向上跳过括号、TS 断言、可选链外壳，返回真正消费该节点的父节点及其下标。
const findConsumer = (
  node: TypedNode,
  ancestors: ReadonlyArray<TypedNode>,
  fromIndex: number
): { child: TypedNode; parent: TypedNode | undefined; index: number } => {
  let child = node
  let index = fromIndex
  while (index >= 0 && isTransparentWrapper(ancestors[index])) {
    child = ancestors[index]
    index -= 1
  }
  return { child, parent: ancestors[index], index }
}

// 节点是否是赋值、自增或 delete 的目标。
const isWriteTarget = (child: TypedNode, parent: TypedNode | undefined): boolean => {
  if (!parent) {
    return false
  }
  const shape = parent as TypedNode & { left?: unknown; argument?: unknown; operator?: string }
  if (parent.type === 'AssignmentExpression') {
    return shape.left === child
  }
  if (parent.type === 'UpdateExpression') {
    return shape.argument === child
  }
  return (
    parent.type === 'UnaryExpression' && shape.operator === 'delete' && shape.argument === child
  )
}

// 节点以只读方式被消费：作为 .has()/.includes() 等查找方法的接收者，或被读取 .length/.size/[i]。
const isReadOnlyUse = (
  node: TypedNode,
  ancestors: ReadonlyArray<TypedNode>,
  fromIndex: number
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

  if (name && READ_METHODS.has(name)) {
    return isCallee
  }
  if (isCallee || isWriteTarget(outer.child, outer.parent)) {
    return false
  }
  if (name && READ_PROPERTIES.has(name)) {
    return true
  }
  // 按下标读取：list[0] / list[i]。
  return member.property.type === 'Computed' && name === null
}

// 构建结果的消费方式是否只读：直接查找，或赋给本轮的 const 后只被查找。
const isConsumedReadOnly = (
  node: TypedNode,
  ancestors: ReadonlyArray<TypedNode>,
  scope: HotScope
): boolean => {
  if (isReadOnlyUse(node, ancestors, ancestors.length - 1)) {
    return true
  }

  const { child, parent, index } = findConsumer(node, ancestors, ancestors.length - 1)
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
        if (!isReadOnlyUse(candidate, candidateAncestors, candidateAncestors.length - 1)) {
          readOnly = false
        }
        return true
      },
      [scope.node]
    )
  }
  return readOnly && references > 0
}

// 标识符是否处在“引用”位置：obj.name 的属性名、{ name: v } 的键、声明本身都不算引用。
const isReferencePosition = (
  identifier: TypedNode,
  ancestors: ReadonlyArray<TypedNode>
): boolean => {
  const parent = ancestors[ancestors.length - 1] as
    | (TypedNode & { property?: unknown; key?: unknown; id?: unknown })
    | undefined
  if (!parent) {
    return true
  }
  if (parent.type === 'MemberExpression') {
    return parent.property !== identifier
  }
  if (parent.type === 'KeyValueProperty') {
    return parent.key !== identifier
  }
  if (parent.type === 'VariableDeclarator') {
    return parent.id !== identifier
  }
  return true
}

// 报告中展示的构建形态：new Set(ids)、admins.map(...)、Object.keys(config)、[...source]。
const describeBuilder = (raw: TypedNode): string => {
  const node = raw as BuilderShape
  if (node.type === 'ArrayExpression') {
    return `[...${describeExpression(node.elements?.[0]?.expression)}]`
  }
  if (node.type === 'NewExpression' || node.type === 'CallExpression') {
    const chain = getNameChain(node.callee)
    const argument = node.arguments?.[0]?.expression
    if (node.type === 'NewExpression' || (chain && STATIC_BUILDERS.has(chain.join('.')))) {
      const prefix = node.type === 'NewExpression' ? 'new ' : ''
      return `${prefix}${describeExpression(node.callee)}(${argument ? describeExpression(argument) : ''})`
    }
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
