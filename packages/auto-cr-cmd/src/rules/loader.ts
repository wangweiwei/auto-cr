import fs from 'fs'
import path from 'path'
import { consola } from 'consola'
import { getAllFiles } from '../utils/file'
import { getTranslator } from '../i18n'
import type { Rule } from 'auto-cr-rules'
import { toRule } from 'auto-cr-rules'

// 自定义规则加载器：只解析 JS/CJS/MJS 文件，便于在运行时动态引入。
const SUPPORTED_EXTENSIONS = ['.js', '.cjs', '.mjs']

export interface LoadCustomRulesOptions {
  // 自定义告警处理器：主线程可收集日志，worker 可静默处理避免重复输出。
  onWarning?: (message: string, detail?: string) => void
}

// 从指定目录读取规则文件，并转换为 Rule 列表。
export function loadCustomRules(ruleDir?: string, options: LoadCustomRulesOptions = {}): Rule[] {
  const t = getTranslator()
  const emitWarning =
    typeof options.onWarning === 'function'
      ? options.onWarning
      : (message: string, detail?: string) => consola.warn(message, detail)
  if (!ruleDir) {
    return []
  }

  const absolutePath = path.isAbsolute(ruleDir)
    ? ruleDir
    : path.resolve(process.cwd(), ruleDir)

  if (!fs.existsSync(absolutePath)) {
    emitWarning(t.customRuleDirMissing({ path: absolutePath }))
    return []
  }

  const ruleFiles = getAllFiles(absolutePath, [], SUPPORTED_EXTENSIONS)
  const loaded: Rule[] = []

  for (const file of ruleFiles) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const moduleExports = require(file)
      // 支持模块直接导出 rule / rules / default / 数组。
      const rules = extractRules(moduleExports, file)

      if (!rules.length) {
        emitWarning(t.customRuleNoExport({ file }))
        continue
      }

      loaded.push(...rules)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      emitWarning(t.customRuleLoadFailed({ file }), detail)
    }
  }

  return loaded
}

// 兼容多种导出形态：默认导出、命名导出或数组。
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

// 把候选导出统一转为 Rule；无法识别的会被忽略。
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
