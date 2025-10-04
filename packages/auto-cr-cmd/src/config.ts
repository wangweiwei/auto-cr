import fs from 'fs'
import path from 'path'
import type { EsParserConfig, JscTarget, ParseOptions, TsParserConfig } from '@swc/types'
import { getTranslator } from './i18n'
import consola from 'consola'

interface TsCompilerOptions {
  jsx?: string
  target?: string
  experimentalDecorators?: boolean
}

interface TsConfig {
  compilerOptions?: TsCompilerOptions
}

let cachedTsConfig: TsConfig | null | undefined

function readTsConfig(): TsConfig | null {
  if (cachedTsConfig !== undefined) {
    return cachedTsConfig
  }

  const tsConfigPath = path.resolve(process.cwd(), 'tsconfig.json')

  if (!fs.existsSync(tsConfigPath)) {
    cachedTsConfig = null
    return cachedTsConfig
  }

  try {
    const raw = fs.readFileSync(tsConfigPath, 'utf-8')
    cachedTsConfig = JSON.parse(raw) as TsConfig
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

function createTsParserConfig(extension: string, options: TsCompilerOptions | undefined, enableDecorators: boolean): TsParserConfig {
  const shouldEnableJsx = extension === '.tsx' || (extension === '.ts' && isJsxEnabled(options?.jsx))

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

export function loadParseOptions(filePath: string): ParseOptions {
  const extension = path.extname(filePath).toLowerCase()
  const tsConfig = readTsConfig()
  const compilerOptions = tsConfig?.compilerOptions
  const enableDecorators = Boolean(compilerOptions?.experimentalDecorators)
  const target = normalizeTarget(compilerOptions?.target)

  let parserConfig: TsParserConfig | EsParserConfig

  if (extension === '.ts' || extension === '.tsx') {
    parserConfig = createTsParserConfig(extension, compilerOptions, enableDecorators)
  } else if (extension === '.js' || extension === '.jsx') {
    parserConfig = createEsParserConfig(extension, compilerOptions, enableDecorators)
  } else {
    parserConfig = createTsParserConfig('.ts', compilerOptions, enableDecorators)
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
