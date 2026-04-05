import fs from 'fs'
import path from 'path'

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

export type WorkspacePackageJson = {
  name?: string
  exports?: unknown
  main?: string
  module?: string
  types?: string
}

export type WorkspacePackage = {
  name: string
  dir: string
  packageJson: WorkspacePackageJson
}

const workspacePackageCache = new Map<string, Map<string, WorkspacePackage>>()

// 优先寻找最近的 pnpm workspace 根；找不到时退回到最近的 package.json 目录。
export const resolveWorkspaceRoot = (filePath: string): string => {
  let current = path.dirname(path.resolve(filePath))
  let last = ''
  let nearestPackageRoot: string | null = null

  while (current !== last) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current
    }

    if (!nearestPackageRoot && fs.existsSync(path.join(current, 'package.json'))) {
      nearestPackageRoot = current
    }

    last = current
    current = path.dirname(current)
  }

  return nearestPackageRoot ?? path.resolve(process.cwd())
}

export const getWorkspacePackages = (root: string): Map<string, WorkspacePackage> => {
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

  packageDirs.forEach((dir) => {
    try {
      const raw = fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')
      const pkg = JSON.parse(raw) as WorkspacePackageJson
      if (pkg.name) {
        packages.set(pkg.name, { name: pkg.name, dir, packageJson: pkg })
      }
    } catch {
      return
    }
  })

  workspacePackageCache.set(root, packages)
  return packages
}

// 找到文件所属的 workspace 包；若有嵌套目录，优先选择路径最长的包。
export const findOwningWorkspacePackage = (
  filePath: string,
  packages: ReadonlyMap<string, WorkspacePackage>
): WorkspacePackage | null => {
  const normalized = path.resolve(filePath)
  let bestMatch: WorkspacePackage | null = null

  packages.forEach((pkg) => {
    if (!isWithinDirectory(normalized, pkg.dir)) {
      return
    }

    if (!bestMatch || pkg.dir.length > bestMatch.dir.length) {
      bestMatch = pkg
    }
  })

  return bestMatch
}

export const parsePackageName = (specifier: string): string | null => {
  const normalized = specifier.replace(/^node:/, '')

  if (!normalized || normalized.startsWith('.') || normalized.startsWith('/')) {
    return null
  }

  if (normalized.startsWith('@')) {
    const segments = normalized.split('/')
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : null
  }

  const [name] = normalized.split('/')
  return name || null
}

export const getPackageSubpath = (specifier: string, packageName: string): string => {
  if (specifier === packageName) {
    return '.'
  }

  const rest = specifier.slice(packageName.length + 1)
  return rest ? `./${rest}` : '.'
}

export const resolveExportsTarget = (exportsField: unknown, subpath: string): string | null => {
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
    return resolveExportsSubpath(exportsObj, subpath)
  }

  if (subpath !== '.') {
    return null
  }

  return resolveConditionalTarget(exportsObj)
}

export const resolveRelativeImport = (fromFile: string, specifier: string, root: string): string | null => {
  if (!specifier.startsWith('.')) {
    return null
  }

  const cleaned = specifier.split(/[?#]/)[0]
  const basePath = path.resolve(path.dirname(fromFile), cleaned)
  return resolvePathCandidate(basePath, root)
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
  const starIndex = target.indexOf('*')
  if (starIndex < 0) {
    return target
  }

  // 直接按字面量插入捕获到的片段，避免 `$` 之类的字符
  // 被 String.prototype.replace 当成替换标记解释。
  return `${target.slice(0, starIndex)}${wildcard}${target.slice(starIndex + 1)}`
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

const resolvePathCandidate = (basePath: string, root: string): string | null => {
  const resolved = resolveFile(basePath) || resolveWithExtensions(basePath) || resolveFromDirectory(basePath)
  if (!resolved) {
    return null
  }

  if (!isWithinDirectory(resolved, root)) {
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

const isWithinDirectory = (filePath: string, root: string): boolean => {
  const relative = path.relative(path.resolve(root), path.resolve(filePath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
