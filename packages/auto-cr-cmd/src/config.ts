import fs from 'fs'
import path from 'path'
import type { EsParserConfig, JscTarget, ParseOptions, TsParserConfig } from '@swc/types'
import { parse, type ParseError, printParseErrorCode } from 'jsonc-parser'
import { getTranslator } from './i18n'
import consola from 'consola'

// 读取并解析 tsconfig.json，推导 SWC 解析参数（target/jsx/decorators 等）。
// 这里使用 jsonc-parser 以兼容 tsconfig 中的注释与尾逗号。
interface TsCompilerOptions {
  jsx?: string
  target?: string
  experimentalDecorators?: boolean
}

interface TsConfig {
  compilerOptions?: TsCompilerOptions
}

// 缓存 tsconfig 解析结果，避免每个文件都重复读取与解析。
let cachedTsConfig: TsConfig | null | undefined
let tsConfigPathOverride: string | null = null

export function setTsConfigPath(path?: string): void {
  tsConfigPathOverride = path ? path : null
  cachedTsConfig = undefined
}

function getLineAndColumn(text: string, offset: number): { line: number; column: number } {
  const prefix = text.slice(0, offset)
  const lines = prefix.split(/\r?\n/)
  const line = lines.length
  const column = lines[lines.length - 1].length + 1

  return { line, column }
}

function formatParseErrors(errors: ParseError[], content: string): string {
  return errors
    .map(({ error, offset }) => {
      const { line, column } = getLineAndColumn(content, offset)
      return `${printParseErrorCode(error)} at ${line}:${column}`
    })
    .join('; ')
}

// 读取并解析 tsconfig；失败时只记录警告，不中断扫描流程。
function readTsConfig(): TsConfig | null {
  if (cachedTsConfig !== undefined) {
    return cachedTsConfig
  }

  const tsConfigPath = tsConfigPathOverride ?? path.resolve(process.cwd(), 'tsconfig.json')

  if (!fs.existsSync(tsConfigPath)) {
    cachedTsConfig = null
    return cachedTsConfig
  }

  try {
    const raw = fs.readFileSync(tsConfigPath, 'utf-8')
    const errors: ParseError[] = []
    const parsed = parse(raw, errors, {
      allowTrailingComma: true,
      disallowComments: false,
    })

    if (errors.length > 0) {
      cachedTsConfig = null
      const t = getTranslator()
      consola.warn(t.tsconfigReadFailed(), formatParseErrors(errors, raw))
      return cachedTsConfig
    }

    cachedTsConfig = parsed as TsConfig
  } catch (error) {
    cachedTsConfig = null
    const t = getTranslator()
    consola.warn(
      t.tsconfigReadFailed(),
      error instanceof Error ? error.message : error
    )
  }

  return cachedTsConfig
}

const TARGET_MAP: Record<string, JscTarget> = {
  es3: 'es3',
  es5: 'es5',
  es6: 'es2015',
  es2015: 'es2015',
  es2016: 'es2016',
  es2017: 'es2017',
  es2018: 'es2018',
  es2019: 'es2019',
  es2020: 'es2020',
  es2021: 'es2021',
  es2022: 'es2022',
  esnext: 'esnext',
  latest: 'esnext',
}

function normalizeTarget(target?: string): JscTarget | undefined {
  if (!target) return undefined

  const normalized = target.toLowerCase()

  if (normalized in TARGET_MAP) {
    return TARGET_MAP[normalized]
  }

  const match = normalized.match(/^es(\d{4})$/)
  if (match) {
    const year = `es${match[1]}` as keyof typeof TARGET_MAP
    return TARGET_MAP[year]
  }

  return undefined
}

function isJsxEnabled(option?: string): boolean {
  if (!option) return false

  const normalized = option.toLowerCase()
  return normalized !== 'none'
}

function createTsParserConfig(extension: string, enableDecorators: boolean): TsParserConfig {
  const shouldEnableJsx = extension === '.tsx'

  return {
    syntax: 'typescript',
    tsx: shouldEnableJsx,
    decorators: enableDecorators,
    dynamicImport: true,
  }
}

function createEsParserConfig(extension: string, options: TsCompilerOptions | undefined, enableDecorators: boolean): EsParserConfig {
  const jsxEnabled =
    extension === '.jsx' ||
    (extension === '.js' && isJsxEnabled(options?.jsx))

  return {
    syntax: 'ecmascript',
    jsx: jsxEnabled,
    decorators: enableDecorators,
    importAttributes: true,
  }
}

// 按文件扩展名推导 SWC 的 parser 选项，并结合 tsconfig 的 target/decorators。
export function loadParseOptions(filePath: string): ParseOptions {
  const extension = path.extname(filePath).toLowerCase()
  const tsConfig = readTsConfig()
  const compilerOptions = tsConfig?.compilerOptions
  const enableDecorators = Boolean(compilerOptions?.experimentalDecorators)
  const target = normalizeTarget(compilerOptions?.target)

  let parserConfig: TsParserConfig | EsParserConfig

  if (extension === '.ts' || extension === '.tsx') {
    parserConfig = createTsParserConfig(extension, enableDecorators)
  } else if (extension === '.js' || extension === '.jsx') {
    parserConfig = createEsParserConfig(extension, compilerOptions, enableDecorators)
  } else {
    parserConfig = createTsParserConfig('.ts', enableDecorators)
  }

  const options: ParseOptions = {
    ...parserConfig,
    comments: true,
  }

  if (target) {
    options.target = target
  }

  return options
}
