import type {
  BlockStatement,
  CatchClause,
  Identifier,
  KeyValueProperty,
  MemberExpression,
  ThrowStatement,
} from '@swc/types'
import { RuleSeverity, defineRule } from '../types'
import { walkAst, type TypedNode } from './utils/ast'

// 检测 catch 块中“丢弃原始异常后另起新错”的写法：
//   catch (error) { throw new Error('...') }
// error 从未被使用，原始异常的堆栈、消息与 cause 链全部丢失，线上排障时只能看到一条没有来源的新错误。
// 只要捕获的异常在 catch 块内被引用过（记录、包装、透传），就视为作者有意识地处理过，不再上报。
export const noLostErrorCause = defineRule(
  'no-lost-error-cause',
  { tag: 'base', severity: RuleSeverity.Warning },
  ({ analysis, helpers, language, messages }) => {
    const suggestions =
      language === 'zh'
        ? [
            { text: "用 { cause } 串联原始异常：throw new Error('...', { cause: error })。" },
            { text: '若只需透传，直接 throw error；若需记录，先写日志再抛出。' },
          ]
        : [
            { text: "Chain the original error with { cause }: throw new Error('...', { cause: error })." },
            { text: 'If you only need to propagate it, rethrow the original; if you need to record it, log it before throwing.' },
          ]

    // analysis.tryStatements 来自共享遍历，已包含嵌套的 try，无需再次扫 AST。
    for (const tryStatement of analysis.tryStatements) {
      const handler = tryStatement.handler
      if (!handler) {
        continue
      }

      const binding = getCatchBinding(handler)
      // 解构形式的 catch 参数本身就是一种使用（已经取了字段），不做判定。
      if (binding.kind === 'pattern') {
        continue
      }
      if (binding.kind === 'identifier' && isReferenced(handler.body, binding.name)) {
        continue
      }

      const name = binding.kind === 'identifier' ? binding.name : null
      for (const throwStatement of collectThrows(handler.body)) {
        helpers.reportViolation(
          {
            description: messages.noLostErrorCause({ name }),
            code: describeThrow(throwStatement),
            suggestions,
            span: throwStatement.span,
          },
          throwStatement.span
        )
      }
    }
  }
)

type CatchBinding = { kind: 'omitted' } | { kind: 'identifier'; name: string } | { kind: 'pattern' }

// catch 参数三种形态：省略（catch {}）、单个标识符、解构模式。
const getCatchBinding = (handler: CatchClause): CatchBinding => {
  const param = handler.param
  if (!param) {
    return { kind: 'omitted' }
  }
  if (param.type === 'Identifier') {
    return { kind: 'identifier', name: param.value }
  }
  return { kind: 'pattern' }
}

// 判断标识符是否在 catch 块内被引用。嵌套函数内的引用同样算数（例如回调里记录日志）。
// 需要排除两种“同名但不是引用”的位置：非计算属性访问 obj.error、对象字面量的键 { error: 1 }。
const isReferenced = (body: BlockStatement, name: string): boolean => {
  let found = false
  const visit = (node: TypedNode): boolean => {
    if (found) {
      return false
    }
    if (node.type === 'Identifier') {
      found = (node as unknown as Identifier).value === name
      return false
    }
    if (node.type === 'MemberExpression') {
      const member = node as unknown as MemberExpression
      walkAst(member.object, visit)
      if (member.property.type === 'Computed') {
        walkAst(member.property.expression, visit)
      }
      return false
    }
    if (node.type === 'KeyValueProperty') {
      const pair = node as unknown as KeyValueProperty
      if (pair.key.type !== 'Identifier') {
        walkAst(pair.key, visit)
      }
      walkAst(pair.value, visit)
      return false
    }
    return true
  }
  walkAst(body, visit)
  return found
}

// 只收集会从当前 catch 路径直接抛出的 throw：
// 嵌套函数/类里的 throw 不在本次执行路径上；嵌套 try 里的 throw 归内层 catch 处理，且内层 try 会被单独判定。
const THROW_BOUNDARIES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'FunctionDeclaration',
  'ClassDeclaration',
  'ClassExpression',
  'TryStatement',
])

const collectThrows = (body: BlockStatement): ThrowStatement[] => {
  const throws: ThrowStatement[] = []
  walkAst(body, (node) => {
    if (node.type && THROW_BOUNDARIES.has(node.type)) {
      return false
    }
    if (node.type === 'ThrowStatement') {
      throws.push(node as unknown as ThrowStatement)
    }
    return true
  })
  return throws
}

// 报告里展示 `throw new XxxError(...)`，便于一眼看出抛的是什么。
const describeThrow = (statement: ThrowStatement): string => {
  const argument = statement.argument
  if (argument.type === 'NewExpression' && argument.callee.type === 'Identifier') {
    return `throw new ${argument.callee.value}(...)`
  }
  return 'throw ...'
}
