#!/usr/bin/env node
import { consola } from 'consola'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { program } from 'commander'
import { setTsConfigPath } from './config'
import { renderViolations, type ReporterFormat, type ViolationRecord } from './report'
import { getLanguage, getTranslator, setLanguage } from './i18n'
import { getAllFiles, checkPathExists } from './utils/file'
import { readPathsFromStdin } from './utils/stdin'
import type { RuleSeverity as RuleSeverityType } from 'auto-cr-rules'
import { analyzeFile, type ReporterHooks } from './scan/analyzeFile'
import type { AnalyzeFileSummary, FileSeveritySummary, Logger, Notification, NotificationLevel } from './scan/types'
import { loadRulesRuntime } from './scan/runtime'
import { runWorkerPool } from './scan/workerPool'
import type { WorkerInitData } from './scan/workerTypes'
import { loadCustomRules } from './rules/loader'
import { applyRuleConfig, loadAutoCrRc } from './config/autocrrc'
import { createIgnoreMatcher, loadIgnoreConfig } from './config/ignore'
import type { Rule } from 'auto-cr-rules'

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

interface FileScanResult {
  filePath: string
  severityCounts: FileSeveritySummary
  totalViolations: number
  errorViolations: number
  violations: ReadonlyArray<ViolationRecord>
}

type OutputFormat = ReporterFormat

const consolaLoggers = {
  info: consola.info.bind(consola),
  warn: consola.warn.bind(consola),
  error: consola.error.bind(consola),
} as const

// 仅扫描 JS/TS 源码扩展名，避免把配置文件/JSON/图片等送进 SWC 解析导致报错。
const SCANNABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']

// 运行 TS 源码时优先加载本地 rules，避免开发时拿到旧的 workspace 依赖。
const rulesRuntime = loadRulesRuntime()
const builtinRules = rulesRuntime.builtinRules
const createRuleContext = rulesRuntime.createRuleContext
const RuleSeverity = rulesRuntime.RuleSeverity

// 单文件路径也走扩展名过滤，保证与目录扫描的行为一致。
const isScannableFile = (filePath: string): boolean =>
  SCANNABLE_EXTENSIONS.some((extension) => filePath.endsWith(extension))

// 小文件集无需并行，避免 worker 初始化开销大于收益。
const MIN_FILES_FOR_WORKERS = 20

const resolveWorkerCount = (totalFiles: number): number => {
  // 支持环境变量覆盖并发数：
  // - AUTO_CR_WORKERS=0 表示强制单线程；
  // - AUTO_CR_WORKERS=1 表示不启用并行；
  // - >1 则按指定数量启用 worker。
  const override = process.env.AUTO_CR_WORKERS
  if (override) {
    const parsed = Number(override)
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return Math.min(totalFiles, Math.floor(parsed))
    }
  }

  if (totalFiles < MIN_FILES_FOR_WORKERS) {
    return 1
  }

  // 默认按 CPU 数量 - 1 取值，给主线程留出空间。
  const cpuCount = os.cpus().length || 1
  const maxWorkers = Math.max(1, cpuCount - 1)
  return Math.min(maxWorkers, totalFiles)
}

/**
 * CLI 主流程：
 * 1. 校验输入路径并应用 ignore；
 * 2. 展开目录为可扫描文件列表；
 * 3. 加载规则 + 规则配置；
 * 4. 逐文件扫描并汇总输出。
 */
