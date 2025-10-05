import { RuleSeverity, defineRule } from '../types'

const MAX_DEPTH = 2

export const noDeepRelativeImports = defineRule(
  'no-deep-relative-imports',
  { tag: 'base', severity: RuleSeverity.Warning },
  ({ ast, helpers, messages, language, source }) => {
    const moduleStart = ast.span?.start ?? 0
    const lineIndex = buildLineIndex(source)

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

        const line = reference.span
          ? resolveLine(lineIndex, bytePosToCharIndex(source, moduleStart, reference.span.start))
          : undefined

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

type LineIndex = {
  offsets: number[]
}

const buildLineIndex = (source: string): LineIndex => {
  const offsets: number[] = [0]

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      offsets.push(index + 1)
    }
  }

  return { offsets }
}

const resolveLine = ({ offsets }: LineIndex, position: number): number => {
  let low = 0
  let high = offsets.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const current = offsets[mid]

    if (current === position) {
      return mid + 1
    }

    if (current < position) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return high + 1
}

const readUtf8Character = (source: string, index: number, code: number): { bytes: number; nextIndex: number } => {
  if (code <= 0x7f) {
    return { bytes: 1, nextIndex: index + 1 }
  }

  if (code <= 0x7ff) {
    return { bytes: 2, nextIndex: index + 1 }
  }

  if (code >= 0xd800 && code <= 0xdbff && index + 1 < source.length) {
    const next = source.charCodeAt(index + 1)
    if (next >= 0xdc00 && next <= 0xdfff) {
      return { bytes: 4, nextIndex: index + 2 }
    }
  }

  return { bytes: 3, nextIndex: index + 1 }
}

const bytePosToCharIndex = (source: string, moduleStart: number, bytePos: number): number => {
  if (bytePos <= moduleStart) {
    return 0
  }

  let index = 0
  let byteOffset = moduleStart

  while (index < source.length) {
    const code = source.charCodeAt(index)
    const { bytes, nextIndex } = readUtf8Character(source, index, code)

    if (byteOffset + bytes > bytePos) {
      return index
    }

    byteOffset += bytes
    index = nextIndex
  }

  return source.length
}
