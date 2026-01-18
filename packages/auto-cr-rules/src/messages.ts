import type { Language, RuleMessages } from './types'

// 规则文案多语言表（由 rules 通过 messages 接口访问）。
const ruleTranslations: Record<Language, RuleMessages> = {
  zh: {
    noDeepRelativeImports: ({ value, maxDepth }) => `导入路径 "${value}"，不能超过最大层级${maxDepth}`,
    swallowedError: () => '捕获到的异常未被重新抛出或记录，可能导致问题被静默吞噬。',
    circularDependency: ({ chain }) => `检测到循环依赖: ${chain}`,
    unresolvedImport: ({ value }) =>
      `无法解析导入 "${value}"，请检查 tsconfig paths/baseUrl/rootDirs 或 package.json exports。`,
    noCatastrophicRegex: ({ pattern }) => `热路径正则包含嵌套的无限量词，可能引发灾难性回溯: ${pattern}`,
    noDeepCloneInLoop: () => '热路径中使用深拷贝（structuredClone 或 JSON.parse(JSON.stringify)），可能造成明显开销。',
    noN2ArrayLookup: ({ method }) => `热路径中使用线性查找方法 ${method}，可能导致 O(n^2) 访问。`,
  },
  en: {
    noDeepRelativeImports: ({ value, maxDepth }) => `Import path "${value}" must not exceed max depth ${maxDepth}`,
    swallowedError: () => 'Caught exception is neither rethrown nor logged; potential swallowed error detected.',
    circularDependency: ({ chain }) => `Circular dependency detected: ${chain}`,
    unresolvedImport: ({ value }) =>
      `Unable to resolve import "${value}". Check tsconfig paths/baseUrl/rootDirs or package.json exports.`,
    noCatastrophicRegex: ({ pattern }) =>
      `Regex in a hot path contains nested unbounded quantifiers and may trigger catastrophic backtracking: ${pattern}`,
    noDeepCloneInLoop: () => 'Deep cloning in a hot path (structuredClone or JSON.parse(JSON.stringify)) may be costly.',
    noN2ArrayLookup: ({ method }) =>
      `Linear lookup method ${method} is used in a hot path and may cause O(n^2) access.`,
  },
}

// 固定文案对象，避免运行期被意外修改。
Object.values(ruleTranslations).forEach((messages) => Object.freeze(messages))

// 根据语言返回对应的规则文案实现。
export const createRuleMessages = (language: Language): RuleMessages => {
  return ruleTranslations[language] ?? ruleTranslations.zh
}
