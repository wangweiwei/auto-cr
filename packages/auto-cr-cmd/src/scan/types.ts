import type { ViolationRecord } from '../report'

// 日志级别：与 consola 输出级别保持一致。
export type NotificationLevel = 'info' | 'warn' | 'error'

// 记录扫描过程中的提示/告警/错误，便于 JSON 输出或 UI 展示。
export interface Notification {
  level: NotificationLevel
  message: string
  detail?: string
}

// 统一日志函数签名，便于主线程与 worker 复用。
export type Logger = (level: NotificationLevel, message: string, detail?: unknown) => void

export interface FileSeveritySummary {
  error: number
  warning: number
  optimizing: number
}

export interface AnalyzeFileSummary {
  severityCounts: FileSeveritySummary
  totalViolations: number
  errorViolations: number
  violations: ReadonlyArray<ViolationRecord>
}
