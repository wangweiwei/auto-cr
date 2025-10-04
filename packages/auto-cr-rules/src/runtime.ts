import type { Module } from '@swc/types'
import { collectImportReferences } from './imports'
import { createRuleMessages } from './messages'
import type { Language, RuleContext, RuleHelpers, RuleReporter } from './types'

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

  const reportViolation = (message: string, span?: Parameters<RuleReporter['errorAtSpan']>[0]): void => {
    if (span) {
      reporter.errorAtSpan(span, message)
      return
    }

    reporter.error(message)
  }

  return {
    imports,
    isRelativePath,
    relativeDepth,
    reportViolation,
  }
}
