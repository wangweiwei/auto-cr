import type { Language, RuleSeverity } from 'auto-cr-rules'

interface Translator {
  noPathsProvided(): string
  allPathsMissing(): string
  scanningDirectory(params: { path: string }): string
  noFilesFound(): string
  noRulesLoaded(): string
  scanningFile(params: { file: string }): string
  scanComplete(): string
  scanError(): string
  parseFileFailed(params: { file: string }): string
  ruleExecutionFailed(params: { ruleName: string; file: string }): string
  unexpectedError(): string
  pathNotExist(params: { path: string }): string
  customRuleDirMissing(params: { path: string }): string
  customRuleNoExport(params: { file: string }): string
  customRuleLoadFailed(params: { file: string }): string
  tsconfigReadFailed(): string
  reporterSeverityLabel(params: { severity: RuleSeverity }): string
  reporterSeverityIcon(params: { severity: RuleSeverity }): string
  reporterFileLabel(): string
  reporterCodeLabel(): string
  reporterDescriptionLabel(): string
  reporterSuggestionLabel(): string
  reporterFormatSuggestion(params: { text: string; link?: string }): string
  ruleTagLabel(params: { tag: string }): string
}

const translations = {
  zh: {
    noPathsProvided: () => '未提供文件或目录路径，跳过代码扫描',
    allPathsMissing: () => '所有提供的路径均不存在，终止操作',
    scanningDirectory: ({ path }) => `扫描目录: ${path}`,
    noFilesFound: () => '未找到需要扫描的文件',
    noRulesLoaded: () => '未加载任何规则，跳过扫描',
    scanningFile: ({ file }) => `扫描文件: ${file}`,
    scanComplete: () => '代码扫描完成',
    scanError: () => '代码扫描过程中发生错误:',
    parseFileFailed: ({ file }) => `解析文件失败: ${file}`,
    ruleExecutionFailed: ({ ruleName, file }) => `规则执行失败(${ruleName}): ${file}`,
    unexpectedError: () => '执行过程中发生未预期的错误:',
    pathNotExist: ({ path }) => `路径不存在: ${path}`,
    customRuleDirMissing: ({ path }) => `自定义规则目录不存在: ${path}`,
    customRuleNoExport: ({ file }) => `规则文件未导出任何可用规则: ${file}`,
    customRuleLoadFailed: ({ file }) => `加载自定义规则失败: ${file}`,
    tsconfigReadFailed: () => '警告: 无法读取 tsconfig.json',
    reporterSeverityLabel: ({ severity }) => {
      const labels: Record<RuleSeverity, string> = {
        error: '错误',
        warning: '警告',
        optimizing: '优化建议',
      }

      return labels[severity]
    },
    reporterSeverityIcon: ({ severity }) => {
      const icons: Record<RuleSeverity, string> = {
        error: '❌',
        warning: '⚠️',
        optimizing: '⚡️',
      }

      return icons[severity]
    },
    reporterFileLabel: () => '文件位置',
    reporterCodeLabel: () => '错误代码',
    reporterDescriptionLabel: () => '错误描述',
    reporterSuggestionLabel: () => '优化建议',
    reporterFormatSuggestion: ({ text, link }) => {
      if (!link) {
        return text
      }

      return `${text}（链接: ${link}）`
    },
    ruleTagLabel: ({ tag }) => {
      const labels: Record<string, string> = {
        base: '基础规则',
        untagged: '未定义'
      }
      
      return labels[tag] ?? tag
    },
  },
  en: {
    noPathsProvided: () => 'No file or directory paths provided; skipping scan',
    allPathsMissing: () => 'All provided paths do not exist; aborting.',
    scanningDirectory: ({ path }) => `Scanning directory: ${path}`,
    noFilesFound: () => 'No files found to scan',
    noRulesLoaded: () => 'No rules loaded; skipping scan',
    scanningFile: ({ file }) => `Scanning file: ${file}`,
    scanComplete: () => 'Code scan complete',
    scanError: () => 'An error occurred during code scanning:',
    parseFileFailed: ({ file }) => `Failed to parse file: ${file}`,
    ruleExecutionFailed: ({ ruleName, file }) => `Rule execution failed (${ruleName}): ${file}`,
    unexpectedError: () => 'Unexpected error occurred during execution:',
    pathNotExist: ({ path }) => `Path does not exist: ${path}`,
    customRuleDirMissing: ({ path }) => `Custom rule directory does not exist: ${path}`,
    customRuleNoExport: ({ file }) => `Rule file does not export any usable rules: ${file}`,
    customRuleLoadFailed: ({ file }) => `Failed to load custom rule: ${file}`,
    tsconfigReadFailed: () => 'Warning: Failed to read tsconfig.json',
    reporterSeverityLabel: ({ severity }) => {
      const labels: Record<RuleSeverity, string> = {
        error: 'ERROR',
        warning: 'WARNING',
        optimizing: 'OPTIMIZING',
      }

      return labels[severity]
    },
    reporterSeverityIcon: ({ severity }) => {
      const icons: Record<RuleSeverity, string> = {
        error: '❌',
        warning: '⚠️',
        optimizing: '⚡️',
      }

      return icons[severity]
    },
    reporterFileLabel: () => 'File',
    reporterCodeLabel: () => 'Code',
    reporterDescriptionLabel: () => 'Description',
    reporterSuggestionLabel: () => 'Suggestion',
    reporterFormatSuggestion: ({ text, link }) => {
      if (!link) {
        return text
      }

      return `${text} (Link: ${link})`
    },
    ruleTagLabel: ({ tag }) => {
      const labels: Record<string, string> = {
        base: 'Base Rules',
        untagged: 'untagged'
      }

      return labels[tag] ?? tag
    },
  },
} satisfies Record<Language, Translator>

let currentLanguage: Language = 'zh'
let currentTranslator: Translator = translations.zh

export function normalizeLanguage(input?: string): Language {
  if (!input) {
    return 'zh'
  }

  const lower = input.toLowerCase()

  if (lower.startsWith('en')) {
    return 'en'
  }

  if (lower.startsWith('zh')) {
    return 'zh'
  }

  return 'zh'
}

export function setLanguage(language?: string): Translator {
  const normalized = normalizeLanguage(language)
  currentLanguage = normalized
  currentTranslator = translations[normalized]
  return currentTranslator
}

export function getLanguage(): Language {
  return currentLanguage
}

export function getTranslator(): Translator {
  return currentTranslator
}

export type { Translator }
export type { Language } from 'auto-cr-rules'
