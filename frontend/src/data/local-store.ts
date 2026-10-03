import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'
const SEED_VERSION_KEY = 'hydrology-monitor-station:seed-version'
// 播种版本：调整示例数据时 +1，老浏览器缓存里的对应模块会整体换种。
const SEED_VERSION = 2
// 本次换种的模块：汛情值守台依赖站点与四类监测记录之间的流域关联。
const RESEED_MODULES = ['station', 'waterlevel', 'rainfall', 'discharge', 'groundwater']

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function migrateSeeds(entries: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return entries
  }
  const stored = Number(window.localStorage.getItem(SEED_VERSION_KEY) ?? '0')
  if (stored >= SEED_VERSION) {
    return entries
  }
  const next = { ...entries }
  for (const key of RESEED_MODULES) {
    next[key] = clone(SEED_ROWS[key] ?? [])
  }
  window.localStorage.setItem(SEED_VERSION_KEY, String(SEED_VERSION))
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(SEED_VERSION_KEY, String(SEED_VERSION))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return migrateSeeds({ ...fallback, ...parsed })
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(SEED_VERSION_KEY, String(SEED_VERSION))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
