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
import type {
  Rule,
  RuleContext,
  RuleReporter,
  RuleReporterRecord,
  RuleViolationInput,
} from 'auto-cr-rules'

async function run(filePaths: string[] = [], ruleDir?: string): Promise<void> {
  const t = getTranslator()

  try {
    if (filePaths.length === 0) {
      consola.info(t.noPathsProvided())
      return
    }

    const validPaths = filePaths.filter((candidate) => checkPathExists(candidate))
    if (validPaths.length === 0) {
      consola.error(t.allPathsMissing())
      return
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
      return
    }

    const customRules = loadCustomRules(ruleDir)
    const rules: Rule[] = [...builtinRules, ...customRules]

    if (rules.length === 0) {
      consola.warn(t.noRulesLoaded())
      return
    }

    for (const file of allFiles) {
      if (file.endsWith('.d.ts')) {
        continue
      }
      await analyzeFile(file, rules)
    }

    consola.success(t.scanComplete())
  } catch (error) {
    consola.error(t.scanError(), error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

async function analyzeFile(file: string, rules: Rule[]): Promise<void> {
  const source = readFile(file)
  const reporter = createReporter(file, source)
  const t = getTranslator()

  let ast

  try {
    const parseOptions = loadParseOptions(file)
    ast = parseSync(source, parseOptions as unknown as Parameters<typeof parseSync>[1])
  } catch (error) {
    consola.error(t.parseFileFailed({ file }), error instanceof Error ? error.message : error)
    return
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

      const helpers: RuleContext['helpers'] = {
        ...sharedHelpers,
        reportViolation: (input: RuleViolationInput, span?: ReporterSpanArg): void => {
          const normalized = normalizeViolationInputForCli(input, span)

          if (typeof scopedReporter.record === 'function') {
            scopedReporter.record(normalized)
            return
          }

          if (normalized.span) {
            scopedReporter.errorAtSpan(normalized.span, normalized.description)
            return
          }

          if (typeof normalized.line === 'number') {
            scopedReporter.errorAtLine(normalized.line, normalized.description)
            return
          }

          scopedReporter.error(normalized.description)
        },
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

  reporter.flush()
}

type ReporterSpanArg = Parameters<RuleReporter['errorAtSpan']>[0]

function normalizeViolationInputForCli(
  input: RuleViolationInput,
  spanArg?: ReporterSpanArg
): RuleReporterRecord {
  if (typeof input === 'string') {
    return {
      description: input,
      span: spanArg,
    }
  }

  const description = input.description ?? input.message

  return {
    description: description ?? 'Rule violation detected.',
    code: input.code,
    suggestions: input.suggestions,
    span: input.span ?? spanArg,
    line: input.line,
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
    await run(filePaths, options.ruleDir)
    process.exit(0)
  } catch (error) {
    const t = getTranslator()
    consola.error(t.unexpectedError(), error)
    process.exit(1)
  }
})()
