import type {
  Argument,
  ArrowFunctionExpression,
  CallExpression,
  Expression,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  ImportDeclaration,
  MemberExpression,
  Module,
  NewExpression,
  RegExpLiteral,
  StringLiteral,
  TryStatement,
  WhileStatement,
  DoWhileStatement,
} from '@swc/types'
import type { ImportReference, LoopEntry, RuleAnalysis, HotCallbackEntry } from './types'

// 热路径定义：循环体 + 常见数组回调（map/forEach/...）的函数体。
const HOT_CALLBACK_METHODS = new Set([
  'map',
  'forEach',
  'reduce',
  'reduceRight',
  'filter',
  'some',
  'every',
  'find',
  'findIndex',
  'flatMap',
])

// 共享 AST 遍历入口：一次遍历同时抽取 imports/loops/callbacks/hotPath/tryStatements。
// 这样规则只需读取索引即可，避免每条规则重复扫 AST。
export const analyzeModule = (ast: Module): RuleAnalysis => {
  const imports: ImportReference[] = []
  const loops: LoopEntry[] = []
  const callbacks: HotCallbackEntry[] = []
  const tryStatements: TryStatement[] = []
  const hotPath = {
    callExpressions: [] as CallExpression[],
    newExpressions: [] as NewExpression[],
    regExpLiterals: [] as RegExpLiteral[],
  }

  const walk = (node: unknown, inHot: boolean): void => {
    if (!node || typeof node !== 'object') {
      return
    }

    const candidate = node as { type?: string }

    // 先收集与类型无关的索引，避免遗漏。
    if (candidate.type === 'ImportDeclaration') {
      const declaration = candidate as ImportDeclaration
      imports.push({
        kind: 'static',
        value: declaration.source.value,
        span: declaration.source.span,
      })
      // ImportDeclaration 不需要继续深挖（内部结构固定），可以提前返回。
      return
    }

    if (candidate.type === 'TryStatement') {
      tryStatements.push(candidate as TryStatement)
    }

    // 热路径正则字面量只在热路径内收集，避免无关代码噪声。
    if (candidate.type === 'RegExpLiteral' && inHot) {
      hotPath.regExpLiterals.push(candidate as RegExpLiteral)
    }

    switch (candidate.type) {
      case 'ForStatement': {
        const statement = candidate as ForStatement
        loops.push({ type: 'ForStatement', node: statement })
        // for 循环条件与循环体都视为热路径。
        walk(statement.init, inHot)
        walk(statement.test, true)
        walk(statement.update, true)
        walk(statement.body, true)
        return
      }
      case 'WhileStatement': {
        const statement = candidate as WhileStatement
        loops.push({ type: 'WhileStatement', node: statement })
        walk(statement.test, true)
        walk(statement.body, true)
        return
      }
      case 'DoWhileStatement': {
        const statement = candidate as DoWhileStatement
        loops.push({ type: 'DoWhileStatement', node: statement })
        walk(statement.body, true)
        walk(statement.test, true)
        return
      }
      case 'ForInStatement':
      case 'ForOfStatement': {
        const statement = candidate as ForInStatement | ForOfStatement
        loops.push({ type: statement.type as LoopEntry['type'], node: statement })
        walk(statement.left, inHot)
        walk(statement.right, inHot)
        walk(statement.body, true)
        return
      }
      case 'CallExpression': {
        // 统一在这里处理 import/require、热路径调用点、数组回调。
        handleCallExpression(candidate as CallExpression, inHot, imports, callbacks, hotPath, walk)
        return
      }
      case 'NewExpression': {
        const expression = candidate as NewExpression
        // new 表达式可能构造 RegExp，因此也纳入热路径集合。
        if (inHot) {
          hotPath.newExpressions.push(expression)
        }
        walk(expression.callee, inHot)
        expression.arguments?.forEach((argument) => walk(argument.expression, inHot))
        return
      }
      case 'OptionalChainingExpression': {
        const expression = candidate as { base: unknown }
        walk(expression.base, inHot)
        return
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        // 新函数不继承热路径，避免跨函数误标记。
        walkFunctionBody(
          candidate as FunctionDeclaration | FunctionExpression | ArrowFunctionExpression,
          false,
          walk
        )
        return
      }
      default:
        break
    }

    // 通用遍历：对未知节点递归扫描子节点。
    const record = candidate as Record<string, unknown>
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          walk(item, inHot)
        }
      } else {
        walk(value, inHot)
      }
    }
  }

  walk(ast, false)

  // 对分析结果做 freeze，防止规则侧误修改。
  return Object.freeze({
    imports: Object.freeze(imports),
    loops: Object.freeze(loops),
    callbacks: Object.freeze(callbacks),
    tryStatements: Object.freeze(tryStatements),
    hotPath: Object.freeze({
      callExpressions: Object.freeze(hotPath.callExpressions),
      newExpressions: Object.freeze(hotPath.newExpressions),
      regExpLiterals: Object.freeze(hotPath.regExpLiterals),
    }),
  }) as RuleAnalysis
}

