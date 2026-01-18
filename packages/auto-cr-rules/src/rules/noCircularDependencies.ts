import fs from 'fs'
import path from 'path'
import { RuleSeverity, defineRule } from '../types'

/**
 * 检测循环依赖：
 * - 解析相对路径与 tsconfig paths/baseUrl/rootDirs；
 * - 支持 workspace 内 package.json exports；
 * - 从当前文件的 import 出发，沿依赖图寻找回到自身的路径；
 * - 输出完整环路链路，便于定位循环发生的文件。
 */
const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
// 避免在大型仓库里构图过深或过大导致卡顿。
const MAX_GRAPH_NODES = 2000
const MAX_GRAPH_DEPTH = 80

// 跨文件缓存解析结果，减少重复 IO 与正则扫描。
const resolvedImportCache = new Map<string, string[]>()
// 记录已上报的环路（做规范化），避免同一环路重复报错。
const reportedCycles = new Set<string>()
// 缓存 tsconfig 解析结果，避免重复 IO。
const tsconfigCache = new Map<string, TsConfigInfo>()
const tsconfigLookupCache = new Map<string, TsConfigInfo | null>()
// 缓存 workspace 包名索引，避免重复扫描。
const workspacePackageCache = new Map<string, Map<string, WorkspacePackage>>()

export const noCircularDependencies = defineRule(
  'no-circular-dependencies',
  { tag: 'base', severity: RuleSeverity.Warning },
  ({ ast, filePath, helpers, language, messages, source }) => {
    const origin = path.resolve(filePath)
    const root = resolveProjectRoot(origin)
    const moduleStart = ast.span?.start ?? 0
    const lineIndex = buildLineIndex(source)
    const resolver = createModuleResolver(root)
    const resolvedTargets = new Set<string>()
    const warnedSpecifiers = new Set<string>()

    for (const reference of helpers.imports) {
      const resolution = resolveModuleSpecifier(origin, reference.value, root, resolver)
      if (resolution.resolved) {
        resolvedTargets.add(resolution.resolved)
      } else if (resolution.shouldWarn) {
        const warningKey = `${origin}:${reference.value}`
        if (!warnedSpecifiers.has(warningKey)) {
          warnedSpecifiers.add(warningKey)
          const computedLine = reference.span
            ? resolveLine(lineIndex, bytePosToCharIndex(source, moduleStart, reference.span.start))
            : undefined
          const fallbackLine = findImportLine(source, reference.value)
          const line = selectLineNumber(computedLine, fallbackLine)
          helpers.reportViolation(
            {
              description: messages.unresolvedImport({ value: reference.value }),
              code: reference.value,
              span: reference.span,
              line,
            },
            reference.span
          )
        }
        continue
      } else {
        continue
      }

      const target = resolution.resolved

      // 从目标模块回溯，如果能再次回到 origin，即存在环路。
      const pathToOrigin = findPathToOrigin(target, origin, root, resolver)
      if (!pathToOrigin) {
        continue
      }

      const cycle = [origin, ...pathToOrigin]
      const cycleKey = buildCycleKey(cycle)

      if (reportedCycles.has(cycleKey)) {
        continue
      }

      reportedCycles.add(cycleKey)

      // 统一输出相对路径，便于直接定位到仓库内文件。
      const displayChain = formatCycle(cycle, root)
      const description = messages.circularDependency({ chain: displayChain })
      const suggestions =
        language === 'zh'
          ? [
              { text: '考虑拆分模块，避免相互依赖。' },
              { text: '抽取共享逻辑到独立模块以打破循环。' },
            ]
          : [
              { text: 'Split modules to avoid mutual dependencies.' },
              { text: 'Extract shared logic into a dedicated module to break the cycle.' },
            ]

      // 优先使用 SWC 的 span 计算行号，作为高可信位置；失败时再用文本匹配兜底。
      const computedLine = reference.span
        ? resolveLine(lineIndex, bytePosToCharIndex(source, moduleStart, reference.span.start))
        : undefined
      const fallbackLine = findImportLine(source, reference.value)
      const line = selectLineNumber(computedLine, fallbackLine)

      helpers.reportViolation(
        {
          description,
          code: displayChain,
          suggestions,
          span: reference.span,
          line,
        },
        reference.span
      )
    }

    // 用 SWC 提供的 import 列表初始化当前文件的依赖，保证准确性与性能。
    resolvedImportCache.set(origin, Array.from(resolvedTargets))
  }
)

