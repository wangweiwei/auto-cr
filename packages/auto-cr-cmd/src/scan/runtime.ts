import fs from 'fs'
import path from 'path'
import type { Rule } from 'auto-cr-rules'

export type RulesRuntime = {
  builtinRules: Rule[]
  createRuleContext: typeof import('auto-cr-rules').createRuleContext
  RuleSeverity: typeof import('auto-cr-rules').RuleSeverity
}

// 运行 TS 源码时优先加载本地 rules，避免开发时拿到旧的 workspace 依赖。
// 生产构建产物（dist）会直接走安装包导出的 runtime。
export function loadRulesRuntime(): RulesRuntime {
  const fallback = require('auto-cr-rules') as RulesRuntime
  const localRuntime = resolveLocalRulesRuntime()

  if (localRuntime) {
    return localRuntime
  }

  return fallback
}

function resolveLocalRulesRuntime(): RulesRuntime | null {
  if (!__filename.endsWith('.ts')) {
    return null
  }

  const localEntry = path.resolve(__dirname, '../../../auto-cr-rules/src/index.ts')
  if (!fs.existsSync(localEntry)) {
    return null
  }

  try {
    const localRuntime = require(localEntry) as RulesRuntime
    if (Array.isArray(localRuntime.builtinRules)) {
      return localRuntime
    }
  } catch {
    return null
  }

  return null
}
