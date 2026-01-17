// 从 STDIN 读取路径列表：
// - 默认仅在非 TTY 时读取；
// - 支持 NUL 分隔与换行分隔两种格式；
// - 保留空格，仅移除空行与 CR。
export async function readPathsFromStdin(shouldForceRead: boolean): Promise<string[]> {
  const shouldRead = shouldForceRead || !process.stdin.isTTY

  if (!shouldRead) {
    return []
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false

    const finish = (result: string[]) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error)
    }

    process.stdin.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    process.stdin.on('error', (error) => {
      fail(error)
    })

    process.stdin.on('end', () => {
      try {
        if (chunks.length === 0) {
          return finish([])
        }

        const buf = Buffer.concat(chunks)
        if (buf.length === 0) {
          return finish([])
        }

        // 优先使用 NUL 分隔（适配 xargs -0 等工具），否则按换行切分。
        const hasNul = buf.includes(0) // 0x00
        const payload = buf.toString('utf8')

        const parts = hasNul ? payload.split('\0') : payload.split(/\r?\n/)

        // 保留文件名中的空格，只去掉末尾 CR 并过滤空行。
        const lines = parts
          .map((s) => (s.endsWith('\r') ? s.slice(0, -1) : s))
          .filter((s) => s.length > 0)

        finish(lines)
      } catch (err) {
        fail(err)
      }
    })

    process.stdin.on('close', () => {
      if (!settled) {
        finish([])
      }
    })

    if (process.stdin.isTTY) {
      process.stdin.resume()
    }
  })
}
