import type { BlockStatement, Module, Statement, TryStatement } from '@swc/types'
import { RuleSeverity, defineRule } from '../types'

// 检测 try/catch/finally 中未处理任何可执行语句的情况（吞掉异常）。
export const noSwallowedErrors = defineRule(
  'no-swallowed-errors',
  { tag: 'base', severity: RuleSeverity.Warning },
  ({ ast, helpers, messages, source }) => {
    const moduleStart = ast.span?.start ?? 0
    const lineIndex = buildLineIndex(source)

    visitTryStatements(ast, (tryStatement) => {
      const catchBlock = tryStatement.handler?.body ?? null
      const finallyBlock = tryStatement.finalizer ?? null

      const catchHasExecutable = catchBlock ? hasExecutableStatements(catchBlock.stmts) : false
      const finallyHasExecutable = finallyBlock ? hasExecutableStatements(finallyBlock.stmts) : false

      // 任意一段有真实逻辑，则认为异常被处理或至少被记录。
      if (catchHasExecutable || finallyHasExecutable) {
        return
      }

      // 尽量指向 catch/finally 块本身，保证定位直观。
      const reportSpan = catchBlock?.span ?? finallyBlock?.span ?? tryStatement.span
      const charIndex = bytePosToCharIndex(source, moduleStart, reportSpan.start)
      const computedLine = resolveLine(lineIndex, charIndex)
      const fallbackLine = determineFallbackLine({
        source,
        computedLine,
        hasCatch: Boolean(catchBlock),
        hasFinally: Boolean(finallyBlock),
      })
      const line = selectLineNumber(computedLine, fallbackLine)

      helpers.reportViolation(
        {
          description: messages.swallowedError(),
          line,
          span: reportSpan,
        },
        reportSpan
      )
    })
  }
)

type LineIndex = {
  offsets: number[]
}

const buildLineIndex = (source: string): LineIndex => {
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

const determineFallbackLine = ({
  source,
  computedLine,
  hasCatch,
  hasFinally,
}: {
  source: string
  computedLine?: number
  hasCatch: boolean
  hasFinally: boolean
}): number | undefined => {
  if (hasCatch) {
    return findKeywordLine(source, computedLine, /\bcatch\b/)
  }

  if (hasFinally) {
    return findKeywordLine(source, computedLine, /\bfinally\b/)
  }

  return findKeywordLine(source, computedLine, /\btry\b/)
}

const findKeywordLine = (source: string, computedLine: number | undefined, pattern: RegExp): number | undefined => {
  const lines = source.split(/\r?\n/)
  const startIndex = Math.max((computedLine ?? 1) - 1, 0)

  for (let index = startIndex; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) {
      return index + 1
    }
  }

  return undefined
}

const selectLineNumber = (computed?: number, fallback?: number): number | undefined => {
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

const visitTryStatements = (ast: Module, callback: (statement: TryStatement) => void): void => {
  const queue: unknown[] = [ast]

  while (queue.length > 0) {
    const current = queue.pop()

    if (!current || typeof current !== 'object') {
      continue
    }

    const candidate = current as { type?: string }

    if (candidate.type === 'TryStatement') {
      callback(candidate as TryStatement)
    }

    for (const value of Object.values(candidate)) {
      queue.push(value)
    }
  }
}

const hasExecutableStatements = (statements: Statement[]): boolean => {
  return statements.some(isExecutableStatement)
}

const isExecutableStatement = (statement: Statement): boolean => {
  switch (statement.type) {
    case 'EmptyStatement':
      return false
    case 'BlockStatement':
      return hasExecutableStatements((statement as BlockStatement).stmts)
    default:
      return true
  }
}
