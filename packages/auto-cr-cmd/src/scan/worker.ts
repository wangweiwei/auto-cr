import { parentPort, workerData } from 'worker_threads'
import { setLanguage } from '../i18n'
import { setTsConfigPath } from '../config'
import { applyRuleConfig } from '../config/autocrrc'
import { loadCustomRules } from '../rules/loader'
import { analyzeFile } from './analyzeFile'
import { loadRulesRuntime } from './runtime'
import type { Logger, Notification, NotificationLevel } from './types'
import type { WorkerInboundMessage, WorkerInitData, WorkerOutboundMessage } from './workerTypes'

const initData = workerData as WorkerInitData

// 初始化 worker 环境：语言、tsconfig 与规则运行时需与主线程保持一致。
setLanguage(initData.language)
setTsConfigPath(initData.tsconfigPath)

// Worker 内部同样走 runtime 解析，保证内置规则与主线程一致。
const rulesRuntime = loadRulesRuntime()
const builtinRules = rulesRuntime.builtinRules
const createRuleContext = rulesRuntime.createRuleContext
// 自定义规则加载失败不在 worker 中输出，避免多 worker 重复日志。
const customRules = loadCustomRules(initData.ruleDir, { onWarning: () => {} })
// 规则配置在 worker 中生效，确保与主线程扫描结果一致。
const rules = applyRuleConfig([...builtinRules, ...customRules], initData.ruleSettings, () => {})

const port = parentPort

if (!port) {
  process.exit(0)
}

// 与主线程一致的日志规范化：只收集，不直接输出。
const createNotification = (level: NotificationLevel, message: string, detail?: unknown): Notification => {
  let detailText: string | undefined

  if (detail !== undefined) {
    if (detail instanceof Error) {
      detailText = detail.message
    } else if (typeof detail === 'string') {
      detailText = detail
    } else {
      try {
        detailText = JSON.stringify(detail)
      } catch {
        detailText = String(detail)
      }
    }
  }

  return { level, message, detail: detailText }
}

port.on('message', async (message: WorkerInboundMessage) => {
  if (message.type === 'shutdown') {
    // 主线程告知退出：释放端口并结束进程。
    port.close()
    process.exit(0)
    return
  }

  const { id, filePath } = message
  const logs: Notification[] = []
  // 只收集日志，不直接输出，保持主线程统一渲染。
  const log: Logger = (level, msg, detail) => {
    logs.push(createNotification(level, msg, detail))
  }

  try {
    // format 固定为 json，确保 worker 不直接输出。
    const summary = await analyzeFile(filePath, rules, 'json', log, createRuleContext)
    const payload: WorkerOutboundMessage = {
      type: 'result',
      id,
      filePath,
      summary,
      logs,
    }
    port.postMessage(payload)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const payload: WorkerOutboundMessage = {
      type: 'error',
      id,
      filePath,
      message: detail,
    }
    port.postMessage(payload)
  }
})
