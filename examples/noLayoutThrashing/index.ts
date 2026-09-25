declare const items: HTMLElement[]
declare const panel: HTMLElement

// Read then write on every iteration: each read forces a synchronous reflow.
export function autoHeight(): void {
  for (const item of items) {
    item.style.height = `${item.scrollHeight}px`
  }
}

// Same problem inside an array callback, with a class change as the write.
export function markOverflowing(): void {
  items.forEach((item) => {
    if (item.getBoundingClientRect().width > panel.clientWidth) {
      item.classList.add('overflowing')
    }
  })
}

// --- Compliant ---

// Batch the reads first, then the writes.
export function autoHeightBatched(): void {
  const heights = items.map((item) => item.scrollHeight)
  items.forEach((item, index) => {
    item.style.height = `${heights[index]}px`
  })
}

// Reads only.
export function measure(): number {
  let total = 0
  for (const item of items) {
    total += item.offsetHeight
  }
  return total
}

// Writes only.
export function hideAll(): void {
  for (const item of items) {
    item.style.display = 'none'
  }
}
