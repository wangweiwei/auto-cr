import { RuleSeverity, defineRule } from '../types'
import { asCall, describeExpression, getStringifiedValue, type TypedNode } from './utils/ast'

// 检测用 JSON.stringify 的结果比较两个值是否“相等”：
//   if (JSON.stringify(prev) === JSON.stringify(next)) { ... }
// 这种比较有三类问题：
// - 结果依赖属性插入顺序：内容相同、构造顺序不同的两个对象会被判为不相等；
// - 序列化有损：undefined / 函数 / Symbol 被丢弃，NaN、Infinity 变成 null，Date 变成字符串，Map / Set 变成 {}，
//   不同的值可能得到相同的字符串；
// - 每次比较都要完整序列化两个对象，数据大时开销可观。
// 传了 replacer（第二个参数）的调用不报：数组形式的 replacer 会固定输出的键顺序，属于有意为之。
export const noJsonStringifyComparison = defineRule(
  'no-json-stringify-comparison',
  { tag: 'base', severity: RuleSeverity.Warning },
  ({ analysis, helpers, language, messages }) => {
    const suggestions =
      language === 'zh'
        ? [
            {
              text: '改用深比较：Node 中的 util.isDeepStrictEqual，或 lodash 的 isEqual、fast-deep-equal 等库。',
            },
            {
              text: '只关心个别字段时直接比较这些字段；确需稳定字符串（如做缓存键）时使用按键排序的稳定序列化。',
            },
          ]
        : [
            {
              text: 'Use a deep-equality helper instead: util.isDeepStrictEqual in Node, or lodash isEqual / fast-deep-equal.',
            },
            {
              text: 'Compare the specific fields you care about; if you need a canonical string (e.g. a cache key), use a stable, key-sorted serializer.',
            },
          ]

    // analysis.binaryExpressions 来自共享遍历，无需再扫整棵树。
    for (const binary of analysis.binaryExpressions) {
      if (!EQUALITY_OPERATORS.has(binary.operator)) {
        continue
      }
      const left = getStringifyArgument(binary.left)
      const right = getStringifyArgument(binary.right)
      if (!left || !right) {
        continue
      }

      const code = `JSON.stringify(${describeExpression(left)}) ${binary.operator} JSON.stringify(${describeExpression(right)})`
      helpers.reportViolation(
        {
          description: messages.noJsonStringifyComparison(),
          code,
          suggestions,
          span: binary.span,
        },
        binary.span
      )
    }
  }
)

const EQUALITY_OPERATORS = new Set(['===', '==', '!==', '!='])

// 表达式是 JSON.stringify(x)（且没有 replacer）时返回 x。
const getStringifyArgument = (expression: unknown): TypedNode | null => {
  const call = asCall(expression)
  return call ? getStringifiedValue(call) : null
}
