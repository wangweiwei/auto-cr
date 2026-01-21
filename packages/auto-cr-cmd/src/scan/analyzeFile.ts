import type { Span } from '@swc/types'
import { parseSync } from '@swc/wasm'
import { loadParseOptions } from '../config'
import { createReporter, type ReporterFormat } from '../report'
import { getLanguage, getTranslator } from '../i18n'
import { readFile } from '../utils/file'
import type { Rule, RuleContext, RuleReporter } from 'auto-cr-rules'
import type { AnalyzeFileSummary, Logger } from './types'

export interface ReporterHooks {
  onBeforeReport?: () => void
  onAfterReport?: () => void
}

export type CreateRuleContext = typeof import('auto-cr-rules').createRuleContext

type ReporterSpanArg = Parameters<RuleReporter['errorAtSpan']>[0]

/**
 * 单文件扫描流程：
 * - 读取源码并解析 AST；
 * - 构建规则上下文（共享 AST 索引、源码索引等）；
 * - 逐条执行规则，收集 reporter 输出；
 * - 汇总为文件级统计。
 */
export async function analyzeFile(
  file: string,
  rules: Rule[],
  format: ReporterFormat,
  log: Logger,
  createRuleContext: CreateRuleContext,
  reporterHooks?: ReporterHooks
): Promise<AnalyzeFileSummary> {
  const source = readFile(file)
  // reporter 负责收集违规与（可选）输出；format=json 用于 worker/缓存场景避免直接输出。
  const reporter = createReporter(file, source, { format, ...reporterHooks })
  const t = getTranslator()

  let ast

  try {
    const parseOptions = loadParseOptions(file)
    ast = parseSync(source, parseOptions as unknown as Parameters<typeof parseSync>[1])
  } catch (error) {
    log('error', t.parseFileFailed({ file }), error)
    return {
      severityCounts: {
        error: 1,
        warning: 0,
        optimizing: 0,
      },
      totalViolations: 1,
      errorViolations: 1,
      violations: [],
    }
  }

  const language = getLanguage()
  const baseContext = createRuleContext({
    ast,
    filePath: file,
    source,
    reporter,
    language,
  })

  // baseContext 已经包含共享分析索引（imports/loops/hotPath 等）。
  const sharedHelpers = baseContext.helpers

  for (const rule of rules) {
    try {
      const scopedReporter = reporter.forRule(rule)
      const reporterWithRecord = scopedReporter as RuleReporter & {
        record?: (record: ReporterRecordPayload) => void
      }

      // 每条规则都有独立 reporter，但共享 helpers 与分析索引。
      const helpers: RuleContext['helpers'] = {
        ...sharedHelpers,
        reportViolation: ((input: unknown, span?: ReporterSpanArg): void => {
          // 统一把规则输出收敛成结构化数据，避免各规则实现重复分支。
          const normalized = normalizeViolationInput(input, span)
          const resolvedLine = resolveLineForViolation(baseContext.source, baseContext.sourceIndex, normalized)

          if (typeof reporterWithRecord.record === 'function') {
            reporterWithRecord.record({
              description: normalized.message,
              code: normalized.code,
              suggestions: normalized.suggestions,
              span: normalized.span,
              line: resolvedLine,
            })
            return
          }

          if (resolvedLine !== undefined) {
            scopedReporter.errorAtLine(resolvedLine, normalized.message)
            return
          }

          if (normalized.span) {
            scopedReporter.errorAtSpan(normalized.span, normalized.message)
            return
          }

          scopedReporter.error(normalized.message)
        }) as RuleContext['helpers']['reportViolation'],
      }

      const context: RuleContext = {
        ...baseContext,
        reporter: scopedReporter,
        helpers,
      }

      await rule.run(context)
    } catch (error) {
      log('error', t.ruleExecutionFailed({ ruleName: rule.name, file }), error)
    }
  }

  // flush 会在 text 模式输出日志，在 json 模式只返回结构化结果。
  const summary = reporter.flush()

  return {
    severityCounts: summary.severityCounts,
    totalViolations: summary.totalViolations,
    errorViolations: summary.errorViolations,
    violations: summary.violations,
  }
}

