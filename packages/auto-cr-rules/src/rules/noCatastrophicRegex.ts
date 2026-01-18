import type { CallExpression, Expression, NewExpression, RegExpLiteral, Span, TemplateLiteral } from '@swc/types'
import { RuleSeverity, defineRule } from '../types'
import { walkHotPath } from './utils/hotPath'

// 检测热路径中可能引发灾难性回溯的嵌套无限量词正则。
// 只处理字面量或静态字符串/模板字符串构造的 RegExp，忽略动态拼接。
export const noCatastrophicRegex = defineRule(
  'no-catastrophic-regex',
  { tag: 'performance', severity: RuleSeverity.Optimizing },
  ({ ast, helpers, language, messages }) => {
    const suggestions =
      language === 'zh'
        ? [
            { text: '避免嵌套无限量词，给量词增加上限或使用更具体的匹配。' },
            { text: '必要时拆分为多次匹配，或先做前置过滤。' },
          ]
        : [
            { text: 'Avoid nested unbounded quantifiers by adding bounds or more specific tokens.' },
            { text: 'Split the regex into multiple passes or pre-filter before matching.' },
          ]

    walkHotPath(ast, (node, inHot) => {
      if (!inHot || !node || typeof node !== 'object') {
        return
      }

      const candidate = node as { type?: string }

      // 直接的 /.../ 字面量。
      if (candidate.type === 'RegExpLiteral') {
        const literal = candidate as RegExpLiteral
        if (!hasNestedUnboundedQuantifier(literal.pattern)) {
          return
        }

        helpers.reportViolation(
          {
            description: messages.noCatastrophicRegex({ pattern: literal.pattern }),
            code: literal.pattern,
            suggestions,
            span: literal.span,
          },
          literal.span
        )
        return
      }

      // RegExp('...') 或 new RegExp('...') 的静态模式。
      if (candidate.type === 'CallExpression' || candidate.type === 'NewExpression') {
        const info = extractRegExpPattern(candidate as CallExpression | NewExpression)
        if (!info) {
          return
        }

        if (!hasNestedUnboundedQuantifier(info.pattern)) {
          return
        }

        helpers.reportViolation(
          {
            description: messages.noCatastrophicRegex({ pattern: info.pattern }),
            code: info.pattern,
            suggestions,
            span: info.span,
          },
          info.span
        )
      }
    })
  }
)

type RegExpPattern = {
  pattern: string
  span?: Span
}

type Quantifier = {
  unbounded: boolean
  length: number
}

type GroupState = {
  hasUnbounded: boolean
}

// 提取静态 RegExp 字符串，动态表达式直接跳过。
const extractRegExpPattern = (expression: CallExpression | NewExpression): RegExpPattern | null => {
  const callee = expression.callee
  if (callee.type !== 'Identifier' || callee.value !== 'RegExp') {
    return null
  }

  const args = expression.arguments ?? []
  if (args.length === 0) {
    return null
  }

  const pattern = getStaticPattern(args[0]?.expression)
  if (!pattern) {
    return null
  }

  return {
    pattern,
    span: expression.span,
  }
}

// 只接受字符串字面量或无表达式的模板字符串。
const getStaticPattern = (expression?: Expression): string | null => {
  if (!expression) {
    return null
  }

  const candidate = unwrapExpression(expression)

  if (candidate.type === 'StringLiteral') {
    return candidate.value
  }

  if (candidate.type === 'TemplateLiteral') {
    return resolveTemplateLiteral(candidate)
  }

  return null
}

// 去掉包裹用的括号表达式，避免误判。
const unwrapExpression = (expression: Expression): Expression => {
  let current = expression

  while (current.type === 'ParenthesisExpression') {
    current = current.expression
  }

  return current
}

// 仅当模板字符串没有插值表达式时才返回完整字符串。
const resolveTemplateLiteral = (literal: TemplateLiteral): string | null => {
  if (literal.expressions.length > 0) {
    return null
  }

  return literal.quasis.map((quasi) => quasi.cooked ?? quasi.raw).join('')
}

// 简化的正则分析：检测分组内出现无限量词，且分组本身也被无限量词包裹。
// 注意：刻意不检测“重叠分支”一类复杂情况，只聚焦嵌套量词。
const hasNestedUnboundedQuantifier = (pattern: string): boolean => {
  const stack: GroupState[] = []
  let inCharClass = false
  let escaped = false

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (inCharClass) {
      if (char === ']') {
        inCharClass = false
      }
      continue
    }

    if (char === '[') {
      inCharClass = true
      continue
    }

    if (char === '(') {
      stack.push({ hasUnbounded: false })
      continue
    }

    if (char === ')') {
      const current = stack.pop()
      const quantifier = readQuantifier(pattern, index + 1)

      if (quantifier?.unbounded && current?.hasUnbounded) {
        return true
      }

      const parent = stack[stack.length - 1]
      if (parent && current?.hasUnbounded) {
        parent.hasUnbounded = true
      }

      if (parent && quantifier?.unbounded) {
        parent.hasUnbounded = true
      }

      if (quantifier) {
        index += quantifier.length
      }

      continue
    }

    // 读取当前 token 后紧跟的量词（如 a+, a*, a{1,}）。
    const quantifier = readQuantifier(pattern, index)
    if (quantifier) {
      if (quantifier.unbounded && stack.length > 0) {
        stack[stack.length - 1].hasUnbounded = true
      }

      index += quantifier.length - 1
    }
  }

  return false
}

// 解析量词并判断是否为“无限上限”的量词（+/*/{m,}）。
const readQuantifier = (pattern: string, index: number): Quantifier | null => {
  if (index >= pattern.length) {
    return null
  }

  const char = pattern[index]

  if (char === '*' || char === '+') {
    return {
      unbounded: true,
      length: 1 + (pattern[index + 1] === '?' ? 1 : 0),
    }
  }

  if (char === '?') {
    return {
      unbounded: false,
      length: 1 + (pattern[index + 1] === '?' ? 1 : 0),
    }
  }

  if (char !== '{') {
    return null
  }

  let end = index + 1
  while (end < pattern.length && pattern[end] !== '}') {
    end += 1
  }

  if (end >= pattern.length) {
    return null
  }

  // 只接受 {m} 或 {m,} / {m,n} 形式。
  const body = pattern.slice(index + 1, end)
  if (!/^\d+(,\d*)?$/.test(body)) {
    return null
  }

  let unbounded = false
  if (body.includes(',')) {
    const upper = body.split(',')[1]
    unbounded = upper === ''
  }

  return {
    unbounded,
    length: end - index + 1 + (pattern[end + 1] === '?' ? 1 : 0),
  }
}
