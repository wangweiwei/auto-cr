declare const lines: string[]
declare const prefix: string
declare const flags: string

// Constant pattern rebuilt on every iteration of a for...of loop.
for (const line of lines) {
  if (new RegExp('^\\d+$').test(line)) {
    console.log(line)
  }
}

// Same inside an array callback, without `new` and with literal flags.
const errors = lines.filter((line) => RegExp('error', 'i').test(line))

// A template literal without interpolation is still a constant.
let index = 0
while (index < lines.length) {
  const matcher = new RegExp(`^foo$`)
  if (matcher.test(lines[index])) break
  index += 1
}

// --- Compliant ---

// Hoisted once, reused inside the loop.
const DIGITS = /^\d+$/
for (const line of lines) {
  if (DIGITS.test(line)) console.log(line)
}

// The pattern depends on per-iteration data and cannot be hoisted.
for (const line of lines) {
  const dynamic = new RegExp(line)
  void dynamic
}

// An interpolated template is dynamic.
const prefixed = lines.map((line) => new RegExp(`^${prefix}`).test(line))

// Dynamic flags make the construction non-constant as well.
const flagged = lines.map((line) => new RegExp('x', flags).test(line))

// Constructing outside any hot path is fine.
const once = new RegExp('^once$')

// Regex literals are compiled once per site; they are outside this rule's scope.
const literalHits = lines.filter((line) => /literal/.test(line))

void errors
void prefixed
void flagged
void once
void literalHits
