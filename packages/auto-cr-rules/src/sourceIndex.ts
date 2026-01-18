// 源码索引工具：把 SWC 的 byte offset 转换为行号，供规则复用，避免重复扫描源码。
import type { SourceIndex } from './types'

// 构建行号索引。lineOffsets 记录每一行的起始字符偏移（基于 JS 字符索引）。
// moduleStart 来自 SWC Module.span.start（byte offset），用于与 SWC 的 span 对齐。
export const createSourceIndex = (source: string, moduleStart: number): SourceIndex => {
  const lineOffsets: number[] = [0]

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      lineOffsets.push(index + 1)
    }
  }

  return {
    moduleStart,
    lineOffsets,
  }
}

// 根据 SWC byte offset 计算行号：先把 byte 偏移转成字符索引，再做二分查找。
// 注意：JS 字符索引与 UTF-8 字节长度不同，需要转换。
export const resolveLineFromByteOffset = (source: string, index: SourceIndex, byteOffset: number): number => {
  const charIndex = bytePosToCharIndex(source, index.moduleStart, byteOffset)
  return resolveLine(index.lineOffsets, charIndex)
}

// 二分查找行号：lineOffsets 是升序的行起始偏移。
const resolveLine = (lineOffsets: number[], position: number): number => {
  let low = 0
  let high = lineOffsets.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const current = lineOffsets[mid]

    if (current === position) {
      return mid + 1
    }

    if (current < position) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return high + 1
}

// 将 byte offset 转为 JS 字符索引（兼容 UTF-8 多字节字符）。
// 这里不做 substring/Buffer 转换，避免额外分配与性能抖动。
const bytePosToCharIndex = (source: string, moduleStart: number, bytePos: number): number => {
  const target = Math.max(bytePos - moduleStart, 0)

  if (target === 0) {
    return 0
  }

  let index = 0
  let byteOffset = 0

  while (index < source.length) {
    const code = source.charCodeAt(index)
    const { bytes, nextIndex } = readUtf8Character(source, index, code)

    if (byteOffset + bytes > target) {
      return index
    }

    byteOffset += bytes
    index = nextIndex
  }

  return source.length
}

// 计算当前字符对应的 UTF-8 字节长度，用于 byte -> char 的累加转换。
const readUtf8Character = (source: string, index: number, code: number): { bytes: number; nextIndex: number } => {
  if (code <= 0x7f) {
    return { bytes: 1, nextIndex: index + 1 }
  }

  if (code <= 0x7ff) {
    return { bytes: 2, nextIndex: index + 1 }
  }

  if (code >= 0xd800 && code <= 0xdbff && index + 1 < source.length) {
    const next = source.charCodeAt(index + 1)
    if (next >= 0xdc00 && next <= 0xdfff) {
      return { bytes: 4, nextIndex: index + 2 }
    }
  }

  return { bytes: 3, nextIndex: index + 1 }
}
