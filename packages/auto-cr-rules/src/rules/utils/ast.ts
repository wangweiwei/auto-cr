import type { Span } from '@swc/types'

export type TypedNode = { type?: string; span?: Span }

// 通用 AST 子树遍历：visitor 返回 false 时不再深入该节点。
// span 只是位置信息，跳过以减少无意义递归。
export const walkAst = (root: unknown, visitor: (node: TypedNode) => boolean): void => {
  if (!root || typeof root !== 'object') {
    return
  }
  if (Array.isArray(root)) {
    root.forEach((item) => walkAst(item, visitor))
    return
  }
  const node = root as TypedNode
  if (node.type && !visitor(node)) {
    return
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'span') {
      continue
    }
    walkAst(value, visitor)
  }
}

// 类型标注相关的字段：只描述类型，运行期不存在，遍历时整体跳过。
const TYPE_ONLY_KEYS = new Set([
  'span',
  'typeAnnotation',
  'typeParameters',
  'typeParams',
  'typeArguments',
  'superTypeParams',
  'returnType',
  'implements',
])

export type AncestorVisitor = (
  node: TypedNode,
  ancestors: ReadonlyArray<TypedNode>
) => boolean | void

// 带祖先链的遍历：ancestors 只包含带 type 的节点（ExprOrSpread 这类无 type 的包装层会被跳过），
// 因此调用参数的父节点就是 CallExpression 本身。visitor 返回 false 时不再深入。
export const walkWithAncestors = (
  root: unknown,
  visitor: AncestorVisitor,
  ancestors: TypedNode[] = []
): void => {
  if (!root || typeof root !== 'object') {
    return
  }
  if (Array.isArray(root)) {
    for (const item of root) {
      walkWithAncestors(item, visitor, ancestors)
    }
    return
  }
  const node = root as TypedNode & Record<string, unknown>
  const typed = typeof node.type === 'string'
  if (typed && visitor(node, ancestors) === false) {
    return
  }
  if (typed) {
    ancestors.push(node)
  }
  // for...in 避免为每个节点分配 entries 数组；AST 节点是普通对象，没有可枚举的继承属性。
  for (const key in node) {
    if (TYPE_ONLY_KEYS.has(key)) {
      continue
    }
    const value = node[key]
    if (value && typeof value === 'object') {
      walkWithAncestors(value, visitor, ancestors)
    }
  }
  if (typed) {
    ancestors.pop()
  }
}

// 函数边界：函数体只在被调用时执行，“定义在循环里”不等于“每轮都执行”。
// ClassMethod 的函数体挂在无 type 的 function 字段下，因此按成员节点本身判定。
const FUNCTION_NODE_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassMethod',
  'PrivateMethod',
  'Constructor',
  'MethodProperty',
  'GetterProperty',
  'SetterProperty',
])

export const isFunctionNode = (node: TypedNode | null | undefined): boolean =>
  Boolean(node?.type && FUNCTION_NODE_TYPES.has(node.type))

// 各类函数节点的参数：类方法挂在 function.params 下，对象字面量的 setter 只有一个 param。
export const getFunctionParams = (node: TypedNode): unknown[] => {
  const fn = node as TypedNode & {
    params?: unknown[]
    function?: { params?: unknown[] }
    param?: unknown
  }
  return fn.params ?? fn.function?.params ?? (fn.param ? [fn.param] : [])
}

// 不改变运行期取值的包装：括号、TS 断言、非空断言。判定表达式形态前统一剥掉（可选链外壳另行处理）。
const TRANSPARENT_WRAPPERS = new Set([
  'ParenthesisExpression',
  'TsAsExpression',
  'TsSatisfiesExpression',
  'TsNonNullExpression',
  'TsTypeAssertion',
  'TsConstAssertion',
])

// 节点是否只是透明包装（括号、TS 断言、可选链外壳），向上找真正的消费者时需要跳过。
export const isTransparentWrapper = (node: TypedNode | null | undefined): boolean =>
  Boolean(
    node?.type &&
    (node.type === 'OptionalChainingExpression' || TRANSPARENT_WRAPPERS.has(node.type))
  )

export const stripWrappers = (node: unknown): TypedNode | null => {
  let current = (node ?? null) as (TypedNode & { expression?: unknown; base?: unknown }) | null
  while (current && typeof current === 'object' && isTransparentWrapper(current)) {
    current = (
      current.type === 'OptionalChainingExpression' ? current.base : current.expression
    ) as typeof current
  }
  return current && typeof current === 'object' ? current : null
}

