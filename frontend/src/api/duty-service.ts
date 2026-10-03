import {
  BASINS,
  LATEST_RULE_VERSION,
  MONITOR_MODULES,
  RULE_VERSIONS,
  readDuty,
  writeDuty,
} from '@/data/duty'
import { listRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  BasinStat,
  DutyBoard,
  EntryRow,
  ShiftBoardRow,
  ShiftSlot,
  ShiftSummary,
} from '@/data/types'

// 记录归属流域：数据里带「所属流域」就用它，老数据没有这个字段的一律进「未划分流域」。
export function basinOf(row: EntryRow): string {
  const basin = String(row['所属流域'] ?? '').trim()
  return basin || '未划分流域'
}

function isPending(row: EntryRow, ruleVersion: number): boolean {
  if (ruleVersion >= 2) {
    // v2 起异常记录即使已处理，也一并计入未处理量
    return Boolean(row.pending) || Boolean(row.abnormal)
  }
  return Boolean(row.pending)
}

export function computeBasinStats(ruleVersion: number): BasinStat[] {
  const basinNames = [...BASINS]
  for (const mod of MONITOR_MODULES) {
    for (const row of listRows(mod.key)) {
      const name = basinOf(row)
      if (!basinNames.includes(name)) {
        basinNames.push(name)
      }
    }
  }
  return basinNames.map((basin) => {
    const modules = MONITOR_MODULES.map((mod) => {
      const rows = listRows(mod.key).filter((row) => basinOf(row) === basin)
      const latest = rows.reduce((acc, row) => {
        const moment = String(row[mod.timeField] ?? '')
        return moment > acc ? moment : acc
      }, '')
      return {
        moduleKey: mod.key,
        moduleName: mod.name,
        pending: rows.filter((row) => isPending(row, ruleVersion)).length,
        abnormal: rows.filter((row) => row.abnormal).length,
        latest: latest || '—',
      }
    })
    return {
      basin,
      modules,
      pending: modules.reduce((sum, item) => sum + item.pending, 0),
      abnormal: modules.reduce((sum, item) => sum + item.abnormal, 0),
    }
  })
}

export function listBasinRecords(basin: string): Record<string, EntryRow[]> {
  const result: Record<string, EntryRow[]> = {}
  for (const mod of MONITOR_MODULES) {
    result[mod.key] = listRows(mod.key).filter((row) => basinOf(row) === basin)
  }
  return result
}

const SHIFT_DEFS = [
  { name: '白班', span: '08:00-20:00' },
  { name: '夜班', span: '20:00-08:00' },
]

function fmtDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function nowText(): string {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `${fmtDate(now)} ${hh}:${mm}`
}

// 班次清单：今天白班/夜班 + 昨天白班/夜班，按时间倒序就是列表顺序。
export function listShiftSlots(): ShiftSlot[] {
  const now = new Date()
  const hour = now.getHours()
  const slots: ShiftSlot[] = []
  for (let offset = 0; offset >= -1; offset -= 1) {
    const date = new Date(now)
    date.setDate(date.getDate() + offset)
    const workDate = fmtDate(date)
    for (const def of SHIFT_DEFS) {
      const onDuty = def.name === '白班' ? hour >= 8 && hour < 20 : hour >= 20 || hour < 8
      slots.push({
        shiftKey: `${workDate}#${def.name}`,
        shiftLabel: `${workDate} ${def.name} ${def.span}`,
        workDate,
        current: offset === 0 && onDuty,
      })
    }
  }
  return slots
}

export function loadDutyBoard(): DutyBoard {
  const duty = readDuty()
  const basins = computeBasinStats(duty.ruleVersion)
  const slots = listShiftSlots()
  const rows: ShiftBoardRow[] = slots.map((slot) => ({
    slot,
    summary: duty.summaries.find((item) => item.shiftKey === slot.shiftKey) ?? null,
  }))
  // 更早的已归档摘要不在最近班次清单里，追加到列表末尾继续展示原版本。
  const archived: ShiftBoardRow[] = duty.summaries
    .filter((item) => !slots.some((slot) => slot.shiftKey === item.shiftKey))
    .sort((a, b) => (a.shiftKey < b.shiftKey ? 1 : -1))
    .map((summary) => ({
      slot: {
        shiftKey: summary.shiftKey,
        shiftLabel: summary.shiftLabel,
        workDate: summary.workDate,
        current: false,
      },
      summary,
    }))
  const rule = RULE_VERSIONS.find((item) => item.version === duty.ruleVersion) ?? RULE_VERSIONS[0]
  return {
    ruleVersion: duty.ruleVersion,
    ruleName: rule.name,
    ruleDesc: rule.desc,
    basins,
    shifts: [...rows, ...archived],
    cards: [
      { label: '流域数量', value: basins.length },
      { label: '未处理总量', value: basins.reduce((sum, item) => sum + item.pending, 0) },
      { label: '异常站次', value: basins.reduce((sum, item) => sum + item.abnormal, 0) },
      { label: '已锁定班次', value: duty.summaries.filter((item) => item.locked).length },
    ],
  }
}

