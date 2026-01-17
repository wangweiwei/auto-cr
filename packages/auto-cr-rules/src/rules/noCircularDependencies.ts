import fs from 'fs'
import path from 'path'
import { RuleSeverity, defineRule } from '../types'

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const MAX_GRAPH_NODES = 2000
const MAX_GRAPH_DEPTH = 80

const resolvedImportCache = new Map<string, string[]>()
const reportedCycles = new Set<string>()

export const noCircularDependencies = defineRule(
  'no-circular-dependencies',
  { tag: 'base', severity: RuleSeverity.Warning },
  ({ ast, filePath, helpers, language, messages, source }) => {
    const origin = path.resolve(filePath)
    const root = resolveProjectRoot(origin)
    const moduleStart = ast.span?.start ?? 0
    const lineIndex = buildLineIndex(source)

    // Seed cache with SWC-collected imports for the current file.
    resolvedImportCache.set(origin, resolveFromReferences(origin, helpers.imports, root))

    for (const reference of helpers.imports) {
      if (!helpers.isRelativePath(reference.value)) {
        continue
      }

      const target = resolveImportFile(origin, reference.value, root)
      if (!target) {
        continue
      }

      const pathToOrigin = findPathToOrigin(target, origin, root)
      if (!pathToOrigin) {
        continue
      }

      const cycle = [origin, ...pathToOrigin]
      const cycleKey = buildCycleKey(cycle)

      if (reportedCycles.has(cycleKey)) {
        continue
      }

      reportedCycles.add(cycleKey)

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
  }
)

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

const isWithinRoot = (filePath: string, root: string): boolean => {
  const relative = path.relative(root, filePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const resolveFromReferences = (
  origin: string,
  references: ReadonlyArray<{ value: string }>,
  root: string
): string[] => {
  const resolved = new Set<string>()

  for (const reference of references) {
    if (!reference.value.startsWith('.')) {
      continue
    }

    const target = resolveImportFile(origin, reference.value, root)
    if (target) {
      resolved.add(target)
    }
  }

  return Array.from(resolved)
}

const findPathToOrigin = (start: string, origin: string, root: string): string[] | null => {
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

    const neighbors = getResolvedImports(current, root)
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

const getResolvedImports = (filePath: string, root: string): string[] => {
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
    if (!spec.startsWith('.')) {
      continue
    }

    const target = resolveImportFile(filePath, spec, root)
    if (target) {
      resolved.add(target)
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

const resolveImportFile = (fromFile: string, specifier: string, root: string): string | null => {
  if (!specifier.startsWith('.')) {
    return null
  }

  const cleaned = specifier.split(/[?#]/)[0]
  const basePath = path.resolve(path.dirname(fromFile), cleaned)

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

  if (computed < fallback) {
    return fallback
  }

  return computed
}
