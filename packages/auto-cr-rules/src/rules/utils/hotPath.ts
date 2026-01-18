import type {
  ArrowFunctionExpression,
  CallExpression,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  MemberExpression,
} from '@swc/types'

// 访问器会收到当前节点以及是否位于热路径的标记。
type HotPathVisitor = (node: unknown, inHot: boolean) => void

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

// 遍历 AST，并根据循环体/数组回调标记“热路径”。
export const walkHotPath = (root: unknown, visitor: HotPathVisitor): void => {
  const walk = (node: unknown, inHot: boolean): void => {
    if (!node || typeof node !== 'object') {
      return
    }

    const candidate = node as { type?: string }
    // 先访问当前节点，保证调用方可以在遍历前做判断。
    visitor(node, inHot)

    switch (candidate.type) {
      case 'ForStatement': {
        const statement = candidate as {
          init?: unknown
          test?: unknown
          update?: unknown
          body: unknown
        }
        // 循环条件与循环体被视为热路径。
        walk(statement.init, inHot)
        walk(statement.test, true)
        walk(statement.update, true)
        walk(statement.body, true)
        return
      }
      case 'WhileStatement': {
        const statement = candidate as { test: unknown; body: unknown }
        // while 条件与循环体进入热路径。
        walk(statement.test, true)
        walk(statement.body, true)
        return
      }
      case 'DoWhileStatement': {
        const statement = candidate as { test: unknown; body: unknown }
        // do/while 先执行 body，仍视为热路径。
        walk(statement.body, true)
        walk(statement.test, true)
        return
      }
      case 'ForInStatement':
      case 'ForOfStatement': {
        const statement = candidate as { left: unknown; right: unknown; body: unknown }
        walk(statement.left, inHot)
        walk(statement.right, inHot)
        // for-in / for-of 的 body 为热路径。
        walk(statement.body, true)
        return
      }
      case 'CallExpression': {
        // 处理数组高阶回调：回调函数体视为热路径。
        handleCallExpression(candidate as CallExpression, inHot, walk)
        return
      }
      case 'OptionalChainingExpression': {
        const expression = candidate as { base: unknown }
        // Optional chaining 只影响访问形式，不改变热路径判断。
        walk(expression.base, inHot)
        return
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        // 新函数默认不继承热路径，避免跨函数过度扩散。
        walkFunctionBody(candidate as FunctionDeclaration | FunctionExpression | ArrowFunctionExpression, false, walk)
        return
      }
      default:
        break
    }

    // 通用遍历：对未知节点递归扫描子节点。
    for (const value of Object.values(candidate)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          walk(item, inHot)
        }
      } else {
        walk(value, inHot)
      }
    }
  }

  walk(root, false)
}

const handleCallExpression = (
  callExpression: CallExpression,
  inHot: boolean,
  walk: (node: unknown, inHot: boolean) => void
): void => {
  const isHotCallback = isHotCallbackMethod(callExpression.callee)

  // 被调用对象本身不一定在热路径，但仍需遍历以触发 visitor。
  walk(callExpression.callee, inHot)

  if (!callExpression.arguments) {
    return
  }

  callExpression.arguments.forEach((argument, index) => {
    const expression = argument.expression
    // 约定数组回调的第一个参数是回调函数体，标记为热路径。
    if (isHotCallback && index === 0 && isFunctionLike(expression)) {
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
  // ArrowFunctionExpression 可能直接返回表达式，因此统一对 body 继续遍历。
  if (fn.type === 'ArrowFunctionExpression') {
    walk(fn.body, inHot)
    return
  }

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

export type { HotPathVisitor }
