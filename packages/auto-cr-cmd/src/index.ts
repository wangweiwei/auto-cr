#!/usr/bin/env node
import { consola } from 'consola'
import fs from 'fs'
import path from 'path'
import { program } from 'commander'
import { parseSync } from '@swc/wasm'
import { loadParseOptions, setTsConfigPath } from './config'
import { createReporter, type ReporterFormat, type ViolationRecord } from './report'
import { getLanguage, getTranslator, setLanguage } from './i18n'
import { readFile, getAllFiles, checkPathExists } from './utils/file'
import { readPathsFromStdin } from './utils/stdin'
import { builtinRules, createRuleContext, RuleSeverity } from 'auto-cr-rules'
import { loadCustomRules } from './rules/loader'
import { applyRuleConfig, loadAutoCrRc } from './config/autocrrc'
import { createIgnoreMatcher, loadIgnoreConfig } from './config/ignore'
import type { Rule, RuleContext, RuleReporter } from 'auto-cr-rules'

consola.options.formatOptions = {
  ...consola.options.formatOptions,
  date: false,
}

interface ScanSummary {
  scannedFiles: number
  filesWithErrors: number
  filesWithWarnings: number
  filesWithOptimizing: number
  violationTotals: {
    total: number
    error: number
    warning: number
    optimizing: number
  }
  files: FileScanResult[]
  notifications: Notification[]
}

interface FileSeveritySummary {
  error: number
  warning: number
  optimizing: number
}

interface FileScanResult {
  filePath: string
  severityCounts: FileSeveritySummary
  totalViolations: number
  errorViolations: number
  violations: ReadonlyArray<ViolationRecord>
}

type OutputFormat = ReporterFormat

type NotificationLevel = 'info' | 'warn' | 'error'

interface Notification {
  level: NotificationLevel
  message: string
  detail?: string
}

type Logger = (level: NotificationLevel, message: string, detail?: unknown) => void

type ReporterSpanArg = Parameters<RuleReporter['errorAtSpan']>[0]

const consolaLoggers = {
  info: consola.info.bind(consola),
  warn: consola.warn.bind(consola),
  error: consola.error.bind(consola),
} as const

const SCANNABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']

const isScannableFile = (filePath: string): boolean =>
  SCANNABLE_EXTENSIONS.some((extension) => filePath.endsWith(extension))

