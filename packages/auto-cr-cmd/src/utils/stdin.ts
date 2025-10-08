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

        // Prefer NUL-delimited when present; else fall back to newline.
        const hasNul = buf.includes(0) // 0x00
        const payload = buf.toString('utf8')

        const parts = hasNul ? payload.split('\0') : payload.split(/\r?\n/)

        // Preserve spaces in filenames; only strip stray CR and drop empties.
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
