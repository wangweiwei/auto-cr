import type { CallExpression, NewExpression } from '@swc/types'
import { RuleSeverity, defineRule } from '../types'
import { extractRegExpPattern, getStaticPattern } from './utils/regexp'

// 检测热路径中用常量模式构造正则：new RegExp('...') / RegExp('...') 每次迭代都会重新编译，
// 而模式既然是常量，就可以提升到循环外一次性构造。模式或 flags 为动态值时不报，避免误判。
// 正则字面量 /.../ 由引擎按出现位置缓存编译结果，不在本规则范围内。
export const noRegexpConstructionInHotPath = defineRule(
  'no-regexp-construction-in-hot-path',
  { tag: 'performance', severity: RuleSeverity.Optimizing },
  ({ analysis, helpers, language, messages }) => {
    const suggestions =
      language === 'zh'
        ? [
            { text: '把 new RegExp(...) 提升到循环/回调外，或改写为正则字面量 /.../。' },
            { text: '多处共用时，定义为模块级常量一次构造。' },
          ]
        : [
            { text: 'Hoist new RegExp(...) out of the loop/callback, or write it as a regex literal /.../.' },
            { text: 'If it is used in several places, construct it once as a module-level constant.' },
          ]

    // hotPath.newExpressions / callExpressions 已是热路径内的节点列表，分别覆盖 new RegExp(...) 与 RegExp(...)。
    const candidates: Array<CallExpression | NewExpression> = [
      ...analysis.hotPath.newExpressions,
      ...analysis.hotPath.callExpressions,
    ]

    for (const expression of candidates) {
      const found = extractRegExpPattern(expression)
      if (!found || !hasStaticFlags(expression)) {
        continue
      }

      helpers.reportViolation(
        {
          description: messages.noRegexpConstructionInHotPath({ pattern: found.pattern }),
          code: `${expression.type === 'NewExpression' ? 'new ' : ''}RegExp('${found.pattern}')`,
          suggestions,
          span: expression.span,
        },
        expression.span
      )
    }
  }
)

// flags 缺省或为静态字符串时，整个构造才是常量。
const hasStaticFlags = (expression: CallExpression | NewExpression): boolean => {
  const flags = (expression.arguments ?? [])[1]
  return !flags || getStaticPattern(flags.expression) !== null
}
