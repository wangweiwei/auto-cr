import fs from 'fs'
import path from 'path'
import { RuleSeverity, type Rule } from 'auto-cr-rules'
import { getTranslator } from '../i18n'

const RC_CANDIDATES = ['.autocrrc.json', '.autocrrc.js']

type RuleSettingInput =
  | RuleSeverity
  | 'off'
  | 'warn'
  | 'warning'
  | 'error'
  | 'optimizing'
  | 0
  | 1
  | 2
  | boolean

export interface AutoCrRcConfig {
  rules?: Record<string, RuleSettingInput>
}

export interface LoadedAutoCrRc {
  path?: string
  rules?: Record<string, RuleSettingInput>
  warnings: string[]
}

export function loadAutoCrRc(configPath?: string): LoadedAutoCrRc {
  const warnings: string[] = []
  const t = getTranslator()
  const resolvedPath = resolveConfigPath(configPath)

  if (!resolvedPath) {
    return { warnings }
  }

  if (!fs.existsSync(resolvedPath)) {
    warnings.push(t.autocrrcPathMissing({ path: resolvedPath }))
    return { warnings }
  }

  try {
    const raw = readConfigFile(resolvedPath)
    const config = unwrapDefault(raw)

    if (!isRecord(config)) {
      warnings.push(t.autocrrcInvalidFormat({ path: resolvedPath }))
      return { warnings }
    }

    if (config.rules !== undefined && !isRecord(config.rules)) {
      warnings.push(t.autocrrcInvalidRulesField({ path: resolvedPath }))
      return { warnings }
    }

    return {
      path: resolvedPath,
      rules: config.rules as Record<string, RuleSettingInput> | undefined,
      warnings,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    warnings.push(t.autocrrcLoadFailed({ path: resolvedPath, error: detail }))
    return { warnings }
  }
}

export function applyRuleConfig(
  rules: Rule[],
  ruleSettings: Record<string, RuleSettingInput> | undefined,
  onWarning: (message: string) => void
): Rule[] {
  if (!ruleSettings || Object.keys(ruleSettings).length === 0) {
    return rules
  }

  const t = getTranslator()
  const configured: Rule[] = []

  for (const rule of rules) {
    const hasSetting = Object.prototype.hasOwnProperty.call(ruleSettings, rule.name)

    if (!hasSetting) {
      configured.push(rule)
      continue
    }

    const rawSetting = ruleSettings[rule.name]
    const normalized = normalizeRuleSetting(rawSetting)

    if (normalized === 'off') {
      continue
    }

    if (normalized === null) {
      onWarning(t.autocrrcInvalidRuleSetting({ ruleName: rule.name, value: stringifyValue(rawSetting) }))
      configured.push(rule)
      continue
    }

    if (normalized === undefined) {
      configured.push(rule)
      continue
    }

    configured.push({ ...rule, severity: normalized })
  }

  return configured
}

function resolveConfigPath(explicitPath?: string): string | null {
  if (explicitPath) {
    return path.isAbsolute(explicitPath) ? explicitPath : path.resolve(process.cwd(), explicitPath)
  }

  for (const candidate of RC_CANDIDATES) {
    const resolved = path.resolve(process.cwd(), candidate)
    if (fs.existsSync(resolved)) {
      return resolved
    }
  }

  return null
}

function readConfigFile(filePath: string): unknown {
  if (filePath.endsWith('.json')) {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw)
  }

  if (filePath.endsWith('.js')) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(filePath)
  }

  return {}
}

function unwrapDefault(value: unknown): unknown {
  if (isRecord(value) && 'default' in value) {
    return (value as { default?: unknown }).default ?? value
  }

  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeRuleSetting(input: RuleSettingInput): RuleSeverity | 'off' | null | undefined {
  if (input === undefined) {
    return undefined
  }

  if (input === null) {
    return null
  }

  if (typeof input === 'boolean') {
    return input ? undefined : 'off'
  }

  if (typeof input === 'number') {
    if (input === 0) return 'off'
    if (input === 1) return RuleSeverity.Warning
    if (input === 2) return RuleSeverity.Error
    return null
  }

  if (typeof input === 'string') {
    const normalized = input.toLowerCase()

    if (normalized === 'off' || normalized === 'disable' || normalized === 'disabled') {
      return 'off'
    }

    if (normalized === 'warn' || normalized === 'warning') {
      return RuleSeverity.Warning
    }

    if (normalized === 'error') {
      return RuleSeverity.Error
    }

    if (normalized === 'optimizing' || normalized === 'optimize' || normalized === 'optimise') {
      return RuleSeverity.Optimizing
    }

    return null
  }

  if (input === RuleSeverity.Error || input === RuleSeverity.Warning || input === RuleSeverity.Optimizing) {
    return input
  }

  return null
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return `"${value}"`
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
