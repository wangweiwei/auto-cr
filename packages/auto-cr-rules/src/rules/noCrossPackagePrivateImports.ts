import path from 'path'
import { RuleSeverity, defineRule } from '../types'
import {
  findOwningWorkspacePackage,
  getPackageSubpath,
  getWorkspacePackages,
  parsePackageName,
  resolveExportsTarget,
  resolveRelativeImport,
  resolveWorkspaceRoot,
  type WorkspacePackage,
} from './utils/workspace'

const PRIVATE_PATH_SEGMENTS = new Set([
  'src',
  'dist',
  'lib',
  'internal',
  'internals',
  '__tests__',
  'tests',
  'test',
  '__mocks__',
])

// 禁止跨 workspace 包直接导入未公开导出的内部实现。
// 规则会拦截两类情况：
// 1. 通过包名深挖到未在 package.json exports 中声明的子路径；
// 2. 通过相对路径直接跨进另一个包的目录。
export const noCrossPackagePrivateImports = defineRule(
  'no-cross-package-private-imports',
  { tag: 'architecture', severity: RuleSeverity.Warning },
  ({ filePath, helpers, language, messages }) => {
    const origin = path.resolve(filePath)
    const root = resolveWorkspaceRoot(origin)
    const workspacePackages = getWorkspacePackages(root)

    if (workspacePackages.size === 0) {
      return
    }

    const currentPackage = findOwningWorkspacePackage(origin, workspacePackages)
    const suggestions =
      language === 'zh'
        ? [
            { text: '改为从目标包的公开入口导入，例如包名根入口或已声明的 exports 子路径。' },
            { text: '如确需该子路径，请在目标包 package.json 的 exports 中显式公开。' },
          ]
        : [
            { text: 'Import from the target package public entry, such as the bare package name or an exported subpath.' },
            { text: 'If the subpath is intentional, expose it explicitly via the target package package.json exports.' },
          ]

    for (const reference of helpers.imports) {
      const cleaned = reference.value.split(/[?#]/)[0]
      const targetPackage = getViolatedWorkspacePackage(cleaned, origin, root, currentPackage, workspacePackages)
      if (!targetPackage) {
        continue
      }

      helpers.reportViolation(
        {
          description: messages.noCrossPackagePrivateImports({
            value: reference.value,
            packageName: targetPackage.name,
          }),
          code: reference.value,
          suggestions,
          span: reference.span,
        },
        reference.span
      )
    }
  }
)

const getViolatedWorkspacePackage = (
  specifier: string,
  origin: string,
  root: string,
  currentPackage: WorkspacePackage | null,
  workspacePackages: ReadonlyMap<string, WorkspacePackage>
): WorkspacePackage | null => {
  if (specifier.startsWith('.')) {
    return getRelativePrivateImportTarget(specifier, origin, root, currentPackage, workspacePackages)
  }

  const packageName = parsePackageName(specifier)
  if (!packageName) {
    return null
  }

  const targetPackage = workspacePackages.get(packageName)
  if (!targetPackage || isSameWorkspacePackage(origin, currentPackage, targetPackage)) {
    return null
  }

  const subpath = getPackageSubpath(specifier, packageName)
  if (subpath === '.') {
    return null
  }

  if (resolveExportsTarget(targetPackage.packageJson.exports, subpath)) {
    return null
  }

  if (!targetPackage.packageJson.exports && !isLikelyPrivateSubpath(subpath)) {
    return null
  }

  return targetPackage
}

const getRelativePrivateImportTarget = (
  specifier: string,
  origin: string,
  root: string,
  currentPackage: WorkspacePackage | null,
  workspacePackages: ReadonlyMap<string, WorkspacePackage>
): WorkspacePackage | null => {
  const resolved = resolveRelativeImport(origin, specifier, root)
  if (!resolved) {
    return null
  }

  const targetPackage = findOwningWorkspacePackage(resolved, workspacePackages)
  if (!targetPackage || isSameWorkspacePackage(origin, currentPackage, targetPackage)) {
    return null
  }

  return targetPackage
}

const isSameWorkspacePackage = (
  origin: string,
  currentPackage: WorkspacePackage | null,
  targetPackage: WorkspacePackage
): boolean => {
  if (currentPackage && currentPackage.name === targetPackage.name) {
    return true
  }

  const relative = path.relative(targetPackage.dir, origin)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const isLikelyPrivateSubpath = (subpath: string): boolean => {
  const normalized = subpath.replace(/^\.\//, '')

  if (normalized === 'package.json') {
    return true
  }

  return normalized.split('/').some((segment) => PRIVATE_PATH_SEGMENTS.has(segment))
}
