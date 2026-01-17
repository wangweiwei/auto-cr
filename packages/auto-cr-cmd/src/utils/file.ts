import fs from 'fs'
import path from 'path'
import { consola } from 'consola'
import { getTranslator } from '../i18n'

// 统一读取文本文件（UTF-8），供解析与规则执行使用。
export const readFile = (path: string) => {
  return fs.readFileSync(path, 'utf-8')
}

/**
 * 递归获取目录下所有 TypeScript 和 JavaScript 文件
 * - 默认跳过 node_modules
 * - 可通过 shouldIgnore 进一步过滤路径
 */
export function getAllFiles(
  dirPath: string,
  arrayOfFiles: string[] = [],
  extensions: string[] = ['.ts', '.tsx', '.js', '.jsx'],
  options: { skipNodeModules?: boolean; shouldIgnore?: (fullPath: string, isDirectory: boolean) => boolean } = {}
): string[] {
  if (!fs.existsSync(dirPath)) return arrayOfFiles

  const { skipNodeModules = true } = options
  const files = fs.readdirSync(dirPath)

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file)
    const stats = fs.statSync(fullPath)

    if (options.shouldIgnore && options.shouldIgnore(fullPath, stats.isDirectory())) {
      return
    }

    if (stats.isDirectory()) {
      if (skipNodeModules && file === 'node_modules') {
        return
      }
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles, extensions, options)
    } else {
      if (extensions?.some((ext) => fullPath.endsWith(ext))) {
        arrayOfFiles.push(fullPath)
      }
    }
  })

  return arrayOfFiles
}

/**
 * 检查文件或目录是否存在
 */
export function checkPathExists(targetPath: string): boolean {
  if (!fs.existsSync(targetPath)) {
    const t = getTranslator()
    consola.error(t.pathNotExist({ path: targetPath }))
    return false
  }
  return true
}
