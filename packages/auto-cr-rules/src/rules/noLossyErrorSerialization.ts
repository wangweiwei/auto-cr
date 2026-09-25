import type { Span } from '@swc/types'
import type { RuleAnalysis } from '../types'
import { RuleSeverity, defineRule } from '../types'
import {
  asMember,
  collectPatternNames,
  getNameChain,
  getPropertyName,
  getRootName,
  isFunctionNode,
  stripWrappers,
  walkAst,
  type CallNode,
  type TypedNode,
} from './utils/ast'

// 检测把错误对象按“普通对象”序列化/复制，导致 message、stack 丢失的写法：
//   catch (err) { logger.error(JSON.stringify(err)) }          // 输出 "{}"
//   catch (err) { res.status(500).json(err) }                   // 客户端收到 {}
//   promise.catch((error) => report({ ...error, requestId }))   // message / stack 不见了
// Error 的 message、stack、cause 都是不可枚举的自有属性，JSON.stringify、对象展开与 Object.assign 只处理可枚举属性，
// 于是最关键的排障信息被悄悄丢掉，线上日志里只剩 {} 或寥寥几个自定义字段。
// “错误对象”按以下来源识别：catch 参数、.catch() / .then() 第二个回调的第一个参数、
// 作为回调传入且第一个参数名为 err / error 的函数（Node 风格回调；类型标注明显不是错误时除外）。
export const noLossyErrorSerialization = defineRule(
  'no-lossy-error-serialization',
  { tag: 'base', severity: RuleSeverity.Warning },
  ({ analysis, helpers, language, messages }) => {
    const suggestions =
      language === 'zh'
        ? [
            {
              text: '记录日志时直接传错误对象（console.error(err)、logger.error({ err }) 并配置序列化器），由日志库展开 message / stack。',
            },
            {
              text: '需要 JSON 时显式挑选字段：{ name: err.name, message: err.message, stack: err.stack, cause: err.cause }，或使用 serialize-error 等库。',
            },
          ]
        : [
            {
              text: 'Pass the error object itself to the logger (console.error(err), logger.error({ err }) with an error serializer) so message and stack are expanded.',
            },
            {
              text: 'When you need JSON, pick the fields explicitly: { name: err.name, message: err.message, stack: err.stack, cause: err.cause }, or use a library such as serialize-error.',
            },
          ]

    const reported = new Set<unknown>()
    for (const binding of collectErrorBindings(analysis)) {
      findLossyUses(binding.body, binding.name, (node, form) => {
        if (reported.has(node)) {
          return
        }
        reported.add(node)
        const span = (node as { span?: Span }).span
        helpers.reportViolation(
          {
            description: messages.noLossyErrorSerialization({ name: binding.name, form }),
            code: form,
            suggestions,
            span,
          },
          span
        )
      })
    }
  }
)

type ErrorBinding = { name: string; body: unknown }

type FunctionShape = TypedNode & { params?: unknown[]; body?: unknown }

// 名字本身就表明是错误对象的首个参数。
const ERROR_PARAM_NAMES = new Set(['err', 'error'])

// catch 子句来自 analysis.tryStatements，回调来自 analysis.callExpressions，都由共享遍历提供。
const collectErrorBindings = (analysis: RuleAnalysis): ErrorBinding[] => {
  const bindings: ErrorBinding[] = []

  const addFunctionParam = (fn: FunctionShape | null, requireErrorName: boolean): void => {
    if (!fn || !isFunctionNode(fn)) {
      return
    }
    const first = unwrapParam(fn.params?.[0])
    if (first?.type !== 'Identifier' || !first.value) {
      return
    }
    if (requireErrorName && !ERROR_PARAM_NAMES.has(first.value)) {
      return
    }
    if (!isErrorLikeAnnotation(first.typeAnnotation)) {
      return
    }
    bindings.push({ name: first.value, body: fn.body })
  }

  for (const tryStatement of analysis.tryStatements) {
    const param = tryStatement.handler?.param
    if (param?.type === 'Identifier' && param.value) {
      bindings.push({ name: param.value, body: tryStatement.handler?.body })
    }
  }

  for (const callExpression of analysis.callExpressions) {
    const call = callExpression as unknown as CallNode
    const member = asMember(call.callee)
    const method = member ? getPropertyName(member) : null
    const handlerIndex = method === 'catch' ? 0 : method === 'then' ? 1 : -1
    call.arguments?.forEach((argument, index) => {
      const fn = stripWrappers(argument.expression) as FunctionShape | null
      // promise 的拒绝回调无论参数叫什么都是错误；其它回调只认 Node 风格的 (err, ...) / (error, ...)。
      addFunctionParam(fn, index !== handlerIndex)
    })
  }

  return bindings
}

type ParamIdentifier = TypedNode & {
  value?: string
  typeAnnotation?: TypedNode & { typeAnnotation?: TypedNode }
}

// 函数参数形如 Parameter { pat }，箭头函数参数直接是模式。
const unwrapParam = (param: unknown): ParamIdentifier | null => {
  const node = param as (TypedNode & { pat?: unknown }) | undefined
  if (!node) {
    return null
  }
  return (node.type === 'Parameter' ? node.pat : node) as ParamIdentifier
}

// 没有类型标注，或标注为 unknown / any / *Error / *Exception（含联合类型中的一项）时视为错误对象。
const isErrorLikeAnnotation = (annotation: ParamIdentifier['typeAnnotation']): boolean => {
  const type = annotation?.typeAnnotation
  if (!type) {
    return true
  }
  return isErrorLikeType(type)
}

