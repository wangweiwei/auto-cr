import type { Rule } from '../types'
import { noDeepRelativeImports } from './noDeepRelativeImports'
import { noSwallowedErrors } from './noSwallowedErrors'

export const builtinRules: Rule[] = [noDeepRelativeImports, noSwallowedErrors]

export { noDeepRelativeImports, noSwallowedErrors }
