import type { Language } from 'auto-cr-rules'

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
  reporterErrorLabel(): string
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
    reporterErrorLabel: () => '错误',
    ruleTagLabel: ({ tag }) => {
      const labels: Record<string, string> = {
        base: '基础规则',
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
    reporterErrorLabel: () => 'ERROR',
    ruleTagLabel: ({ tag }) => {
      const labels: Record<string, string> = {
        base: 'Base Rules',
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
