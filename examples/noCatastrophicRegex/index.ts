const samples = ['aaaaaaaaaaaa!', 'aaaaab']

for (const sample of samples) {
  // Nested unbounded quantifiers in a hot loop.
  const risky = /(a+)+$/
  if (risky.test(sample)) {
    console.log('matched', sample)
  }
}

const inputs = ['aaaa', 'bbb']

inputs.forEach((value) => {
  // Static RegExp constructor with nested unbounded quantifiers.
  const re = new RegExp('(a+)+$')
  re.test(value)
})
