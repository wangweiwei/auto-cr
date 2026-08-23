// Another package importing @demo/core by name is the normal cross-package form.
import { add } from '@demo/core'

export const main = (): number => add(2, 3)
