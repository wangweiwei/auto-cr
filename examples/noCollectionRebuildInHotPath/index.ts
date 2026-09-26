type User = { id: number; tags: string[]; active: boolean }

declare const users: User[]
declare const admins: User[]
declare const ids: number[]
declare const allowedCsv: string
declare const schema: Record<string, unknown>
declare const rows: Array<{ key: string; value: number }>

// Rebuilt for every user: admins never changes inside the callback.
export const adminUsers = users.filter((user) => admins.map((admin) => admin.id).includes(user.id))

// A Set built per element defeats the purpose of using a Set.
export const picked = users.filter((user) => new Set(ids).has(user.id))

// Splitting the same string on every iteration.
export const allowedTags = users.flatMap((user) =>
  user.tags.filter((tag) => allowedCsv.split(',').includes(tag))
)

// Recomputed in the loop condition on every iteration.
export function walkSchema(): void {
  for (let i = 0; i < Object.keys(schema).length; i++) {
    console.log(i)
  }
}

// Assigned to a per-iteration const that is only read.
export function markKnown(): string[] {
  const known: string[] = []
  for (const row of rows) {
    const keys = Object.keys(schema)
    if (keys.includes(row.key)) {
      known.push(row.key)
    }
  }
  return known
}

// --- Compliant ---

// Built once, reused for every lookup.
const adminIds = new Set(admins.map((admin) => admin.id))
export const adminUsersFast = users.filter((user) => adminIds.has(user.id))

// Depends on the current element, so it has to be computed per iteration.
export const activeTagCounts = users.map(
  (user) => user.tags.filter((tag) => tag.startsWith('a')).length
)

// A fresh copy per iteration that is then mutated on purpose.
export function withExtra(base: string[]): string[][] {
  const result: string[][] = []
  for (const row of rows) {
    const copy = base.slice()
    copy.push(row.key)
    result.push(copy)
  }
  return result
}

// The source array is mutated inside the loop, so the rebuild is not redundant.
export function drain(queue: number[]): void {
  for (const id of ids) {
    queue.push(id)
    if (new Set(queue).has(-1)) {
      break
    }
  }
}
