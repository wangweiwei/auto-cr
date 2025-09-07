import fs from 'fs'
import path from 'path'
import { loadOptions, TransformOptions } from '@babel/core'

interface TsConfig {
  compilerOptions?: {
    jsx?: string
    target?: string
    module?: string
    strict?: boolean
    esModuleInterop?: boolean
  }
  include?: string[]
  exclude?: string[]
}

/**
 * 获取项目中的 Babel 配置（如果存在）
 * 如果没有找到配置文件，则返回 null
 */
function getProjectBabelConfig(): TransformOptions | null {
  try {
    const fullConfig = loadOptions({
      root: process.cwd(),
    })

    if (fullConfig) {
      return fullConfig
    }

    return null
  } catch (error) {
    console.warn('Warning: Failed to load project Babel config:', error)
    return null
  }
}

/**
 * 获取合并后的 Babel 配置
 * 会尝试读取项目配置，如果没有则使用默认配置
 */
function getMergedBabelConfig(): TransformOptions {
  // 尝试获取项目中的 Babel 配置
  const projectConfig = getProjectBabelConfig()

  const tsConfigPath = path.resolve(process.cwd(), 'tsconfig.json')
  let tsConfig: TsConfig = {}

  try {
    if (fs.existsSync(tsConfigPath)) {
      tsConfig = JSON.parse(fs.readFileSync(tsConfigPath, 'utf-8'))
    }
  } catch (error) {
    console.warn('Warning: Failed to read tsconfig.json:', error)
  }

  const defaultConfig: TransformOptions = {
    presets: [
      [
        '@babel/preset-react',
        {
          // 根据 tsconfig 决定使用哪种 JSX 运行时
          runtime: tsConfig.compilerOptions?.jsx === 'react-jsx' ? 'automatic' : 'classic',
          development: process.env.NODE_ENV === 'development',
        },
      ],
      [
        '@babel/preset-typescript',
        {
          allExtensions: true,
          isTSX: true,
        },
      ],
    ],
  }

  // 合并配置：项目配置优先，默认配置作为后备
  if (projectConfig) {
    return {
      ...defaultConfig,
      ...projectConfig,
      // 对于 presets 和 plugins 等数组，需要更复杂的合并策略
      // 这里简单起见，如果项目配置有 presets，就使用项目的，否则使用默认的
      presets: projectConfig.presets || defaultConfig.presets,
      plugins: projectConfig.plugins || defaultConfig.plugins,
    }
  }

  // 如果没有找到项目配置，返回默认配置
  return defaultConfig
}

const tsConfigPath = path.resolve(process.cwd(), 'tsconfig.json')
const tsConfig = JSON.parse(fs.readFileSync(tsConfigPath, 'utf-8'))

export const babelConfig: TransformOptions = {
  ...getMergedBabelConfig(),
  parserOpts: {
    plugins: [
      'jsx',
      'typescript',
      tsConfig.compilerOptions.jsx === 'preserve' ? 'preserveJsx' : '',
    ].filter(Boolean) as [],
  },
}