const handleCallExpression = (
  callExpression: CallExpression,
  inHot: boolean,
  imports: ImportReference[],
  callbacks: HotCallbackEntry[],
  hotPath: {
    callExpressions: CallExpression[]
  },
  walk: (node: unknown, inHot: boolean) => void
): void => {
  if (inHot) {
    hotPath.callExpressions.push(callExpression)
  }

  // 解析 import(...) / require(...)，写入 import 索引。
  const reference = extractImportReference(callExpression)
  if (reference) {
    imports.push(reference)
  }

  // 判断是否为数组高阶回调，回调函数体应当视为热路径。
  const isHotCallback = isHotCallbackMethod(callExpression.callee)
  walk(callExpression.callee, inHot)

  if (!callExpression.arguments) {
    return
  }

  callExpression.arguments.forEach((argument, index) => {
    const expression = argument.expression
    // 约定数组回调的第一个参数是回调函数体，标记为热路径。
    if (isHotCallback && index === 0 && isFunctionLike(expression)) {
      callbacks.push({
        method: getMemberMethodName(callExpression.callee),
        callExpression,
        callback: expression,
      })
      // 回调函数体在热路径内执行，遍历时显式传入 true。
      walkFunctionBody(expression, true, walk)
      return
    }

    walk(expression, inHot)
  })
}

const walkFunctionBody = (
  fn: FunctionDeclaration | FunctionExpression | ArrowFunctionExpression,
  inHot: boolean,
  walk: (node: unknown, inHot: boolean) => void
): void => {
  // 先遍历参数/装饰器等非 body 字段，保持 inHot=false，避免把定义期表达式算进热路径。
  // 例如：默认参数表达式不应被当作热路径执行。
  // TypeScript 对 AST 节点没有索引签名，这里先转为 unknown 再转 Record。
  const record = fn as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(record)) {
    if (key === 'body') {
      continue
    }

    if (key === 'params' && Array.isArray(value)) {
      for (const param of value) {
        walk(param, false)
      }
      continue
    }

    walk(value, false)
  }

  // body 按当前规则标记热路径（回调函数体会传入 true）。
  walk(fn.body, inHot)
}

const isFunctionLike = (candidate: Expression): candidate is FunctionExpression | ArrowFunctionExpression => {
  return candidate.type === 'FunctionExpression' || candidate.type === 'ArrowFunctionExpression'
}

// 判断是否为数组高阶方法（如 arr.map/arr.forEach）。
const isHotCallbackMethod = (callee: unknown): boolean => {
  if (!callee || typeof callee !== 'object') {
    return false
  }

  const candidate = callee as { type?: string }
  if (candidate.type !== 'MemberExpression') {
    return false
  }

  const member = callee as MemberExpression
  const property = member.property
  if (property.type === 'Identifier') {
    return HOT_CALLBACK_METHODS.has(property.value)
  }

  if (property.type === 'Computed' && property.expression.type === 'StringLiteral') {
    return HOT_CALLBACK_METHODS.has(property.expression.value)
  }

  return false
}

// 提取形如 obj.method(...) 的方法名，用于回调索引。
const getMemberMethodName = (expression: Expression | { type?: string }): string | null => {
  if (!expression || expression.type !== 'MemberExpression') {
    return null
  }

  const member = expression as MemberExpression
  const property = member.property

  if (property.type === 'Identifier') {
    return property.value
  }

  if (property.type === 'Computed' && property.expression.type === 'StringLiteral') {
    return property.expression.value
  }

  return null
}

// 从调用表达式中提取 import/require 的字符串字面量参数。
const extractImportReference = (node: CallExpression): ImportReference | null => {
  if (!node.arguments.length) {
    return null
  }

  const [firstArgument] = node.arguments

  if (!firstArgument || isSpread(firstArgument)) {
    return null
  }

  const literal = getStringLiteral(firstArgument)

  if (!literal) {
    return null
  }

  if (node.callee.type === 'Import') {
    return createImportReference('dynamic', literal)
  }

  if (isRequireIdentifier(node.callee) || isRequireMember(node.callee)) {
    return createImportReference('require', literal)
  }

  return null
}

const createImportReference = (kind: ImportReference['kind'], literal: StringLiteral): ImportReference => ({
  kind,
  value: literal.value,
  span: literal.span,
})

const isSpread = (argument: Argument): boolean => Boolean(argument.spread)

const getStringLiteral = (argument: Argument): StringLiteral | null => {
  if (argument.expression.type === 'StringLiteral') {
    return argument.expression
  }

  return null
}

const isRequireIdentifier = (expression: CallExpression['callee']): expression is Identifier => {
  return expression.type === 'Identifier' && expression.value === 'require'
}

const isRequireMember = (expression: CallExpression['callee']): expression is MemberExpression => {
  return (
    expression.type === 'MemberExpression' &&
    expression.object.type === 'Identifier' &&
    expression.object.value === 'require'
  )
}
