import type { Module } from '@swc/types'
import { analyzeModule } from './analysis'
import { createRuleMessages } from './messages'
import { createSourceIndex } from './sourceIndex'
import type {
  ImportReference,
  Language,
  RuleAnalysis,
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

// 构建规则执行所需的上下文：包含 AST、imports、文案与统一的 helper 方法。
export const createRuleContext = ({
  ast,
  filePath,
  source,
  reporter,
  language,
}: RuleContextOptions): RuleContext => {
  // 共享 AST 分析结果：一次遍历抽取 imports/loops/callbacks/hotPath 等索引。
  const analysis: RuleAnalysis = analyzeModule(ast)
  // 源码行号索引：仅构建一次，规则可直接复用。
  const sourceIndex = Object.freeze(createSourceIndex(source, ast.span?.start ?? 0))
  const messages = createRuleMessages(language)
  const helpers = Object.freeze(createRuleHelpers(reporter, analysis.imports)) as RuleHelpers

  return Object.freeze({
    ast,
    filePath,
    source,
    language,
    reporter,
    analysis,
    sourceIndex,
    helpers,
    messages,
  }) as RuleContext
}

// 规则 helper：统一封装路径判断、相对深度与违规上报逻辑。
const createRuleHelpers = (reporter: RuleReporter, imports: ReadonlyArray<ImportReference>): RuleHelpers => {
  const isRelativePath = (value: string): boolean => value.startsWith('.')

  const relativeDepth = (value: string): number => {
    return (value.match(/\.\.\//g) || []).length
  }

  // reportViolation 可兼容 string 或结构化对象，并自动选择合适的 reporter 方法。
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

// 统一规则输出结构，便于 reporter 处理 span/line/suggestions。
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
