import type { Rule } from '../types'
import { noDeepRelativeImports } from './noDeepRelativeImports'
import { noCircularDependencies } from './noCircularDependencies'
import { noSwallowedErrors } from './noSwallowedErrors'

export const builtinRules: Rule[] = [noDeepRelativeImports, noCircularDependencies, noSwallowedErrors]

export { noDeepRelativeImports, noCircularDependencies, noSwallowedErrors }
