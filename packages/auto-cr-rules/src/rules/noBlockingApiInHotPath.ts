import type {
  ArrowFunctionExpression,
  CallExpression,
  Expression,
  Fn,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  ImportDeclaration,
  MemberExpression,
  ModuleExportName,
  ObjectPattern,
  Param,
  Pattern,
  PropertyName,
  Span,
  TsParameterProperty,
  VariableDeclarator,
} from '@swc/types'
import { resolveLineFromByteOffset } from '../sourceIndex'
import { RuleSeverity, defineRule } from '../types'

type BlockingModule = 'fs' | 'child_process' | 'crypto' | 'zlib'

type BlockingBinding =
  | {
      kind: 'module'
      moduleName: BlockingModule
    }
  | {
      kind: 'function'
      moduleName: BlockingModule
      apiName: string
    }

type Scope = Map<string, BlockingBinding | null>

const BLOCKING_APIS: Record<BlockingModule, ReadonlySet<string>> = {
  fs: new Set([
    'accessSync',
    'appendFileSync',
    'chmodSync',
    'chownSync',
    'closeSync',
    'copyFileSync',
    'cpSync',
    'existsSync',
    'lchmodSync',
    'lchownSync',
    'linkSync',
    'lstatSync',
    'lutimesSync',
    'mkdirSync',
    'mkdtempSync',
    'openSync',
    'opendirSync',
    'readFileSync',
    'readdirSync',
    'readlinkSync',
    'readSync',
    'realpathSync',
    'renameSync',
    'rmSync',
    'rmdirSync',
    'statSync',
    'symlinkSync',
    'truncateSync',
    'unlinkSync',
    'utimesSync',
    'writeFileSync',
    'writeSync',
  ]),
  child_process: new Set(['execFileSync', 'execSync', 'spawnSync']),
  crypto: new Set([
    'generateKeyPairSync',
    'generateKeySync',
    'generatePrimeSync',
    'pbkdf2Sync',
    'randomFillSync',
    'scryptSync',
  ]),
  zlib: new Set([
    'brotliCompressSync',
    'brotliDecompressSync',
    'deflateRawSync',
    'deflateSync',
    'gunzipSync',
    'gzipSync',
    'inflateRawSync',
    'inflateSync',
    'unzipSync',
  ]),
}

const BLOCKING_MODULES = new Set<BlockingModule>(['fs', 'child_process', 'crypto', 'zlib'])

