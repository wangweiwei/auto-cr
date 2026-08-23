import { RuleSeverity, defineRule } from '../types'

// 检测传给 forEach 的 async 回调。
// forEach 不会等待回调返回的 Promise：调用方会在回调完成前继续执行，
// 回调内抛出的异常也会变成未处理的 Promise rejection。
// 这不是性能建议，而是几乎必然的逻辑错误，因此归入 base 并以 warning 上报。
export const noAsyncForEach = defineRule(
  'no-async-foreach',
  { tag: 'base', severity: RuleSeverity.Warning },
  ({ analysis, helpers, language, messages }) => {
    const suggestions =
      language === 'zh'
        ? [
            { text: '需要顺序执行时，改用 for...of 配合 await。' },
            { text: '需要并发执行时，改用 await Promise.all(items.map(async ...))。' },
          ]
        : [
            { text: 'Use for...of with await when iterations must run sequentially.' },
            { text: 'Use await Promise.all(items.map(async ...)) when iterations may run concurrently.' },
          ]

    // analysis.callbacks 已收集所有数组高阶方法的内联回调，无需再次遍历 AST。
    // 只要回调是 async，就一定存在“返回的 Promise 被 forEach 丢弃”的问题，
    // 不论回调体内有没有 await（即便没有，抛错也会从同步异常变成 unhandled rejection）。
    for (const entry of analysis.callbacks) {
      if (entry.method !== 'forEach' || !entry.callback.async) {
        continue
      }

      helpers.reportViolation(
        {
          description: messages.noAsyncForEach(),
          code: 'forEach(async (...) => { ... })',
          suggestions,
          span: entry.callExpression.span,
        },
        entry.callExpression.span
      )
    }
  }
)
