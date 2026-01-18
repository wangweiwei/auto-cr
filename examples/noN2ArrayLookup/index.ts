const catalog = ['alpha', 'beta', 'gamma']
const orders = ['beta', 'delta', 'alpha']

for (const order of orders) {
  // Linear lookup inside a loop.
  if (catalog.includes(order)) {
    console.log('found', order)
  }
}

const ids = [10, 20, 30]
const users = [
  { id: 10, name: 'Ada' },
  { id: 40, name: 'Lin' },
]

const matches = users.map((user) => {
  // Linear lookup inside a hot callback.
  const hit = ids.find((id) => id === user.id)
  return hit ?? null
})

console.log(matches)
