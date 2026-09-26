import { HOT_CALLBACK_METHODS } from '../analysis'
import type { RuleAnalysis } from '../types'
import { RuleSeverity, defineRule } from '../types'
import {
  asMember,
  collectPatternNames,
  describeExpression,
  getCalledMethodName,
  getQualifiedName,
  getRootName,
  getScopeDeclaredNames,
  getStringifiedValue,
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
// 作为回调传入且第一个参数名为 err / error 的函数（Node 风格回调；数组迭代回调与类型标注明显不是错误的除外）。
// 同名变量被重新声明（遮蔽）的内层作用域、以及绑定被重新赋值之后的代码不再检查。
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
        helpers.reportViolation(
          {
            description: messages.noLossyErrorSerialization({ name: binding.name, form }),
            code: form,
            suggestions,
            span: node.span,
          },
          node.span
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
    // 没有类型标注，或标注为 unknown / any / *Error / *Exception（含联合类型中的一项）时视为错误对象。
    const type = first.typeAnnotation?.typeAnnotation
    if (type && !isErrorLikeType(type)) {
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
    const call = callExpression as CallNode
    const method = getCalledMethodName(call)
    const handlerIndex = method === 'catch' ? 0 : method === 'then' ? 1 : -1
    call.arguments?.forEach((argument, index) => {
      // 数组迭代回调的第一个参数是元素 / 累加器，不是 Node 风格回调里的错误对象（result.errors.map((error) => ...)）。
      if (index === 0 && HOT_CALLBACK_METHODS.has(method ?? '')) {
        return
      }
      // promise 的拒绝回调无论参数叫什么都是错误；其它回调只认 Node 风格的 (err, ...) / (error, ...)。
      addFunctionParam(
        stripWrappers(argument.expression) as FunctionShape | null,
        index !== handlerIndex
      )
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
type ObjectShape = TypedNode & {
  properties?: Array<TypedNode & { key?: TypedNode; value?: unknown; arguments?: unknown }>
}

// 显式带上 message / stack 的对象说明作者已经处理过不可枚举属性。
const EXPLICIT_ERROR_KEYS = new Set(['message', 'stack'])
const KEYED_PROPERTY_TYPES = new Set(['KeyValueProperty', 'GetterProperty', 'MethodProperty'])
const RESPONSE_NAMES = new Set(['res', 'response'])

const findLossyUses = (body: unknown, name: string, onFound: LossyVisitor): void => {
  // 绑定被重新赋值后（e = serializeError(e)），后面的同名标识符不一定还是 Error，不再上报。
  let reassigned = false
  const report: LossyVisitor = (node, form) => {
    if (!reassigned) {
      onFound(node, form)
    }
  }

  walkAst(body, (node) => {
    // 内层作用域重新声明了同名变量（嵌套函数参数、块内 const、for (const err of ...)、catch (err)）：内部已不是这个错误对象。
    if (node !== body && getScopeDeclaredNames(node).has(name)) {
      return false
    }
    if (node.type === 'AssignmentExpression') {
      const targets = new Set<string>()
      collectPatternNames((node as TypedNode & { left?: unknown }).left, targets)
      reassigned ||= targets.has(name)
    }

    if (node.type === 'ObjectExpression') {
      const properties = (node as ObjectShape).properties ?? []
      const spreadsError = properties.some(
        (property) => property.type === 'SpreadElement' && isName(property.arguments, name)
      )
      if (spreadsError && !hasExplicitErrorKeys(properties)) {
        report(node, `{ ...${name} }`)
      }
      return true
    }
    if (node.type !== 'CallExpression') {
      return true
    }

    const call = node as CallNode
    const args = call.arguments ?? []
    const qualified = getQualifiedName(call.callee)
    if (qualified === 'JSON.stringify') {
      const value = getStringifiedValue(call)
      if (value && (isName(value, name) || objectHoldsError(value, name))) {
        report(node, `JSON.stringify(${describeExpression(value)})`)
      }
      return true
    }
    if (qualified === 'Object.assign') {
      const sources = args.slice(1).map((argument) => argument.expression)
      const restores = sources.some((source) => {
        const object = stripWrappers(source) as ObjectShape | null
        return object?.type === 'ObjectExpression' && hasExplicitErrorKeys(object.properties ?? [])
      })
      if (!restores && sources.some((source) => isName(source, name))) {
        report(node, `Object.assign(..., ${name})`)
      }
      return true
    }

    // res.json(err) / Response.json(err) / c.json(err)：内部就是 JSON.stringify。
    // Express 的 res.send(err) 对普通对象同样走 JSON 序列化；Fastify 的 reply.send 会专门处理 Error，不算。
    const method = getCalledMethodName(call)
    const receiver = asMember(call.callee)?.object
    const first = args[0]?.expression
    const isJsonResponse =
      method === 'json' || (method === 'send' && RESPONSE_NAMES.has(getRootName(receiver) ?? ''))
    if (isJsonResponse && first && (isName(first, name) || objectHoldsError(first, name))) {
      report(node, `${describeExpression(call.callee)}(${describeExpression(first)})`)
    }
    return true
  })
}

const isName = (expression: unknown, name: string): boolean => {
  const node = stripWrappers(expression) as { type?: string; value?: string } | null
  return node?.type === 'Identifier' && node.value === name
}

// 对象字面量的静态键名：name、'name'、['name']；其它计算键返回 null。
const getStaticKeyName = (key: TypedNode | undefined): string | null => {
  const node = (
    key?.type === 'Computed'
      ? stripWrappers((key as TypedNode & { expression?: unknown }).expression)
      : key
  ) as (TypedNode & { value?: unknown }) | null | undefined
  return node?.type === 'Identifier' || node?.type === 'StringLiteral' ? String(node.value) : null
}

// 展开错误对象时，同一对象里显式写了 message / stack 键，说明作者已补回不可枚举属性。
const hasExplicitErrorKeys = (properties: NonNullable<ObjectShape['properties']>): boolean =>
  properties.some((property) => {
    if (property.type === 'Identifier') {
      return EXPLICIT_ERROR_KEYS.has(String((property as { value?: unknown }).value))
    }
    return (
      KEYED_PROPERTY_TYPES.has(property.type ?? '') &&
      EXPLICIT_ERROR_KEYS.has(getStaticKeyName(property.key) ?? '')
    )
  })

// { error: err } / { err }：错误对象作为属性值被整体序列化。
// 同一对象里 message / stack 的值取自这个错误（{ message: err.message, error: err }）时视为已处理；
// 与错误无关的 message 文案（{ message: 'Server error', error }）补不回嵌套错误里丢失的字段。
const objectHoldsError = (expression: unknown, name: string): boolean => {
  const object = stripWrappers(expression) as ObjectShape | null
  if (object?.type !== 'ObjectExpression') {
    return false
  }
  const properties = object.properties ?? []
  const readsErrorFields = properties.some(
    (property) =>
      property.type === 'KeyValueProperty' &&
      EXPLICIT_ERROR_KEYS.has(getStaticKeyName(property.key) ?? '') &&
      getRootName(property.value) === name
  )
  if (readsErrorFields) {
    return false
  }
  return properties.some((property) =>
    property.type === 'Identifier'
      ? (property as { value?: unknown }).value === name
      : property.type === 'KeyValueProperty' && isName(property.value, name)
  )
}
