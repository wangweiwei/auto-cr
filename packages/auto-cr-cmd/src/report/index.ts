import type { Span } from '@swc/types'
import { RuleSeverity } from 'auto-cr-rules'
import type { Rule, RuleReporter, RuleReporterRecord, RuleSuggestion } from 'auto-cr-rules'
import consola from 'consola'
import { getLanguage, getTranslator } from '../i18n'

export interface Reporter extends RuleReporter {
  forRule(rule: Pick<Rule, 'name' | 'tag' | 'severity'>): RuleReporter
  flush(): void
}

interface SpanCarrier {
  span?: Span
}

type LineOffsets = number[]

type Severity = RuleSeverity

interface ViolationRecord {
  tag: string
  line?: number
  description: string
  code?: string
  suggestions?: ReadonlyArray<RuleSuggestion>
  ruleName: string
  severity: Severity
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

  const pushRecord = (record: ViolationRecord): void => {
    records.push(record)
  }

  const error = (message: string): void => {
    pushRecord({
      tag: UNTAGGED_TAG,
      ruleName: 'general',
      severity: RuleSeverity.Error,
      description: message,
    })
  }

  const errorAtLine = (line: number | undefined, message: string): void => {
    pushRecord({
      tag: UNTAGGED_TAG,
      ruleName: 'general',
      severity: RuleSeverity.Error,
      description: message,
      line,
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
      description: string
      line?: number
      code?: string
      suggestions?: ReadonlyArray<RuleSuggestion>
    }): void => {
      pushRecord({
        tag,
        ruleName: rule.name,
        severity,
        description: payload.description,
        line: payload.line,
        code: payload.code,
        suggestions: payload.suggestions,
      })
    }

    const scopedError = (message: string): void => {
      store({ description: message })
    }

    const scopedErrorAtLine = (line: number | undefined, message: string): void => {
      store({ description: message, line })
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

    const record = (violation: RuleReporterRecord): void => {
      const line = resolveLine(violation, offsets)
      store({
        description: violation.description,
        line,
        code: violation.code,
        suggestions: violation.suggestions,
      })
    }

    return {
      error: scopedError,
      errorAtLine: scopedErrorAtLine,
      errorAtSpan: scopedErrorAtSpan,
      record,
    }
  }

  const flush = (): void => {
    if (records.length === 0) {
      return
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

    records.forEach((violation, index) => {
      if (index > 0) {
        consola.log('')
      }

      const timestamp = formatter.format(new Date())
      const tagLabel = t.ruleTagLabel({ tag: violation.tag })
      const severityIcon = t.reporterSeverityIcon({ severity: violation.severity })
      const logger = getLoggerForSeverity(violation.severity)
      const header = `[${timestamp}] ${severityIcon} [${tagLabel}]${colon}${headerGap}${violation.ruleName}`
      logger(header)

      const location = typeof violation.line === 'number' ? `${filePath}:${violation.line}` : filePath
      consola.log(`${indent}${t.reporterFileLabel()}: ${location}`)

      if (violation.code) {
        consola.log(`${indent}${t.reporterCodeLabel()}: ${violation.code}`)
      }

      consola.log(`${indent}${t.reporterDescriptionLabel()}: ${violation.description}`)

      if (violation.suggestions && violation.suggestions.length > 0) {
        const suggestionSeparator = language === 'zh' ? '； ' : ' | '
        const suggestionLine = violation.suggestions
          .map((suggestion) => t.reporterFormatSuggestion(suggestion))
          .join(suggestionSeparator)

        consola.log(`${indent}${t.reporterSuggestionLabel()}: ${suggestionLine}`)
      }
    })

    records.length = 0
  }

  return Object.assign({ error, errorAtLine, errorAtSpan }, {
    forRule: buildRuleReporter,
    flush,
  }) as Reporter
}

function getLoggerForSeverity(severity: Severity): (message?: unknown, ...args: unknown[]) => void {
  return severityLoggers[severity] ?? consola.error
}

function resolveLine(violation: RuleReporterRecord, offsets: LineOffsets): number | undefined {
  if (typeof violation.line === 'number') {
    return violation.line
  }

  if (violation.span) {
    return offsetToLine(violation.span.start, offsets)
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
