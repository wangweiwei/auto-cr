import type { Span } from '@swc/types'
import { getTranslator } from '../i18n'
import consola from 'consola'

export interface Reporter {
  error(message: string): void
  errorAtSpan(span: Span | SpanCarrier | undefined, message: string): void
  errorAtLine(line: number | undefined, message: string): void
}

interface SpanCarrier {
  span?: Span
}

type LineOffsets = number[]

export function createReporter(filePath: string, source: string): Reporter {
  const offsets = buildLineOffsets(source)
  const t = getTranslator()
  const errorLabel = t.reporterErrorLabel()

  const error = (message: string): void => {
    consola.error(`[${errorLabel}] ${filePath} ${message}`)
  }

  const errorAtLine = (line: number | undefined, message: string): void => {
    if (typeof line === 'number') {
      consola.error(`[${errorLabel}] ${filePath}:${line} ${message}`)
    } else {
      error(message)
    }
  }

  const errorAtSpan = (spanLike: Span | SpanCarrier | undefined, message: string): void => {
    const span = extractSpan(spanLike)

    if (!span) {
      error(message)
      return
    }

    const line = offsetToLine(span.start, offsets)
    errorAtLine(line, message)
  }

  return { error, errorAtSpan, errorAtLine }
}

function extractSpan(spanLike: Span | SpanCarrier | undefined): Span | undefined {
  if (!spanLike) {
    return undefined
  }

  if (hasSpan(spanLike)) {
    return spanLike.span
  }

  return spanLike as Span
}

function hasSpan(value: Span | SpanCarrier): value is SpanCarrier {
  return typeof value === 'object' && value !== null && 'span' in value
}

function buildLineOffsets(source: string): LineOffsets {
  const offsets: number[] = [0]

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      offsets.push(index + 1)
    }
  }

  return offsets
}

function offsetToLine(offset: number, offsets: LineOffsets): number {
  let low = 0
  let high = offsets.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const current = offsets[mid]

    if (current === offset) {
      return mid + 1
    }

    if (current < offset) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return high + 1
}