// 检测循环、数组回调等热路径里对阻塞式 Node API 的调用。
// 与全局禁用同步 API 不同，本规则只在“重复执行”的上下文里报性能风险。
export const noBlockingApiInHotPath = defineRule(
  'no-blocking-api-in-hot-path',
  { tag: 'performance', severity: RuleSeverity.Optimizing },
  ({ analysis, ast, helpers, language, messages, source, sourceIndex }) => {
    const hotCallKeys = new Set(
      analysis.hotPath.callExpressions.map((callExpression) => buildSpanKey(callExpression.span)).filter(Boolean)
    )

    if (hotCallKeys.size === 0) {
      return
    }

    const suggestions =
      language === 'zh'
        ? [
            { text: '将阻塞调用移出循环或数组回调，避免重复阻塞事件循环。' },
            { text: '优先改用异步 API，例如 fs/promises、exec 的回调或 Promise 封装。' },
          ]
        : [
            { text: 'Move blocking calls out of loops or callbacks to avoid repeatedly blocking the event loop.' },
            { text: 'Prefer async APIs such as fs/promises or a callback/Promise wrapper around exec.' },
          ]

    const scopeStack: Scope[] = [new Map<string, BlockingBinding | null>()]

    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') {
        return
      }

      const candidate = node as { type?: string }

      switch (candidate.type) {
        case 'ImportDeclaration': {
          registerImportDeclaration(candidate as ImportDeclaration, currentScope(scopeStack))
          return
        }
        case 'VariableDeclarator': {
          const declarator = candidate as VariableDeclarator
          walk(declarator.init)
          registerVariableDeclarator(declarator, scopeStack)
          walk(declarator.id)
          return
        }
        case 'FunctionDeclaration': {
          const declaration = candidate as FunctionDeclaration
          currentScope(scopeStack).set(declaration.identifier.value, null)
          walkFunctionNode(declaration, scopeStack, declaration.identifier.value, walk)
          return
        }
        case 'FunctionExpression': {
          const expression = candidate as FunctionExpression
          walkFunctionNode(expression, scopeStack, expression.identifier?.value ?? null, walk)
          return
        }
        case 'ArrowFunctionExpression': {
          walkFunctionNode(candidate as ArrowFunctionExpression, scopeStack, null, walk)
          return
        }
        case 'MethodProperty': {
          walkFn(candidate as Fn, scopeStack, walk)
          return
        }
        case 'ClassMethod':
        case 'PrivateMethod': {
          const method = candidate as { function: Fn }
          walkFn(method.function, scopeStack, walk)
          return
        }
        case 'GetterProperty': {
          const getter = candidate as { body?: unknown }
          pushScope(scopeStack)
          walk(getter.body)
          popScope(scopeStack)
          return
        }
        case 'SetterProperty': {
          const setter = candidate as { param: Pattern; body?: unknown }
          pushScope(scopeStack)
          registerShadowPattern(setter.param, currentScope(scopeStack))
          walk(setter.param)
          walk(setter.body)
          popScope(scopeStack)
          return
        }
        case 'Constructor': {
          const constructorNode = candidate as { params: Array<Param | TsParameterProperty>; body?: unknown }
          pushScope(scopeStack)
          constructorNode.params.forEach((param) => registerFunctionParameter(param, currentScope(scopeStack)))
          constructorNode.params.forEach((param) => walk(param))
          walk(constructorNode.body)
          popScope(scopeStack)
          return
        }
        case 'BlockStatement': {
          const block = candidate as { stmts: unknown[] }
          pushScope(scopeStack)
          block.stmts.forEach((statement) => walk(statement))
          popScope(scopeStack)
          return
        }
        case 'ForStatement': {
          const statement = candidate as { init?: unknown; test?: unknown; update?: unknown; body: unknown }
          pushScope(scopeStack)
          walk(statement.init)
          walk(statement.test)
          walk(statement.update)
          walk(statement.body)
          popScope(scopeStack)
          return
        }
        case 'ForInStatement':
        case 'ForOfStatement': {
          const statement = candidate as { left: unknown; right: unknown; body: unknown }
          pushScope(scopeStack)
          walk(statement.left)
          walk(statement.right)
          walk(statement.body)
          popScope(scopeStack)
          return
        }
        case 'CatchClause': {
          const catchClause = candidate as { param?: Pattern; body: unknown }
          pushScope(scopeStack)
          if (catchClause.param) {
            registerShadowPattern(catchClause.param, currentScope(scopeStack))
            walk(catchClause.param)
          }
          walk(catchClause.body)
          popScope(scopeStack)
          return
        }
        case 'ClassDeclaration': {
          const declaration = candidate as { identifier: Identifier }
          currentScope(scopeStack).set(declaration.identifier.value, null)
          break
        }
        case 'CallExpression': {
          const callExpression = candidate as CallExpression
          const spanKey = buildSpanKey(callExpression.span)

          if (spanKey && hotCallKeys.has(spanKey)) {
            const blockingApi = getBlockingApi(callExpression, scopeStack)
            if (blockingApi) {
              const line = callExpression.span
                ? resolveLineFromByteOffset(source, sourceIndex, callExpression.span.start)
                : undefined

              helpers.reportViolation(
                {
                  description: messages.noBlockingApiInHotPath({ api: blockingApi }),
                  code: blockingApi,
                  suggestions,
                  line,
                  span: callExpression.span,
                },
                callExpression.span
              )
            }
          }

          break
        }
        default:
          break
      }

      const record = candidate as Record<string, unknown>
      for (const value of Object.values(record)) {
        if (Array.isArray(value)) {
          value.forEach((item) => walk(item))
        } else {
          walk(value)
        }
      }
    }

    walk(ast)
  }
)

const walkFunctionNode = (
  fn: FunctionDeclaration | FunctionExpression | ArrowFunctionExpression,
  scopeStack: Scope[],
  declaredName: string | null,
  walk: (node: unknown) => void
): void => {
  pushScope(scopeStack)

  if (declaredName) {
    currentScope(scopeStack).set(declaredName, null)
  }

  fn.params.forEach((param) => registerFunctionParameter(param, currentScope(scopeStack)))

  const record = fn as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(record)) {
    if (key === 'body') {
      continue
    }

    if (key === 'params' && Array.isArray(value)) {
      value.forEach((param) => walk(param))
      continue
    }

    walk(value)
  }

  walk(fn.body)
  popScope(scopeStack)
}

const walkFn = (fn: Fn, scopeStack: Scope[], walk: (node: unknown) => void): void => {
  pushScope(scopeStack)
  fn.params.forEach((param) => registerFunctionParameter(param, currentScope(scopeStack)))
  fn.params.forEach((param) => walk(param))
  walk(fn.body)
  popScope(scopeStack)
}

const registerFunctionParameter = (param: Param | TsParameterProperty | Pattern, scope: Scope): void => {
  const pattern = getParameterPattern(param)
  if (!pattern) {
    return
  }

  registerShadowPattern(pattern, scope)
}

