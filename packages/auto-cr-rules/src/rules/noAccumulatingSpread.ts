import type {
  ArrayExpression,
  ArrowFunctionExpression,
  AssignmentExpression,
  FunctionExpression,
  Identifier,
  ObjectExpression,
  Pattern,
  Span,
} from '@swc/types'
import { RuleSeverity, defineRule } from '../types'

// 检测热路径中对累加器使用展开语法：每次迭代都会复制整个累加器，整体复杂度退化为 O(n^2)。
// 两种形态：
// - A：reduce / reduceRight 回调内展开累加器参数，如 (acc, x) => [...acc, x]；
// - B：循环体或数组回调内把变量重新赋值为自身的展开，如 result = [...result, x]。
export const noAccumulatingSpread = defineRule(
  'no-accumulating-spread',
  { tag: 'performance', severity: RuleSeverity.Optimizing },
  ({ analysis, helpers, language, messages }) => {
    const suggestions =
      language === 'zh'
        ? [
            { text: '原地修改累加器（acc.push(x) / acc[key] = value）并返回它。' },
            { text: '或先收集结果，循环结束后一次性展开或合并。' },
          ]
        : [
            { text: 'Mutate the accumulator in place (acc.push(x) / acc[key] = value) and return it.' },
            { text: 'Or collect items first and spread/merge them once after the loop.' },
          ]

    // 形态 A/B 可能命中同一处（如 reduce 回调嵌套在循环里），按展开位置去重。
    const reported = new Set<number>()
    const report = (name: string, kind: SpreadKind, span: Span): void => {
      if (reported.has(span.start)) {
        return
      }
      reported.add(span.start)
      helpers.reportViolation(
        {
          description: messages.noAccumulatingSpread({ name }),
          code: kind === 'array' ? `[...${name}]` : `{...${name}}`,
          suggestions,
          span,
        },
        span
      )
    }

    // 形态 A：reduce 回调内展开累加器参数。
    for (const entry of analysis.callbacks) {
      if (entry.method !== 'reduce' && entry.method !== 'reduceRight') {
        continue
      }
      const accumulator = getFirstParamName(entry.callback)
      if (!accumulator) {
        continue
      }
      walk(entry.callback.body, (node) => {
        // 嵌套函数若重新绑定了同名参数，其内部的 acc 已不是累加器，整段跳过。
        if (isFunctionNode(node)) {
          return !bindsName(node, accumulator)
        }
        for (const spread of findSpreadsOf(node, accumulator)) {
          report(accumulator, spread.kind, spread.span)
        }
        return true
      })
    }

    // 形态 B：循环体 / 数组回调内 `x = [...x, ...]`。
    // 不进入嵌套函数：普通闭包只是定义在热路径里，未必逐次执行；数组回调则已由 callbacks 索引单独覆盖。
    const hotRoots: unknown[] = [
      ...analysis.loops.map((loop) => loop.node.body),
      ...analysis.callbacks.map((callback) => callback.callback.body),
    ]
    for (const root of hotRoots) {
      walk(root, (node) => {
        if (isFunctionNode(node)) {
          return false
        }
        const assignment = asSelfSpreadAssignment(node)
        if (assignment) {
          report(assignment.name, assignment.kind, assignment.span)
        }
        return true
      })
    }
  }
)

type SpreadKind = 'array' | 'object'
type SpreadHit = { kind: SpreadKind; span: Span }
type FunctionNode = ArrowFunctionExpression | FunctionExpression
type TypedNode = { type?: string }

// 通用子树遍历；visitor 返回 false 时不再深入该节点。
const walk = (root: unknown, visitor: (node: TypedNode) => boolean): void => {
  if (!root || typeof root !== 'object') {
    return
  }
  if (Array.isArray(root)) {
    root.forEach((item) => walk(item, visitor))
    return
  }
  const node = root as Record<string, unknown> & TypedNode
  if (node.type && !visitor(node)) {
    return
  }
  for (const [key, value] of Object.entries(node)) {
    // span 只是位置信息，跳过以减少无意义递归。
    if (key === 'span') {
      continue
    }
    walk(value, visitor)
  }
}

const isFunctionNode = (node: TypedNode): node is FunctionNode =>
  node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression'

// 箭头函数的 params 直接是 Pattern；function 表达式的 params 是 Param，需取 .pat。
const getParamPatterns = (fn: FunctionNode): Pattern[] => {
  if (fn.type === 'ArrowFunctionExpression') {
    return fn.params
  }
  return fn.params.map((param) => param.pat)
}

const getFirstParamName = (fn: FunctionNode): string | null => {
  const first = getParamPatterns(fn)[0]
  return first && first.type === 'Identifier' ? first.value : null
}

const bindsName = (fn: FunctionNode, name: string): boolean =>
  getParamPatterns(fn).some((pattern) => pattern.type === 'Identifier' && pattern.value === name)

// 在数组/对象字面量中找出对指定标识符的展开。
const findSpreadsOf = (node: TypedNode, name: string): SpreadHit[] => {
  const hits: SpreadHit[] = []
  if (node.type === 'ArrayExpression') {
    for (const element of (node as ArrayExpression).elements) {
      if (element?.spread && isIdentifierNamed(element.expression, name)) {
        hits.push({ kind: 'array', span: element.expression.span })
      }
    }
  } else if (node.type === 'ObjectExpression') {
    for (const property of (node as ObjectExpression).properties) {
      if (property.type === 'SpreadElement' && isIdentifierNamed(property.arguments, name)) {
        hits.push({ kind: 'object', span: property.arguments.span })
      }
    }
  }
  return hits
}

// 识别 `x = [...x, ...]` / `x = { ...x, ... }`：左右两侧为同一标识符。
const asSelfSpreadAssignment = (node: TypedNode): (SpreadHit & { name: string }) | null => {
  if (node.type !== 'AssignmentExpression') {
    return null
  }
  const assignment = node as AssignmentExpression
  if (assignment.operator !== '=' || assignment.left.type !== 'Identifier') {
    return null
  }
  const name = assignment.left.value
  const [hit] = findSpreadsOf(assignment.right as TypedNode, name)
  return hit ? { ...hit, name } : null
}

const isIdentifierNamed = (expression: { type: string }, name: string): expression is Identifier =>
  expression.type === 'Identifier' && (expression as Identifier).value === name
