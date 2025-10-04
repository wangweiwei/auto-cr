import { RuleSeverity, defineRule } from '../types'

const MAX_DEPTH = 2

export const noDeepRelativeImports = defineRule(
  'no-deep-relative-imports',
  { tag: 'base', severity: RuleSeverity.Warning },
  ({ helpers, messages, language }) => {
    for (const reference of helpers.imports) {
      if (!helpers.isRelativePath(reference.value)) {
        continue
      }

      const depth = helpers.relativeDepth(reference.value)

      if (depth > MAX_DEPTH) {
        const description = messages.noDeepRelativeImports({ value: reference.value, maxDepth: MAX_DEPTH })

        const suggestions =
          language === 'zh'
            ? [
                { text: '使用别名路径（如 @shared/deep/utils）' },
                { text: '或在上层聚合导出，避免过深相对路径。' },
              ]
            : [
                { text: 'Use a path alias (for example: @shared/deep/utils).' },
                { text: 'Create an index file at a higher level to re-export the module and shorten the import.' },
              ]

        helpers.reportViolation({
          description,
          code: reference.value,
          suggestions,
          span: reference.span,
        })
      }
    }
  }
)
