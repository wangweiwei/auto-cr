import type { Language, RuleMessages } from './types'

// 规则文案多语言表（由 rules 通过 messages 接口访问）。
const ruleTranslations: Record<Language, RuleMessages> = {
  zh: {
    noDeepRelativeImports: ({ value, maxDepth }) => `导入路径 "${value}"，不能超过最大层级${maxDepth}`,
    swallowedError: () => '捕获到的异常未被重新抛出或记录，可能导致问题被静默吞噬。',
    circularDependency: ({ chain }) => `检测到循环依赖: ${chain}`,
  },
  en: {
    noDeepRelativeImports: ({ value, maxDepth }) => `Import path "${value}" must not exceed max depth ${maxDepth}`,
    swallowedError: () => 'Caught exception is neither rethrown nor logged; potential swallowed error detected.',
    circularDependency: ({ chain }) => `Circular dependency detected: ${chain}`,
  },
}

// 固定文案对象，避免运行期被意外修改。
Object.values(ruleTranslations).forEach((messages) => Object.freeze(messages))

// 根据语言返回对应的规则文案实现。
export const createRuleMessages = (language: Language): RuleMessages => {
  return ruleTranslations[language] ?? ruleTranslations.zh
}
