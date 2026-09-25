declare const logger: { error(message: string, meta?: unknown): void }
declare const res: {
  status(code: number): { json(body: unknown): void; send(body: unknown): void }
}
declare function doWork(): Promise<void>
declare function readConfig(callback: (err: Error | null, data?: string) => void): void
declare const validator: { on(event: string, listener: (error: string) => void): void }
declare const result: { errors: Array<{ path: string; message: string }> }

// JSON.stringify(err) prints "{}".
export function run(): void {
  try {
    JSON.parse('{')
  } catch (err) {
    logger.error(`parse failed: ${JSON.stringify(err)}`)
  }
}

// The client receives {}.
export async function handler(): Promise<void> {
  try {
    await doWork()
  } catch (error) {
    res.status(500).json(error)
  }
}

// Spreading an error drops message and stack.
export function report(): Promise<void> {
  return doWork().catch((reason) => {
    logger.error('failed', { ...reason, requestId: 'abc' })
  })
}

// Node-style callback, wrapped in an object and serialized.
readConfig((err) => {
  if (err) {
    logger.error(JSON.stringify({ err }))
  }
})

// --- Compliant ---

export function runSafe(): void {
  try {
    JSON.parse('{')
  } catch (err) {
    // Pass the error itself, or pick the fields explicitly.
    logger.error('parse failed', err)
    const payload =
      err instanceof Error ? { message: err.message, stack: err.stack } : { value: String(err) }
    logger.error(JSON.stringify(payload))
    // A replacer listing own property names includes message and stack.
    logger.error(JSON.stringify(err, Object.getOwnPropertyNames(err)))
    // Explicit message / stack next to the spread.
    logger.error('failed', {
      ...(err as object),
      message: (err as Error).message,
      stack: (err as Error).stack,
    })
  }
}

// A callback parameter annotated with a non-error type is not an Error object.
validator.on('invalid', (error: string) => {
  logger.error(JSON.stringify({ error }))
})

// Array iteration callbacks receive elements, not errors.
export const issues = result.errors.map((error) => JSON.stringify(error))

// message / stack taken from the error itself travel alongside the nested object.
export async function handlerSafe(): Promise<void> {
  try {
    await doWork()
  } catch (error) {
    res.status(500).json({ message: (error as Error).message, error })
  }
}
