import type { ShiftSummary } from './types'

// 值守数据（统计规则版本 + 交接班摘要）单独存一份 localStorage。
// 摘要要在多块终端之间抢占锁定，每次读写都直接打 storage，不走 entries 那份的内存缓存，
// 否则另一块终端已经锁定的班次在这边看不出来。
const DUTY_STORAGE_KEY = 'hydrology-monitor-station:duty'

// 流域清单：监测记录用「所属流域」字段归属，没划分的记录归入「未划分流域」。
export const BASINS = ['长江流域', '黄河流域', '珠江流域']

// 值守台并排对比的四类监测：模块 key + 观测时刻字段名。
export const MONITOR_MODULES = [
  { key: 'waterlevel', name: '水位监测', timeField: '观测时间' },
  { key: 'rainfall', name: '雨量观测', timeField: '观测时段' },
  { key: 'discharge', name: '流量监测', timeField: '测量时间' },
  { key: 'groundwater', name: '地下水观测', timeField: '观测日期' },
]

// 统计规则版本：升级后只重算未锁定班次，已归档班次继续展示锁定时的版本与结果。
export const RULE_VERSIONS = [
  { version: 1, name: '主汛期值守规则', desc: '未处理量只统计待处理记录' },
  { version: 2, name: '秋汛修订规则', desc: '异常记录一并计入未处理量' },
]

export const LATEST_RULE_VERSION = RULE_VERSIONS[RULE_VERSIONS.length - 1].version

export type DutyStorage = {
  ruleVersion: number
  summaries: ShiftSummary[]
}

function fallback(): DutyStorage {
  return { ruleVersion: 1, summaries: [] }
}

export function readDuty(): DutyStorage {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback()
  }
  const raw = window.localStorage.getItem(DUTY_STORAGE_KEY)
  if (!raw) {
    return fallback()
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DutyStorage>
    return {
      ruleVersion: Number(parsed.ruleVersion) || 1,
      summaries: Array.isArray(parsed.summaries) ? (parsed.summaries as ShiftSummary[]) : [],
    }
  } catch {
    return fallback()
  }
}

export function writeDuty(data: DutyStorage): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(DUTY_STORAGE_KEY, JSON.stringify(data))
  }
}

export function dutyStorageKey(): string {
  return DUTY_STORAGE_KEY
}