async function run(
  filePaths: string[] = [],
  ruleDir: string | undefined,
  format: OutputFormat,
  configPath?: string,
  ignorePath?: string
): Promise<ScanSummary> {
  const t = getTranslator()
  const notifications: Notification[] = []

  const log: Logger = (level, message, detail) => {
    let detailText: string | undefined

    if (detail !== undefined) {
      if (detail instanceof Error) {
        detailText = detail.message
      } else if (typeof detail === 'string') {
        detailText = detail
      } else {
        try {
          detailText = JSON.stringify(detail)
        } catch {
          detailText = String(detail)
        }
      }
    }

    notifications.push({ level, message, detail: detailText })

    if (format === 'text') {
      const logger = consolaLoggers[level]
      if (detail === undefined) {
        logger(message)
      } else {
        logger(message, detail)
      }
    }
  }

  try {
    if (filePaths.length === 0) {
      log('info', t.noPathsProvided())
      return {
        scannedFiles: 0,
        filesWithErrors: 0,
        filesWithWarnings: 0,
        filesWithOptimizing: 0,
        violationTotals: { total: 0, error: 0, warning: 0, optimizing: 0 },
        files: [],
        notifications,
      }
    }

    const validPaths = filePaths.filter((candidate) => checkPathExists(candidate))
    if (validPaths.length === 0) {
      log('error', t.allPathsMissing())
      return {
        scannedFiles: 0,
        filesWithErrors: 0,
        filesWithWarnings: 0,
        filesWithOptimizing: 0,
        violationTotals: { total: 0, error: 0, warning: 0, optimizing: 0 },
        files: [],
        notifications,
      }
    }

    const ignoreConfig = loadIgnoreConfig(ignorePath)
    ignoreConfig.warnings.forEach((warning) => log('warn', warning))
    const isIgnored = createIgnoreMatcher(ignoreConfig.patterns, ignoreConfig.baseDir)

    let allFiles: string[] = []

    for (const targetPath of validPaths) {
      if (isIgnored(targetPath)) {
        continue
      }

      const stat = fs.statSync(targetPath)
      if (stat.isFile()) {
        if (!isIgnored(targetPath) && isScannableFile(targetPath)) {
          allFiles.push(targetPath)
        }
      } else if (stat.isDirectory()) {
        const directoryFiles = getAllFiles(targetPath, [], SCANNABLE_EXTENSIONS, {
          shouldIgnore: (fullPath) => isIgnored(fullPath),
        })
        allFiles = [...allFiles, ...directoryFiles]
      }
    }

    if (allFiles.length === 0) {
      log('info', t.noFilesFound())
      return {
        scannedFiles: 0,
        filesWithErrors: 0,
        filesWithWarnings: 0,
        filesWithOptimizing: 0,
        violationTotals: { total: 0, error: 0, warning: 0, optimizing: 0 },
        files: [],
        notifications,
      }
    }

    const scannableFiles = allFiles.filter((candidate) => !candidate.endsWith('.d.ts') && !isIgnored(candidate))
    const customRules = loadCustomRules(ruleDir)
    const rcConfig = loadAutoCrRc(configPath)

    rcConfig.warnings.forEach((warning) => log('warn', warning))

    const rules: Rule[] = applyRuleConfig([...builtinRules, ...customRules], rcConfig.rules, (warning) =>
      log('warn', warning)
    )

    if (rules.length === 0) {
      log('warn', rcConfig.rules ? t.autocrrcAllRulesDisabled() : t.noRulesLoaded())
      return {
        scannedFiles: 0,
        filesWithErrors: 0,
        filesWithWarnings: 0,
        filesWithOptimizing: 0,
        violationTotals: { total: 0, error: 0, warning: 0, optimizing: 0 },
        files: [],
        notifications,
      }
    }

    let filesWithErrors = 0
    let filesWithWarnings = 0
    let filesWithOptimizing = 0
    let totalViolations = 0
    let totalErrorViolations = 0
    let totalWarningViolations = 0
    let totalOptimizingViolations = 0

    const fileSummaries: FileScanResult[] = []

    for (const file of scannableFiles) {
      const summary = await analyzeFile(file, rules, format, log)

      if (summary.severityCounts.error > 0) {
        filesWithErrors += 1
      }

      if (summary.severityCounts.warning > 0) {
        filesWithWarnings += 1
      }

      if (summary.severityCounts.optimizing > 0) {
        filesWithOptimizing += 1
      }

      totalViolations += summary.totalViolations
      totalErrorViolations += summary.errorViolations
      totalWarningViolations += summary.severityCounts.warning
      totalOptimizingViolations += summary.severityCounts.optimizing

      fileSummaries.push({
        filePath: file,
        severityCounts: summary.severityCounts,
        totalViolations: summary.totalViolations,
        errorViolations: summary.errorViolations,
        violations: summary.violations,
      })
    }

    return {
      scannedFiles: scannableFiles.length,
      filesWithErrors,
      filesWithWarnings,
      filesWithOptimizing,
      violationTotals: {
        total: totalViolations,
        error: totalErrorViolations,
        warning: totalWarningViolations,
        optimizing: totalOptimizingViolations,
      },
      files: fileSummaries,
      notifications,
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}

interface AnalyzeFileSummary {
  severityCounts: FileSeveritySummary
  totalViolations: number
  errorViolations: number
  violations: ReadonlyArray<ViolationRecord>
}

async function analyzeFile(
  file: string,
  rules: Rule[],
  format: OutputFormat,
  log: Logger
): Promise<AnalyzeFileSummary> {
  const source = readFile(file)
  const reporter = createReporter(file, source, { format })
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

  const sharedHelpers = baseContext.helpers

  for (const rule of rules) {
    try {
      const scopedReporter = reporter.forRule(rule)
      const reporterWithRecord = scopedReporter as RuleReporter & {
        record?: (record: ReporterRecordPayload) => void
      }

      const helpers: RuleContext['helpers'] = {
        ...sharedHelpers,
        reportViolation: ((input: unknown, span?: ReporterSpanArg): void => {
          const normalized = normalizeViolationInput(input, span)

          if (typeof reporterWithRecord.record === 'function') {
            reporterWithRecord.record({
              description: normalized.message,
              code: normalized.code,
              suggestions: normalized.suggestions,
              span: normalized.span,
              line: normalized.line,
            })
            return
          }

          if (normalized.span) {
            scopedReporter.errorAtSpan(normalized.span, normalized.message)
            return
          }

          if (typeof normalized.line === 'number') {
            scopedReporter.errorAtLine(normalized.line, normalized.message)
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
  if (typeof input === 'string') {
    return {
      message: input,
      span: spanArg,
    }
  }

  if (input && typeof input === 'object') {
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

function parseOutputFormat(value?: string): OutputFormat {
  if (!value) {
    return 'text'
  }

  const normalized = value.toLowerCase()

  if (normalized === 'json' || normalized === 'text') {
    return normalized as OutputFormat
  }

  throw new Error(`Unsupported output format: ${value}. Use "text" or "json".`)
}

type JsonSeverity = 'error' | 'warning' | 'optimizing'

interface JsonSuggestion {
  text: string
  link?: string
}

interface JsonViolation {
  tag: string
  ruleName: string
  severity: JsonSeverity
  message: string
  line?: number
  code?: string
  suggestions: JsonSuggestion[]
}

interface JsonFileResult {
  filePath: string
  severityCounts: FileSeveritySummary
  totalViolations: number
  errorViolations: number
  violations: JsonViolation[]
}

interface JsonOutputPayload {
  summary: {
    scannedFiles: number
    filesWithErrors: number
    filesWithWarnings: number
    filesWithOptimizing: number
    violationTotals: ScanSummary['violationTotals']
  }
  files: JsonFileResult[]
  notifications: Notification[]
}

function severityToLabel(severity: RuleSeverity): JsonSeverity {
  switch (severity) {
    case RuleSeverity.Warning:
      return 'warning'
    case RuleSeverity.Optimizing:
      return 'optimizing'
    case RuleSeverity.Error:
    default:
      return 'error'
  }
}

function formatViolationForJson(violation: ViolationRecord): JsonViolation {
  const suggestions = violation.suggestions
    ? violation.suggestions.map((suggestion) => ({ ...suggestion }))
    : []

  const payload: JsonViolation = {
    tag: violation.tag,
    ruleName: violation.ruleName,
    severity: severityToLabel(violation.severity),
    message: violation.message,
    suggestions,
  }

  if (typeof violation.line === 'number') {
    payload.line = violation.line
  }

  if (violation.code) {
    payload.code = violation.code
  }

  return payload
}

function formatJsonOutput(result: ScanSummary): JsonOutputPayload {
  return {
    summary: {
      scannedFiles: result.scannedFiles,
      filesWithErrors: result.filesWithErrors,
      filesWithWarnings: result.filesWithWarnings,
      filesWithOptimizing: result.filesWithOptimizing,
      violationTotals: result.violationTotals,
    },
    files: result.files.map((file) => ({
      filePath: file.filePath,
      severityCounts: file.severityCounts,
      totalViolations: file.totalViolations,
      errorViolations: file.errorViolations,
      violations: file.violations.map(formatViolationForJson),
    })),
    notifications: result.notifications,
  }
}

program
  .argument('[paths...]', '需要扫描的文件或目录路径列表 / Paths to scan')
  .option('-r, --rule-dir <directory>', '自定义规则目录路径 / Custom rule directory')
  .option('-l, --language <language>', '设置 CLI 语言 (zh/en) / Set CLI language (zh/en)')
  .option('-o, --output <format>', '设置输出格式 (text/json) / Output format (text/json)', 'text')
  .option('-c, --config <path>', '配置文件路径 (.autocrrc.json|.autocrrc.js) / Config file path (.autocrrc.json|.autocrrc.js)')
  .option('--ignore-path <path>', '忽略文件列表路径 (.autocrignore.json|.autocrignore.js) / Ignore file path (.autocrignore.json|.autocrignore.js)')
  .option('--tsconfig <path>', '自定义 tsconfig 路径 / Custom tsconfig path')
  .option('--stdin', '从标准输入读取扫描路径 / Read file paths from STDIN')
  .parse(process.argv)

const options = program.opts<{
  ruleDir?: string
  language?: string
  output?: string
  stdin?: boolean
  config?: string
  ignorePath?: string
  tsconfig?: string
}>()
const cliArguments = program.args as string[]

setLanguage(options.language ?? process.env.LANG)
setTsConfigPath(options.tsconfig ? path.resolve(process.cwd(), options.tsconfig) : undefined)

let outputFormat: OutputFormat

try {
  outputFormat = parseOutputFormat(options.output)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  consola.error(message)
  process.exit(1)
}

;(async () => {
  try {
    const stdinTargets = await readPathsFromStdin(Boolean(options.stdin))
    const combinedTargets = [...cliArguments, ...stdinTargets]
    const filePaths = combinedTargets.map((target) => path.resolve(process.cwd(), target))
    const result = await run(filePaths, options.ruleDir, outputFormat, options.config, options.ignorePath)
    const t = getTranslator()

    if (outputFormat === 'json') {
      const payload = formatJsonOutput(result)
      const exitCode = result.filesWithErrors > 0 ? 1 : 0
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
      process.exit(exitCode)
    }

    if (result.scannedFiles > 0) {
      consola.log(' ')
      const language = getLanguage()
      const resultMessage = language.startsWith('zh')
        ? ` ${t.scanComplete()}，本次共扫描${result.scannedFiles}个文件，其中${result.filesWithErrors}个文件存在错误，${result.filesWithWarnings}个文件存在警告，${result.filesWithOptimizing}个文件存在优化建议！`
        : ` ${t.scanComplete()}, scanned ${result.scannedFiles} files: ${result.filesWithErrors} with errors, ${result.filesWithWarnings} with warnings, ${result.filesWithOptimizing} with optimizing hints!`

      consola.success(resultMessage)
      const exitCode = result.filesWithErrors > 0 ? 1 : 0
      process.exit(exitCode)
    } else {
      process.exit(0)
    }
  } catch (error) {
    const t = getTranslator()
    const detail = error instanceof Error ? error.message : String(error)

    if (outputFormat === 'json') {
      const payload = {
        error: {
          message: t.scanError(),
          detail,
        },
      }
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    } else {
      consola.error(t.scanError(), detail)
    }

    process.exit(1)
  }
})()
