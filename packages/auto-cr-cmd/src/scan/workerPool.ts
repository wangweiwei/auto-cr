import path from 'path'
import { Worker } from 'worker_threads'
import type { AnalyzeFileSummary, Notification } from './types'
import type { WorkerInitData, WorkerInboundMessage, WorkerOutboundMessage } from './workerTypes'

export interface WorkerFileResult {
  id: number
  filePath: string
  summary: AnalyzeFileSummary
  logs: Notification[]
}

export interface WorkerPoolOptions {
  files: string[]
  workerCount: number
  initData: WorkerInitData
  onResult: (result: WorkerFileResult) => void
}

// 创建 worker 池并分发任务，结果通过回调抛给主线程处理。
export async function runWorkerPool(options: WorkerPoolOptions): Promise<void> {
  const { files, workerCount, initData, onResult } = options

  if (files.length === 0) {
    return
  }

  const { entry, execArgv } = resolveWorkerEntry()
  // 用 index 作为任务 ID，主线程可按 ID 还原扫描顺序。
  const tasks = files.map((filePath, index) => ({ id: index, filePath }))
  const workers: Worker[] = []
  let nextTaskIndex = 0
  let completed = 0

  // 不论成功/失败都终止 worker，避免孤儿线程占用资源。
  const terminateAll = async (): Promise<void> => {
    await Promise.all(workers.map((worker) => worker.terminate()))
  }

  // 将任务分配给空闲 worker；无任务时发送 shutdown。
  const assignTask = (worker: Worker): void => {
    if (nextTaskIndex >= tasks.length) {
      const shutdown: WorkerInboundMessage = { type: 'shutdown' }
      worker.postMessage(shutdown)
      return
    }

    const task = tasks[nextTaskIndex]
    nextTaskIndex += 1
    const message: WorkerInboundMessage = {
      type: 'analyze',
      id: task.id,
      filePath: task.filePath,
    }
    worker.postMessage(message)
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false

    // 只允许 resolve/reject 一次，避免重复触发导致未捕获异常。
    const finish = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }

    const startWorker = (): Worker => {
      const worker = new Worker(entry, {
        workerData: initData,
        execArgv: execArgv.length > 0 ? execArgv : undefined,
      })

      worker.on('message', (payload: WorkerOutboundMessage) => {
        if (payload.type === 'error') {
          finish(new Error(payload.message))
          return
        }

        // 把单文件结果交回主线程，由主线程决定输出/汇总策略。
        onResult({
          id: payload.id,
          filePath: payload.filePath,
          summary: payload.summary,
          logs: payload.logs,
        })

        completed += 1
        if (completed >= tasks.length) {
          finish()
          return
        }

        assignTask(worker)
      })

      worker.on('error', (error) => {
        finish(error instanceof Error ? error : new Error(String(error)))
      })

      worker.on('exit', (code) => {
        // 非 0 退出视为异常，且只在任务未完成时失败。
        if (code !== 0 && completed < tasks.length) {
          finish(new Error(`Worker exited with code ${code}`))
        }
      })

      assignTask(worker)
      return worker
    }

    const actualCount = Math.max(1, Math.min(workerCount, tasks.length))
    for (let index = 0; index < actualCount; index += 1) {
      workers.push(startWorker())
    }
  }).finally(async () => {
    await terminateAll()
  })
}

// Worker 入口解析：开发态使用 ts-node，构建产物直接使用 JS。
function resolveWorkerEntry(): { entry: string; execArgv: string[] } {
  if (__filename.endsWith('.ts')) {
    // 开发态：worker 需要加载 ts-node 才能执行 TypeScript。
    return {
      entry: path.resolve(__dirname, 'worker.ts'),
      execArgv: ['-r', 'ts-node/register'],
    }
  }

  // 生产构建：直接运行编译后的 JS 文件。
  return {
    entry: path.resolve(__dirname, 'worker.js'),
    execArgv: [],
  }
}
