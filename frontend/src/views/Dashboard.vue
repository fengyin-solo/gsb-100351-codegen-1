<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>汛情值守台</h2>
        <p class="page-desc">
          按流域并列展示水位、雨量、流量与地下水监测的未处理量、异常站次与最近观测时刻，点击流域行可下钻到具体记录。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>

    <table class="data-table duty-table">
      <thead>
        <tr>
          <th rowspan="2">流域</th>
          <th v-for="mod in dutyModules" :key="mod.key" colspan="3">{{ mod.name }}</th>
        </tr>
        <tr>
          <template v-for="mod in dutyModules" :key="mod.key">
            <th>未处理量</th>
            <th>异常站次</th>
            <th>最近观测时刻</th>
          </template>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in basins"
          :key="row.basin"
          :class="{ selected: row.basin === selectedBasin }"
          @click="drill(row.basin)"
        >
          <td class="basin-name">{{ row.basin }}</td>
          <template v-for="stat in row.stats" :key="stat.moduleKey">
            <td>{{ stat.pending }}</td>
            <td :class="{ 'abnormal-cell': stat.abnormal > 0 }">{{ stat.abnormal }}</td>
            <td>{{ stat.latestAt || '—' }}</td>
          </template>
        </tr>
        <tr v-if="!basins.length">
          <td :colspan="1 + dutyModules.length * 3" class="empty-state">暂无监测数据</td>
        </tr>
      </tbody>
    </table>

    <section v-if="selectedBasin" class="drill-panel">
      <header class="panel-head">
        <h3>{{ selectedBasin }} · 记录明细（{{ records.length }} 条）</h3>
        <button class="btn ghost" type="button" @click="closeDrill">收起</button>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>监测模块</th>
            <th>记录编号</th>
            <th>站点/井点</th>
            <th>观测时刻</th>
            <th>当前状态</th>
            <th>标记</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rec in records" :key="`${rec.moduleKey}-${rec.id}`">
            <td>{{ rec.moduleName }}</td>
            <td>{{ rec.code }}</td>
            <td>{{ rec.station }}</td>
            <td>{{ rec.observedAt || '—' }}</td>
            <td>{{ rec.status }}</td>
            <td>
              <span v-if="rec.pending" class="legend-item">未处理</span>
              <span v-if="rec.abnormal" class="legend-item abnormal">异常</span>
              <span v-if="!rec.pending && !rec.abnormal">—</span>
            </td>
          </tr>
          <tr v-if="!records.length">
            <td colspan="6" class="empty-state">该流域暂无监测记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="summary-panel">
      <header class="panel-head">
        <div>
          <h3>交接班摘要</h3>
          <p class="page-desc">
            当前班次 {{ today }} · {{ store.shiftLabel }}，摘要由当日值守人 {{ store.operator }} 确认锁定；
            同一班次两块终端同时提交时只保留先到的版本。当前统计规则 {{ ruleVersion }}。
          </p>
        </div>
        <div class="page-actions">
          <button class="btn primary" type="button" @click="submit">提交本班摘要</button>
          <button class="btn" type="button" @click="upgradeRule">升级统计规则版本</button>
        </div>
      </header>
      <p v-if="message" class="summary-message" :class="{ conflict: conflicted }">{{ message }}</p>
      <article v-for="item in summaries" :key="item.id" class="summary-card">
        <header class="summary-head">
          <strong>{{ item.code }}</strong>
          <span>{{ item.shiftDate }} · {{ item.shiftLabel }}</span>
          <span>提交人：{{ item.operator }}（{{ item.createdAt }}）</span>
          <span>规则版本：{{ item.ruleVersion }}</span>
          <span class="legend-item">{{ item.status }}</span>
          <span v-if="item.lockedBy">锁定：{{ item.lockedBy }}（{{ item.lockedAt }}）</span>
          <span v-if="item.archivedAt">归档：{{ item.archivedAt }}</span>
        </header>
        <ul class="summary-lines">
          <li v-for="(line, index) in item.lines" :key="index">{{ line }}</li>
        </ul>
        <footer class="row-actions">
          <button v-if="item.status === '未锁定'" class="link" type="button" @click="confirm(item)">
            确认并锁定
          </button>
          <button v-if="item.status === '已锁定'" class="link" type="button" @click="archive(item)">
            归档班次
          </button>
        </footer>
      </article>
      <p v-if="!summaries.length" class="empty-state">暂无交接班摘要，点击「提交本班摘要」生成。</p>
    </section>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import {
  archiveSummary,
  bumpRuleVersion,
  confirmSummary,
  listBasinRecords,
  listSummaries,
  loadDutyBoard,
  submitSummary,
  todayText,
} from '@/api/duty-service'
import { DUTY_MODULES } from '@/data/duty'
import type { BasinRecord, BasinStat, DutySummary } from '@/data/duty'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const dutyModules = DUTY_MODULES
const today = todayText()

const basins = ref<BasinStat[]>([])
const selectedBasin = ref('')
const records = ref<BasinRecord[]>([])
const summaries = ref<DutySummary[]>([])
const ruleVersion = ref('')
const message = ref('')
const conflicted = ref(false)

function refresh() {
  basins.value = loadDutyBoard()
  const payload = listSummaries()
  summaries.value = payload.summaries
  ruleVersion.value = payload.ruleVersion
  if (selectedBasin.value) {
    records.value = listBasinRecords(selectedBasin.value)
  }
}

function drill(basin: string) {
  if (selectedBasin.value === basin) {
    closeDrill()
    return
  }
  selectedBasin.value = basin
  records.value = listBasinRecords(basin)
}

function closeDrill() {
  selectedBasin.value = ''
  records.value = []
}

function submit() {
  const result = submitSummary(store.operator, store.shiftLabel)
  message.value = result.message
  conflicted.value = result.conflict
  refresh()
}

function confirm(item: DutySummary) {
  const result = confirmSummary(item.id, store.operator)
  message.value = result.message
  conflicted.value = !result.ok
  refresh()
}

function archive(item: DutySummary) {
  const result = archiveSummary(item.id)
  message.value = result.message
  conflicted.value = !result.ok
  refresh()
}

function upgradeRule() {
  const result = bumpRuleVersion()
  message.value = result.message
  conflicted.value = false
  refresh()
}

onMounted(refresh)
</script>
