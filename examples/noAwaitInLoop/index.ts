declare const ids: number[]
declare const table: Record<string, number>
declare const save: (id: number) => Promise<void>
declare const load: (id: number) => Promise<string>
declare const sync: (key: string, value: number) => Promise<void>
declare const check: (id: number) => Promise<boolean>
declare const done: () => boolean
declare const sleep: (ms: number) => Promise<void>
declare const stream: () => AsyncIterable<string>
declare const handle: (chunk: string) => Promise<void>
declare const step: (state: number, id: number) => Promise<number>

// Each iteration waits for the previous save to finish.
export const saveAll = async (): Promise<void> => {
  for (const id of ids) {
    await save(id)
  }
}

// Classic index loop, same problem.
export const loadAll = async (): Promise<string[]> => {
  const results: string[] = []
  for (let i = 0; i < ids.length; i += 1) {
    results.push(await load(ids[i]))
  }
  return results
}

// for...in over keys.
export const syncAll = async (): Promise<void> => {
  for (const key in table) {
    await sync(key, table[key])
  }
}

// --- Compliant ---

// Independent iterations run concurrently.
export const saveConcurrently = async (): Promise<void> => {
  await Promise.all(ids.map(async (id) => save(id)))
}

// for await consumes an async iterable sequentially by design.
export const consume = async (): Promise<void> => {
  for await (const chunk of stream()) {
    await handle(chunk)
  }
}

// Condition-driven polling is sequential by design.
export const waitUntilDone = async (): Promise<void> => {
  while (!done()) {
    await sleep(50)
  }
}

// Early exit: the first successful load wins, so later iterations must not start.
export const loadFirst = async (): Promise<string | null> => {
  for (const id of ids) {
    try {
      return await load(id)
    } catch {
      continue
    }
  }
  return null
}

// break after an awaited check is also an early exit.
export const findInvalid = async (): Promise<number | null> => {
  let found: number | null = null
  for (const id of ids) {
    if (!(await check(id))) {
      found = id
      break
    }
  }
  return found
}

// Awaiting inside a nested async function is the concurrent pattern itself.
export const scheduleAll = (): Array<() => Promise<void>> => {
  const tasks: Array<() => Promise<void>> = []
  for (const id of ids) {
    tasks.push(async () => {
      await save(id)
    })
  }
  return tasks
}

// Loop-carried state: each step consumes the previous result, so it cannot run concurrently.
export const fold = async (): Promise<number> => {
  let state = 0
  for (const id of ids) {
    state = await step(state, id)
  }
  return state
}
