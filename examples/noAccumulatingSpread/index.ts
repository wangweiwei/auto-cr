type Item = { id: number; tags: string[] }
declare const items: Item[]

// reduce: array spread of the accumulator on every iteration.
const ids = items.reduce<number[]>((acc, item) => [...acc, item.id], [])

// reduce: object spread of the accumulator.
const byId = items.reduce<Record<number, Item>>((acc, item) => ({ ...acc, [item.id]: item }), {})

// reduceRight with a function expression.
const reversed = items.reduceRight<number[]>(function (acc, item) {
  return [...acc, item.id]
}, [])

// Loop-carried variable reassigned from its own spread.
let collected: number[] = []
for (const item of items) {
  collected = [...collected, item.id]
}

// Same pattern inside a hot callback.
let index: Record<number, Item> = {}
items.forEach((item) => {
  index = { ...index, [item.id]: item }
})

// --- Compliant ---

// Mutate the accumulator in place.
const idsFast = items.reduce<number[]>((acc, item) => {
  acc.push(item.id)
  return acc
}, [])

// Spreading something other than the accumulator is fine.
const tags = items.reduce<string[]>((acc, item) => {
  acc.push(...item.tags)
  return acc
}, [])

// Spread once, outside the loop.
const merged = [...collected, ...idsFast]

// A shadowed parameter is not the accumulator.
const shadowed = items.reduce<number[]>((acc, item) => {
  const pick = (acc: number[]) => [...acc, item.id]
  void pick
  return acc
}, [])

void ids
void byId
void reversed
void index
void tags
void merged
void shadowed
