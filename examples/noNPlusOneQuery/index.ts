type User = { id: string; teamId: string }

declare const prisma: {
  user: {
    findUnique(args: unknown): Promise<User | null>
    findMany(args: unknown): Promise<User[]>
    update(args: unknown): Promise<User>
  }
  post: { findMany(args: unknown): Promise<unknown[]> }
}
declare const UserModel: { findById(id: string): Promise<User | null> }
declare const pool: { query(sql: string, params?: unknown[]): Promise<unknown> }
declare const redis: {
  get(key: string): Promise<string | null>
  mget(keys: string[]): Promise<Array<string | null>>
}
declare const userRepository: {
  save(user: User): Promise<User>
  findBy(where: unknown): Promise<User[]>
}
declare function In<T>(values: T[]): unknown

// One query per user inside a loop.
export async function loadPosts(users: User[]): Promise<unknown[][]> {
  const result: unknown[][] = []
  for (const user of users) {
    result.push(await prisma.post.findMany({ where: { authorId: user.id } }))
  }
  return result
}

// Promise.all does not help: still one round-trip per id.
export function loadUsers(ids: string[]): Promise<Array<User | null>> {
  return Promise.all(ids.map((id) => UserModel.findById(id)))
}

// Raw SQL per row.
export function loadTeams(users: User[]): Promise<unknown[]> {
  return Promise.all(
    users.map((user) => pool.query('SELECT * FROM teams WHERE id = $1', [user.teamId]))
  )
}

// Redis GET per key.
export function readFlags(keys: string[]): Promise<Array<string | null>> {
  return Promise.all(keys.map((key) => redis.get(key)))
}

// One write per entity.
export async function saveAll(users: User[]): Promise<void> {
  for (const user of users) {
    await userRepository.save(user)
  }
}

// --- Compliant ---

// One batched query, then an in-memory lookup.
export async function loadUsersBatched(ids: string[]): Promise<Array<User | undefined>> {
  const users = await prisma.user.findMany({ where: { id: { in: ids } } })
  const byId = new Map(users.map((user) => [user.id, user]))
  return ids.map((id) => byId.get(id))
}

// Chunked batches are the fix for very large id lists.
export async function loadInChunks(chunks: string[][]): Promise<User[]> {
  const result: User[] = []
  for (const chunk of chunks) {
    result.push(...(await prisma.user.findMany({ where: { id: { in: chunk } } })))
  }
  return result
}

// SQL with IN / ANY and TypeORM In() are batched queries.
export function loadTeamsBatched(teamIdGroups: string[][]): Promise<unknown[]> {
  return Promise.all(
    teamIdGroups.map((group) => pool.query('SELECT * FROM teams WHERE id = ANY($1)', [group]))
  )
}
export function findByGroups(groups: string[][]): Promise<User[][]> {
  return Promise.all(groups.map((group) => userRepository.findBy({ id: In(group) })))
}

// Batch Redis commands.
export function readFlagsBatched(keyGroups: string[][]): Promise<Array<Array<string | null>>> {
  return Promise.all(keyGroups.map((keys) => redis.mget(keys)))
}

// Array#find is not a database call.
export function pick(users: User[], ids: string[]): Array<User | undefined> {
  return ids.map((id) => users.find((user) => user.id === id))
}
