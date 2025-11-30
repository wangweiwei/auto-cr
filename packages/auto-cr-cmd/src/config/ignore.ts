import fs from 'fs'
import path from 'path'
import picomatch from 'picomatch'
import { getTranslator } from '../i18n'

const IGNORE_CANDIDATES = ['.autocrignore.json', '.autocrignore.js']

export interface LoadedIgnoreConfig {
  path?: string
  patterns: string[]
  baseDir: string
  warnings: string[]
}

export function loadIgnoreConfig(configPath?: string): LoadedIgnoreConfig {
  const warnings: string[] = []
  const t = getTranslator()
  const resolvedPath = resolveConfigPath(configPath)

  if (!resolvedPath) {
    return { patterns: [], warnings, baseDir: process.cwd() }
  }

  if (!fs.existsSync(resolvedPath)) {
    warnings.push(t.autocrignorePathMissing({ path: resolvedPath }))
    return { patterns: [], warnings, baseDir: process.cwd() }
  }

  const baseDir = path.dirname(resolvedPath)

  try {
    const raw = readIgnoreFile(resolvedPath)
    const patterns = normalizeIgnorePayload(raw)

    if (!patterns.length) {
      warnings.push(t.autocrignoreInvalidFormat({ path: resolvedPath }))
    }

    return { path: resolvedPath, patterns, warnings, baseDir }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    warnings.push(t.autocrignoreLoadFailed({ path: resolvedPath, error: detail }))
    return { patterns: [], warnings, baseDir }
  }
}

export function createIgnoreMatcher(patterns: string[], baseDir: string = process.cwd()): (candidate: string) => boolean {
  if (!patterns.length) {
    return () => false
  }

  const cwd = baseDir
  const matchers = patterns
    .map((pattern) => picomatch(pattern, { dot: true, nocase: false, posix: true }))
    .filter((matcher) => matcher !== null)

  return (candidate: string) => {
    const normalized = toPosix(candidate)
    const relative = toPosix(path.relative(cwd, candidate))

    return matchers.some((matcher) => matcher(normalized) || matcher(relative))
  }
}

function resolveConfigPath(explicitPath?: string): string | null {
  if (explicitPath) {
    return path.isAbsolute(explicitPath) ? explicitPath : path.resolve(process.cwd(), explicitPath)
  }

  for (const candidate of IGNORE_CANDIDATES) {
    const resolved = path.resolve(process.cwd(), candidate)
    if (fs.existsSync(resolved)) {
      return resolved
    }
  }

  return null
}

function readIgnoreFile(filePath: string): unknown {
  if (filePath.endsWith('.json')) {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw)
  }

  if (filePath.endsWith('.js')) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(filePath)
  }

  return []
}

function normalizeIgnorePayload(payload: unknown): string[] {
  const values: string[] = []

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const normalized = normalizeEntry(entry)
      if (normalized) values.push(normalized)
    }
    return values
  }

  if (isRecord(payload) && payload.ignore) {
    return normalizeIgnorePayload(payload.ignore)
  }

  if (isRecord(payload) && payload.default) {
    return normalizeIgnorePayload(payload.default)
  }

  if (typeof payload === 'string') {
    return normalizeIgnorePayload(payload.split(/\r?\n/))
  }

  return values
}

function normalizeEntry(entry: unknown): string | null {
  if (typeof entry !== 'string') {
    return null
  }

  const trimmed = entry.trim()

  if (!trimmed || trimmed.startsWith('#')) {
    return null
  }

  return trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}
