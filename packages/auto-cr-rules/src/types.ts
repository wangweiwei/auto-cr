import type { Module, Span } from '@swc/types'

export type Language = 'zh' | 'en'

export interface RuleReporter {
  error(message: string): void
  errorAtSpan(span: Span | undefined, message: string): void
  errorAtLine(line: number | undefined, message: string): void
}

export interface ImportReference {
  kind: 'static' | 'dynamic' | 'require'
  value: string
  span?: Span
}

export interface RuleMessages {
  noDeepRelativeImports(params: { value: string; maxDepth: number }): string
}

export interface RuleHelpers {
  readonly imports: ReadonlyArray<ImportReference>
  isRelativePath(value: string): boolean
  relativeDepth(value: string): number
  reportViolation(message: string, span?: Span): void
}

export interface RuleContext {
  readonly filePath: string
  readonly source: string
  readonly language: Language
  readonly reporter: RuleReporter
  readonly ast: Module
  readonly helpers: RuleHelpers
  readonly messages: RuleMessages
}

export interface RuleMetadata {
  tag?: string
}

export interface Rule {
  name: string
  tag?: string
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
      typeof (value as { tag?: unknown }).tag === 'string')
  )
}

export const toRule = (value: unknown, origin: string): Rule | null => {
  if (isRule(value)) {
    return value
  }

  if (typeof value === 'function') {
    const fn = value as (context: RuleContext) => void | Promise<void>
    return {
      name: fn.name || origin,
      run: fn,
    }
  }

  return null
}
