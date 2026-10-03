import {
  BASINS,
  DEFAULT_RULE_VERSION,
  DUTY_MODULES,
  UNGROUPED_BASIN,
  WELL_STATION_MAP,
} from '@/data/duty'
import type { BasinRecord, BasinStat, DutySummary } from '@/data/duty'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 交接班摘要单独存一个 localStorage 键，并且每次读写都直接走 localStorage：
// 两块终端（两个标签页）同时操作时，提交那一刻读到的必须是对方已经落库的版本。
const DUTY_STORAGE_KEY = 'hydrology-monitor-station:duty-summaries'

type DutyStorage = {
  ruleVersion: string
  summaries: DutySummary[]
}

export type SubmitSummaryResult = ActionResult & { conflict: boolean }

function readDutyStorage(): DutyStorage {
  const fallback: DutyStorage = { ruleVersion: DEFAULT_RULE_VERSION, summaries: [] }
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(DUTY_STORAGE_KEY)
  if (!raw) {
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DutyStorage>
    return {
      ruleVersion: typeof parsed.ruleVersion === 'string' ? parsed.ruleVersion : DEFAULT_RULE_VERSION,
      summaries: Array.isArray(parsed.summaries) ? (parsed.summaries as DutySummary[]) : [],
    }
  } catch {
    return fallback
  }
}

