type Row = { amount: number; createdAt: Date; name: string; locale: string }

declare const rows: Row[]
declare const query: string

// A new currency formatter for every row.
export const amounts = rows.map((row) =>
  row.amount.toLocaleString('zh-CN', { style: 'currency', currency: 'CNY' })
)

// A new date formatter for every row.
export function printDates(): void {
  for (const row of rows) {
    console.log(
      row.createdAt.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    )
  }
}

// `undefined` locale with options still builds a formatter each time.
export const fixed = rows.map((row) =>
  row.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })
)

// A new collator for every comparison.
export const matches = rows.filter(
  (row) => row.name.localeCompare(query, 'zh', { sensitivity: 'base' }) === 0
)

// --- Compliant ---

// Formatter created once and reused.
const currency = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' })
export const amountsFast = rows.map((row) => currency.format(row.amount))

// No arguments: engines cache the default formatter.
export const plain = rows.map((row) => row.amount.toLocaleString())

// The locale changes per row, so the call cannot simply be hoisted.
export const perRowLocale = rows.map((row) => row.amount.toLocaleString(row.locale))

// Outside any loop or callback.
export const total = rows.length.toLocaleString('zh-CN')
