import type { CallExpression, MemberExpression, Module, Statement } from '@swc/types'
import { RuleSeverity, defineRule } from '../types'

const LOG_METHODS = new Set(['error', 'warn', 'info', 'log', 'fatal'])

const isLoggingCall = (expression: CallExpression): boolean => {
  const callee = expression.callee

  if (callee.type === 'Identifier') {
    const name = callee.value.toLowerCase()
    return name.includes('log') || name.includes('error') || name.includes('report')
  }

  if (callee.type === 'MemberExpression') {
    const member = callee as MemberExpression
    const property = member.property

    if (property.type === 'Identifier' && LOG_METHODS.has(property.value)) {
      return true
    }
  }

  return false
}

const hasLoggingCall = (statements: Statement[]): boolean => {
  for (const statement of statements) {
    if (statement.type === 'ExpressionStatement' && statement.expression.type === 'CallExpression') {
      if (isLoggingCall(statement.expression)) {
        return true
      }
    }
  }

  return false
}

const containsThrowStatement = (node: unknown): boolean => {
  const queue: unknown[] = [node]

  while (queue.length > 0) {
    const current = queue.pop()

    if (!current || typeof current !== 'object') {
      continue
    }

    const candidate = current as { type?: string }

    if (candidate.type === 'ThrowStatement') {
      return true
    }

    for (const value of Object.values(candidate)) {
      queue.push(value)
    }
  }

  return false
}

const visitTryStatements = (ast: Module, callback: (statement: Statement) => void): void => {
  const queue: unknown[] = [ast]

  while (queue.length > 0) {
    const current = queue.pop()

    if (!current || typeof current !== 'object') {
      continue
    }

    const candidate = current as { type?: string }

    if (candidate.type === 'TryStatement') {
      callback(candidate as Statement)
    }

    for (const value of Object.values(candidate)) {
      queue.push(value)
    }
  }
}

export const noSwallowedErrors = defineRule(
  'no-swallowed-errors',
  { tag: 'base', severity: RuleSeverity.Warning },
  ({ ast, helpers, messages }) => {
    visitTryStatements(ast, (statement) => {
      if (statement.type !== 'TryStatement') {
        return
      }

      const handler = statement.handler

      if (!handler) {
        return
      }

      const body = handler.body
      const statements = body.stmts

      if (statements.length === 0) {
        helpers.reportViolation({
          description: messages.swallowedError(),
          span: body.span,
        })
        return
      }

      const hasThrow = containsThrowStatement(statements)
      const hasLogging = hasLoggingCall(statements)

      if (!hasThrow && !hasLogging) {
        helpers.reportViolation({
          description: messages.swallowedError(),
          span: body.span,
        })
      }
    })
  }
)
