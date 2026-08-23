import type { Expression, TemplateLiteral } from '@swc/types'
import { RuleSeverity, defineRule } from '../types'

// 检测说明符不是字面量的 import() / require()：打包器无法静态解析，
// 要么运行时找不到模块，要么被迫把整个目录打进产物；本工具的依赖图也看不到这条边。
// 默认关闭：Node 工具里按路径加载配置/插件是惯用写法，本规则面向需要打包的项目，按需开启。
// 带静态相对前缀的模板字符串（import(`./locales/${lang}.js`)）是打包器明确支持的形式，不报。
export const noNonLiteralDynamicImport = defineRule(
  'no-non-literal-dynamic-import',
  { tag: 'base', severity: RuleSeverity.Warning, enabledByDefault: false },
  ({ analysis, helpers, language, messages }) => {
    const suggestions =
      language === 'zh'
        ? [
            { text: '改为字面量路径；需要按条件加载时，用 if/switch 分支各写一个字面量 import()。' },
            { text: '确需运行时选择时，使用带静态相对前缀的模板字符串，如 import(`./locales/${lang}.js`)。' },
          ]
        : [
            { text: 'Use a literal specifier; for conditional loading, write one literal import() per branch.' },
            { text: 'If the target must be chosen at runtime, use a template literal with a static relative prefix, e.g. import(`./locales/${lang}.js`).' },
          ]

    // analysis.nonLiteralImports 由共享遍历收集：说明符不是字符串字面量的 import() / require()。
    for (const reference of analysis.nonLiteralImports) {
      if (isStaticallyResolvable(reference.argument)) {
        continue
      }

      const form = reference.kind === 'dynamic' ? 'import()' : 'require()'

      helpers.reportViolation(
        {
          description: messages.noNonLiteralDynamicImport({ form }),
          code: form.replace('()', '(...)'),
          suggestions,
          span: reference.span,
        },
        reference.span
      )
    }
  }
)

// 两种情况视为可静态解析：
// - 无插值的模板字符串，本质就是常量；
// - 带静态相对前缀（./ 或 ../）的模板字符串，打包器会按目录上下文处理。
const isStaticallyResolvable = (argument: Expression): boolean => {
  const candidate = unwrap(argument)
  if (candidate.type !== 'TemplateLiteral') {
    return false
  }

  const literal = candidate as TemplateLiteral
  if (literal.expressions.length === 0) {
    return true
  }

  const prefix = literal.quasis[0]?.cooked ?? literal.quasis[0]?.raw ?? ''
  return prefix.startsWith('./') || prefix.startsWith('../')
}

const unwrap = (expression: Expression): Expression => {
  let current = expression
  while (current.type === 'ParenthesisExpression') {
    current = current.expression
  }
  return current
}
