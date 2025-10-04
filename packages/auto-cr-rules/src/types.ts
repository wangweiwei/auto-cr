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

export interface Rule {
  name: string
  run(context: RuleContext): void | Promise<void>
}

export const defineRule = (
  name: string,
  runner: (context: RuleContext) => void | Promise<void>
): Rule => ({
  name,
  run: runner,
})

export const isRule = (value: unknown): value is Rule => {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { run?: unknown }).run === 'function'
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