// 选择项目根目录：优先使用当前工作目录，找不到则向上寻找最近的 package.json。
const resolveProjectRoot = (filePath: string): string => {
  const cwd = path.resolve(process.cwd())
  if (isWithinRoot(filePath, cwd)) {
    return cwd
  }

  let current = path.dirname(filePath)
  let last = ''

  while (current !== last) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current
    }
    last = current
    current = path.dirname(current)
  }

  return cwd
}

// 防止解析路径逃逸到仓库外，避免跨项目误报。
const isWithinRoot = (filePath: string, root: string): boolean => {
  const relative = path.relative(root, filePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

type ModuleResolver = {
  root: string
  workspacePackages: Map<string, WorkspacePackage>
}

type ResolveResult = {
  resolved: string | null
  shouldWarn: boolean
}

type TsConfigInfo = {
  path: string
  dir: string
  baseUrl?: string
  paths: Record<string, string[]>
  rootDirs: string[]
}

type WorkspacePackage = {
  name: string
  dir: string
  packageJson: PackageJsonShape
}

type PackageJsonShape = {
  name?: string
  exports?: unknown
  main?: string
  module?: string
  types?: string
}

type CompilerOptionsShape = {
  baseUrl?: string
  paths?: Record<string, string[]>
  rootDirs?: string[]
}

const createModuleResolver = (root: string): ModuleResolver => {
  return {
    root,
    workspacePackages: getWorkspacePackages(root),
  }
}

const resolveModuleSpecifier = (
  fromFile: string,
  specifier: string,
  root: string,
  resolver: ModuleResolver
): ResolveResult => {
  const cleaned = specifier.split(/[?#]/)[0]

  if (cleaned.startsWith('.')) {
    return {
      resolved: resolveRelativeImport(fromFile, cleaned, root),
      shouldWarn: false,
    }
  }

  const tsconfig = getTsConfigForFile(fromFile, root)
  let aliasAttempted = false

  const pathsResolution = resolveWithTsConfigPaths(cleaned, tsconfig, root)
  if (pathsResolution.resolved) {
    return { resolved: pathsResolution.resolved, shouldWarn: false }
  }
  if (pathsResolution.attempted) {
    aliasAttempted = true
  }

  const baseUrlResolution = resolveWithBaseUrl(cleaned, tsconfig, root, resolver)
  if (baseUrlResolution.resolved) {
    return { resolved: baseUrlResolution.resolved, shouldWarn: false }
  }
  if (baseUrlResolution.attempted) {
    aliasAttempted = true
  }

  const packageResolution = resolveWorkspacePackageImport(cleaned, resolver)
  if (packageResolution.resolved) {
    return { resolved: packageResolution.resolved, shouldWarn: false }
  }

  return {
    resolved: null,
    shouldWarn: aliasAttempted || packageResolution.attempted,
  }
}

const resolveRelativeImport = (fromFile: string, specifier: string, root: string): string | null => {
  const cleaned = specifier.split(/[?#]/)[0]
  const basePath = path.resolve(path.dirname(fromFile), cleaned)
  const direct = resolvePathCandidate(basePath, root)
  if (direct) {
    return direct
  }

  const tsconfig = getTsConfigForFile(fromFile, root)
  if (!tsconfig || tsconfig.rootDirs.length === 0) {
    return null
  }

  const containingRoot = tsconfig.rootDirs.find((dir) => isWithinRoot(fromFile, dir))
  if (!containingRoot) {
    return null
  }

  const relativeToRoot = path.relative(containingRoot, basePath)
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    return null
  }

  for (const rootDir of tsconfig.rootDirs) {
    const candidate = resolvePathCandidate(path.join(rootDir, relativeToRoot), root)
    if (candidate) {
      return candidate
    }
  }

  return null
}

const resolveWithTsConfigPaths = (
  specifier: string,
  tsconfig: TsConfigInfo | null,
  root: string
): { resolved: string | null; attempted: boolean } => {
  if (!tsconfig || Object.keys(tsconfig.paths).length === 0) {
    return { resolved: null, attempted: false }
  }

  let attempted = false

  for (const [pattern, targets] of Object.entries(tsconfig.paths)) {
    const match = matchPathPattern(pattern, specifier)
    if (!match.matched) {
      continue
    }

    attempted = true

    for (const target of targets) {
      const mapped = applyPathMapping(target, match.wildcard)
      const resolved = resolvePathCandidate(mapped, root)
      if (resolved) {
        return { resolved, attempted: true }
      }
    }
  }

  return { resolved: null, attempted }
}

const resolveWithBaseUrl = (
  specifier: string,
  tsconfig: TsConfigInfo | null,
  root: string,
  resolver: ModuleResolver
): { resolved: string | null; attempted: boolean } => {
  if (!tsconfig?.baseUrl) {
    return { resolved: null, attempted: false }
  }

  const packageName = parsePackageName(specifier)
  if (packageName && isKnownPackage(packageName, resolver, tsconfig.rootDirs)) {
    return { resolved: null, attempted: false }
  }

  if (!specifier.includes('/') && !specifier.startsWith('@')) {
    return { resolved: null, attempted: false }
  }

  const basePath = path.resolve(tsconfig.baseUrl, specifier)
  const resolved = resolvePathCandidate(basePath, root)
  return { resolved, attempted: true }
}

const resolveWorkspacePackageImport = (
  specifier: string,
  resolver: ModuleResolver
): { resolved: string | null; attempted: boolean } => {
  const { packageName, subpath } = splitPackageSpecifier(specifier)
  const pkg = resolver.workspacePackages.get(packageName)
  if (!pkg) {
    return { resolved: null, attempted: false }
  }

  const resolved = resolveWorkspacePackageTarget(pkg, subpath, resolver.root)
  return { resolved, attempted: true }
}

const splitPackageSpecifier = (specifier: string): { packageName: string; subpath: string } => {
  const segments = specifier.split('/')
  if (specifier.startsWith('@') && segments.length >= 2) {
    const packageName = `${segments[0]}/${segments[1]}`
    const subpath = segments.length > 2 ? `./${segments.slice(2).join('/')}` : '.'
    return { packageName, subpath }
  }

  const packageName = segments[0]
  const subpath = segments.length > 1 ? `./${segments.slice(1).join('/')}` : '.'
  return { packageName, subpath }
}

const parsePackageName = (specifier: string): string | null => {
  const { packageName } = splitPackageSpecifier(specifier)
  return packageName || null
}

const isKnownPackage = (packageName: string, resolver: ModuleResolver, rootDirs: string[]): boolean => {
  if (resolver.workspacePackages.has(packageName)) {
    return true
  }

  const nodeModules = findNodeModulePackageDir(packageName, resolver.root, rootDirs)
  return Boolean(nodeModules)
}

const getTsConfigForFile = (filePath: string, root: string): TsConfigInfo | null => {
  const dir = path.dirname(filePath)
  const cached = tsconfigLookupCache.get(dir)
  if (cached !== undefined) {
    return cached
  }

  let current = dir
  let last = ''

  while (current !== last) {
    const candidate = path.join(current, 'tsconfig.json')
    if (fs.existsSync(candidate)) {
      const info = loadTsConfigInfo(candidate)
      tsconfigLookupCache.set(dir, info)
      return info
    }

    if (path.resolve(current) === path.resolve(root)) {
      break
    }

    last = current
    current = path.dirname(current)
  }

  tsconfigLookupCache.set(dir, null)
  return null
}

const loadTsConfigInfo = (configPath: string): TsConfigInfo => {
  const cached = tsconfigCache.get(configPath)
  if (cached) {
    return cached
  }

  const mergedOptions = loadCompilerOptions(configPath, new Set<string>())
  const configDir = path.dirname(configPath)

  const baseUrl = mergedOptions.baseUrl
  const baseUrlForPaths = baseUrl ?? configDir
  const paths = resolvePathsMap(mergedOptions.paths ?? {}, baseUrlForPaths)
  const rootDirs = resolveRootDirs(mergedOptions.rootDirs ?? [], configDir)

  const info: TsConfigInfo = {
    path: configPath,
    dir: configDir,
    baseUrl,
    paths,
    rootDirs,
  }

  tsconfigCache.set(configPath, info)
  return info
}

const loadCompilerOptions = (configPath: string, visited: Set<string>): CompilerOptionsShape => {
  if (visited.has(configPath)) {
    return {}
  }
  visited.add(configPath)

  const raw = readTsConfigFile(configPath)
  const configDir = path.dirname(configPath)
  let baseOptions: CompilerOptionsShape = {}

  if (typeof raw.extends === 'string') {
    const basePath = resolveExtendsPath(raw.extends, configDir)
    if (basePath) {
      baseOptions = loadCompilerOptions(basePath, visited)
    }
  }

  const compilerOptions = normalizeCompilerOptions(raw.compilerOptions, configDir, baseOptions.baseUrl)
  const mergedPaths = {
    ...(baseOptions.paths ?? {}),
    ...(compilerOptions.paths ?? {}),
  }

  return {
    baseUrl: compilerOptions.baseUrl ?? baseOptions.baseUrl,
    paths: Object.keys(mergedPaths).length > 0 ? mergedPaths : undefined,
    rootDirs: compilerOptions.rootDirs ?? baseOptions.rootDirs,
  }
}

const normalizeCompilerOptions = (
  compilerOptions: unknown,
  configDir: string,
  inheritedBaseUrl?: string
): CompilerOptionsShape => {
  if (!compilerOptions || typeof compilerOptions !== 'object') {
    return {}
  }

  const options = compilerOptions as CompilerOptionsShape
  const baseUrl = options.baseUrl ? path.resolve(configDir, options.baseUrl) : inheritedBaseUrl
  const baseUrlForPaths = baseUrl ?? configDir

  const paths = options.paths ? resolvePathsMap(options.paths, baseUrlForPaths) : undefined
  const rootDirs = options.rootDirs ? resolveRootDirs(options.rootDirs, configDir) : undefined

  return {
    baseUrl,
    paths,
    rootDirs,
  }
}

const resolvePathsMap = (paths: Record<string, string[]>, baseUrl: string): Record<string, string[]> => {
  const resolved: Record<string, string[]> = {}

  for (const [key, values] of Object.entries(paths)) {
    resolved[key] = values.map((value) => (path.isAbsolute(value) ? value : path.resolve(baseUrl, value)))
  }

  return resolved
}

const resolveRootDirs = (rootDirs: string[], configDir: string): string[] => {
  return rootDirs.map((dir) => (path.isAbsolute(dir) ? dir : path.resolve(configDir, dir)))
}

const readTsConfigFile = (configPath: string): { extends?: string; compilerOptions?: unknown } => {
  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    const parsed = parseJsonc(content)
    if (parsed && typeof parsed === 'object') {
      return parsed as { extends?: string; compilerOptions?: unknown }
    }
  } catch {
    return {}
  }

  return {}
}

const resolveExtendsPath = (extendsValue: string, configDir: string): string | null => {
  const trimmed = extendsValue.trim()

  if (trimmed.startsWith('.')) {
    return resolveTsConfigPath(path.resolve(configDir, trimmed))
  }

  if (path.isAbsolute(trimmed)) {
    return resolveTsConfigPath(trimmed)
  }

  try {
    const resolved = require.resolve(trimmed, { paths: [configDir] })
    return resolveTsConfigPath(resolved)
  } catch {
    return null
  }
}

const resolveTsConfigPath = (candidate: string): string | null => {
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate
  }

  if (fs.existsSync(`${candidate}.json`)) {
    return `${candidate}.json`
  }

  const asDir = path.join(candidate, 'tsconfig.json')
  if (fs.existsSync(asDir)) {
    return asDir
  }

  return null
}

const matchPathPattern = (pattern: string, specifier: string): { matched: boolean; wildcard: string } => {
  if (pattern === specifier) {
    return { matched: true, wildcard: '' }
  }

  const starIndex = pattern.indexOf('*')
  if (starIndex < 0) {
    return { matched: false, wildcard: '' }
  }

  const prefix = pattern.slice(0, starIndex)
  const suffix = pattern.slice(starIndex + 1)

  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
    return { matched: false, wildcard: '' }
  }

  const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length)
  return { matched: true, wildcard }
}

const applyPathMapping = (target: string, wildcard: string): string => {
  if (!target.includes('*')) {
    return target
  }

  return target.replace('*', wildcard)
}

const resolveWorkspacePackageTarget = (pkg: WorkspacePackage, subpath: string, root: string): string | null => {
  const exportsField = pkg.packageJson.exports

  if (exportsField) {
    const target = resolveExportsTarget(exportsField, subpath)
    if (target) {
      const candidate = path.resolve(pkg.dir, target)
      const resolved = resolvePathCandidate(candidate, root)
      if (resolved) {
        return resolved
      }
    }
  }

  if (subpath === '.') {
    const fallback = pkg.packageJson.module || pkg.packageJson.main || pkg.packageJson.types
    if (fallback) {
      const candidate = path.resolve(pkg.dir, fallback)
      const resolved = resolvePathCandidate(candidate, root)
      if (resolved) {
        return resolved
      }
    }
  }

  if (subpath.startsWith('./')) {
    const candidate = path.resolve(pkg.dir, subpath.slice(2))
    const resolved = resolvePathCandidate(candidate, root)
    if (resolved) {
      return resolved
    }
  }

  return null
}

const resolveExportsTarget = (exportsField: unknown, subpath: string): string | null => {
  if (typeof exportsField === 'string') {
    return subpath === '.' ? exportsField : null
  }

  if (Array.isArray(exportsField)) {
    for (const entry of exportsField) {
      const resolved = resolveExportsTarget(entry, subpath)
      if (resolved) {
        return resolved
      }
    }
    return null
  }

  if (!exportsField || typeof exportsField !== 'object') {
    return null
  }

  const exportsObj = exportsField as Record<string, unknown>

  if (Object.keys(exportsObj).some((key) => key.startsWith('./') || key === '.')) {
    const direct = resolveExportsSubpath(exportsObj, subpath)
    if (direct) {
      return direct
    }
    return null
  }

  return resolveConditionalTarget(exportsObj)
}

const resolveExportsSubpath = (exportsObj: Record<string, unknown>, subpath: string): string | null => {
  if (exportsObj[subpath] !== undefined) {
    return resolveExportsTarget(exportsObj[subpath], '.')
  }

  for (const [pattern, target] of Object.entries(exportsObj)) {
    if (!pattern.includes('*')) {
      continue
    }

    const match = matchPathPattern(pattern, subpath)
    if (!match.matched) {
      continue
    }

    if (typeof target === 'string') {
      return applyPathMapping(target, match.wildcard)
    }

    const resolved = resolveExportsTarget(target, '.')
    if (resolved && resolved.includes('*')) {
      return applyPathMapping(resolved, match.wildcard)
    }

    if (resolved) {
      return resolved
    }
  }

  return null
}

const resolveConditionalTarget = (exportsObj: Record<string, unknown>): string | null => {
  const orderedKeys = ['import', 'require', 'default', 'types']
  for (const key of orderedKeys) {
    if (exportsObj[key] === undefined) {
      continue
    }
    const resolved = resolveExportsTarget(exportsObj[key], '.')
    if (resolved) {
      return resolved
    }
  }

  for (const value of Object.values(exportsObj)) {
    const resolved = resolveExportsTarget(value, '.')
    if (resolved) {
      return resolved
    }
  }

  return null
}

const findNodeModulePackageDir = (packageName: string, root: string, rootDirs: string[]): string | null => {
  const searchRoots = [root, ...rootDirs]
  for (const start of searchRoots) {
    let current = start
    let last = ''

    while (current && current !== last) {
      const candidate = path.join(current, 'node_modules', packageName, 'package.json')
      if (fs.existsSync(candidate)) {
        return path.dirname(candidate)
      }

      if (path.resolve(current) === path.resolve(root)) {
        break
      }

      last = current
      current = path.dirname(current)
    }
  }

  return null
}

const getWorkspacePackages = (root: string): Map<string, WorkspacePackage> => {
  const cached = workspacePackageCache.get(root)
  if (cached) {
    return cached
  }

  const patterns = loadWorkspacePatterns(root)
  const packageDirs = new Set<string>()

  for (const pattern of patterns) {
    const expanded = expandWorkspacePattern(root, pattern)
    for (const dir of expanded) {
      const pkgPath = path.join(dir, 'package.json')
      if (fs.existsSync(pkgPath)) {
        packageDirs.add(dir)
      }
    }
  }

  const packages = new Map<string, WorkspacePackage>()

  for (const dir of packageDirs) {
    try {
      const raw = fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')
      const pkg = JSON.parse(raw) as PackageJsonShape
      if (pkg.name) {
        packages.set(pkg.name, { name: pkg.name, dir, packageJson: pkg })
      }
    } catch {
      continue
    }
  }

  workspacePackageCache.set(root, packages)
  return packages
}

const loadWorkspacePatterns = (root: string): string[] => {
  const workspaceFile = path.join(root, 'pnpm-workspace.yaml')
  if (!fs.existsSync(workspaceFile)) {
    return ['packages/*', 'apps/*']
  }

  const content = fs.readFileSync(workspaceFile, 'utf-8')
  const lines = content.split(/\r?\n/)
  const patterns: string[] = []
  let inPackages = false

  for (const line of lines) {
    if (!inPackages) {
      if (line.trim() === 'packages:') {
        inPackages = true
      }
      continue
    }

    if (line.trim() === '' || line.startsWith('#')) {
      continue
    }

    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      break
    }

    const match = line.match(/^\s*-\s+(.+)$/)
    if (match) {
      const raw = match[1].trim()
      patterns.push(raw.replace(/^['"]|['"]$/g, ''))
    }
  }

  return patterns.length > 0 ? patterns : ['packages/*', 'apps/*']
}

const expandWorkspacePattern = (root: string, pattern: string): string[] => {
  const normalized = pattern.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  const results: string[] = []
  const visited = new Set<string>()

  const walk = (current: string, remaining: string[]) => {
    if (results.length > 5000) {
      return
    }

    if (remaining.length === 0) {
      if (!visited.has(current)) {
        visited.add(current)
        results.push(current)
      }
      return
    }

    const [segment, ...rest] = remaining

    if (segment === '**') {
      walk(current, rest)
      const entries = safeReadDir(current)
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue
        }
        walk(path.join(current, entry.name), remaining)
      }
      return
    }

    if (segment.includes('*')) {
      const entries = safeReadDir(current)
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue
        }
        if (!matchGlobSegment(segment, entry.name)) {
          continue
        }
        walk(path.join(current, entry.name), rest)
      }
      return
    }

    const next = path.join(current, segment)
    if (fs.existsSync(next) && fs.statSync(next).isDirectory()) {
      walk(next, rest)
    }
  }

  walk(root, segments)
  return results
}

