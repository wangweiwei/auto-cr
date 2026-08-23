import type { User } from './types'

export const displayName = (user: User): string => user.name.trim()
