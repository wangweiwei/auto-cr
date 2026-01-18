import { RuleSeverity, defineRule } from '../types'
import { resolveLineFromByteOffset } from '../sourceIndex'

const MAX_DEPTH = 2

// 检测相对路径过深的导入，避免维护困难与重构风险。
export const noDeepRelativeImports = defineRule(
  'no-deep-relative-imports',
  { tag: 'base', severity: RuleSeverity.Warning },
  ({ helpers, messages, language, source, sourceIndex }) => {
    // sourceIndex 由 runtime 统一构建，避免每条规则重复计算行号索引。
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

        // 优先使用 span 计算行号，若异常则退回到文本匹配。
        const computedLine = reference.span
          ? resolveLineFromByteOffset(source, sourceIndex, reference.span.start)
          : undefined
        const fallbackLine = findImportLine(source, reference.value)
        // 取更大的行号，避免 span 截断时指向注释块。
        const line = selectLineNumber(computedLine, fallbackLine)

        helpers.reportViolation(
          {
            description,
            code: reference.value,
            suggestions,
            span: reference.span,
            line,
          },
          reference.span
        )
      }
    }
  }
)

const findImportLine = (source: string, value: string): number | undefined => {
  const lines = source.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    // Look for the literal import string. This is slower than span math but provides a robust fallback.
    if (line.includes('import') && line.includes(value)) {
      return index + 1
    }
  }

  return undefined
}

const selectLineNumber = (computed?: number, fallback?: number): number | undefined => {
  // If one of the sources is missing, prefer the other. When both exist, use the larger line number so
  // we avoid pointing at comment blocks above the actual statement.
  if (fallback === undefined) {
    return computed
  }

  if (computed === undefined) {
    return fallback
  }

  if (computed < fallback) {
    return fallback
  }

  return computed
}