const isErrorLikeType = (type: TypedNode): boolean => {
  const node = type as TypedNode & {
    kind?: string
    types?: TypedNode[]
    typeName?: TypedNode & { value?: string; right?: TypedNode & { value?: string } }
  }
  switch (node.type) {
    case 'TsKeywordType':
      return node.kind === 'unknown' || node.kind === 'any'
    case 'TsUnionType':
      return (node.types ?? []).some(isErrorLikeType)
    case 'TsTypeReference': {
      const name =
        node.typeName?.type === 'TsQualifiedName'
          ? node.typeName.right?.value
          : node.typeName?.value
      return Boolean(name && /(Error|Exception)$/.test(name))
    }
    default:
      return false
  }
}

type LossyVisitor = (node: TypedNode, form: string) => void

// 显式带上 message / stack 的对象说明作者已经处理过不可枚举属性。
const EXPLICIT_ERROR_KEYS = new Set(['message', 'stack'])

const findLossyUses = (body: unknown, name: string, onFound: LossyVisitor): void => {
  walkAst(body, (node) => {
    // 嵌套函数或 catch 重新绑定了同名参数：内部的同名标识符已不是这个错误对象。
    if (isFunctionNode(node) && rebinds((node as FunctionShape).params, name)) {
      return false
    }
    if (
      node.type === 'CatchClause' &&
      rebinds([(node as TypedNode & { param?: unknown }).param], name)
    ) {
      return false
    }

    if (node.type === 'ObjectExpression') {
      const properties = (node as TypedNode & { properties?: TypedNode[] }).properties ?? []
      const spreadsError = properties.some(
        (property) =>
          property.type === 'SpreadElement' &&
          isName((property as TypedNode & { arguments?: unknown }).arguments, name)
      )
      if (spreadsError && !hasExplicitErrorKeys(properties)) {
        onFound(node, `{ ...${name} }`)
      }
      return true
    }

    if (node.type !== 'CallExpression') {
      return true
    }
    const call = node as CallNode
    const args = call.arguments ?? []
    const chain = getNameChain(call.callee)?.join('.')

    if (chain === 'JSON.stringify') {
      const [value, replacer] = args
      if (!value || (replacer && !isNullish(replacer.expression))) {
        return true
      }
      if (isName(value.expression, name)) {
        onFound(node, `JSON.stringify(${name})`)
      } else if (objectHoldsError(value.expression, name)) {
        onFound(node, `JSON.stringify({ ${name} })`)
      }
      return true
    }

    if (chain === 'Object.assign') {
      if (args.slice(1).some((argument) => isName(argument.expression, name))) {
        onFound(node, `Object.assign(..., ${name})`)
      }
      return true
    }

    // res.json(err) / Response.json(err) / c.json(err)：内部就是 JSON.stringify。
    // Express 的 res.send(err) 对普通对象同样走 JSON 序列化；Fastify 的 reply.send 会专门处理 Error，不算。
    const member = asMember(call.callee)
    const method = member ? getPropertyName(member) : null
    const first = args[0]?.expression
    const receiver = member ? getRootName(member.object) : null
    const isJsonResponse =
      method === 'json' || (method === 'send' && RESPONSE_NAMES.has(receiver ?? ''))
    if (!member || !first || !isJsonResponse) {
      return true
    }
    if (isName(first, name)) {
      onFound(node, `${receiver ?? '...'}.${method}(${name})`)
    } else if (objectHoldsError(first, name)) {
      onFound(node, `${receiver ?? '...'}.${method}({ ${name} })`)
    }
    return true
  })
}

const RESPONSE_NAMES = new Set(['res', 'response'])

const rebinds = (params: unknown[] | undefined, name: string): boolean => {
  const names = new Set<string>()
  params?.forEach((param) => collectPatternNames(param, names))
  return names.has(name)
}

const isName = (expression: unknown, name: string): boolean => {
  const node = stripWrappers(expression) as { type?: string; value?: string } | null
  return node?.type === 'Identifier' && node.value === name
}

const isNullish = (expression: unknown): boolean => {
  const node = stripWrappers(expression) as { type?: string; value?: string } | null
  return node?.type === 'NullLiteral' || (node?.type === 'Identifier' && node.value === 'undefined')
}

// { error: err } / { err }：错误对象作为属性值被整体序列化。
const objectHoldsError = (expression: unknown, name: string): boolean => {
  const node = stripWrappers(expression) as (TypedNode & { properties?: TypedNode[] }) | null
  if (node?.type !== 'ObjectExpression') {
    return false
  }
  const properties = node.properties ?? []
  if (hasExplicitErrorKeys(properties)) {
    return false
  }
  return properties.some((property) => {
    if (property.type === 'Identifier') {
      return (property as { value?: string }).value === name
    }
    return (
      property.type === 'KeyValueProperty' && isName((property as { value?: unknown }).value, name)
    )
  })
}

const hasExplicitErrorKeys = (properties: TypedNode[]): boolean =>
  properties.some((property) => {
    if (property.type === 'Identifier') {
      return EXPLICIT_ERROR_KEYS.has(String((property as { value?: string }).value))
    }
    if (property.type !== 'KeyValueProperty') {
      return false
    }
    const key = (property as { key?: TypedNode & { value?: unknown } }).key
    return (
      (key?.type === 'Identifier' || key?.type === 'StringLiteral') &&
      EXPLICIT_ERROR_KEYS.has(String(key.value))
    )
  })
