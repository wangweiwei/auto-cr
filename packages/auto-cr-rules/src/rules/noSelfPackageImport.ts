import fs from 'fs'
import path from 'path'
import { RuleSeverity, defineRule } from '../types'
import { resolveLineFromByteOffset } from '../sourceIndex'
import { isTestPath } from './utils/testPaths'
import {
  findOwningWorkspacePackage,
  getWorkspacePackages,
  parsePackageName,
  resolveWorkspaceRoot,
} from './utils/workspace'

// 检测模块通过包名导入自己所在的包（@scope/pkg 或 @scope/pkg/sub）。
// 这类引用不走源码树，而是解析到 node_modules 里的安装/构建产物：开发时拿到陈旧代码、
// 同一模块出现两份实例（单例与状态各自为政），并经由 dist 形成看不见的循环依赖。
// 包内的测试文件豁免：以消费者视角测试公开入口是常见且合理的写法。
export const noSelfPackageImport = defineRule(
  'no-self-package-import',
  { tag: 'architecture', severity: RuleSeverity.Warning },
  ({ filePath, helpers, language, messages, source, sourceIndex }) => {
    const origin = path.resolve(filePath)
    const owner = findOwningPackage(origin)
    if (!owner) {
      return
    }

    // 相对于包目录判断是否为测试文件，包自身的目录名不会参与判定。
    if (isTestPath(path.relative(owner.dir, origin))) {
      return
    }

    const suggestions =
      language === 'zh'
        ? [
            { text: '改用相对路径引用同一个包内的模块。' },
            { text: '若需要稳定的内部入口，配置指向 src 的 tsconfig paths 别名，而不是使用包名。' },
          ]
        : [
            { text: 'Use a relative path to import modules that live in the same package.' },
            { text: 'If you need a stable internal entry point, add a tsconfig paths alias that targets src instead of the package name.' },
          ]

    for (const reference of helpers.imports) {
      const cleaned = reference.value.split(/[?#]/)[0]
      if (parsePackageName(cleaned) !== owner.name) {
        continue
      }

      const line = reference.span ? resolveLineFromByteOffset(source, sourceIndex, reference.span.start) : undefined

      helpers.reportViolation(
        {
          description: messages.noSelfPackageImport({ value: reference.value, packageName: owner.name }),
          code: reference.value,
          suggestions,
          line,
          span: reference.span,
        },
        reference.span
      )
    }
  }
)

type OwningPackage = { name: string; dir: string }

// monorepo 里取文件所属的工作区包；单包仓库没有工作区索引，退回到最近的 package.json。
// 工作区存在但文件不属于任何包（例如根目录脚本）时不做判定，避免奇特布局下的误报。
const findOwningPackage = (origin: string): OwningPackage | null => {
  const root = resolveWorkspaceRoot(origin)
  const workspacePackages = getWorkspacePackages(root)
  if (workspacePackages.size > 0) {
    const owner = findOwningWorkspacePackage(origin, workspacePackages)
    return owner ? { name: owner.name, dir: owner.dir } : null
  }
  return findNearestPackage(origin)
}

const findNearestPackage = (origin: string): OwningPackage | null => {
  let current = path.dirname(origin)
  let last = ''

  while (current !== last) {
    const packageJsonPath = path.join(current, 'package.json')
    if (fs.existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { name?: unknown }
        return typeof parsed.name === 'string' && parsed.name ? { name: parsed.name, dir: current } : null
      } catch {
        return null
      }
    }
    last = current
    current = path.dirname(current)
  }

  return null
}
