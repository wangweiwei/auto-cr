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
  ({ ast, helpers, messages, source }) => {
    // Record the start of the module so we can normalise SWC's global byte offsets to file-local positions.
    const moduleStart = ast.span?.start ?? 0
    const lineIndex = buildLineIndex(source)

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

      const report = (): void => {
        // Convert the body span to a line, then fall back to the literal catch line if the maths lands in comments.
        const charIndex = bytePosToCharIndex(source, moduleStart, body.span.start)
        const computedLine = resolveLine(lineIndex, charIndex)
        const fallbackLine = findCatchLine(source, computedLine)
        const line = selectLineNumber(computedLine, fallbackLine)
        helpers.reportViolation(
          {
            description: messages.swallowedError(),
            line,
            span: body.span,
          },
          body.span
        )
      }

      if (statements.length === 0) {
        report()
        return
      }

      const hasThrow = containsThrowStatement(statements)
      const hasLogging = hasLoggingCall(statements)

      if (!hasThrow && !hasLogging) {
        report()
      }
    })
  }
)

type LineIndex = {
  offsets: number[]
}

const buildLineIndex = (source: string): LineIndex => {
  // Collect every newline. We share the helper with the import rule so behaviour stays consistent across detectors.
  const offsets: number[] = [0]

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      offsets.push(index + 1)
    }
  }

  return { offsets }
}

const resolveLine = ({ offsets }: LineIndex, position: number): number => {
  let low = 0
  let high = offsets.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const current = offsets[mid]

    if (current === position) {
      return mid + 1
    }

    if (current < position) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return high + 1
}

const readUtf8Character = (source: string, index: number, code: number): { bytes: number; nextIndex: number } => {
  if (code <= 0x7f) {
    return { bytes: 1, nextIndex: index + 1 }
  }

  if (code <= 0x7ff) {
    return { bytes: 2, nextIndex: index + 1 }
  }

  if (code >= 0xd800 && code <= 0xdbff && index + 1 < source.length) {
    const next = source.charCodeAt(index + 1)
    if (next >= 0xdc00 && next <= 0xdfff) {
      return { bytes: 4, nextIndex: index + 2 }
    }
  }

  return { bytes: 3, nextIndex: index + 1 }
}

const bytePosToCharIndex = (source: string, moduleStart: number, bytePos: number): number => {
  const target = Math.max(bytePos - moduleStart, 0)

  if (target === 0) {
    return 0
  }

  let index = 0
  let byteOffset = 0

  while (index < source.length) {
    const code = source.charCodeAt(index)
    const { bytes, nextIndex } = readUtf8Character(source, index, code)

    if (byteOffset + bytes > target) {
      return index
    }

    byteOffset += bytes
    index = nextIndex
  }

  return source.length
}

const findCatchLine = (source: string, computedLine?: number): number | undefined => {
  const lines = source.split(/\r?\n/)
  const startIndex = Math.max((computedLine ?? 1) - 1, 0)
  const catchPattern = /\bcatch\b/

  // Walk forward from the computed line so we land on the actual catch clause even if decorators or comments exist.
  for (let index = startIndex; index < lines.length; index += 1) {
    if (catchPattern.test(lines[index])) {
      return index + 1
    }
  }

  return undefined
}

const selectLineNumber = (computed?: number, fallback?: number): number | undefined => {
  // Mirror the behaviour in the import rule: prefer the fallback when it is available and appears after the computed line.
  if (fallback === undefined) {
    return computed
  }

  if (computed === undefined) {
    return fallback
  }

  if (computed < fallback) {
    return fallback
  }

  return computed
}
