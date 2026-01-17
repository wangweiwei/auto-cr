import type { Rule } from '../types'
import { noDeepRelativeImports } from './noDeepRelativeImports'
import { noCircularDependencies } from './noCircularDependencies'
import { noSwallowedErrors } from './noSwallowedErrors'

// 内置规则列表，按默认顺序执行。
export const builtinRules: Rule[] = [noDeepRelativeImports, noCircularDependencies, noSwallowedErrors]

export { noDeepRelativeImports, noCircularDependencies, noSwallowedErrors }
