import type { RuleSettingInput } from '../config/autocrrc'
import type { AnalyzeFileSummary, Notification } from './types'

// Worker 启动参数：由主线程传入，用于初始化规则与解析配置。
export interface WorkerInitData {
  ruleDir?: string
  ruleSettings?: Record<string, RuleSettingInput>
  language: string
  tsconfigPath?: string
}

// 主线程 -> worker：请求分析单个文件。
export interface WorkerTaskMessage {
  type: 'analyze'
  id: number
  filePath: string
}

// 主线程 -> worker：结束信号。
export interface WorkerShutdownMessage {
  type: 'shutdown'
}

// worker -> 主线程：返回单文件扫描结果与日志记录。
export interface WorkerResultMessage {
  type: 'result'
  id: number
  filePath: string
  summary: AnalyzeFileSummary
  logs: Notification[]
}

// worker -> 主线程：发生不可恢复错误。
export interface WorkerErrorMessage {
  type: 'error'
  id: number
  filePath: string
  message: string
}

export type WorkerInboundMessage = WorkerTaskMessage | WorkerShutdownMessage
export type WorkerOutboundMessage = WorkerResultMessage | WorkerErrorMessage
