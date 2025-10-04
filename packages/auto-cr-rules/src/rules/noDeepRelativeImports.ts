import { RuleSeverity, defineRule } from '../types'

const MAX_DEPTH = 2

export const noDeepRelativeImports = defineRule(
  'no-deep-relative-imports',
  { tag: 'base', severity: RuleSeverity.Warning },
  ({
  helpers,
  messages,
}) => {
  for (const reference of helpers.imports) {
    if (!helpers.isRelativePath(reference.value)) {
      continue
    }

    const depth = helpers.relativeDepth(reference.value)

    if (depth > MAX_DEPTH) {
      helpers.reportViolation(
        messages.noDeepRelativeImports({ value: reference.value, maxDepth: MAX_DEPTH }),
        reference.span
      )
    }
  }
})