const matchGlobSegment = (pattern: string, value: string): boolean => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`^${escaped.replace(/\*/g, '.*')}$`)
  return regex.test(value)
}

const safeReadDir = (dir: string): fs.Dirent[] => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

const parseJsonc = (content: string): unknown => {
  const stripped = stripJsonComments(content)
  const sanitized = removeTrailingCommas(stripped)
  return JSON.parse(sanitized)
}

const stripJsonComments = (content: string): string => {
  let result = ''
  let inString = false
  let stringChar = ''
  let inLineComment = false
  let inBlockComment = false
  let escaped = false

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const next = content[index + 1]

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false
        result += char
      }
      continue
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false
        index += 1
      }
      continue
    }

    if (inString) {
      result += char
      if (!escaped && char === stringChar) {
        inString = false
        stringChar = ''
      }
      escaped = !escaped && char === '\\'
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      stringChar = char
      result += char
      continue
    }

    if (char === '/' && next === '/') {
      inLineComment = true
      index += 1
      continue
    }

    if (char === '/' && next === '*') {
      inBlockComment = true
      index += 1
      continue
    }

    result += char
  }

  return result
}

const removeTrailingCommas = (content: string): string => {
  let result = ''
  let inString = false
  let stringChar = ''
  let escaped = false

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]

    if (inString) {
      result += char
      if (!escaped && char === stringChar) {
        inString = false
        stringChar = ''
      }
      escaped = !escaped && char === '\\'
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      stringChar = char
      result += char
      continue
    }

    if (char === ',') {
      let lookahead = index + 1
      while (lookahead < content.length && /\s/.test(content[lookahead])) {
        lookahead += 1
      }
      const next = content[lookahead]
      if (next === '}' || next === ']') {
        continue
      }
    }

    result += char
  }

  return result
}


