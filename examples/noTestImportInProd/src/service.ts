import type { User } from './types'
// Test helper pulled into production code.
import { makeUser } from './__tests__/helpers'
// Mock implementation pulled into production code.
import { fakeDb } from './__mocks__/db'
// Fixture data from the top-level test directory.
import { sampleUsers } from '../test/fixtures'

// Re-exporting from a spec file ships it with the production barrel.
export { expectUser } from './assertions.spec'

// Dynamic imports are checked too.
export const loadSpec = () => import('./utils.spec')

export const listUsers = (): User[] => [...sampleUsers, makeUser('prod'), ...fakeDb.users]