function writeDutyStorage(storage: DutyStorage): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(DUTY_STORAGE_KEY, JSON.stringify(storage))
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function nowText(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export function todayText(): string {
  return nowText().slice(0, 10)
}

export function currentShiftKey(shiftLabel: string): string {
  return `${todayText()}|${shiftLabel}`
}

// 站点编号 → 流域：按站点档案里的「所在河流」归入流域，查不到的进兜底组。
function stationBasinMap(): Map<string, string> {
  const riverBasin = new Map<string, string>()
  for (const basin of BASINS) {
    for (const river of basin.rivers) {
      riverBasin.set(river, basin.name)
    }
  }
  const map = new Map<string, string>()
  for (const row of listRows('station')) {
    const code = String(row['站点编号'] ?? '')
    const basin = riverBasin.get(String(row['所在河流'] ?? ''))
    if (code && basin) {
      map.set(code, basin)
    }
  }
  return map
}

function basinOf(row: EntryRow, stationField: string, stations: Map<string, string>): string {
  const code = String(row[stationField] ?? '')
  // 地下水记录挂的是井点，先换算成所属监测站再归流域。
  const stationCode = stationField === '井点编号' ? (WELL_STATION_MAP[code] ?? code) : code
  return stations.get(stationCode) ?? UNGROUPED_BASIN
}

export function loadDutyBoard(): BasinStat[] {
  const stations = stationBasinMap()
  const order = [...BASINS.map((basin) => basin.name), UNGROUPED_BASIN]
  const board = new Map<string, BasinStat>()
  for (const mod of DUTY_MODULES) {
    for (const row of listRows(mod.key)) {
      const basin = basinOf(row, mod.stationField, stations)
      let entry = board.get(basin)
      if (!entry) {
        entry = {
          basin,
          stats: DUTY_MODULES.map((item) => ({
            moduleKey: item.key,
            moduleName: item.name,
            pending: 0,
            abnormal: 0,
            latestAt: '',
          })),
        }
        board.set(basin, entry)
      }
      const stat = entry.stats.find((item) => item.moduleKey === mod.key)
      if (!stat) {
        continue
      }
      if (row.pending) {
        stat.pending += 1
      }
      if (row.abnormal) {
        stat.abnormal += 1
      }
      const observedAt = String(row[mod.timeField] ?? '')
      if (observedAt && observedAt > stat.latestAt) {
        stat.latestAt = observedAt
      }
    }
  }
  return [...board.values()].sort((a, b) => order.indexOf(a.basin) - order.indexOf(b.basin))
}

export function listBasinRecords(basin: string): BasinRecord[] {
  const stations = stationBasinMap()
  const records: BasinRecord[] = []
  for (const mod of DUTY_MODULES) {
    for (const row of listRows(mod.key)) {
      if (basinOf(row, mod.stationField, stations) !== basin) {
        continue
      }
      records.push({
        moduleKey: mod.key,
        moduleName: mod.name,
        id: Number(row.id),
        code: String(row['记录编号'] ?? row.id),
        station: String(row[mod.stationField] ?? ''),
        observedAt: String(row[mod.timeField] ?? ''),
        status: String(row.status),
        pending: Boolean(row.pending),
        abnormal: Boolean(row.abnormal),
      })
    }
  }
  return records.sort((a, b) => b.observedAt.localeCompare(a.observedAt))
}

// 摘要正文按当前统计规则生成：规则版本变了，未锁定班次要照新规则重算这一段。
function buildSummaryLines(ruleVersion: string): string[] {
  const lines = [`统计口径 ${ruleVersion}：未处理量 / 异常站次 / 最近观测时刻`]
  for (const basin of loadDutyBoard()) {
    for (const stat of basin.stats) {
      lines.push(
        `${basin.basin} · ${stat.moduleName}：未处理 ${stat.pending}，异常站次 ${stat.abnormal}，最近观测 ${stat.latestAt || '—'}`,
      )
    }
  }
  return lines
}

// 只重算未锁定班次；已锁定、已归档的班次保留提交时的规则版本与内容快照。
function recalcUnlocked(storage: DutyStorage): boolean {
  let changed = false
  for (const summary of storage.summaries) {
    if (summary.status === '未锁定' && summary.ruleVersion !== storage.ruleVersion) {
      summary.lines = buildSummaryLines(storage.ruleVersion)
      summary.ruleVersion = storage.ruleVersion
      changed = true
    }
  }
  return changed
}

export function listSummaries(): { ruleVersion: string; summaries: DutySummary[] } {
  const storage = readDutyStorage()
  if (recalcUnlocked(storage)) {
    writeDutyStorage(storage)
  }
  return {
    ruleVersion: storage.ruleVersion,
    summaries: [...storage.summaries].sort((a, b) => b.id - a.id),
  }
}

export function submitSummary(operator: string, shiftLabel: string): SubmitSummaryResult {
  const storage = readDutyStorage()
  recalcUnlocked(storage)
  const shiftKey = currentShiftKey(shiftLabel)
  const existing = storage.summaries.find((item) => item.shiftKey === shiftKey)
  if (existing) {
    // 同一班次只保留先提交的版本，后提交的终端收到冲突提示。
    writeDutyStorage(storage)
    return {
      ok: false,
      conflict: true,
      message: `提交冲突：${shiftLabel} 的交接班摘要已由 ${existing.operator} 于 ${existing.createdAt} 提交（${existing.code}），本终端的版本未保留。`,
    }
  }
  const id = storage.summaries.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const summary: DutySummary = {
    id,
    code: `SUM-${todayText().replace(/-/g, '')}-${pad(id)}`,
    shiftKey,
    shiftDate: todayText(),
    shiftLabel,
    operator,
    ruleVersion: storage.ruleVersion,
    status: '未锁定',
    lines: buildSummaryLines(storage.ruleVersion),
    createdAt: nowText(),
    lockedBy: '',
    lockedAt: '',
    archivedAt: '',
  }
  storage.summaries.push(summary)
  writeDutyStorage(storage)
  return {
    ok: true,
    conflict: false,
    message: `交接班摘要 ${summary.code} 已提交，等待当日值守人确认锁定。`,
  }
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 确认摘要时联动生成：巡检待办里多一条「观测核查」，站房维护台账多一条关联记录。
function createLinkedItems(summary: DutySummary, operator: string): string[] {
  const created: string[] = []
  const inspectionRows = listRows('inspection')
  const inspectionId = nextId(inspectionRows)
  const inspectionCode = `INSP-${String(inspectionId).padStart(4, '0')}`
  saveRows('inspection', [
    ...inspectionRows,
    {
      id: inspectionId,
      status: '待巡检',
      pending: true,
      abnormal: false,
      记录编号: inspectionCode,
      站点编号: '全网',
      巡检日期: summary.shiftDate,
      巡检人员: operator,
      检查项目: '观测核查',
      发现问题: `交接班摘要 ${summary.code} 待核查`,
      处理措施: '按摘要列出的未处理量与异常站次逐项核查观测记录',
      巡检状态: '待巡检',
    },
  ])
  created.push(`巡检待办「观测核查」${inspectionCode}`)

  const houseRows = listRows('stationhouse')
  const houseId = nextId(houseRows)
  const houseCode = `STAT-${String(houseId).padStart(4, '0')}`
  saveRows('stationhouse', [
    ...houseRows,
    {
      id: houseId,
      status: '待安排',
      pending: true,
      abnormal: false,
      记录编号: houseCode,
      站点编号: '全网',
      维护类型: '值守交接保障',
      维护内容: `交接班摘要 ${summary.code} 关联：值守期间站房与供电保障检查`,
      维护单位: '站网运维班',
      维护日期: summary.shiftDate,
      费用支出: 0,
      维护状态: '待安排',
    },
  ])
  created.push(`站房维护台账 ${houseCode}`)
  return created
}

export function confirmSummary(id: number, operator: string): ActionResult {
  const storage = readDutyStorage()
  const summary = storage.summaries.find((item) => item.id === id)
  if (!summary) {
    return { ok: false, message: `没有找到编号为 ${id} 的交接班摘要` }
  }
  if (summary.status !== '未锁定') {
    return { ok: false, message: `摘要 ${summary.code} 当前状态「${summary.status}」，不能重复锁定` }
  }
  summary.status = '已锁定'
  summary.lockedBy = operator
  summary.lockedAt = nowText()
  writeDutyStorage(storage)
  const linked = createLinkedItems(summary, operator)
  return {
    ok: true,
    message: `摘要 ${summary.code} 已由当日值守人 ${operator} 锁定，并生成关联事项：${linked.join('、')}。`,
  }
}

export function archiveSummary(id: number): ActionResult {
  const storage = readDutyStorage()
  const summary = storage.summaries.find((item) => item.id === id)
  if (!summary) {
    return { ok: false, message: `没有找到编号为 ${id} 的交接班摘要` }
  }
  if (summary.status !== '已锁定') {
    return { ok: false, message: `摘要 ${summary.code} 需先由值守人锁定，才能归档` }
  }
  summary.status = '已归档'
  summary.archivedAt = nowText()
  writeDutyStorage(storage)
  return { ok: true, message: `摘要 ${summary.code} 已归档，后续规则调整不再重算该班次。` }
}

export function bumpRuleVersion(): ActionResult {
  const storage = readDutyStorage()
  const match = /^v(\d+)\.(\d+)$/.exec(storage.ruleVersion)
  const next = match ? `v${match[1]}.${Number(match[2]) + 1}` : `${storage.ruleVersion}.1`
  storage.ruleVersion = next
  recalcUnlocked(storage)
  writeDutyStorage(storage)
  return {
    ok: true,
    message: `统计规则已升级到 ${next}：未锁定班次已按新规则重算，已锁定与已归档班次保留原版本。`,
  }
}
