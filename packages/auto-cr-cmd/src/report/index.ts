import type { Span } from '@swc/types'
import { RuleSeverity } from 'auto-cr-rules'
import type { Rule, RuleReporter } from 'auto-cr-rules'
import consola from 'consola'
import { getLanguage, getTranslator } from '../i18n'

export interface Reporter extends RuleReporter {
  forRule(rule: Pick<Rule, 'name' | 'tag' | 'severity'>): RuleReporter
  flush(): ReporterSummary
}

interface ReporterSummary {
  totalViolations: number
  errorViolations: number
  severityCounts: {
    error: number
    warning: number
    optimizing: number
  }
}

interface SpanCarrier {
  span?: Span
}

type LineOffsets = number[]

type Severity = RuleSeverity

type SuggestionEntry = {
  text: string
  link?: string
}

interface ReporterRecordPayload {
  description: string
  code?: string
  suggestions?: ReadonlyArray<SuggestionEntry>
  span?: Span
  line?: number
}

interface ViolationRecord {
  tag: string
  ruleName: string
  severity: Severity
  message: string
  line?: number
  code?: string
  suggestions?: ReadonlyArray<SuggestionEntry>
}

type CompatibleRuleReporter = RuleReporter & {
  record?: (payload: ReporterRecordPayload) => void
}

const UNTAGGED_TAG = 'untagged'
const severityLoggers: Record<Severity, (message?: unknown, ...args: unknown[]) => void> = {
  [RuleSeverity.Error]: consola.error,
  [RuleSeverity.Warning]: consola.warn,
  [RuleSeverity.Optimizing]: consola.info,
}

