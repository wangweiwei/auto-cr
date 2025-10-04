import type { Language, RuleMessages } from './types'

const ruleTranslations: Record<Language, RuleMessages> = {
  zh: {
    noDeepRelativeImports: ({ value, maxDepth }) => `导入路径 "${value}"，不能超过最大层级${maxDepth}`,
  },
  en: {
    noDeepRelativeImports: ({ value, maxDepth }) => `Import path "${value}" must not exceed max depth ${maxDepth}`,
  },
}

Object.values(ruleTranslations).forEach((messages) => Object.freeze(messages))

export const createRuleMessages = (language: Language): RuleMessages => {
  return ruleTranslations[language] ?? ruleTranslations.zh
}
