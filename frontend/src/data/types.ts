/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type BasinModuleStat = {
  moduleKey: string
  moduleName: string
  pending: number
  abnormal: number
  latest: string
}

export type BasinStat = {
  basin: string
  modules: BasinModuleStat[]
  pending: number
  abnormal: number
}

export type ShiftSlot = {
  shiftKey: string
  shiftLabel: string
  workDate: string
  current: boolean
}

export type ShiftSummary = {
  shiftKey: string
  shiftLabel: string
  workDate: string
  operator: string
  locked: boolean
  lockedAt: string
  ruleVersion: number
  note: string
  pending: number
  abnormal: number
  snapshot: BasinStat[]
  linked: { inspectionId: number; stationhouseId: number } | null
}

export type ShiftBoardRow = {
  slot: ShiftSlot
  summary: ShiftSummary | null
}

export type DutyBoard = {
  ruleVersion: number
  ruleName: string
  ruleDesc: string
  cards: { label: string; value: number }[]
  basins: BasinStat[]
  shifts: ShiftBoardRow[]
}