export type MemberNode = TypedNode & {
  type: 'MemberExpression'
  object: TypedNode
  property: TypedNode & { value?: string; expression?: TypedNode }
}

export type CallNode = TypedNode & {
  type: 'CallExpression' | 'NewExpression'
  callee: TypedNode
  arguments?: Array<{ spread?: unknown; expression: TypedNode }>
}

export const asMember = (node: unknown): MemberNode | null => {
  const stripped = stripWrappers(node)
  return stripped?.type === 'MemberExpression' ? (stripped as MemberNode) : null
}

export const asCall = (node: unknown): CallNode | null => {
  const stripped = stripWrappers(node)
  return stripped?.type === 'CallExpression' ? (stripped as CallNode) : null
}

// obj.name / obj['name'] 的属性名，私有字段 obj.#name 返回 '#name'（不会与同名公有属性混淆）；
// 计算属性不是字符串字面量时返回 null。
export const getPropertyName = (member: MemberNode): string | null => {
  const property = member.property
  if (property.type === 'Identifier') {
    return property.value ?? null
  }
  if (property.type === 'PrivateName') {
    return property.value ? `#${property.value}` : null
  }
  if (property.type === 'Computed') {
    const key = stripWrappers(property.expression) as (TypedNode & { value?: unknown }) | null
    if (key?.type === 'StringLiteral' && typeof key.value === 'string') {
      return key.value
    }
  }
  return null
}

// 调用的“方法名”：a.b(...) / a?.b(...) / a['b'](...) 返回 'b'；不是成员调用时返回 null。
export const getCalledMethodName = (call: CallNode): string | null => {
  const member = asMember(call.callee)
  return member ? getPropertyName(member) : null
}

// 名称链：this.prisma.user.findUnique → ['this', 'prisma', 'user', 'findUnique']。
// 链上出现调用、非字面量计算属性等无法命名的环节时返回 null。
export const getNameChain = (node: unknown): string[] | null => {
  const stripped = stripWrappers(node) as (TypedNode & { value?: string }) | null
  if (!stripped) {
    return null
  }
  if (stripped.type === 'Identifier') {
    return stripped.value ? [stripped.value] : null
  }
  if (stripped.type === 'ThisExpression') {
    return ['this']
  }
  if (stripped.type === 'MemberExpression') {
    const member = stripped as MemberNode
    const name = getPropertyName(member)
    const head = getNameChain(member.object)
    return name && head ? [...head, name] : null
  }
  return null
}

// 点号连接的完整名称：JSON.stringify、Object.keys；无法命名时返回 null。
export const getQualifiedName = (node: unknown): string | null =>
  getNameChain(node)?.join('.') ?? null

// 成员链的根：a.b[c].d → 'a'，this.x / super.x → 'this'；根不是标识符/this 时返回 null。
export const getRootName = (node: unknown): string | null => {
  let current = stripWrappers(node) as (TypedNode & { value?: string }) | null
  while (current) {
    switch (current.type) {
      case 'Identifier':
        return current.value ?? null
      case 'ThisExpression':
      case 'SuperPropExpression':
        return 'this'
      case 'MemberExpression':
        current = stripWrappers((current as MemberNode).object) as typeof current
        continue
      case 'CallExpression':
        // a.b().c 这类链式调用：根仍取最左侧的对象，便于识别 a 上的变更。
        current = stripWrappers((current as CallNode).callee) as typeof current
        continue
      default:
        return null
    }
  }
  return null
}

type PatternShape = TypedNode & {
  value?: string
  pat?: unknown
  param?: unknown
  elements?: unknown[]
  properties?: unknown[]
  key?: unknown
  left?: unknown
  argument?: unknown
  declarations?: Array<{ id: unknown }>
  decls?: Array<{ id: unknown }>
}

