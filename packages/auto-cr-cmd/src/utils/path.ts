const ESCAPE_BYTES: Record<string, number> = {
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  '"': 0x22,
  '\\': 0x5c,
}

const isOctalDigit = (char: string): boolean => char >= '0' && char <= '7'

const isHexDigit = (char: string): boolean =>
  (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')

const pushUtf8Bytes = (bytes: number[], text: string) => {
  for (const byte of Buffer.from(text, 'utf8')) {
    bytes.push(byte)
  }
}

const decodeGitQuotedPath = (input: string): string => {
  if (input.length < 2 || input[0] !== '"' || input[input.length - 1] !== '"') {
    return input
  }

  const body = input.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i += 1) {
    const current = body[i]

    if (current !== '\\') {
      const codePoint = body.codePointAt(i) ?? 0
      if (codePoint <= 0x7f) {
        bytes.push(codePoint)
      } else {
        pushUtf8Bytes(bytes, String.fromCodePoint(codePoint))
        if (codePoint > 0xffff) {
          i += 1
        }
      }
      continue
    }

    if (i + 1 >= body.length) {
      bytes.push(0x5c)
      continue
    }

    const next = body[i + 1]

    if (isOctalDigit(next)) {
      let octal = next
      let consumed = 1
      while (consumed < 3 && i + 1 + consumed < body.length) {
        const digit = body[i + 1 + consumed]
        if (!isOctalDigit(digit)) {
          break
        }
        octal += digit
        consumed += 1
      }
      bytes.push(parseInt(octal, 8))
      i += consumed
      continue
    }

    if ((next === 'x' || next === 'X') && i + 3 < body.length) {
      const hex1 = body[i + 2]
      const hex2 = body[i + 3]
      if (isHexDigit(hex1) && isHexDigit(hex2)) {
        bytes.push(parseInt(`${hex1}${hex2}`, 16))
        i += 3
        continue
      }
    }

    const escaped = ESCAPE_BYTES[next]
    if (escaped !== undefined) {
      bytes.push(escaped)
      i += 1
      continue
    }

    bytes.push(0x5c)
  }

  return Buffer.from(bytes).toString('utf8')
}

// 兼容 git quotePath 输出的 C-style 字符串，确保非 ASCII 路径可解析。
export const normalizeInputPath = (input: string): string => decodeGitQuotedPath(input)
