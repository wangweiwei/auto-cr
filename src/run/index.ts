#!/usr/bin/env node
import { consola } from 'consola'
import fs from 'fs'
import { program } from 'commander'
import { babelConfig } from '../babel/config'
import { readFile, getAllFiles, checkPathExists } from '../utils/file'
import { transformSync } from '@babel/core'
import { report } from '../report'
import path from 'path'
import { rules } from 'auto-cr-rules'

export async function run(filePaths: string[] = [], ruleDir?: string): Promise<void> {
  try {
    if (filePaths.length === 0) {
      consola.info('未提供文件或目录路径，跳过代码扫描')
      return
    }

    // 检查所有路径是否存在
    const validPaths = filePaths.filter((path) => checkPathExists(path))
    if (validPaths.length === 0) {
      consola.error('所有提供的路径均不存在，终止操作')
      return
    }

    // 收集所有需要扫描的文件
    let allFiles: string[] = []

    for (const targetPath of validPaths) {
      const stat = fs.statSync(targetPath)
      if (stat.isFile()) {
        // 如果是文件，直接添加到扫描列表
        allFiles.push(targetPath)
      } else if (stat.isDirectory()) {
        // 如果是目录，递归获取所有相关文件
        consola.info(`扫描目录: ${targetPath}`)
        const directoryFiles = getAllFiles(targetPath)
        allFiles = [...allFiles, ...directoryFiles]
      }
    }

    if (allFiles.length === 0) {
      consola.info('未找到需要扫描的文件')
      return
    }

    let plugins
    if (ruleDir?.length) {
      const ruleFullDir = path.resolve(__dirname, ruleDir ?? '')
      plugins = getAllFiles(ruleFullDir, [], ['.js'])
        .map((file) => {
          const fileName = file.split('/').reverse()[0]
          if (fileName !== 'index.js' && fileName !== 'types.js') {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            return [require(file), { report }]
          }
          return undefined
        })
        .filter((item) => item !== undefined)
    }
    
    // 执行扫描
    for (const file of allFiles) {
      consola.info(`扫描文件: ${file}`)
      try {
        transformSync(readFile(file), {
          ...babelConfig,
          plugins: [
            ...rules.map(rule => [rule, { report }]),
            ...(plugins || [])
          ],
        })
      } catch (error) {
        consola.error(`文件扫描失败: ${file}`, error instanceof Error ? error.message : error)
      }
    }

    consola.success('代码扫描完成')
  } catch (error) {
    consola.error('代码扫描过程中发生错误:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
