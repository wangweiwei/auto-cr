import type { CallExpression, Expression, MemberExpression } from '@swc/types'
import { RuleSeverity, defineRule } from '../types'
import { walkHotPath } from './utils/hotPath'

// 线性查找方法集合：filter/some/every 也按线性查找处理。
const LINEAR_LOOKUP_METHODS = new Set([
  'find',
  'findIndex',
  'filter',
  'some',
  'every',
  'includes',
  'indexOf',
  'lastIndexOf',
])

// 检测热路径中对数组进行线性查找的调用，避免潜在 O(n^2) 访问。
// 不强制校验 receiver 是否真实数组（静态分析阶段难以确定）。
export const noN2ArrayLookup = defineRule(
  'no-n2-array-lookup',
  { tag: 'performance', severity: RuleSeverity.Optimizing },
  ({ ast, helpers, language, messages }) => {
    const suggestions =
      language === 'zh'
        ? [
            { text: '预先构建 Map/Set 进行 O(1) 查找。' },
            { text: '缓存查找结果，或将查找逻辑移出循环。' },
          ]
        : [
            { text: 'Build a Map/Set for O(1) lookups.' },
            { text: 'Cache lookup results or move the search outside the loop.' },
          ]

    walkHotPath(ast, (node, inHot) => {
      if (!inHot || !node || typeof node !== 'object') {
        return
      }

      const candidate = node as { type?: string }
      if (candidate.type !== 'CallExpression') {
        return
      }

      const callExpression = candidate as CallExpression
      const method = getMemberMethodName(callExpression.callee)
      if (!method || !LINEAR_LOOKUP_METHODS.has(method)) {
        return
      }

      helpers.reportViolation(
        {
          description: messages.noN2ArrayLookup({ method }),
          code: method,
          suggestions,
          span: callExpression.span,
        },
        callExpression.span
      )
    })
  }
)

// 提取形如 obj.method(...) 的方法名。
const getMemberMethodName = (expression: Expression | { type?: string }): string | null => {
  if (!expression || expression.type !== 'MemberExpression') {
    return null
  }

  const member = expression as MemberExpression
  const property = member.property

  if (property.type === 'Identifier') {
    return property.value
  }

  if (property.type === 'Computed' && property.expression.type === 'StringLiteral') {
    return property.expression.value
  }

  return null
}
