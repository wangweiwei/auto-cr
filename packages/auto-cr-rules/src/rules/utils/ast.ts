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
