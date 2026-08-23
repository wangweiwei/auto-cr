import type { Rule } from '../types'
import { noDeepRelativeImports } from './noDeepRelativeImports'
import { noCircularDependencies } from './noCircularDependencies'
import { noSwallowedErrors } from './noSwallowedErrors'
import { noLayerViolations } from './noLayerViolations'
import { noCrossPackagePrivateImports } from './noCrossPackagePrivateImports'
import { noCatastrophicRegex } from './noCatastrophicRegex'
import { noBlockingApiInHotPath } from './noBlockingApiInHotPath'
import { noDeepCloneInLoop } from './noDeepCloneInLoop'
import { noN2ArrayLookup } from './noN2ArrayLookup'
import { noAsyncForEach } from './noAsyncForEach'
import { noAccumulatingSpread } from './noAccumulatingSpread'

// 内置规则列表，按默认顺序执行。
export const builtinRules: Rule[] = [
  noDeepRelativeImports,
  noCircularDependencies,
  noSwallowedErrors,
  noLayerViolations,
  noCrossPackagePrivateImports,
  noCatastrophicRegex,
  noBlockingApiInHotPath,
  noDeepCloneInLoop,
  noN2ArrayLookup,
  noAsyncForEach,
  noAccumulatingSpread,
]

export {
  noDeepRelativeImports,
  noCircularDependencies,
  noSwallowedErrors,
  noLayerViolations,
  noCrossPackagePrivateImports,
  noCatastrophicRegex,
  noBlockingApiInHotPath,
  noDeepCloneInLoop,
  noN2ArrayLookup,
  noAsyncForEach,
  noAccumulatingSpread,
}