async function run(
  filePaths: string[] = [],
  ruleDir: string | undefined,
  format: OutputFormat,
  configPath?: string,
  ignorePath?: string,
  progressOption?: ProgressOption
): Promise<ScanSummary> {
  const t = getTranslator()
  const notifications: Notification[] = []
  // 进度渲染说明：
  // - 仅 text 模式显示，JSON 输出用于脚本解析需保持稳定。
  // - 进度默认写入 stderr。
  // - --progress tty-only/yes/no 控制显示：tty-only 仅 TTY，yes 强制，no 关闭。
  // - “固定模式”会用 ANSI 保存/恢复光标，把进度绘制在固定行。
  // - 非 TTY 强制显示时只追加行，避免输出控制序列污染日志。
  const progressMode = progressOption?.mode ?? 'tty-only'
  const progressStream = process.stderr
  const progressStreamHasTty = Boolean(progressStream.isTTY)
  const progressEnabled =
    format === 'text' && progressMode !== 'no' && (progressMode === 'yes' || progressStreamHasTty)
  // “固定模式”会让进度行保持在固定位置，避免被其它日志覆盖。
  const progressPinned = progressEnabled && progressStreamHasTty
  // 仅在 TTY 下启用 ANSI 样式，避免输出乱码。
  const progressStyle =
    progressStreamHasTty
      ? { prefix: '\x1b[44m\x1b[97m', reset: '\x1b[0m' }
      : { prefix: '', reset: '' }
  let progressTotal = 0
  let progressCurrent = 0
  let progressLastPercent = -1

  // 清理进度行，避免残留在终端里。
  const clearProgressLine = () => {
    if (!progressEnabled) {
      return
    }

    if (progressPinned) {
      progressStream.write('\x1b7')
      progressStream.write('\x1b[1;1H')
      progressStream.write('\x1b[2K')
      progressStream.write('\x1b8')
    } else if (progressStreamHasTty) {
      progressStream.write('\r\x1b[2K')
    }
  }

  // 百分比变化时渲染（或强制渲染），用单行覆盖避免刷屏。
  const renderProgress = (force = false) => {
    if (!progressEnabled || progressTotal === 0) {
      return
    }

    const percent = Math.min(100, Math.floor((progressCurrent / progressTotal) * 100))
    if (!force && percent === progressLastPercent) {
      return
    }

    progressLastPercent = percent
    const message = t.scanProgress({ percent, current: progressCurrent, total: progressTotal })
    const styledMessage = progressStyle.prefix ? `${progressStyle.prefix}${message}` : message
    if (progressPinned) {
      progressStream.write('\x1b7')
      progressStream.write('\x1b[1;1H')
      progressStream.write('\x1b[2K')
      progressStream.write(styledMessage)
      if (progressStyle.prefix) {
        progressStream.write('\x1b[K')
        progressStream.write(progressStyle.reset)
      }
      progressStream.write('\x1b8')
    } else if (progressStreamHasTty) {
      progressStream.write(`\r${styledMessage}`)
      if (progressStyle.prefix) {
        progressStream.write('\x1b[K')
        progressStream.write(progressStyle.reset)
      } else {
        progressStream.write('\x1b[K')
      }
    } else {
      progressStream.write(`${styledMessage}\n`)
    }
  }

  // 扫描开始前初始化计数。
  const startProgress = (total: number) => {
    if (!progressEnabled) {
      return
    }

    progressTotal = total
    progressCurrent = 0
    progressLastPercent = -1
    renderProgress(true)
  }

  // 每扫描一个文件就推进一次，必要时刷新进度。
  const advanceProgress = () => {
    if (!progressEnabled || progressTotal === 0) {
      return
    }

    progressCurrent = Math.min(progressCurrent + 1, progressTotal)
    renderProgress()
  }

  // 扫描结束：渲染 100%，再清掉进度行。
  const finishProgress = () => {
    if (!progressEnabled) {
      return
    }

    if (progressTotal > 0) {
      progressCurrent = progressTotal
      progressLastPercent = -1
      renderProgress()
      clearProgressLine()
    }
    progressTotal = 0
    progressCurrent = 0
    progressLastPercent = -1
  }

  const reporterHooks: ReporterHooks = {
    onAfterReport: () => renderProgress(true),
  }

  // 统一把日志转换为 Notification，便于缓存/worker 结果回放。
  // detail 统一转成字符串，保证可序列化。
  const createNotification = (level: NotificationLevel, message: string, detail?: unknown): Notification => {
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

    return { level, message, detail: detailText }
  }

  // 统一日志落库 + 可选输出（text 模式），输出后刷新进度行防止覆盖。
  const logRecord = (record: Notification): void => {
    notifications.push(record)
    if (format === 'text') {
      const logger = consolaLoggers[record.level]
      if (record.detail === undefined) {
        logger(record.message)
      } else {
        logger(record.message, record.detail)
      }
      renderProgress(true)
    }
  }

  const log: Logger = (level, message, detail) => {
    logRecord(createNotification(level, message, detail))
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

    // ignore 配置只影响收集阶段，避免无关文件被解析或影响统计。
    const ignoreConfig = loadIgnoreConfig(ignorePath)
    ignoreConfig.warnings.forEach((warning) => log('warn', warning))
    const isIgnored = createIgnoreMatcher(ignoreConfig.patterns, ignoreConfig.baseDir)

    // 先展开路径，再进行二次过滤，保证 ignore 与扩展名筛选一致生效。
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

    // 跳过声明文件与被 ignore 的路径，确保仅扫描真正的业务源码。
    const scannableFiles = allFiles.filter((candidate) => !candidate.endsWith('.d.ts') && !isIgnored(candidate))
    const customRules = loadCustomRules(ruleDir, {
      onWarning: (message, detail) => log('warn', message, detail),
    })
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
    // analyzeFile 内部 reporter 不输出，统一由主流程渲染，便于并发/缓存复用。
    const analysisFormat: ReporterFormat = 'json'
    const workerCount = resolveWorkerCount(scannableFiles.length)

    // 汇总单文件统计，保持统计逻辑集中，避免并发/缓存分支重复实现。
    const applyFileSummary = (filePath: string, summary: AnalyzeFileSummary): void => {
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
        filePath,
        severityCounts: summary.severityCounts,
        totalViolations: summary.totalViolations,
        errorViolations: summary.errorViolations,
        violations: summary.violations,
      })
    }

    startProgress(scannableFiles.length)

    if (workerCount > 1) {
      // 并行模式：
      // - 只把去重后的文件发给 worker；
      // - 通过索引映射保持输出顺序稳定；
      // - 日志与 violations 统一在主线程渲染。
      const fileOccurrences = new Map<string, number[]>()
      scannableFiles.forEach((filePath, index) => {
        const bucket = fileOccurrences.get(filePath) ?? []
        bucket.push(index)
        fileOccurrences.set(filePath, bucket)
      })

      const uniqueFiles = Array.from(fileOccurrences.keys())
      // pendingResults 按扫描序号暂存，确保输出顺序与输入一致。
      const pendingResults = new Map<number, { summary: AnalyzeFileSummary; logs: Notification[] }>()
      let nextOutputIndex = 0

      // 只要前序结果已齐，就持续输出；避免乱序打印。
      const flushReadyResults = (): void => {
        while (pendingResults.has(nextOutputIndex)) {
          const entry = pendingResults.get(nextOutputIndex)
          if (!entry) {
            break
          }
          pendingResults.delete(nextOutputIndex)

          const filePath = scannableFiles[nextOutputIndex]
          // 先回放日志，再回放违规输出，确保日志顺序与单线程一致。
          entry.logs.forEach((record) => logRecord(record))

          if (format === 'text') {
            renderViolations(filePath, entry.summary.violations, { format, ...reporterHooks })
          }

          applyFileSummary(filePath, entry.summary)
          nextOutputIndex += 1
        }
      }

      // worker 初始化数据：确保语言/tsconfig/规则配置一致。
      const initData: WorkerInitData = {
        ruleDir,
        ruleSettings: rcConfig.rules,
        language: getLanguage(),
        tsconfigPath: resolvedTsconfigPath,
      }

      await runWorkerPool({
        files: uniqueFiles,
        workerCount,
        initData,
        onResult: ({ filePath, summary, logs }) => {
          const occurrences = fileOccurrences.get(filePath) ?? []
          for (const index of occurrences) {
            pendingResults.set(index, { summary, logs })
            // 进度按“原始文件列表”推进，保持百分比与实际扫描一致。
            advanceProgress()
          }
          flushReadyResults()
        },
      })

      flushReadyResults()
    } else {
      // 单线程模式下也做跨文件缓存：相同路径只解析一次。
      const fileSummaryCache = new Map<string, { summary: AnalyzeFileSummary; logs: Notification[] }>()

      for (const file of scannableFiles) {
        const cached = fileSummaryCache.get(file)
        let summary: AnalyzeFileSummary
        let logs: Notification[] = []

        if (cached) {
          summary = cached.summary
          logs = cached.logs
          logs.forEach((record) => logRecord(record))
        } else {
          const capturedLogs: Notification[] = []
          // 先把日志收集到缓存里，便于后续复用时保持一致输出。
          const logForFile: Logger = (level, message, detail) => {
            const record = createNotification(level, message, detail)
            capturedLogs.push(record)
            logRecord(record)
          }

          summary = await analyzeFile(file, rules, analysisFormat, logForFile, createRuleContext)
          fileSummaryCache.set(file, { summary, logs: capturedLogs })
        }

        if (format === 'text') {
          renderViolations(file, summary.violations, { format, ...reporterHooks })
        }

        applyFileSummary(file, summary)
        advanceProgress()
      }
    }

    finishProgress()

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

