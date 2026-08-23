import { displayName } from './utils'

export const check = (): boolean => displayName({ id: 1, name: ' a ' }) === 'a'
