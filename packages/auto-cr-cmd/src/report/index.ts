import type { Span } from '@swc/types'
import { RuleSeverity } from 'auto-cr-rules'
import type { Rule, RuleReporter } from 'auto-cr-rules'
import consola from 'consola'
import { getTranslator } from '../i18n'

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
  line?: number
  message: string
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
  const records = new Map<string, ViolationRecord[]>()

  const pushRecord = (
    tag: string,
    ruleName: string,
    message: string,
    severity: Severity,
    line?: number
  ): void => {
    if (!records.has(tag)) {
      records.set(tag, [])
    }

    records.get(tag)!.push({ line, message, ruleName, severity })
  }

  const makeStore = (tag: string, ruleName: string, severity: Severity) => {
    return (message: string, line?: number): void => {
      pushRecord(tag, ruleName, message, severity, line)
    }
  }

  const generalStore = makeStore(UNTAGGED_TAG, 'general', RuleSeverity.Error)

  const error = (message: string): void => {
    generalStore(message)
  }

  const errorAtLine = (line: number | undefined, message: string): void => {
    generalStore(message, line)
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
    const store = makeStore(tag, rule.name, severity)

    const scopedError = (message: string): void => {
      store(message)
    }

    const scopedErrorAtLine = (line: number | undefined, message: string): void => {
      store(message, line)
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

    return {
      error: scopedError,
      errorAtLine: scopedErrorAtLine,
      errorAtSpan: scopedErrorAtSpan,
    }
  }

  const flush = (): void => {
    if (records.size === 0) {
      return
    }

    let firstTag = true

    records.forEach((violations, tag) => {
      if (violations.length === 0) {
        return
      }

      if (!firstTag) {
        consola.log('')
      }

      firstTag = false
      const label = t.ruleTagLabel({ tag })
      consola.info(`[${label}]`)

      violations.forEach((violation) => {
        const location = typeof violation.line === 'number' ? `${filePath}:${violation.line}` : filePath
        const ruleSuffix = violation.ruleName ? ` (${violation.ruleName})` : ''
        const severityLabel = t.reporterSeverityLabel({ severity: violation.severity })
        const logger = getLoggerForSeverity(violation.severity)
        logger(`[${severityLabel}] ${location}${ruleSuffix} ${violation.message}`)
      })
    })

    records.clear()
  }

  return Object.assign({ error, errorAtLine, errorAtSpan }, {
    forRule: buildRuleReporter,
    flush,
  }) as Reporter
}

function getLoggerForSeverity(severity: Severity): (message?: unknown, ...args: unknown[]) => void {
  return severityLoggers[severity] ?? consola.error
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
