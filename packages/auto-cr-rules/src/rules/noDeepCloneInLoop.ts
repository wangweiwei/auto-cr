import type { CallExpression, Expression, MemberExpression } from '@swc/types'
import { RuleSeverity, defineRule } from '../types'
import { walkHotPath } from './utils/hotPath'

// 检测热路径中使用标准深拷贝函数带来的性能开销。
// 仅覆盖 JS 标准函数：structuredClone 与 JSON.parse(JSON.stringify)。
export const noDeepCloneInLoop = defineRule(
  'no-deep-clone-in-loop',
  { tag: 'performance', severity: RuleSeverity.Optimizing },
  ({ ast, helpers, language, messages }) => {
    const suggestions =
      language === 'zh'
        ? [
            { text: '将深拷贝移出循环或回调，避免重复执行。' },
            { text: '只拷贝必要字段，或改用浅拷贝方案。' },
          ]
        : [
            { text: 'Move deep cloning outside loops/callbacks to avoid repeated work.' },
            { text: 'Clone only required fields or switch to a shallow copy.' },
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
      const cloneKind = getCloneKind(callExpression)
      if (!cloneKind) {
        return
      }

      helpers.reportViolation(
        {
          description: messages.noDeepCloneInLoop(),
          code: cloneKind === 'structuredClone' ? 'structuredClone(...)' : 'JSON.parse(JSON.stringify(...))',
          suggestions,
          span: callExpression.span,
        },
        callExpression.span
      )
    })
  }
)

type CloneKind = 'structuredClone' | 'jsonParseStringify'

// 按优先级识别标准深拷贝调用。
const getCloneKind = (expression: CallExpression): CloneKind | null => {
  if (isStructuredCloneCall(expression)) {
    return 'structuredClone'
  }

  if (isJsonParseStringify(expression)) {
    return 'jsonParseStringify'
  }

  return null
}

// structuredClone(...) 或 globalThis.structuredClone(...)
const isStructuredCloneCall = (expression: CallExpression): boolean => {
  const callee = expression.callee

  if (callee.type === 'Identifier' && callee.value === 'structuredClone') {
    return true
  }

  if (callee.type === 'MemberExpression') {
    const member = callee as MemberExpression
    return isIdentifier(member.object, 'globalThis') && getMemberPropertyName(member) === 'structuredClone'
  }

  return false
}

// JSON.parse(JSON.stringify(...))
const isJsonParseStringify = (expression: CallExpression): boolean => {
  if (!isJsonMemberCall(expression, 'parse')) {
    return false
  }

  const firstArg = expression.arguments[0]?.expression
  if (!firstArg || firstArg.type !== 'CallExpression') {
    return false
  }

  return isJsonMemberCall(firstArg, 'stringify')
}

// JSON.parse / JSON.stringify 的静态调用判断。
const isJsonMemberCall = (expression: CallExpression, method: string): boolean => {
  const callee = expression.callee
  if (callee.type !== 'MemberExpression') {
    return false
  }

  const member = callee as MemberExpression
  return isIdentifier(member.object, 'JSON') && getMemberPropertyName(member) === method
}

const getMemberPropertyName = (member: MemberExpression): string | null => {
  const property = member.property

  if (property.type === 'Identifier') {
    return property.value
  }

  if (property.type === 'Computed' && property.expression.type === 'StringLiteral') {
    return property.expression.value
  }

  return null
}

const isIdentifier = (expression: Expression, name: string): boolean => {
  return expression.type === 'Identifier' && expression.value === name
}
