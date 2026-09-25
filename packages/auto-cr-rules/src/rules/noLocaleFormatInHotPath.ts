import { RuleSeverity, defineRule } from '../types'
import {
  describeExpression,
  getCalledMethodName,
  isUndefinedExpression,
  type CallNode,
} from './utils/ast'
import {
  collectHotScopes,
  createInvarianceChecker,
  isLeavingScope,
  walkScopeOwnRegion,
} from './utils/hotScopes'

// 检测热路径中带 locale / options 调用的本地化方法：
//   rows.map((row) => row.amount.toLocaleString('zh-CN', { style: 'currency', currency: 'CNY' }))
//   events.forEach((event) => print(event.at.toLocaleDateString('zh-CN', { month: 'long' })))
//   items.filter((item) => item.name.localeCompare(query, 'zh', { sensitivity: 'base' }) === 0)
// 这些调用每次都要按参数重新协商 locale、加载本地化数据并创建一次性的格式化器/排序器；
// 参数既然不变，就应该在循环外创建一次 Intl.NumberFormat / DateTimeFormat / Collator 后复用。
// 不带参数（或只传 undefined）的调用引擎通常会缓存默认实例，不在范围内；locale / options 随迭代变化时无法直接提升，也不报；
// throw 里、循环中 return 里的调用每次进入作用域至多执行一次，同样不报。
export const noLocaleFormatInHotPath = defineRule(
  'no-locale-format-in-hot-path',
  { tag: 'performance', severity: RuleSeverity.Optimizing },
  ({ analysis, helpers, language, messages }) => {
    // 先在共享的热路径调用索引里预筛：绝大多数文件没有这类调用，直接结束。
    const hasCandidate = analysis.hotPath.callExpressions.some((callExpression) =>
      LOCALE_METHODS.has(getCalledMethodName(callExpression as CallNode) ?? '')
    )
    if (!hasCandidate) {
      return
    }

    const scopes = collectHotScopes(analysis)
    const scopeNodes = new Set<unknown>(scopes.map((scope) => scope.node))
    const checker = createInvarianceChecker(analysis)
    const suggestions =
      language === 'zh'
        ? [
            {
              text: "在循环/回调外创建一次格式化器并复用，例如 const fmt = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' })，循环内调用 fmt.format(value)。",
            },
            {
              text: "日期改用 Intl.DateTimeFormat(...).format(date)，字符串比较改用 new Intl.Collator('zh').compare(a, b)。",
            },
          ]
        : [
            {
              text: "Create the formatter once outside the loop/callback and reuse it, e.g. const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }); then call fmt.format(value) inside.",
            },
            {
              text: "Use Intl.DateTimeFormat(...).format(date) for dates and new Intl.Collator('en').compare(a, b) for string comparison.",
            },
          ]

    for (const scope of scopes) {
      walkScopeOwnRegion(scope, scopeNodes, (node, ancestors) => {
        if (node.type !== 'CallExpression') {
          return true
        }
        const call = node as CallNode
        const method = getCalledMethodName(call)
        const spec = method ? LOCALE_METHODS.get(method) : undefined
        if (!method || !spec || isLeavingScope(scope, ancestors)) {
          return true
        }

        const configArguments = (call.arguments ?? []).slice(spec.configFrom)
        const hasConfig = configArguments.some(
          (argument) => !isUndefinedExpression(argument.expression)
        )
        if (
          hasConfig &&
          configArguments.every(
            (argument) => !argument.spread && checker.isInvariant(argument.expression, scope)
          )
        ) {
          helpers.reportViolation(
            {
              description: messages.noLocaleFormatInHotPath({ method, intl: spec.intl }),
              code: `${describeExpression(call.callee)}(...)`,
              suggestions,
              span: call.span,
            },
            call.span
          )
        }
        return true
      })
    }
  }
)

// configFrom：从第几个参数开始是 locale / options（localeCompare 的第一个参数是被比较的字符串）。
// 用 Map 而不是对象字面量：否则 toString / hasOwnProperty 这类方法名会命中 Object.prototype。
const LOCALE_METHODS = new Map<string, { configFrom: number; intl: string }>([
  ['toLocaleString', { configFrom: 0, intl: 'Intl.NumberFormat / Intl.DateTimeFormat' }],
  ['toLocaleDateString', { configFrom: 0, intl: 'Intl.DateTimeFormat' }],
  ['toLocaleTimeString', { configFrom: 0, intl: 'Intl.DateTimeFormat' }],
  ['localeCompare', { configFrom: 1, intl: 'Intl.Collator' }],
])