function nextId(key: string): number {
  return listRows(key).reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 确认摘要的关联事项之一：巡检待办补一条「观测核查」，巡检记录页会同步看到。
function appendInspectionTodo(summary: ShiftSummary): number {
  const id = nextId('inspection')
  const rows = listRows('inspection')
  saveRows('inspection', [
    ...rows,
    {
      id,
      status: '待巡检',
      pending: true,
      abnormal: false,
      记录编号: `INSP-${String(id).padStart(4, '0')}`,
      站点编号: '全流域',
      巡检日期: summary.workDate,
      巡检人员: summary.operator,
      检查项目: '观测核查',
      发现问题: `交接班摘要「${summary.shiftLabel}」关联生成`,
      处理措施: '待核查',
      巡检状态: '待巡检',
    },
  ])
  return id
}

// 确认摘要的关联事项之二：站房维护台账补一条待安排记录。
function appendStationhouseItem(summary: ShiftSummary): number {
  const id = nextId('stationhouse')
  const rows = listRows('stationhouse')
  saveRows('stationhouse', [
    ...rows,
    {
      id,
      status: '待安排',
      pending: true,
      abnormal: false,
      记录编号: `STAT-${String(id).padStart(4, '0')}`,
      站点编号: '全流域',
      维护类型: '汛情值守关联',
      维护内容: `交接班摘要「${summary.shiftLabel}」确认时生成的站房巡查事项`,
      维护单位: '值守班',
      维护日期: summary.workDate,
      费用支出: 0,
      维护状态: '待安排',
    },
  ])
  return id
}

// 锁定交接班摘要：同一班次只保留先提交的版本。
// 提交前重读 storage，另一块终端若已锁定，本次提交直接判冲突、不落库。
export function submitShiftSummary(slot: ShiftSlot, operator: string, note: string): ActionResult {
  const duty = readDuty()
  const existing = duty.summaries.find((item) => item.shiftKey === slot.shiftKey && item.locked)
  if (existing) {
    return {
      ok: false,
      message: `提交冲突：${slot.shiftLabel} 摘要已由 ${existing.operator} 于 ${existing.lockedAt} 锁定，本终端提交的版本未保留`,
    }
  }
  const snapshot = computeBasinStats(duty.ruleVersion)
  const summary: ShiftSummary = {
    shiftKey: slot.shiftKey,
    shiftLabel: slot.shiftLabel,
    workDate: slot.workDate,
    operator,
    locked: true,
    lockedAt: nowText(),
    ruleVersion: duty.ruleVersion,
    note: note.trim(),
    pending: snapshot.reduce((sum, item) => sum + item.pending, 0),
    abnormal: snapshot.reduce((sum, item) => sum + item.abnormal, 0),
    snapshot,
    linked: null,
  }
  const inspectionId = appendInspectionTodo(summary)
  const stationhouseId = appendStationhouseItem(summary)
  summary.linked = { inspectionId, stationhouseId }
  duty.summaries = [...duty.summaries.filter((item) => item.shiftKey !== slot.shiftKey), summary]
  writeDuty(duty)
  return {
    ok: true,
    message: `${slot.shiftLabel} 摘要已锁定（规则 v${summary.ruleVersion}），已生成巡检待办「观测核查」与站房维护台账关联事项`,
  }
}

// 升级统计规则：未锁定班次跟着新规则实时重算，已归档班次保留锁定时的快照与版本号。
export function upgradeRuleVersion(): ActionResult {
  const duty = readDuty()
  if (duty.ruleVersion >= LATEST_RULE_VERSION) {
    return { ok: false, message: `当前已是最新规则 v${duty.ruleVersion}，无需升级` }
  }
  duty.ruleVersion += 1
  writeDuty(duty)
  const rule = RULE_VERSIONS.find((item) => item.version === duty.ruleVersion)
  return {
    ok: true,
    message: `统计规则已升级到 v${duty.ruleVersion}「${rule?.name ?? ''}」：未锁定班次按新规则重算，已归档班次仍展示原版本`,
  }
}
