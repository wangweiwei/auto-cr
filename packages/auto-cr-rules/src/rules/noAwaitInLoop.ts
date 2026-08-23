import type { AwaitExpression, ForOfStatement } from '@swc/types'
import type { LoopEntry } from '../types'
import { RuleSeverity, defineRule } from '../types'
import { walkAst, type TypedNode } from './utils/ast'

// 检测 for / for...of / for...in 循环体内逐次 await：每轮都要等上一轮完成，
// 若各轮互不依赖，整段工作本可以用 Promise.all 并发执行。
// 刻意不覆盖的场景（都是“有意顺序执行”）：
// - while / do...while：由条件驱动的轮询、重试循环；
// - for await：异步迭代本身就是顺序消费；
// - 循环体内含 break / return：提前退出的语义无法用 Promise.all 复现；
// - 嵌套函数内的 await：tasks.push(async () => { await x }) 正是并发写法，不能误伤。
// - 把 await 结果赋给既有变量（state = await step(state)）：轮次之间携带状态，本就无法并发。
export const noAwaitInLoop = defineRule(
  'no-await-in-loop',
  { tag: 'performance', severity: RuleSeverity.Optimizing },
  ({ analysis, helpers, language, messages }) => {
    const suggestions =
      language === 'zh'
        ? [
            { text: '各轮独立时，改为 await Promise.all(items.map(async (item) => ...)) 并发执行。' },
            { text: '需要限流时分批 Promise.all 或使用并发池；确需顺序执行时可关闭本规则。' },
          ]
        : [
            { text: 'When iterations are independent, run them concurrently with await Promise.all(items.map(async (item) => ...)).' },
            { text: 'Batch the Promise.all calls or use a concurrency pool to limit parallelism; disable the rule where sequential order is required.' },
          ]

    for (const loop of analysis.loops) {
      if (!isCollectionLoop(loop)) {
        continue
      }

      const body = scanLoopBody(loop.node.body)
      // 一个循环只报一次，定位到第一处 await。
      if (!body.firstAwait || body.hasEarlyExit || body.hasCarriedAssignment) {
        continue
      }

      helpers.reportViolation(
        {
          description: messages.noAwaitInLoop(),
          code: describeAwait(body.firstAwait),
          suggestions,
          span: body.firstAwait.span,
        },
        body.firstAwait.span
      )
    }
  }
)

// 只看集合式循环；for await 的 await 是异步迭代的一部分，整段跳过。
const isCollectionLoop = (loop: LoopEntry): boolean => {
  if (loop.type === 'ForOfStatement') {
    return !(loop.node as ForOfStatement).await
  }
  return loop.type === 'ForStatement' || loop.type === 'ForInStatement'
}

type LoopBodyScan = {
  firstAwait: AwaitExpression | null
  hasEarlyExit: boolean
  hasCarriedAssignment: boolean
}

// 每个循环只判断自己这一层：遇到嵌套函数或嵌套循环即停止——
// 内层循环会被单独判定，内层的 break 也不应影响外层的结论。
const SCAN_BOUNDARIES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'FunctionDeclaration',
  'ClassDeclaration',
  'ClassExpression',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
])

const scanLoopBody = (body: unknown): LoopBodyScan => {
  const result: LoopBodyScan = { firstAwait: null, hasEarlyExit: false, hasCarriedAssignment: false }
  walkAst(body, (node) => {
    if (node.type && SCAN_BOUNDARIES.has(node.type)) {
      return false
    }
    if (node.type === 'AwaitExpression' && !result.firstAwait) {
      result.firstAwait = node as unknown as AwaitExpression
    }
    if (node.type === 'BreakStatement' || node.type === 'ReturnStatement') {
      result.hasEarlyExit = true
    }
    if (isCarriedAwaitAssignment(node)) {
      result.hasCarriedAssignment = true
    }
    return true
  })
  return result
}

// `x = await f(...)`：把 await 结果写回既有变量，典型的轮次间携带状态（acc = await step(acc)），
// 或者结果需要按序消费。只匹配对既有标识符的重新赋值；循环内 const/let 声明不算。
const isCarriedAwaitAssignment = (node: TypedNode): boolean => {
  if (node.type !== 'AssignmentExpression') {
    return false
  }
  const assignment = node as TypedNode & { operator?: string; left?: TypedNode; right?: TypedNode }
  if (assignment.operator !== '=' || assignment.left?.type !== 'Identifier') {
    return false
  }
  let right = assignment.right
  while (right?.type === 'ParenthesisExpression') {
    right = (right as TypedNode & { expression?: TypedNode }).expression
  }
  return right?.type === 'AwaitExpression'
}

// 报告里展示 `await load(...)` 之类的调用形态，便于一眼定位。
const describeAwait = (expression: AwaitExpression): string => {
  const argument = expression.argument as TypedNode & { callee?: TypedNode & { value?: string; property?: TypedNode & { value?: string } } }
  if (argument.type === 'CallExpression' && argument.callee) {
    const callee = argument.callee
    if (callee.type === 'Identifier' && callee.value) {
      return `await ${callee.value}(...)`
    }
    if (callee.type === 'MemberExpression' && callee.property?.type === 'Identifier' && callee.property.value) {
      return `await ....${callee.property.value}(...)`
    }
  }
  return 'await ...'
}

