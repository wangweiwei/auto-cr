import type { Rule } from '../types'
import { noDeepRelativeImports } from './noDeepRelativeImports'

export const builtinRules: Rule[] = [noDeepRelativeImports]

export { noDeepRelativeImports }
