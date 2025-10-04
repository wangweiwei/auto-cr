#!/usr/bin/env node
import { consola } from 'consola'
import fs from 'fs'
import path from 'path'
import { program } from 'commander'
import { parseSync } from '@swc/wasm'
import { loadParseOptions } from './config'
import { createReporter } from './report'
import { getLanguage, getTranslator, setLanguage } from './i18n'
import { readFile, getAllFiles, checkPathExists } from './utils/file'
import { builtinRules, createRuleContext } from 'auto-cr-rules'
import { loadCustomRules } from './rules/loader'
import type { Rule, RuleContext, RuleReporter } from 'auto-cr-rules'

interface ScanSummary {
  scannedFiles: number
  filesWithErrors: number
  filesWithWarnings: number
  filesWithOptimizing: number
}

interface FileSeveritySummary {
  error: number
  warning: number
  optimizing: number
}

type ReporterSpanArg = Parameters<RuleReporter['errorAtSpan']>[0]

async function run(filePaths: string[] = [], ruleDir?: string): Promise<ScanSummary> {
  const t = getTranslator()

  try {
    if (filePaths.length === 0) {
      consola.info(t.noPathsProvided())
      return { scannedFiles: 0, filesWithErrors: 0, filesWithWarnings: 0, filesWithOptimizing: 0 }
    }

    const validPaths = filePaths.filter((candidate) => checkPathExists(candidate))
    if (validPaths.length === 0) {
      consola.error(t.allPathsMissing())
      return { scannedFiles: 0, filesWithErrors: 0, filesWithWarnings: 0, filesWithOptimizing: 0 }
    }

    let allFiles: string[] = []

    for (const targetPath of validPaths) {
      const stat = fs.statSync(targetPath)
      if (stat.isFile()) {
        allFiles.push(targetPath)
      } else if (stat.isDirectory()) {
        const directoryFiles = getAllFiles(targetPath)
        allFiles = [...allFiles, ...directoryFiles]
      }
    }

    if (allFiles.length === 0) {
      consola.info(t.noFilesFound())
      return { scannedFiles: 0, filesWithErrors: 0, filesWithWarnings: 0, filesWithOptimizing: 0 }
    }

    const scannableFiles = allFiles.filter((candidate) => !candidate.endsWith('.d.ts'))
    const customRules = loadCustomRules(ruleDir)
    const rules: Rule[] = [...builtinRules, ...customRules]

    if (rules.length === 0) {
      consola.warn(t.noRulesLoaded())
      return {
        scannedFiles: 0,
        filesWithErrors: 0,
        filesWithWarnings: 0,
        filesWithOptimizing: 0,
      }
    }

    let filesWithErrors = 0
    let filesWithWarnings = 0
    let filesWithOptimizing = 0

    for (const file of scannableFiles) {
      const summary = await analyzeFile(file, rules)

      if (summary.severityCounts.error > 0) {
        filesWithErrors += 1
      }

      if (summary.severityCounts.warning > 0) {
        filesWithWarnings += 1
      }

      if (summary.severityCounts.optimizing > 0) {
        filesWithOptimizing += 1
      }
    }

    return {
      scannedFiles: scannableFiles.length,
      filesWithErrors,
      filesWithWarnings,
      filesWithOptimizing,
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}

interface AnalyzeFileSummary {
  severityCounts: FileSeveritySummary
}

async function analyzeFile(file: string, rules: Rule[]): Promise<AnalyzeFileSummary> {
  const source = readFile(file)
  const reporter = createReporter(file, source)
  const t = getTranslator()

  let ast

  try {
    const parseOptions = loadParseOptions(file)
    ast = parseSync(source, parseOptions as unknown as Parameters<typeof parseSync>[1])
  } catch (error) {
    consola.error(t.parseFileFailed({ file }), error instanceof Error ? error.message : error)
    return {
      severityCounts: {
        error: 1,
        warning: 0,
        optimizing: 0,
      },
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
      consola.error(
        t.ruleExecutionFailed({ ruleName: rule.name, file }),
        error instanceof Error ? error.message : error
      )
    }
  }

  const summary = reporter.flush()

  return {
    severityCounts: summary.severityCounts,
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

program
  .argument('[paths...]', '需要扫描的文件或目录路径列表 / Paths to scan')
  .option('-r, --rule-dir <directory>', '自定义规则目录路径 / Custom rule directory')
  .option('-l, --language <language>', '设置 CLI 语言 (zh/en) / Set CLI language (zh/en)')
  .parse(process.argv)

const options = program.opts()
const filePaths = program.args.map((target: string) => path.resolve(process.cwd(), target))

;(async () => {
  try {
    setLanguage(options.language ?? process.env.LANG)
    const summary = await run(filePaths, options.ruleDir)
    const t = getTranslator()

    if (summary.scannedFiles > 0) {
      consola.log(' ')
      const language = getLanguage()
      const resultMessage = language.startsWith('zh')
        ? ` ${t.scanComplete()}，本次共扫描${summary.scannedFiles}个文件，其中${summary.filesWithErrors}个文件存在错误，${summary.filesWithWarnings}个文件存在警告，${summary.filesWithOptimizing}个文件存在优化建议！`
        : ` ${t.scanComplete()}, scanned ${summary.scannedFiles} files: ${summary.filesWithErrors} with errors, ${summary.filesWithWarnings} with warnings, ${summary.filesWithOptimizing} with optimizing hints!`

      if (summary.filesWithErrors > 0) {
        consola.success(resultMessage)
        process.exit(1)
      } else {
        consola.success(resultMessage)
        process.exit(0)
      }
    } else {
      process.exit(0)
    }
  } catch (error) {
    const t = getTranslator()
    consola.error(t.scanError(), error instanceof Error ? error.message : error)
    process.exit(1)
  }
})()