// DFS 搜索依赖图中是否存在一条从 start 回到 origin 的路径。
// 通过节点数与深度上限，避免超大项目中搜索失控。
const findPathToOrigin = (start: string, origin: string, root: string, resolver: ModuleResolver): string[] | null => {
  let nodesVisited = 0
  const visiting = new Set<string>()
  const deadEnds = new Set<string>()

  const walk = (current: string, depth: number): string[] | null => {
    if (depth > MAX_GRAPH_DEPTH) {
      return null
    }

    if (current === origin) {
      return [origin]
    }

    if (deadEnds.has(current)) {
      return null
    }

    if (visiting.has(current)) {
      return null
    }

    nodesVisited += 1
    if (nodesVisited > MAX_GRAPH_NODES) {
      return null
    }

    visiting.add(current)

    const neighbors = getResolvedImports(current, root, resolver)
    for (const next of neighbors) {
      const result = walk(next, depth + 1)
      if (result) {
        visiting.delete(current)
        return [current, ...result]
      }
    }

    visiting.delete(current)
    deadEnds.add(current)
    return null
  }

  return walk(start, 0)
}

// 读取文件并通过简单正则抽取 import/require/export-from。
// 这里不重新解析 AST，成本低但可能漏掉非常规写法。
const getResolvedImports = (filePath: string, root: string, resolver: ModuleResolver): string[] => {
  const cached = resolvedImportCache.get(filePath)
  if (cached) {
    return cached
  }

  const source = readFileSafe(filePath)
  if (!source) {
    resolvedImportCache.set(filePath, [])
    return []
  }

  const resolved = new Set<string>()
  const specifiers = extractImportSpecifiers(source)

  for (const spec of specifiers) {
    const resolution = resolveModuleSpecifier(filePath, spec, root, resolver)
    if (resolution.resolved) {
      resolved.add(resolution.resolved)
    }
  }

  const list = Array.from(resolved)
  resolvedImportCache.set(filePath, list)
  return list
}

