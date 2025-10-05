import type { Language, RuleMessages } from './types'

const ruleTranslations: Record<Language, RuleMessages> = {
  zh: {
    noDeepRelativeImports: ({ value, maxDepth }) => `导入路径 "${value}"，不能超过最大层级${maxDepth}`,
    swallowedError: () => '捕获到的异常未被重新抛出或记录，可能导致问题被静默吞噬。',
  },
  en: {
    noDeepRelativeImports: ({ value, maxDepth }) => `Import path "${value}" must not exceed max depth ${maxDepth}`,
    swallowedError: () => 'Caught exception is neither rethrown nor logged; potential swallowed error detected.',
  },
}

Object.values(ruleTranslations).forEach((messages) => Object.freeze(messages))

export const createRuleMessages = (language: Language): RuleMessages => {
  return ruleTranslations[language] ?? ruleTranslations.zh
}