const registerImportDeclaration = (declaration: ImportDeclaration, scope: Scope): void => {
  if (declaration.typeOnly) {
    return
  }

  const moduleName = getBlockingModule(declaration.source.value)
  if (!moduleName) {
    return
  }

  declaration.specifiers.forEach((specifier) => {
    if (specifier.type === 'ImportDefaultSpecifier' || specifier.type === 'ImportNamespaceSpecifier') {
      scope.set(specifier.local.value, { kind: 'module', moduleName })
      return
    }

    if (specifier.isTypeOnly) {
      return
    }

    const importedName = getModuleExportName(specifier.imported) ?? specifier.local.value
    if (isBlockingApi(moduleName, importedName)) {
      scope.set(specifier.local.value, { kind: 'function', moduleName, apiName: importedName })
      return
    }

    scope.set(specifier.local.value, null)
  })
}

const registerVariableDeclarator = (declarator: VariableDeclarator, scopeStack: Scope[]): void => {
  const binding = declarator.init ? resolveExpressionBinding(declarator.init, scopeStack) : null
  const scope = currentScope(scopeStack)

  if (declarator.id.type === 'Identifier') {
    scope.set(declarator.id.value, binding)
    return
  }

  registerShadowPattern(declarator.id, scope)

  if (binding?.kind === 'module' && declarator.id.type === 'ObjectPattern') {
    applyModuleObjectPatternBindings(declarator.id, binding.moduleName, scope)
  }
}

const applyModuleObjectPatternBindings = (
  pattern: ObjectPattern,
  moduleName: BlockingModule,
  scope: Scope
): void => {
  pattern.properties.forEach((property) => {
    if (property.type === 'AssignmentPatternProperty') {
      const apiName = property.key.value
      if (isBlockingApi(moduleName, apiName)) {
        scope.set(property.key.value, { kind: 'function', moduleName, apiName })
      }
      return
    }

    if (property.type === 'KeyValuePatternProperty') {
      const propertyName = getPropertyName(property.key)
      if (!propertyName) {
        return
      }

      const binding: BlockingBinding | null = isBlockingApi(moduleName, propertyName)
        ? { kind: 'function', moduleName, apiName: propertyName }
        : null

      applyResolvedBindingToPattern(property.value, binding, scope)
    }
  })
}

const applyResolvedBindingToPattern = (
  pattern: Pattern,
  binding: BlockingBinding | null,
  scope: Scope
): void => {
  switch (pattern.type) {
    case 'Identifier':
      scope.set(pattern.value, binding)
      return
    case 'AssignmentPattern':
      applyResolvedBindingToPattern(pattern.left, binding, scope)
      return
    case 'RestElement':
      applyResolvedBindingToPattern(pattern.argument, null, scope)
      return
    default:
      return
  }
}

const registerShadowPattern = (pattern: Pattern, scope: Scope): void => {
  switch (pattern.type) {
    case 'Identifier':
      scope.set(pattern.value, null)
      return
    case 'AssignmentPattern':
      registerShadowPattern(pattern.left, scope)
      return
    case 'RestElement':
      registerShadowPattern(pattern.argument, scope)
      return
    case 'ArrayPattern':
      pattern.elements.forEach((element) => {
        if (element) {
          registerShadowPattern(element, scope)
        }
      })
      return
    case 'ObjectPattern':
      pattern.properties.forEach((property) => {
        if (property.type === 'KeyValuePatternProperty') {
          registerShadowPattern(property.value, scope)
          return
        }

        if (property.type === 'AssignmentPatternProperty') {
          scope.set(property.key.value, null)
          return
        }

        if (property.type === 'RestElement') {
          registerShadowPattern(property.argument, scope)
        }
      })
      return
    default:
      return
  }
}

const resolveExpressionBinding = (expression: Expression, scopeStack: Scope[]): BlockingBinding | null => {
  const candidate = unwrapExpression(expression)

  if (candidate.type === 'Identifier') {
    const binding = lookupBinding(scopeStack, candidate.value)
    return binding ?? null
  }

  if (candidate.type === 'CallExpression') {
    const moduleName = getBlockingModuleFromRequire(candidate)
    return moduleName ? { kind: 'module', moduleName } : null
  }

  if (candidate.type === 'MemberExpression') {
    const moduleName = resolveModuleBindingName(candidate.object, scopeStack)
    const method = getMemberPropertyName(candidate)

    if (moduleName && method && isBlockingApi(moduleName, method)) {
      return { kind: 'function', moduleName, apiName: method }
    }
  }

  return null
}