// 遍历绑定/赋值目标的叶子：标识符与成员表达式。解构、默认值、剩余参数、声明、参数都会展开，
// 每一层都先剥掉括号与 TS 断言（(x as T) = ...、x! = ...）。
export const forEachTargetLeaf = (target: unknown, visit: (leaf: TypedNode) => void): void => {
  const node = stripWrappers(target) as PatternShape | null
  if (!node) {
    return
  }
  switch (node.type) {
    case 'Identifier':
    case 'MemberExpression':
    case 'SuperPropExpression':
      visit(node)
      return
    case 'Parameter':
      forEachTargetLeaf(node.pat, visit)
      return
    case 'TsParameterProperty':
      forEachTargetLeaf(node.param, visit)
      return
    case 'ArrayPattern':
      node.elements?.forEach((element) => forEachTargetLeaf(element, visit))
      return
    case 'ObjectPattern':
      node.properties?.forEach((property) => forEachTargetLeaf(property, visit))
      return
    case 'AssignmentPatternProperty':
      forEachTargetLeaf(node.key, visit)
      return
    case 'KeyValuePatternProperty':
      forEachTargetLeaf(node.value, visit)
      return
    case 'AssignmentPattern':
      forEachTargetLeaf(node.left, visit)
      return
    case 'RestElement':
      forEachTargetLeaf(node.argument, visit)
      return
    case 'VariableDeclaration':
    case 'UsingDeclaration':
      ;(node.declarations ?? node.decls)?.forEach((declarator) =>
        forEachTargetLeaf(declarator.id, visit)
      )
      return
    default:
      return
  }
}

// 收集模式（参数、声明、for-of 左侧、赋值目标）中绑定的名字。
export const collectPatternNames = (pattern: unknown, out: Set<string>): void => {
  forEachTargetLeaf(pattern, (leaf) => {
    const name = (leaf as { value?: string }).value
    if (leaf.type === 'Identifier' && name) {
      out.add(name)
    }
  })
}

type DeclarationShape = TypedNode & {
  id?: unknown
  identifier?: unknown
  param?: unknown
  kind?: string
  body?: unknown
  function?: { body?: unknown }
  stmts?: TypedNode[]
  init?: TypedNode
  left?: TypedNode
}

// 节点在本层声明的名字：变量、函数、类、catch 参数。
export const collectDeclaredNames = (node: TypedNode, out: Set<string>): void => {
  const shape = node as DeclarationShape
  switch (shape.type) {
    case 'VariableDeclarator':
      collectPatternNames(shape.id, out)
      break
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      collectPatternNames(shape.identifier, out)
      break
    case 'CatchClause':
      collectPatternNames(shape.param, out)
      break
    default:
      break
  }
}

const scopeNamesCache = new WeakMap<object, ReadonlySet<string>>()
const EMPTY_NAMES: ReadonlySet<string> = new Set()

// 节点按词法作用域引入的名字：函数的参数与 var（function 表达式还有自身名字与 arguments）、
// 块内的 let/const/class/function、catch 参数、for 头部的声明。其它节点返回空集合。
export const getScopeDeclaredNames = (node: TypedNode): ReadonlySet<string> => {
  const cached = scopeNamesCache.get(node)
  if (cached) {
    return cached
  }
  const shape = node as DeclarationShape
  const names = new Set<string>()
  if (isFunctionNode(shape)) {
    getFunctionParams(shape).forEach((param) => collectPatternNames(param, names))
    if (shape.type === 'FunctionExpression') {
      collectPatternNames(shape.identifier, names)
      names.add('arguments')
    }
    // var 提升到函数作用域：收集函数体内（不跨越嵌套函数）的所有 var。
    walkAst(shape.function?.body ?? shape.body, (inner) => {
      if (isFunctionNode(inner)) {
        return false
      }
      if (inner.type === 'VariableDeclaration' && (inner as DeclarationShape).kind === 'var') {
        collectPatternNames(inner, names)
      }
      return true
    })
  } else if (shape.type === 'BlockStatement') {
    for (const statement of shape.stmts ?? []) {
      if (statement.type === 'VariableDeclaration') {
        collectPatternNames(statement, names)
      } else {
        collectDeclaredNames(statement, names)
      }
    }
  } else if (shape.type === 'CatchClause') {
    collectPatternNames(shape.param, names)
  } else if (shape.type === 'ForStatement') {
    if (shape.init?.type === 'VariableDeclaration') {
      collectPatternNames(shape.init, names)
    }
  } else if (shape.type === 'ForInStatement' || shape.type === 'ForOfStatement') {
    if (shape.left?.type === 'VariableDeclaration' || shape.left?.type === 'UsingDeclaration') {
      collectPatternNames(shape.left, names)
    }
  }
  const result = names.size > 0 ? names : EMPTY_NAMES
  scopeNamesCache.set(node, result)
  return result
}

