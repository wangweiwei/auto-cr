import type { Module } from '@swc/types'
import { collectImportReferences } from './imports'
import { createRuleMessages } from './messages'
import type {
  Language,
  RuleContext,
  RuleHelpers,
  RuleReporter,
  RuleReporterRecord,
  RuleViolationInput,
} from './types'

export interface RuleContextOptions {
  ast: Module
  filePath: string
  source: string
  reporter: RuleReporter
  language: Language
}

export const createRuleContext = ({
  ast,
  filePath,
  source,
  reporter,
  language,
}: RuleContextOptions): RuleContext => {
  const imports = collectImportReferences(ast)
  const messages = createRuleMessages(language)
  const helpers = Object.freeze(createRuleHelpers(reporter, imports)) as RuleHelpers

  return Object.freeze({
    ast,
    filePath,
    source,
    language,
    reporter,
    helpers,
    messages,
  }) as RuleContext
}

const createRuleHelpers = (reporter: RuleReporter, imports: ReturnType<typeof collectImportReferences>): RuleHelpers => {
  const isRelativePath = (value: string): boolean => value.startsWith('.')

  const relativeDepth = (value: string): number => {
    return (value.match(/\.\.\//g) || []).length
  }

  const reportViolation = (
    input: RuleViolationInput,
    spanArg?: Parameters<RuleReporter['errorAtSpan']>[0]
  ): void => {
    const normalized = normalizeViolationInput(input, spanArg)

    if (typeof reporter.record === 'function') {
      reporter.record(normalized)
      return
    }

    const targetSpan = normalized.span

    if (targetSpan) {
      reporter.errorAtSpan(targetSpan, normalized.description)
      return
    }

    if (typeof normalized.line === 'number') {
      reporter.errorAtLine(normalized.line, normalized.description)
      return
    }

    reporter.error(normalized.description)
  }

  return {
    imports,
    isRelativePath,
    relativeDepth,
    reportViolation,
  }
}

function normalizeViolationInput(
  input: RuleViolationInput,
  fallbackSpan?: Parameters<RuleReporter['errorAtSpan']>[0]
): RuleReporterRecord {
  if (typeof input === 'string') {
    return {
      description: input,
      span: fallbackSpan,
    }
  }

  const description = input.description ?? input.message

  return {
    description: description ?? 'Rule violation detected.',
    code: input.code,
    suggestions: input.suggestions,
    span: input.span ?? fallbackSpan,
    line: input.line,
  }
}
