import type { BlockStatement, Statement } from '@swc/types'
import { RuleSeverity, defineRule } from '../types'
import { resolveLineFromByteOffset } from '../sourceIndex'

// 检测 try/catch/finally 中未处理任何可执行语句的情况（吞掉异常）。
export const noSwallowedErrors = defineRule(
  'no-swallowed-errors',
  { tag: 'base', severity: RuleSeverity.Warning },
  ({ analysis, helpers, messages, source, sourceIndex }) => {
    // analysis.tryStatements 来自共享遍历，避免每条规则重复扫 AST。
    for (const tryStatement of analysis.tryStatements) {
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
      const computedLine = resolveLineFromByteOffset(source, sourceIndex, reportSpan.start)
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
    }
  }
)

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
