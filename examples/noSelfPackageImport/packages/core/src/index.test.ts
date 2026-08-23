// A test inside the package may exercise the public entry as consumers see it.
import { add } from '@demo/core'

export const check = (): boolean => add(1, 1) === 2
