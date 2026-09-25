type Filters = { status?: string; page: number }

declare const prev: Filters
declare const next: Filters
declare function isDeepStrictEqual(a: unknown, b: unknown): boolean

// Order-sensitive and lossy equality checks.
export const changed = JSON.stringify(prev) !== JSON.stringify(next)

export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// --- Compliant ---

export const changedDeep = !isDeepStrictEqual(prev, next)

// Comparing specific fields.
export const samePage = prev.page === next.page

// An array replacer fixes the key order on purpose.
const KEYS = ['page', 'status']
export const sameKeys = JSON.stringify(prev, KEYS) === JSON.stringify(next, KEYS)

// Comparing against a serialized snapshot is a different pattern.
declare const snapshot: string
export const unchanged = JSON.stringify(next) === snapshot