interface NormalizedViolation {
  message: string
  span?: ReporterSpanArg
  line?: number
  code?: string
  suggestions?: ReadonlyArray<SuggestionEntry>
}

interface ReporterRecordPayload {
  description: string
  code?: string
  suggestions?: ReadonlyArray<SuggestionEntry>
  span?: ReporterSpanArg
  line?: number
}

type SuggestionEntry = {
  text: string
  link?: string
}

function normalizeViolationInput(
  input: unknown,
  spanArg?: ReporterSpanArg
): NormalizedViolation {
  // 规则既可以直接输出字符串，也可以输出结构化对象；这里统一为标准格式。
  if (typeof input === 'string') {
    return {
      message: input,
      span: spanArg,
    }
  }

  if (input && typeof input === 'object') {
    // 兼容 rules 返回的 { description/message/code/suggestions/span/line } 结构。
    const candidate = input as {
      description?: unknown
      message?: unknown
      span?: ReporterSpanArg
      line?: number
      code?: unknown
      suggestions?: unknown
    }

    const description =
      typeof candidate.description === 'string'
        ? candidate.description
        : typeof candidate.message === 'string'
          ? candidate.message
          : undefined

    const code = typeof candidate.code === 'string' ? candidate.code : undefined

    let suggestions: ReadonlyArray<SuggestionEntry> | undefined
    if (Array.isArray(candidate.suggestions)) {
      const normalizedSuggestions: SuggestionEntry[] = []

      for (const entry of candidate.suggestions) {
        if (typeof entry === 'string') {
          normalizedSuggestions.push({ text: entry })
          continue
        }

        if (entry && typeof entry === 'object') {
          const suggestion = entry as { text?: unknown; link?: unknown }
          if (typeof suggestion.text === 'string') {
            normalizedSuggestions.push({
              text: suggestion.text,
              link: typeof suggestion.link === 'string' ? suggestion.link : undefined,
            })
          }
        }
      }

      if (normalizedSuggestions.length > 0) {
        suggestions = normalizedSuggestions
      }
    }

    return {
      message: description ?? 'Rule violation detected.',
      span: candidate.span ?? spanArg,
      line: typeof candidate.line === 'number' ? candidate.line : undefined,
      code,
      suggestions,
    }
  }

  return {
    message: 'Rule violation detected.',
    span: spanArg,
  }
}

type SpanCarrier = { span?: Span }

const resolveLineForViolation = (
  source: string,
  sourceIndex: RuleContext['sourceIndex'],
  violation: NormalizedViolation
): number | undefined => {
  if (typeof violation.line === 'number' && Number.isFinite(violation.line)) {
    return violation.line
  }

  const span = extractSpan(violation.span)
  if (!span) {
    return undefined
  }

  const line = resolveLineFromByteOffset(source, sourceIndex, span.start)
  return Number.isFinite(line) ? line : undefined
}

const extractSpan = (spanLike: Span | SpanCarrier | undefined): Span | undefined => {
  if (!spanLike) {
    return undefined
  }

  if (typeof spanLike === 'object' && 'span' in spanLike) {
    return spanLike.span
  }

  return spanLike as Span
}

const resolveLineFromByteOffset = (
  source: string,
  index: RuleContext['sourceIndex'],
  byteOffset: number
): number => {
  const charIndex = bytePosToCharIndex(source, index.moduleStart, byteOffset)
  return resolveLine(index.lineOffsets, charIndex)
}

const resolveLine = (lineOffsets: number[], position: number): number => {
  let low = 0
  let high = lineOffsets.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const current = lineOffsets[mid]

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
