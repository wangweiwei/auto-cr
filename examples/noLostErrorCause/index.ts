declare const load: () => Promise<string>
declare const parse: (raw: string) => unknown
declare const cleanup: () => void
declare const logger: { error: (...args: unknown[]) => void }

class AppError extends Error {}

// The caught error is never used: its stack, message and cause chain are all lost.
export const loadConfig = async (): Promise<string> => {
  try {
    return await load()
  } catch (error) {
    throw new Error('failed to load config')
  }
}

// Omitted catch binding: the original error is unreachable by construction.
export const parseConfig = (raw: string): unknown => {
  try {
    return parse(raw)
  } catch {
    throw new Error('failed to parse config')
  }
}

// Other statements in the catch change nothing if the error itself stays unused.
export const loadWithCleanup = async (): Promise<string> => {
  try {
    return await load()
  } catch (err) {
    cleanup()
    throw new AppError('load aborted')
  }
}

// Every throw on the path loses the original error, so each one is reported.
export const loadStrict = async (mode: 'fast' | 'safe'): Promise<string> => {
  try {
    return await load()
  } catch (error) {
    if (mode === 'fast') {
      throw new Error('fast load failed')
    }
    throw new Error('safe load failed')
  }
}

// --- Compliant ---

// Chain the original error with { cause }.
export const loadChained = async (): Promise<string> => {
  try {
    return await load()
  } catch (error) {
    throw new Error('failed to load config', { cause: error })
  }
}

// Rethrow the original error as-is.
export const loadPassthrough = async (): Promise<string> => {
  try {
    return await load()
  } catch (error) {
    cleanup()
    throw error
  }
}

// Logging the original error counts as handling it.
export const loadLogged = async (): Promise<string> => {
  try {
    return await load()
  } catch (error) {
    logger.error('load failed', error)
    throw new Error('failed to load config')
  }
}

// Destructuring the caught error is itself a use.
export const parseWithMessage = (raw: string): unknown => {
  try {
    return parse(raw)
  } catch ({ message }) {
    throw new Error(`failed to parse config: ${message}`)
  }
}

// Nested try: the inner catch has its own binding and is judged on its own.
export const loadNested = async (): Promise<string> => {
  try {
    return await load()
  } catch (outer) {
    try {
      cleanup()
    } catch (inner) {
      throw new Error('cleanup failed', { cause: inner })
    }
    throw outer
  }
}
