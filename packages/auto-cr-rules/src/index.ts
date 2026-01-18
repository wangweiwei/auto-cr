// 统一导出规则类型、运行时与内置规则集合。
export type {
  HotCallbackEntry,
  HotPathIndex,
  ImportReference,
  Language,
  LoopEntry,
  Rule,
  RuleAnalysis,
  RuleMetadata,
  RuleContext,
  RuleHelpers,
  RuleMessages,
  RuleReporter,
  RuleReporterRecord,
  RuleSuggestion,
  SourceIndex,
  RuleViolationInput,
} from './types'
export { RuleSeverity } from './types'
export { defineRule, isRule, toRule } from './types'
export { createRuleContext } from './runtime'
export type { RuleContextOptions } from './runtime'
export {
  builtinRules,
  noDeepRelativeImports,
  noCircularDependencies,
  noSwallowedErrors,
  noCatastrophicRegex,
  noDeepCloneInLoop,
  noN2ArrayLookup,
} from './rules'
