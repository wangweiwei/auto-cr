// A test file importing helpers and mocks is normal and is not reported.
import { listUsers } from './service'
import { makeUser } from './__tests__/helpers'
import { fakeDb } from './__mocks__/db'

export const run = (): number => listUsers().length + fakeDb.users.length + (makeUser('x') ? 1 : 0)