const readFileSafe = (filePath: string): string | null => {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

// 用正则匹配常见的导入写法，覆盖 import / dynamic import / require / export-from。
const extractImportSpecifiers = (source: string): string[] => {
  const results: string[] = []
  const patterns = [
    /import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /export\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      results.push(match[1])
    }
  }

  return results
}

// 解析相对路径到真实文件：支持自动补全扩展名与目录 index。
// 并确保解析结果在项目根目录内。
const resolveImportFile = (fromFile: string, specifier: string, root: string): string | null => {
  if (!specifier.startsWith('.')) {
    return null
  }

  const cleaned = specifier.split(/[?#]/)[0]
  const basePath = path.resolve(path.dirname(fromFile), cleaned)
  return resolvePathCandidate(basePath, root)
}

const resolvePathCandidate = (basePath: string, root: string): string | null => {
  const resolved =
    resolveFile(basePath) ||
    resolveWithExtensions(basePath) ||
    resolveFromDirectory(basePath)

  if (!resolved) {
    return null
  }

  if (!isWithinRoot(resolved, root)) {
    return null
  }

  if (resolved.endsWith('.d.ts')) {
    return null
  }

  return resolved
}

const resolveFile = (candidate: string): string | null => {
  if (!fs.existsSync(candidate)) {
    return null
  }

  try {
    if (fs.statSync(candidate).isFile()) {
      return candidate
    }
  } catch {
    return null
  }

  return null
}

const resolveWithExtensions = (basePath: string): string | null => {
  const ext = path.extname(basePath)
  if (ext && SUPPORTED_EXTENSIONS.includes(ext)) {
    return resolveFile(basePath)
  }

  for (const extension of SUPPORTED_EXTENSIONS) {
    const candidate = `${basePath}${extension}`
    const resolved = resolveFile(candidate)
    if (resolved) {
      return resolved
    }
  }

  return null
}

const resolveFromDirectory = (basePath: string): string | null => {
  if (!fs.existsSync(basePath)) {
    return null
  }

  try {
    if (!fs.statSync(basePath).isDirectory()) {
      return null
    }
  } catch {
    return null
  }

  for (const extension of SUPPORTED_EXTENSIONS) {
    const candidate = path.join(basePath, `index${extension}`)
    const resolved = resolveFile(candidate)
    if (resolved) {
      return resolved
    }
  }

  return null
}

// 将环路规范化为稳定 key，避免同一环路从不同入口重复报错。
const buildCycleKey = (cycle: string[]): string => {
  if (cycle.length <= 2) {
    return cycle.join('->')
  }

  const unique = cycle.slice(0, -1).map((entry) => path.normalize(entry))
  let best = unique.join('->')

  for (let index = 1; index < unique.length; index += 1) {
    const rotated = unique.slice(index).concat(unique.slice(0, index))
    const candidate = rotated.join('->')
    if (candidate < best) {
      best = candidate
    }
  }

  return best
}

// 输出尽量相对路径，便于直接定位文件。
const formatCycle = (cycle: string[], root: string): string => {
  const formatted = cycle.map((entry) => {
    const relative = path.relative(root, entry)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return entry
    }
    return relative
  })

  return formatted.join(' -> ')
}

type LineIndex = {
  offsets: number[]
}

const buildLineIndex = (source: string): LineIndex => {
  const offsets: number[] = [0]

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      offsets.push(index + 1)
    }
  }

  return { offsets }
}

