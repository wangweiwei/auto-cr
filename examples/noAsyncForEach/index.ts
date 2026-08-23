declare const save: (id: number) => Promise<void>
declare const load: (id: number) => Promise<string>

const ids = [1, 2, 3]

// Async arrow callback: forEach drops the returned promise.
ids.forEach(async (id) => {
  await save(id)
})

// Async function expression is just as broken.
ids.forEach(async function (id) {
  await save(id)
})

// Nested inside another hot callback: still reported.
ids.map((id) => {
  ;[id].forEach(async (inner) => {
    await save(inner)
  })
  return id
})

// Even without await, an async callback turns sync throws into unhandled rejections.
ids.forEach(async (id) => {
  if (id > 2) throw new Error('too large')
})

// --- Compliant ---

// Sequential: for...of with await.
const runSequentially = async (): Promise<void> => {
  for (const id of ids) {
    await save(id)
  }
}

// Concurrent: Promise.all over map.
const runConcurrently = async (): Promise<string[]> => {
  return Promise.all(ids.map(async (id) => load(id)))
}

// Plain synchronous forEach is fine.
ids.forEach((id) => {
  console.log(id)
})

void runSequentially
void runConcurrently
