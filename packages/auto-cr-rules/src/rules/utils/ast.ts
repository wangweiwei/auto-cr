export type TypedNode = { type?: string }

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
export const TYPE_ONLY_KEYS = new Set([
  'span',
  'typeAnnotation',
  'typeParameters',
  'typeParams',
  'typeArguments',
  'superTypeParams',
  'returnType',
  'implements',
])

// 带祖先链的遍历：ancestors 只包含带 type 的节点（ExprOrSpread 这类无 type 的包装层会被跳过），
// 因此调用参数的父节点就是 CallExpression 本身。visitor 返回 false 时不再深入。
export const walkWithAncestors = (
  root: unknown,
  visitor: (node: TypedNode, ancestors: ReadonlyArray<TypedNode>) => boolean | void,
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
export const FUNCTION_NODE_TYPES = new Set([
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

// 不改变运行期取值的包装：括号、TS 断言、非空断言、可选链外壳。判定表达式形态前统一剥掉。
export const TRANSPARENT_WRAPPERS = new Set([
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
  while (current && typeof current === 'object') {
    if (current.type === 'OptionalChainingExpression') {
      current = (current.base ?? null) as typeof current
      continue
    }
    if (current.type && TRANSPARENT_WRAPPERS.has(current.type)) {
      current = (current.expression ?? null) as typeof current
      continue
    }
    return current
  }
  return null
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

// obj.name / obj['name'] 的属性名；计算属性不是字符串字面量时返回 null。
export const getPropertyName = (member: MemberNode): string | null => {
  const property = member.property
  if (property.type === 'Identifier') {
    return property.value ?? null
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

// 成员链的根：a.b[c].d → 'a'，this.x → 'this'；根不是标识符/this 时返回 null。
export const getRootName = (node: unknown): string | null => {
  let current = stripWrappers(node) as (TypedNode & { value?: string }) | null
  while (current) {
    if (current.type === 'Identifier') {
      return current.value ?? null
    }
    if (current.type === 'ThisExpression') {
      return 'this'
    }
    if (current.type === 'MemberExpression') {
      current = stripWrappers((current as MemberNode).object) as typeof current
      continue
    }
    if (current.type === 'CallExpression') {
      // a.b().c 这类链式调用：根仍取最左侧的对象，便于识别 a 上的变更。
      current = stripWrappers((current as CallNode).callee) as typeof current
      continue
    }
    return null
  }
  return null
}

// 收集模式（参数、声明、for-of 左侧）中绑定的名字，支持解构、默认值与剩余参数。
export const collectPatternNames = (pattern: unknown, out: Set<string>): void => {
  const node = pattern as
    | (TypedNode & {
        value?: string
        pat?: unknown
        elements?: unknown[]
        properties?: unknown[]
        key?: TypedNode & { value?: string }
        left?: unknown
        argument?: unknown
        declarations?: Array<{ id: unknown }>
        expression?: unknown
      })
    | null
    | undefined
  if (!node || typeof node !== 'object') {
    return
  }
  switch (node.type) {
    case 'Identifier':
      if (node.value) {
        out.add(node.value)
      }
      return
    case 'Parameter':
      collectPatternNames(node.pat, out)
      return
    case 'TsParameterProperty':
      collectPatternNames((node as { param?: unknown }).param, out)
      return
    case 'ArrayPattern':
      node.elements?.forEach((element) => collectPatternNames(element, out))
      return
    case 'ObjectPattern':
      node.properties?.forEach((property) => collectPatternNames(property, out))
      return
    case 'AssignmentPatternProperty':
      collectPatternNames(node.key, out)
      return
    case 'KeyValuePatternProperty':
      collectPatternNames((node as { value?: unknown }).value, out)
      return
    case 'AssignmentPattern':
      collectPatternNames(node.left, out)
      return
    case 'RestElement':
      collectPatternNames(node.argument, out)
      return
    case 'VariableDeclaration':
      node.declarations?.forEach((declarator) => collectPatternNames(declarator.id, out))
      return
    default:
      return
  }
}

// 报告里展示的简短表达式：标识符、成员链、调用与 new 按形态缩写，其余一律用 ... 代替。
export const describeExpression = (node: unknown, depth = 0): string => {
  const stripped = stripWrappers(node) as (TypedNode & { value?: unknown }) | null
  if (!stripped || depth > 4) {
    return '...'
  }
  switch (stripped.type) {
    case 'Identifier':
      return String(stripped.value)
    case 'ThisExpression':
      return 'this'
    case 'StringLiteral':
      return `'${String(stripped.value)}'`
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return String(stripped.value)
    case 'MemberExpression': {
      const member = stripped as MemberNode
      const object = describeExpression(member.object, depth + 1)
      if (member.property.type === 'Identifier') {
        return `${object}.${member.property.value}`
      }
      const name = getPropertyName(member)
      return name !== null ? `${object}['${name}']` : `${object}[...]`
    }
    case 'CallExpression': {
      const call = stripped as CallNode
      return `${describeExpression(call.callee, depth + 1)}(${call.arguments?.length ? '...' : ''})`
    }
    case 'NewExpression': {
      const call = stripped as CallNode
      return `new ${describeExpression(call.callee, depth + 1)}(${call.arguments?.length ? '...' : ''})`
    }
    case 'ArrayExpression':
      return '[...]'
    case 'ObjectExpression':
      return '{...}'
    default:
      return '...'
  }
}
