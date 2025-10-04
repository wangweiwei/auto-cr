import type {
  Argument,
  CallExpression,
  Identifier,
  ImportDeclaration,
  MemberExpression,
  Module,
  Span,
  StringLiteral,
} from '@swc/types'
import type { ImportReference } from './types'

type SwcNode = {
  type: string
}

const isSwcNode = (value: unknown): value is SwcNode => {
  if (!value || typeof value !== 'object') {
    return false
  }

  if (!('type' in value)) {
    return false
  }

  return typeof (value as { type: unknown }).type === 'string'
}

const traverse = (value: unknown, visitor: (node: SwcNode) => void): void => {
  if (Array.isArray(value)) {
    for (const element of value) {
      traverse(element, visitor)
    }
    return
  }

  if (!value || typeof value !== 'object') {
    return
  }

  if (isSwcNode(value)) {
    visitor(value)
  }

  const record = value as Record<string, unknown>

  for (const child of Object.values(record)) {
    if (typeof child === 'object' && child !== null) {
      traverse(child, visitor)
    }
  }
}

const isImportDeclaration = (node: SwcNode): node is ImportDeclaration => node.type === 'ImportDeclaration'

const isCallExpression = (node: SwcNode): node is CallExpression => node.type === 'CallExpression'

export const collectImportReferences = (module: Module): ImportReference[] => {
  const results: ImportReference[] = []

  traverse(module, (node) => {
    if (isImportDeclaration(node)) {
      results.push({
        kind: 'static',
        value: node.source.value,
        span: node.source.span,
      })
      return
    }

    if (isCallExpression(node)) {
      const reference = extractFromCallExpression(node)
      if (reference) {
        results.push(reference)
      }
    }
  })

  return results
}

const extractFromCallExpression = (node: CallExpression): ImportReference | null => {
  if (!node.arguments.length) {
    return null
  }

  const [firstArgument] = node.arguments

  if (!firstArgument || isSpread(firstArgument)) {
    return null
  }

  const literal = getStringLiteral(firstArgument)

  if (!literal) {
    return null
  }

  if (node.callee.type === 'Import') {
    return createImportReference('dynamic', literal)
  }

  if (isRequireIdentifier(node.callee) || isRequireMember(node.callee)) {
    return createImportReference('require', literal)
  }

  return null
}

const createImportReference = (kind: ImportReference['kind'], literal: StringLiteral): ImportReference => ({
  kind,
  value: literal.value,
  span: literal.span,
})

const isSpread = (argument: Argument): boolean => Boolean(argument.spread)

const getStringLiteral = (argument: Argument): StringLiteral | null => {
  if (argument.expression.type === 'StringLiteral') {
    return argument.expression
  }

  return null
}

const isRequireIdentifier = (expression: CallExpression['callee']): expression is Identifier => {
  return expression.type === 'Identifier' && expression.value === 'require'
}

const isRequireMember = (expression: CallExpression['callee']): expression is MemberExpression => {
  return (
    expression.type === 'MemberExpression' &&
    expression.object.type === 'Identifier' &&
    expression.object.value === 'require'
  )
}
