import type { CallExpression, Expression, NewExpression, Span, TemplateLiteral } from '@swc/types'

// RegExp 构造调用的静态分析，供多条正则相关规则共享。

export type RegExpPattern = {
  pattern: string
  span?: Span
}

// 从 new RegExp(...) / RegExp(...) 中提取静态模式；callee 不是 RegExp 或模式为动态值时返回 null。
export const extractRegExpPattern = (expression: CallExpression | NewExpression): RegExpPattern | null => {
  const callee = expression.callee
  if (callee.type !== 'Identifier' || callee.value !== 'RegExp') {
    return null
  }

  const args = expression.arguments ?? []
  if (args.length === 0) {
    return null
  }

  const pattern = getStaticPattern(args[0]?.expression)
  if (!pattern) {
    return null
  }

  return {
    pattern,
    span: expression.span,
  }
}

// 只接受字符串字面量或无表达式的模板字符串。
export const getStaticPattern = (expression?: Expression): string | null => {
  if (!expression) {
    return null
  }

  const candidate = unwrapExpression(expression)

  if (candidate.type === 'StringLiteral') {
    return candidate.value
  }

  if (candidate.type === 'TemplateLiteral') {
    return resolveTemplateLiteral(candidate)
  }

  return null
}

export const unwrapExpression = (expression: Expression): Expression => {
  let current = expression

  while (current.type === 'ParenthesisExpression') {
    current = current.expression
  }

  return current
}

// 仅当模板字符串没有插值表达式时才返回完整字符串。
const resolveTemplateLiteral = (literal: TemplateLiteral): string | null => {
  if (literal.expressions.length > 0) {
    return null
  }

  return literal.quasis.map((quasi) => quasi.cooked ?? quasi.raw).join('')
}
