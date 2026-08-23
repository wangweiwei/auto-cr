// 源码索引工具：把 SWC 的 byte offset 转换为行号，供规则复用，避免重复扫描源码。
import type { SourceIndex } from './types'

// 构建行号索引。lineOffsets 记录每一行的起始字符偏移（基于 JS 字符索引）。
// moduleStart 来自 SWC Module.span.start（byte offset），用于与 SWC 的 span 对齐。
// 注意：SWC 的 Module.span 从第一个 token 开始，而不是文件第 0 字节——前导空行、许可证注释都不包含在内。
// 若直接拿它当文件起点，所有 span 都会向前偏移“前导琐碎内容”的字节数，行号随之报早。
// 这里把前导空白/注释的字节长度补回去，使 span.start - moduleStart 恰好等于文件内的真实字节偏移。
// （shebang 行是例外：SWC 会把它算进 module span，因此不作为琐碎内容跳过。）
export const createSourceIndex = (source: string, moduleStart: number): SourceIndex => {
  const lineOffsets: number[] = [0]

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      lineOffsets.push(index + 1)
    }
  }

  return {
    moduleStart: moduleStart - leadingTriviaByteLength(source),
    lineOffsets,
  }
}

// 计算文件开头到第一个 token 之间的 UTF-8 字节数：BOM、空白、// 行注释、/* */ 块注释。
const leadingTriviaByteLength = (source: string): number => {
  let index = 0
  let bytes = 0

  if (source.charCodeAt(0) === 0xfeff) {
    index = 1
    bytes = 3
  }

  while (index < source.length) {
    const code = source.charCodeAt(index)

    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
      index += 1
      bytes += 1
      continue
    }

    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index)
      const stop = end === -1 ? source.length : end
      bytes += utf8ByteLength(source, index, stop)
      index = stop
      continue
    }

    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2)
      const stop = end === -1 ? source.length : end + 2
      bytes += utf8ByteLength(source, index, stop)
      index = stop
      continue
    }

    break
  }

  return bytes
}

const utf8ByteLength = (source: string, start: number, end: number): number => {
  let index = start
  let bytes = 0

  while (index < end) {
    const { bytes: size, nextIndex } = readUtf8Character(source, index, source.charCodeAt(index))
    bytes += size
    index = nextIndex
  }

  return bytes
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
