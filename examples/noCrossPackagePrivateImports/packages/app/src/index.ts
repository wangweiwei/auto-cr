import { sharedValue } from '@demo/shared'
import { publicValue } from '@demo/shared/public'
import { internalValue } from '@demo/shared/src/internal'
import { internalValue as relativeInternalValue } from '../../shared/src/internal'

console.log(sharedValue, publicValue, internalValue, relativeInternalValue)