const resolveLine = ({ offsets }: LineIndex, position: number): number => {
  let low = 0
  let high = offsets.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const current = offsets[mid]

    if (current === position) {
      return mid + 1
    }

    if (current < position) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return high + 1
}

const readUtf8Character = (source: string, index: number, code: number): { bytes: number; nextIndex: number } => {
  if (code <= 0x7f) {
    return { bytes: 1, nextIndex: index + 1 }
  }

  if (code <= 0x7ff) {
    return { bytes: 2, nextIndex: index + 1 }
  }

  if (code >= 0xd800 && code <= 0xdbff && index + 1 < source.length) {
    const next = source.charCodeAt(index + 1)
    if (next >= 0xdc00 && next <= 0xdfff) {
      return { bytes: 4, nextIndex: index + 2 }
    }
  }

  return { bytes: 3, nextIndex: index + 1 }
}

const bytePosToCharIndex = (source: string, moduleStart: number, bytePos: number): number => {
  const target = Math.max(bytePos - moduleStart, 0)

  if (target === 0) {
    return 0
  }

  let index = 0
  let byteOffset = 0

  while (index < source.length) {
    const code = source.charCodeAt(index)
    const { bytes, nextIndex } = readUtf8Character(source, index, code)

    if (byteOffset + bytes > target) {
      return index
    }

    byteOffset += bytes
    index = nextIndex
  }

  return source.length
}

const findImportLine = (source: string, value: string): number | undefined => {
  const lines = source.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (line.includes('import') && line.includes(value)) {
      return index + 1
    }

    if (line.includes('require') && line.includes(value)) {
      return index + 1
    }
  }

  return undefined
}

const selectLineNumber = (computed?: number, fallback?: number): number | undefined => {
  if (fallback === undefined) {
    return computed
  }

  if (computed === undefined) {
    return fallback
  }

  // 当两者只差一行时，优先使用文本匹配结果，避免出现 +1 的偏移问题。
  if (Math.abs(computed - fallback) <= 1) {
    return fallback
  }

  // 若 span 指向了更早的注释块，则回退到更靠后的文本行。
  if (computed < fallback) {
    return fallback
  }

  return computed
}
