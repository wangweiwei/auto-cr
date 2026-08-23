import path from 'path'
import { RuleSeverity, defineRule } from '../types'
import { resolveLineFromByteOffset } from '../sourceIndex'
import { resolveRelativeImport, resolveWorkspaceRoot } from './utils/workspace'

// 检测生产代码导入测试专用模块：*.test.* / *.spec.* 文件，或 __tests__ / __mocks__ / test 等目录下的文件。
// 这类导入会把测试夹具、mock 乃至测试框架打进生产包。导入方自己就是测试文件时不做判定。
const DEFAULT_DIRECTORIES = ['__tests__', '__mocks__', '__fixtures__', 'test', 'tests', 'spec']
const DEFAULT_SUFFIXES = ['test', 'spec']
// 去掉源码扩展名后再比较文件名后缀，使 foo.test.ts 与未带扩展名的 ./foo.test 判定一致。
const SOURCE_EXTENSION = /\.(?:d\.ts|[cm]?[jt]sx?)$/

export const noTestImportInProd = defineRule(
  'no-test-import-in-prod',
  { tag: 'architecture', severity: RuleSeverity.Warning },
  ({ configDir, filePath, helpers, language, messages, options, source, sourceIndex }) => {
    const config = parseOptions(options)
    const origin = path.resolve(filePath)
    const root = resolveRoot(configDir, origin)

    // 导入方自己就是测试文件：测试引用 mock / 夹具是正常行为。
    if (isTestPath(normalizePath(path.relative(root, origin)), config)) {
      return
    }

    const suggestions =
      language === 'zh'
        ? [
            { text: '把测试与生产共用的逻辑移出测试目录，改由双方共同引用。' },
            { text: '若当前文件本就是测试，请重命名或移动到测试目录，避免被当作生产代码。' },
          ]
        : [
            { text: 'Move logic shared by tests and production out of the test directory so both can import it.' },
            { text: 'If this file is really a test, rename it or move it under a test directory so it is not treated as production code.' },
          ]

    for (const reference of helpers.imports) {
      const cleaned = reference.value.split(/[?#]/)[0]
      // 相对路径先解析到真实文件，再按“相对于项目根”的路径判断——直接用绝对路径会被仓库自身所在目录名误伤。
      // 解析不到或非相对路径时，退回到按说明符本身匹配：目录名通常就写在路径里。
      const resolved = resolveRelativeImport(origin, cleaned, root)
      const candidate = resolved ? normalizePath(path.relative(root, resolved)) : normalizePath(cleaned)
      if (!isTestPath(candidate, config)) {
        continue
      }

      const line = reference.span ? resolveLineFromByteOffset(source, sourceIndex, reference.span.start) : undefined

      helpers.reportViolation(
        {
          description: messages.noTestImportInProd({ value: reference.value }),
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

// 项目根必须真正包含被扫描文件。CLI 在没有配置文件时会把 configDir 设成 cwd，
// 扫描 cwd 之外的路径时 path.relative 会产出 ../../ 开头的路径，祖先目录名（例如检出在 /home/ci/test/ 下）
// 会混进判定，把生产文件误判成测试文件而整条规则静默跳过。此时改为从文件自身向上找项目根。
const resolveRoot = (configDir: string | undefined, origin: string): string => {
  if (configDir) {
    const candidate = path.resolve(configDir)
    const relative = path.relative(candidate, origin)
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return candidate
    }
  }
  return resolveWorkspaceRoot(origin)
}

type TestPathConfig = {
  directories: Set<string>
  suffixes: string[]
}

// 目录段命中（不含文件名本身，避免把名为 test.ts 的生产模块误判），或文件名去扩展名后以 .test / .spec 结尾。
const isTestPath = (relativePath: string, config: TestPathConfig): boolean => {
  const segments = relativePath.split('/').filter((segment) => segment && segment !== '.' && segment !== '..')
  if (segments.length === 0) {
    return false
  }

  const directories = segments.slice(0, -1)
  if (directories.some((directory) => config.directories.has(directory))) {
    return true
  }

  const stem = segments[segments.length - 1].replace(SOURCE_EXTENSION, '')
  return config.suffixes.some((suffix) => stem.endsWith(`.${suffix}`))
}

// 可选配置：{ directories?: string[], suffixes?: string[] }。缺省或非法时退回默认值。
const parseOptions = (options: unknown): TestPathConfig => {
  const record = options && typeof options === 'object' && !Array.isArray(options) ? (options as Record<string, unknown>) : {}
  return {
    directories: new Set(readStringArray(record.directories) ?? DEFAULT_DIRECTORIES),
    suffixes: readStringArray(record.suffixes) ?? DEFAULT_SUFFIXES,
  }
}

const readStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) {
    return null
  }
  const strings = value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  return strings.length > 0 ? strings : null
}

const normalizePath = (value: string): string => value.replace(/\\/g, '/')