// 向上跳过括号、TS 断言、可选链外壳，返回真正消费该节点的父节点及其在 ancestors 中的下标。
export const findConsumer = (
  node: TypedNode,
  ancestors: ReadonlyArray<TypedNode>,
  fromIndex = ancestors.length - 1
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
export const isWriteTarget = (child: TypedNode, parent: TypedNode | undefined): boolean => {
  const shape = parent as
    | (TypedNode & { left?: unknown; argument?: unknown; operator?: string })
    | undefined
  switch (shape?.type) {
    case 'AssignmentExpression':
      return shape.left === child
    case 'UpdateExpression':
      return shape.argument === child
    case 'UnaryExpression':
      return shape.operator === 'delete' && shape.argument === child
    default:
      return false
  }
}

// 标识符是否处在“引用”位置：obj.name 的属性名、{ name: v } / { name: pattern } 的键、方法/类成员的键、
// 标签名、JSX 属性名以及声明本身都不是引用。
export const isReferencePosition = (
  identifier: TypedNode,
  ancestors: ReadonlyArray<TypedNode>
): boolean => {
  const parent = ancestors[ancestors.length - 1] as
    | (TypedNode & {
        property?: unknown
        key?: unknown
        id?: unknown
        label?: unknown
        name?: unknown
      })
    | undefined
  if (!parent) {
    return true
  }
  switch (parent.type) {
    case 'MemberExpression':
    case 'SuperPropExpression':
    case 'JSXMemberExpression':
      return parent.property !== identifier
    case 'VariableDeclarator':
      return parent.id !== identifier
    case 'JSXAttribute':
      return parent.name !== identifier
    default:
      return parent.key !== identifier && parent.label !== identifier
  }
}

// undefined / void 0：值为 undefined 的表达式。
export const isUndefinedExpression = (expression: unknown): boolean => {
  const node = stripWrappers(expression) as
    | (TypedNode & { value?: string; operator?: string })
    | null
  return (
    (node?.type === 'Identifier' && node.value === 'undefined') ||
    (node?.type === 'UnaryExpression' && node.operator === 'void')
  )
}

export const isNullishExpression = (expression: unknown): boolean =>
  stripWrappers(expression)?.type === 'NullLiteral' || isUndefinedExpression(expression)

// JSON.stringify(x) 且没有 replacer（或 replacer 为 null / undefined）时返回 x。
export const getStringifiedValue = (call: CallNode): TypedNode | null => {
  if (getQualifiedName(call.callee) !== 'JSON.stringify') {
    return null
  }
  const [value, replacer] = call.arguments ?? []
  if (!value || value.spread || (replacer && !isNullishExpression(replacer.expression))) {
    return null
  }
  return value.expression
}

// 报告里展示的简短表达式：标识符、成员链、调用与 new 按形态缩写，其余一律用 ... 代替。
export const describeExpression = (node: unknown, depth = 0): string => {
  const stripped = stripWrappers(node) as (TypedNode & { value?: unknown }) | null
  if (!stripped || depth > 8) {
    return '...'
  }
  switch (stripped.type) {
    case 'Identifier':
      return String(stripped.value)
    case 'ThisExpression':
      return 'this'
    case 'StringLiteral': {
      const text = String(stripped.value)
      return text.length <= 24 ? JSON.stringify(text) : '"..."'
    }
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return String(stripped.value)
    case 'MemberExpression':
    case 'SuperPropExpression': {
      const member = stripped as MemberNode & { obj?: unknown }
      const inner =
        stripped.type === 'SuperPropExpression'
          ? 'super'
          : describeExpression(member.object, depth + 1)
      const object = inner === '...' ? '(...)' : inner
      const name =
        stripped.type === 'MemberExpression'
          ? getPropertyName(member)
          : (member.property.value ?? null)
      if (name === null) {
        return `${object}[...]`
      }
      return member.property.type === 'Computed'
        ? `${object}[${JSON.stringify(name)}]`
        : `${object}.${name}`
    }
    case 'CallExpression':
    case 'NewExpression': {
      const call = stripped as CallNode
      const prefix = stripped.type === 'NewExpression' ? 'new ' : ''
      return `${prefix}${describeExpression(call.callee, depth + 1)}(${call.arguments?.length ? '...' : ''})`
    }
    case 'ArrayExpression':
      return '[...]'
    case 'ObjectExpression':
      return '{...}'
    default:
      return '...'
  }
}
