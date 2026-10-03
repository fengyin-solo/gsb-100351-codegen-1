<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>汛情值守台</h2>
        <p class="page-desc">
          按流域并排展示水位、雨量、流量、地下水监测的未处理量、异常站次与最近观测时刻，点击流域可下钻到具体记录。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
        <button class="btn" type="button" @click="bumpRule">升级规则版本</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th rowspan="2">流域</th>
          <th v-for="mod in monitorModules" :key="mod.key" colspan="3">{{ mod.name }}</th>
          <th rowspan="2">合计未处理</th>
          <th rowspan="2">合计异常站次</th>
        </tr>
        <tr>
          <template v-for="mod in monitorModules" :key="`${mod.key}-sub`">
            <th>未处理</th>
            <th>异常站次</th>
            <th>最近观测</th>
          </template>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in basins" :key="row.basin">
          <td>
            <button class="link" type="button" @click="drill(row.basin)">{{ row.basin }}</button>
          </td>
          <template v-for="mod in row.modules" :key="mod.moduleKey">
            <td>{{ mod.pending }}</td>
            <td>{{ mod.abnormal }}</td>
            <td>{{ mod.latest }}</td>
          </template>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <section v-if="selectedBasin" class="drill-panel">
      <header class="drill-head">
        <h3>{{ selectedBasin }} · 具体记录</h3>
        <button class="btn ghost" type="button" @click="selectedBasin = ''">关闭</button>
      </header>
      <div v-for="mod in monitorModules" :key="mod.key" class="drill-block">
        <h4>{{ mod.name }}</h4>
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="field in fieldsOf(mod.key)" :key="field">{{ field }}</th>
              <th>当前状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in drillRows[mod.key] ?? []" :key="String(row.id)">
              <td v-for="field in fieldsOf(mod.key)" :key="field">{{ row[field] ?? '—' }}</td>
              <td>{{ row.status }}</td>
            </tr>
            <tr v-if="!(drillRows[mod.key] ?? []).length">
              <td :colspan="fieldsOf(mod.key).length + 1" class="empty-state">
                该流域暂无{{ mod.name }}记录
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="shift-panel">
      <header class="drill-head">
        <h3>交接班摘要</h3>
        <span class="tag">当前规则 v{{ ruleVersion }}「{{ ruleName }}」：{{ ruleDesc }}</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>班次</th>
            <th>状态</th>
            <th>值守人</th>
            <th>锁定时间</th>
            <th>规则版本</th>
            <th>未处理</th>
            <th>异常站次</th>
            <th>关联事项</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in shifts" :key="row.slot.shiftKey">
            <td>
              {{ row.slot.shiftLabel }}
              <span v-if="row.slot.current" class="tag ok">当前班次</span>
              <div v-if="row.summary?.note" class="cell-note">备注：{{ row.summary.note }}</div>
            </td>
            <template v-if="row.summary">
              <td><span class="tag">已归档</span></td>
              <td>{{ row.summary.operator }}</td>
              <td>{{ row.summary.lockedAt }}</td>
              <td>
                v{{ row.summary.ruleVersion }}
                <span v-if="row.summary.ruleVersion !== ruleVersion" class="tag warn">原版本</span>
              </td>
              <td>{{ row.summary.pending }}</td>
              <td>{{ row.summary.abnormal }}</td>
              <td>
                <template v-if="row.summary.linked">
                  巡检#{{ row.summary.linked.inspectionId }} · 站房#{{ row.summary.linked.stationhouseId }}
                </template>
                <template v-else>—</template>
              </td>
              <td>—</td>
            </template>
            <template v-else>
              <td><span class="tag warn">未锁定·实时重算</span></td>
              <td>{{ store.operator }}</td>
              <td>—</td>
              <td>v{{ ruleVersion }}</td>
              <td>{{ livePending }}</td>
              <td>{{ liveAbnormal }}</td>
              <td>锁定后生成</td>
              <td class="row-actions">
                <input
                  v-model="notes[row.slot.shiftKey]"
                  class="note-input"
                  placeholder="交接备注（可空）"
                />
                <button class="btn primary" type="button" @click="lock(row.slot)">锁定摘要</button>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  listBasinRecords,
  loadDutyBoard,
  submitShiftSummary,
  upgradeRuleVersion,
} from '@/api/duty-service'
import { moduleMeta } from '@/api/local-service'
import { MONITOR_MODULES } from '@/data/duty'
import type { DutyBoard, EntryRow, ShiftSlot } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const monitorModules = MONITOR_MODULES

const cards = ref<DutyBoard['cards']>([])
const basins = ref<DutyBoard['basins']>([])
const shifts = ref<DutyBoard['shifts']>([])
const ruleVersion = ref(1)
const ruleName = ref('')
const ruleDesc = ref('')
const selectedBasin = ref('')
const drillRows = ref<Record<string, EntryRow[]>>({})
const notes = ref<Record<string, string>>({})
const errorMessage = ref('')
const successMessage = ref('')

const livePending = computed(() => basins.value.reduce((sum, item) => sum + item.pending, 0))
const liveAbnormal = computed(() => basins.value.reduce((sum, item) => sum + item.abnormal, 0))

function fieldsOf(key: string): string[] {
  return moduleMeta(key).fields
}

function drill(basin: string) {
  selectedBasin.value = basin
  drillRows.value = listBasinRecords(basin)
}

function refresh() {
  const board = loadDutyBoard()
  cards.value = board.cards
  basins.value = board.basins
  shifts.value = board.shifts
  ruleVersion.value = board.ruleVersion
  ruleName.value = board.ruleName
  ruleDesc.value = board.ruleDesc
  if (selectedBasin.value) {
    drillRows.value = listBasinRecords(selectedBasin.value)
  }
}

function lock(slot: ShiftSlot) {
  errorMessage.value = ''
  successMessage.value = ''
  const result = submitShiftSummary(slot, store.operator, notes.value[slot.shiftKey] ?? '')
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  notes.value = { ...notes.value, [slot.shiftKey]: '' }
  refresh()
}

function bumpRule() {
  errorMessage.value = ''
  successMessage.value = ''
  const result = upgradeRuleVersion()
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  refresh()
}

onMounted(refresh)
</script>
