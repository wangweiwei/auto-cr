import type { Rule } from '../types'
import { noDeepRelativeImports } from './noDeepRelativeImports'
import { noCircularDependencies } from './noCircularDependencies'
import { noSwallowedErrors } from './noSwallowedErrors'
import { noCrossPackagePrivateImports } from './noCrossPackagePrivateImports'
import { noCatastrophicRegex } from './noCatastrophicRegex'
import { noDeepCloneInLoop } from './noDeepCloneInLoop'
import { noN2ArrayLookup } from './noN2ArrayLookup'

// 内置规则列表，按默认顺序执行。
export const builtinRules: Rule[] = [
  noDeepRelativeImports,
  noCircularDependencies,
  noSwallowedErrors,
  noCrossPackagePrivateImports,
  noCatastrophicRegex,
  noDeepCloneInLoop,
  noN2ArrayLookup,
]

export {
  noDeepRelativeImports,
  noCircularDependencies,
  noSwallowedErrors,
  noCrossPackagePrivateImports,
  noCatastrophicRegex,
  noDeepCloneInLoop,
  noN2ArrayLookup,
}