const getBlockingApi = (callExpression: CallExpression, scopeStack: Scope[]): string | null => {
  const callee = unwrapExpression(callExpression.callee)

  if (callee.type === 'Identifier') {
    const binding = lookupBinding(scopeStack, callee.value)
    if (binding?.kind === 'function') {
      return formatBlockingApi(binding.moduleName, binding.apiName)
    }

    return null
  }

  if (callee.type !== 'MemberExpression') {
    return null
  }

  const moduleName = resolveModuleBindingName(callee.object, scopeStack)
  const method = getMemberPropertyName(callee)
  if (!moduleName || !method || !isBlockingApi(moduleName, method)) {
    return null
  }

  return formatBlockingApi(moduleName, method)
}

const resolveModuleBindingName = (expression: Expression, scopeStack: Scope[]): BlockingModule | null => {
  const candidate = unwrapExpression(expression)

  if (candidate.type === 'Identifier') {
    const binding = lookupBinding(scopeStack, candidate.value)
    return binding?.kind === 'module' ? binding.moduleName : null
  }

  if (candidate.type === 'CallExpression') {
    return getBlockingModuleFromRequire(candidate)
  }

  return null
}

const getBlockingModuleFromRequire = (expression: CallExpression): BlockingModule | null => {
  const callee = unwrapExpression(expression.callee)
  if (callee.type !== 'Identifier' || callee.value !== 'require') {
    return null
  }

  const firstArgument = expression.arguments[0]?.expression
  const literal = firstArgument ? getStringLiteral(unwrapExpression(firstArgument)) : null
  return literal ? getBlockingModule(literal) : null
}

const lookupBinding = (scopeStack: Scope[], name: string): BlockingBinding | null | undefined => {
  for (let index = scopeStack.length - 1; index >= 0; index -= 1) {
    const scope = scopeStack[index]
    if (scope.has(name)) {
      return scope.get(name)
    }
  }

  return undefined
}

const currentScope = (scopeStack: Scope[]): Scope => {
  return scopeStack[scopeStack.length - 1]
}

const pushScope = (scopeStack: Scope[]): void => {
  scopeStack.push(new Map<string, BlockingBinding | null>())
}

const popScope = (scopeStack: Scope[]): void => {
  scopeStack.pop()
}

const getParameterPattern = (param: Param | TsParameterProperty | Pattern): Pattern | null => {
  if (
    param.type === 'Identifier' ||
    param.type === 'ArrayPattern' ||
    param.type === 'RestElement' ||
    param.type === 'ObjectPattern' ||
    param.type === 'AssignmentPattern' ||
    param.type === 'Invalid'
  ) {
    return param
  }

  if (param.type === 'Parameter') {
    return param.pat
  }

  if (param.type === 'TsParameterProperty') {
    return param.param
  }

  return null
}

const getMemberPropertyName = (member: MemberExpression): string | null => {
  const property = member.property

  if (property.type === 'Identifier') {
    return property.value
  }

  if (property.type === 'Computed' && property.expression.type === 'StringLiteral') {
    return property.expression.value
  }

  return null
}

const getPropertyName = (property: PropertyName): string | null => {
  if (property.type === 'Identifier') {
    return property.value
  }

  if (property.type === 'StringLiteral') {
    return property.value
  }

  return null
}

const getModuleExportName = (value?: ModuleExportName): string | null => {
  if (!value) {
    return null
  }

  if (value.type === 'Identifier') {
    return value.value
  }

  if (value.type === 'StringLiteral') {
    return value.value
  }

  return null
}

const unwrapExpression = (expression: unknown): Expression => {
  let current = expression as Expression

  while (true) {
    if (current.type === 'ParenthesisExpression') {
      current = current.expression
      continue
    }

    if (current.type === 'TsAsExpression' || current.type === 'TsSatisfiesExpression') {
      current = current.expression
      continue
    }

    if (current.type === 'TsTypeAssertion' || current.type === 'TsConstAssertion' || current.type === 'TsNonNullExpression') {
      current = current.expression
      continue
    }

    return current
  }
}

const getStringLiteral = (expression: Expression): string | null => {
  return expression.type === 'StringLiteral' ? expression.value : null
}

const getBlockingModule = (source: string): BlockingModule | null => {
  const normalized = source.replace(/^node:/, '') as BlockingModule | string
  return BLOCKING_MODULES.has(normalized as BlockingModule) ? (normalized as BlockingModule) : null
}

const isBlockingApi = (moduleName: BlockingModule, apiName: string): boolean => {
  return BLOCKING_APIS[moduleName].has(apiName)
}

const formatBlockingApi = (moduleName: BlockingModule, apiName: string): string => {
  return `${moduleName}.${apiName}`
}

const buildSpanKey = (span?: Span): string | null => {
  if (!span) {
    return null
  }

  return `${span.start}:${span.end}`
}