// CLI 输出格式解析：仅允许 text/json。
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

interface ProgressOption {
  mode: ProgressMode
}

type ProgressMode = 'tty-only' | 'yes' | 'no'

function parseProgressOption(value?: boolean | string): ProgressOption {
  if (value === undefined) {
    return { mode: 'tty-only' }
  }

  if (value === true) {
    return { mode: 'yes' }
  }

  if (typeof value === 'string') {
    const normalized = value.toLowerCase()
    if (normalized === 'tty-only' || normalized === 'yes' || normalized === 'no') {
      return { mode: normalized as ProgressMode }
    }

    throw new Error(`Unsupported progress mode: ${value}. Use "tty-only", "yes", or "no".`)
  }

  return { mode: 'tty-only' }
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

function severityToLabel(severity: RuleSeverityType): JsonSeverity {
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
  // JSON 输出用于 CI/脚本解析，保持结构稳定。
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
  .option(
    '--progress [mode]',
    '进度显示模式 tty-only/yes/no（默认 tty-only，输出到 stderr） / Progress mode tty-only/yes/no (default tty-only, outputs to stderr)'
  )
  .option('--stdin', '从标准输入读取扫描路径 / Read file paths from STDIN')
  .parse(process.argv.filter((arg) => arg !== '--'))

const options = program.opts<{
  ruleDir?: string
  language?: string
  output?: string
  stdin?: boolean
  config?: string
  ignorePath?: string
  tsconfig?: string
  progress?: boolean | string
}>()
const cliArguments = program.args as string[]

setLanguage(options.language ?? process.env.LANG)
const resolvedTsconfigPath = options.tsconfig ? path.resolve(process.cwd(), options.tsconfig) : undefined
setTsConfigPath(resolvedTsconfigPath)

let outputFormat: OutputFormat
let progressOption: ProgressOption | undefined

try {
  outputFormat = parseOutputFormat(options.output)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  consola.error(message)
  process.exit(1)
}

try {
  progressOption = parseProgressOption(options.progress)
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
    const result = await run(filePaths, options.ruleDir, outputFormat, options.config, options.ignorePath, progressOption)
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
