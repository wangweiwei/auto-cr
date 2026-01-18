import type { Module, Span } from '@swc/types'

// 规则文案与 CLI 支持的语言标识。
export type Language = 'zh' | 'en'

export interface RuleReporter {
  error(message: string): void
  errorAtSpan(span: Span | undefined, message: string): void
  errorAtLine(line: number | undefined, message: string): void
  record?(record: RuleReporterRecord): void
}

// 规则严重级别，决定 reporter 的输出样式与统计。
export enum RuleSeverity {
  Error = 'error',
  Warning = 'warning',
  Optimizing = 'optimizing',
}

export interface RuleSuggestion {
  text: string
  link?: string
}

export interface RuleReporterRecord {
  description: string
  code?: string
  suggestions?: ReadonlyArray<RuleSuggestion>
  span?: Span
  line?: number
}

export interface RuleViolationInit {
  description?: string
  message?: string
  code?: string
  suggestions?: ReadonlyArray<RuleSuggestion>
  span?: Span
  line?: number
}

export type RuleViolationInput = string | RuleViolationInit

export interface ImportReference {
  kind: 'static' | 'dynamic' | 'require'
  value: string
  span?: Span
}

// 规则文案接口（由 messages.ts 实现）。
export interface RuleMessages {
  noDeepRelativeImports(params: { value: string; maxDepth: number }): string
  swallowedError(): string
  circularDependency(params: { chain: string }): string
  noCatastrophicRegex(params: { pattern: string }): string
  noDeepCloneInLoop(): string
  noN2ArrayLookup(params: { method: string }): string
}

// 规则辅助方法集合，避免在每条规则里重复实现通用逻辑。
export interface RuleHelpers {
  readonly imports: ReadonlyArray<ImportReference>
  isRelativePath(value: string): boolean
  relativeDepth(value: string): number
  reportViolation(input: RuleViolationInput, span?: Span): void
}

// 规则执行上下文：包含 AST/源码/语言/工具方法。
export interface RuleContext {
  readonly filePath: string
  readonly source: string
  readonly language: Language
  readonly reporter: RuleReporter
  readonly ast: Module
  readonly helpers: RuleHelpers
  readonly messages: RuleMessages
}

// 规则元数据（用于 tag/严重级别等）。
export interface RuleMetadata {
  tag?: string
  severity?: RuleSeverity
}

export interface Rule {
  name: string
  tag?: string
  severity?: RuleSeverity
  run(context: RuleContext): void | Promise<void>
}

export function defineRule(
  name: string,
  runner: (context: RuleContext) => void | Promise<void>
): Rule
export function defineRule(
  name: string,
  metadata: RuleMetadata,
  runner: (context: RuleContext) => void | Promise<void>
): Rule
export function defineRule(
  name: string,
  metadataOrRunner: RuleMetadata | ((context: RuleContext) => void | Promise<void>),
  maybeRunner?: (context: RuleContext) => void | Promise<void>
): Rule {
  const metadata: RuleMetadata = typeof metadataOrRunner === 'function' ? {} : metadataOrRunner
  const runner = typeof metadataOrRunner === 'function' ? metadataOrRunner : maybeRunner

  if (!runner) {
    throw new Error('defineRule requires a rule runner function')
  }

  return {
    name,
    ...metadata,
    severity: metadata.severity ?? RuleSeverity.Error,
    run: runner,
  }
}

export const isRule = (value: unknown): value is Rule => {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { run?: unknown }).run === 'function' &&
    (typeof (value as { tag?: unknown }).tag === 'undefined' ||
      typeof (value as { tag?: unknown }).tag === 'string') &&
    (typeof (value as { severity?: unknown }).severity === 'undefined' ||
      (typeof (value as { severity?: unknown }).severity === 'string' &&
        Object.values(RuleSeverity).includes((value as { severity?: unknown }).severity as RuleSeverity)))
  )
}

export const toRule = (value: unknown, origin: string): Rule | null => {
  if (isRule(value)) {
    return {
      severity: value.severity ?? RuleSeverity.Error,
      ...value,
    }
  }

  if (typeof value === 'function') {
    const fn = value as (context: RuleContext) => void | Promise<void>
    return {
      name: fn.name || origin,
      severity: RuleSeverity.Error,
      run: fn,
    }
  }

  return null
}
