const payloads = [
  { id: 1, meta: { scope: 'admin' } },
  { id: 2, meta: { scope: 'user' } },
]

for (const payload of payloads) {
  // Deep cloning inside a loop.
  const clone = structuredClone(payload)
  console.log(clone.id)
}

const items = [
  { id: 3, meta: { scope: 'guest' } },
]

items.map((item) => {
  // JSON deep clone inside a hot callback.
  const copy = JSON.parse(JSON.stringify(item))
  return copy
})
