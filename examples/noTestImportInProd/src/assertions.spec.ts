import type { User } from './types'

export const expectUser = (user: User): boolean => user.id > 0
