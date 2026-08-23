// Importing the package's own root entry by name.
import { add } from '@demo/core'
// Importing a subpath of the package's own name.
import { add as addViaSubpath } from '@demo/core/utils'
// Relative import inside the same package is the correct form.
import { add as addLocal } from './utils'

// Re-exporting from the package's own name ships the built copy through the barrel.
export { add as reexported } from '@demo/core'

// Dynamic imports are checked too.
export const loadSelf = () => import('@demo/core')

export const total = (): number => add(1, 2) + addViaSubpath(3, 4) + addLocal(5, 6)
