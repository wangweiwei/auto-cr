import fs from 'fs'
import path from 'path'
import { consola } from 'consola'
import { getAllFiles } from '../utils/file'
import { getTranslator } from '../i18n'
import type { Rule } from 'auto-cr-rules'
import { toRule } from 'auto-cr-rules'

const SUPPORTED_EXTENSIONS = ['.js', '.cjs', '.mjs']

export function loadCustomRules(ruleDir?: string): Rule[] {
  const t = getTranslator()
  if (!ruleDir) {
    return []
  }

  const absolutePath = path.isAbsolute(ruleDir)
    ? ruleDir
    : path.resolve(process.cwd(), ruleDir)

  if (!fs.existsSync(absolutePath)) {
    consola.warn(t.customRuleDirMissing({ path: absolutePath }))
    return []
  }

  const ruleFiles = getAllFiles(absolutePath, [], SUPPORTED_EXTENSIONS)
  const loaded: Rule[] = []

  for (const file of ruleFiles) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const moduleExports = require(file)
      const rules = extractRules(moduleExports, file)

      if (!rules.length) {
        consola.warn(t.customRuleNoExport({ file }))
        continue
      }

      loaded.push(...rules)
    } catch (error) {
      consola.warn(
        t.customRuleLoadFailed({ file }),
        error instanceof Error ? error.message : error
      )
    }
  }

  return loaded
}

function extractRules(moduleExports: unknown, origin: string): Rule[] {
  const collected: Rule[] = []

  collected.push(...normalizeCandidate(moduleExports, origin))

  if (moduleExports && typeof moduleExports === 'object') {
    const withDefault = moduleExports as { default?: unknown; rules?: unknown; rule?: unknown }

    if (withDefault.default !== undefined) {
      collected.push(...normalizeCandidate(withDefault.default, `${origin}:default`))
    }

    if (withDefault.rules !== undefined) {
      collected.push(...normalizeCandidate(withDefault.rules, `${origin}:rules`))
    }

    if (withDefault.rule !== undefined) {
      collected.push(...normalizeCandidate(withDefault.rule, `${origin}:rule`))
    }
  }

  return collected
}

function normalizeCandidate(candidate: unknown, origin: string): Rule[] {
  if (!candidate) {
    return []
  }

  if (Array.isArray(candidate)) {
    return candidate
      .map((item, index) => toRule(item, `${origin}#${index}`))
      .filter((rule): rule is Rule => rule !== null)
  }

  const rule = toRule(candidate, origin)
  return rule ? [rule] : []
}
