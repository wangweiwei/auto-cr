import fs from 'fs'
import path from 'path'
import { consola } from 'consola'

export const readFile = (path: string) => {
  return fs.readFileSync(path, 'utf-8')
}

/**
 * 递归获取目录下所有 TypeScript 和 JavaScript 文件
 */
export function getAllFiles(
  dirPath: string,
  arrayOfFiles: string[] = [],
  extensions: string[] = ['.ts', '.tsx', '.js', '.jsx']
): string[] {
  if (!fs.existsSync(dirPath)) return arrayOfFiles

  const files = fs.readdirSync(dirPath)

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file)

    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles, extensions)
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
    consola.error(`路径不存在: ${targetPath}`)
    return false
  }
  return true
}