export function createReporter(filePath: string, source: string): Reporter {
  const offsets = buildLineOffsets(source)
  const t = getTranslator()
  const language = getLanguage()
  const records: ViolationRecord[] = []

  let totalViolations = 0
  let errorViolations = 0
  const severityCounts = {
    error: 0,
    warning: 0,
    optimizing: 0,
  }

  const pushRecord = (record: ViolationRecord): void => {
    records.push(record)
    totalViolations += 1

    if (record.severity === RuleSeverity.Error) {
      errorViolations += 1
      severityCounts.error += 1
    } else if (record.severity === RuleSeverity.Warning) {
      severityCounts.warning += 1
    } else if (record.severity === RuleSeverity.Optimizing) {
      severityCounts.optimizing += 1
    }
  }

  const error = (message: string): void => {
    pushRecord({
      tag: UNTAGGED_TAG,
      ruleName: 'general',
      severity: RuleSeverity.Error,
      message,
    })
  }

  const errorAtLine = (line: number | undefined, message: string): void => {
    pushRecord({
      tag: UNTAGGED_TAG,
      ruleName: 'general',
      severity: RuleSeverity.Error,
      line,
      message,
    })
  }

  const errorAtSpan = (spanLike: Span | SpanCarrier | undefined, message: string): void => {
    const span = extractSpan(spanLike)

    if (!span) {
      error(message)
      return
    }

    const line = offsetToLine(span.start, offsets)
    errorAtLine(line, message)
  }

  const buildRuleReporter = (rule: Pick<Rule, 'name' | 'tag' | 'severity'>): RuleReporter => {
    const tag = rule.tag ?? UNTAGGED_TAG
    const severity = rule.severity ?? RuleSeverity.Error

    const store = (payload: {
      message: string
      line?: number
      code?: string
      suggestions?: ReadonlyArray<SuggestionEntry>
    }): void => {
      pushRecord({
        tag,
        ruleName: rule.name,
        severity,
        message: payload.message,
        line: payload.line,
        code: payload.code,
        suggestions: payload.suggestions,
      })
    }

    const scopedError = (message: string): void => {
      store({ message })
    }

    const scopedErrorAtLine = (line: number | undefined, message: string): void => {
      store({ message, line })
    }

    const scopedErrorAtSpan = (spanLike: Span | SpanCarrier | undefined, message: string): void => {
      const span = extractSpan(spanLike)

      if (!span) {
        scopedError(message)
        return
      }

      const line = offsetToLine(span.start, offsets)
      scopedErrorAtLine(line, message)
    }

    const record = (payload: ReporterRecordPayload): void => {
      const line = resolveLine(payload, offsets)
      store({
        message: payload.description,
        line,
        code: payload.code,
        suggestions: payload.suggestions,
      })
    }

    const reporterWithRecord: CompatibleRuleReporter = {
      error: scopedError,
      errorAtLine: scopedErrorAtLine,
      errorAtSpan: scopedErrorAtSpan,
      record,
    }

    return reporterWithRecord
  }

  const flush = (): ReporterSummary => {
    const summary: ReporterSummary = {
      totalViolations,
      errorViolations,
      severityCounts: {
        error: severityCounts.error,
        warning: severityCounts.warning,
        optimizing: severityCounts.optimizing,
      },
    }

    if (records.length === 0) {
      resetCounters()
      return summary
    }

    const locale = language === 'zh' ? 'zh-CN' : 'en-US'
    const formatter = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })

    const indent = '    '
    const colon = language === 'zh' ? '：' : ':'
    const headerGap = language === 'zh' ? '' : ' '

    records.forEach((violation) => {
      const timestamp = formatter.format(new Date())
      const tagLabel = t.ruleTagLabel({ tag: violation.tag })
      const severityIcon = t.reporterSeverityIcon({ severity: violation.severity })
      const logger = getLoggerForSeverity(violation.severity)
      const header = `[${timestamp}] ${severityIcon} [${tagLabel}]${colon}${headerGap}${violation.ruleName}`
      logger(header)

      const location = typeof violation.line === 'number' ? `${filePath}:${violation.line}` : filePath
      consola.log(`${indent}${t.reporterFileLabel()}: ${location}`)
      consola.log(`${indent}${t.reporterDescriptionLabel()}: ${violation.message}`)

      if (violation.code) {
        consola.log(`${indent}${t.reporterCodeLabel()}: ${violation.code}`)
      }

      if (violation.suggestions && violation.suggestions.length > 0) {
        const suggestionSeparator = language === 'zh' ? '； ' : ' | '
        const suggestionLine = violation.suggestions
          .map((suggestion) => t.reporterFormatSuggestion(suggestion))
          .join(suggestionSeparator)

        consola.log(`${indent}${t.reporterSuggestionLabel()}: ${suggestionLine}`)
      }
    })

    records.length = 0
    resetCounters()
    return summary
  }

  const resetCounters = (): void => {
    totalViolations = 0
    errorViolations = 0
    severityCounts.error = 0
    severityCounts.warning = 0
    severityCounts.optimizing = 0
  }

  return Object.assign({ error, errorAtLine, errorAtSpan }, {
    forRule: buildRuleReporter,
    flush,
  }) as Reporter
}

function getLoggerForSeverity(severity: Severity): (message?: unknown, ...args: unknown[]) => void {
  return severityLoggers[severity] ?? consola.error
}

function resolveLine(record: ReporterRecordPayload, offsets: LineOffsets): number | undefined {
  if (typeof record.line === 'number') {
    return record.line
  }

  if (record.span) {
    return offsetToLine(record.span.start, offsets)
  }

  return undefined
}

function extractSpan(spanLike: Span | SpanCarrier | undefined): Span | undefined {
  if (!spanLike) {
    return undefined
  }

  if (hasSpan(spanLike)) {
    return spanLike.span
  }

  return spanLike as Span
}

function hasSpan(value: Span | SpanCarrier): value is SpanCarrier {
  return typeof value === 'object' && value !== null && 'span' in value
}

function buildLineOffsets(source: string): LineOffsets {
  const offsets: number[] = [0]

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      offsets.push(index + 1)
    }
  }

  return offsets
}

function offsetToLine(offset: number, offsets: LineOffsets): number {
  let low = 0
  let high = offsets.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const current = offsets[mid]

    if (current === offset) {
      return mid + 1
    }

    if (current < offset) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return high + 1
}
