// 汛情值守台的领域配置：流域划分、值守模块口径、交接班摘要类型与统计规则版本。

/** 值守台并列展示的监测模块：字段名对应各模块播种数据里的列。 */
export type DutyModule = {
  key: string
  name: string
  /** 记录上定位站点的字段（地下水用井点编号） */
  stationField: string
  /** 最近观测时刻取自哪个字段 */
  timeField: string
}

export const DUTY_MODULES: DutyModule[] = [
  { key: 'waterlevel', name: '水位监测', stationField: '站点编号', timeField: '观测时间' },
  { key: 'rainfall', name: '雨量观测', stationField: '站点编号', timeField: '观测时段' },
  { key: 'discharge', name: '流量监测', stationField: '站点编号', timeField: '测量时间' },
  { key: 'groundwater', name: '地下水观测', stationField: '井点编号', timeField: '观测日期' },
]

/** 流域 → 河流：监测站按「所在河流」归入流域。 */
export const BASINS: { name: string; rivers: string[] }[] = [
  { name: '长江流域', rivers: ['汉江', '嘉陵江'] },
  { name: '黄河流域', rivers: ['渭河', '伊洛河'] },
  { name: '淮河流域', rivers: ['淮河', '沙颍河'] },
]

/** 地下水井点挂靠的监测站：井点编号 → 站点编号。 */
export const WELL_STATION_MAP: Record<string, string> = {
  'GW-1001': 'STA-1001',
  'GW-1002': 'STA-1002',
  'GW-2001': 'STA-2001',
  'GW-2002': 'STA-2002',
  'GW-3001': 'STA-3001',
  'GW-3002': 'STA-3002',
}

/** 站点档案里查不到的记录归入这个兜底流域，不让数据在看板上悄悄丢掉。 */
export const UNGROUPED_BASIN = '未分流域'

/** 交接班摘要的初始统计规则版本：规则调整后只重算未锁定班次。 */
export const DEFAULT_RULE_VERSION = 'v1.0'

export type SummaryStatus = '未锁定' | '已锁定' | '已归档'

export type DutySummary = {
  id: number
  code: string
  shiftKey: string
  shiftDate: string
  shiftLabel: string
  operator: string
  ruleVersion: string
  status: SummaryStatus
  /** 提交时按统计规则算好的内容快照，锁定与归档后不再重算 */
  lines: string[]
  createdAt: string
  lockedBy: string
  lockedAt: string
  archivedAt: string
}

export type BasinModuleStat = {
  moduleKey: string
  moduleName: string
  pending: number
  abnormal: number
  latestAt: string
}

export type BasinStat = {
  basin: string
  stats: BasinModuleStat[]
}

export type BasinRecord = {
  moduleKey: string
  moduleName: string
  id: number
  code: string
  station: string
  observedAt: string
  status: string
  pending: boolean
  abnormal: boolean
}
