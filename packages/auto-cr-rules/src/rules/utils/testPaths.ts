// 测试文件/目录的识别，供多条规则共享：生产代码导入测试模块、测试文件的豁免等。
export const DEFAULT_TEST_DIRECTORIES = ['__tests__', '__mocks__', '__fixtures__', 'test', 'tests', 'spec']
export const DEFAULT_TEST_SUFFIXES = ['test', 'spec']
// 去掉源码扩展名后再比较文件名后缀，使 foo.test.ts 与未带扩展名的 ./foo.test 判定一致。
const SOURCE_EXTENSION = /\.(?:d\.ts|[cm]?[jt]sx?)$/

export type TestPathConfig = {
  directories: ReadonlySet<string>
  suffixes: ReadonlyArray<string>
}

export const DEFAULT_TEST_PATH_CONFIG: TestPathConfig = {
  directories: new Set(DEFAULT_TEST_DIRECTORIES),
  suffixes: DEFAULT_TEST_SUFFIXES,
}

// 目录段命中（不含文件名本身，避免把名为 test.ts 的生产模块误判），或文件名去扩展名后以 .test / .spec 结尾。
// 传入的路径应相对于项目根，不要用绝对路径——仓库自身所在目录名会混进判定。
export const isTestPath = (relativePath: string, config: TestPathConfig = DEFAULT_TEST_PATH_CONFIG): boolean => {
  const segments = normalizePath(relativePath)
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
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

export const normalizePath = (value: string): string => value.replace(/\\/g, '/')
