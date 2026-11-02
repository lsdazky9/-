<script setup lang="ts">
/**
 * 评测运维：查看任务队列状态、人工恢复 FAILED 提交、查看审计。
 *
 * 操作约束（§6.1、UC-11、BR-09）：
 * - 只有 FAILED 允许人工恢复，且必须填写原因；
 * - 已 CLOSED 的考试拒绝恢复（本期发布后不再改分）；
 * - 恢复会创建新的执行尝试并写入审计，不修改历史尝试。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { adminApi } from '@/api/client'
import { ApiError, describeError } from '@/api/http'
import StatusPill from '@/components/StatusPill.vue'
import VerdictBadge from '@/components/VerdictBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import { PHASE_LABEL, type AuditEntry, type JudgeTaskRow } from '@/api/types'
import { formatDateTime, formatRelative } from '@/utils/format'
import { uuid } from '@/utils/id'
import { toast } from '@/stores/toast'

const rows = ref<JudgeTaskRow[]>([])
const audit = ref<AuditEntry[]>([])
const loading = ref(true)
const error = ref('')
const statusFilter = ref('')
const autoRefresh = ref(true)

const recovering = ref<JudgeTaskRow | null>(null)
const reason = ref('')
const submitting = ref(false)
let recoverKey: string | null = null

let timer: number | null = null

const statusOptions = [
  { value: '', label: '全部未终态' },
  { value: 'QUEUED', label: '排队中' },
  { value: 'RUNNING', label: '评测中' },
  { value: 'RETRY_WAIT', label: '等待重试' },
  { value: 'FAILED', label: '系统故障' }
]

async function load(silent = false) {
  if (!silent) loading.value = true
  error.value = ''
  try {
    const [taskResult, auditResult] = await Promise.all([
      adminApi.tasks({ status: statusFilter.value, page: 1, size: 50 }),
      adminApi.audit({ page: 1, size: 8 }).catch(() => ({ items: [] as AuditEntry[], page: 1, size: 8, total: 0 }))
    ])
    rows.value = taskResult.items
    audit.value = auditResult.items
  } catch (e) {
    if (!silent) error.value = describeError(e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
  timer = window.setInterval(() => {
    if (autoRefresh.value && !recovering.value) void load(true)
  }, 5000)
})

onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})

const stats = computed(() => ({
  total: rows.value.length,
  failed: rows.value.filter((r) => r.status === 'FAILED').length,
  running: rows.value.filter((r) => r.status === 'RUNNING').length,
  queued: rows.value.filter((r) => r.status === 'QUEUED').length
}))

function openRecover(row: JudgeTaskRow) {
  recovering.value = row
  reason.value = ''
  recoverKey = uuid()
}

async function submitRecover() {
  if (!recovering.value) return
  if (!reason.value.trim()) {
    toast.warn('人工恢复必须填写原因')
    return
  }
  submitting.value = true
  try {
    await adminApi.recover(recovering.value.submissionId, reason.value.trim(), recoverKey ?? uuid())
    toast.success('已创建新的执行尝试', '原因与操作者已写入审计日志')
    recovering.value = null
    recoverKey = null
    await load()
  } catch (e) {
    const err = e as ApiError
    if (err instanceof ApiError && err.status === 409) {
      toast.error('恢复被拒绝', err.message)
      // 幂等重试时保留同一个键，动作已被处理则直接刷新
      recoverKey = null
    } else {
      toast.error('恢复失败', describeError(e))
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head__main">
        <h1>评测运维</h1>
        <p class="page-head__sub">
          查看排队、执行与基础设施失败；只有 FAILED 允许人工恢复。恢复不修改历史尝试，也不会改变已关闭考试的成绩。
        </p>
      </div>
      <div class="btn-row">
        <label class="checkbox">
          <input v-model="autoRefresh" type="checkbox" />
          每 5 秒自动刷新
        </label>
        <button class="btn btn--sm" type="button" :disabled="loading" @click="load()">刷新</button>
      </div>
    </header>

    <div class="grid-4">
      <div class="stat">
        <span class="stat__label">当前列表</span>
        <span class="stat__value">{{ stats.total }}</span>
      </div>
      <div class="stat">
        <span class="stat__label">排队</span>
        <span class="stat__value">{{ stats.queued }}</span>
      </div>
      <div class="stat">
        <span class="stat__label">执行中</span>
        <span class="stat__value">{{ stats.running }}</span>
      </div>
      <div class="stat">
        <span class="stat__label">系统故障</span>
        <span class="stat__value" :class="{ 'text-danger': stats.failed > 0 }">{{ stats.failed }}</span>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card__head">
        <span class="card__title">任务</span>
        <select v-model="statusFilter" class="select" style="max-width: 160px" @change="load()">
          <option v-for="option in statusOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>

      <div v-if="loading" class="stack" style="padding: 20px">
        <span v-for="n in 4" :key="n" class="skeleton" style="height: 18px" />
      </div>

      <div v-else-if="error" class="card__body">
        <div class="alert alert--danger">
          <span class="alert__icon">!</span>
          <div class="stack stack--sm">
            <strong>任务列表加载失败</strong>
            <span>{{ error }}</span>
            <button class="btn btn--sm" type="button" @click="load()">重试</button>
          </div>
        </div>
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="当前没有匹配的任务"
        hint="所有正式提交都已进入终态。可以把筛选切换到「系统故障」检查历史故障。"
      />

      <div v-else class="table-wrap">
        <table class="table table--compact">
          <thead>
            <tr>
              <th>提交</th>
              <th>题目 / 上下文</th>
              <th style="width: 110px">状态</th>
              <th style="width: 110px">阶段</th>
              <th style="width: 80px">尝试</th>
              <th style="width: 120px">工作进程</th>
              <th style="width: 130px">租约截止</th>
              <th style="width: 140px">判定 / 故障</th>
              <th style="width: 90px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.submissionId">
              <td>
                <RouterLink class="mono" :to="{ name: 'submission-detail', params: { id: row.submissionId } }">
                  #{{ row.submissionId }}
                </RouterLink>
                <div class="small faint">{{ formatRelative(row.acceptedAt) }}</div>
              </td>
              <td>
                <div class="small">{{ row.problemTitle }}</div>
                <div class="small faint">{{ row.contextType }}</div>
              </td>
              <td><StatusPill kind="submission" :value="row.status" /></td>
              <td class="small">{{ row.phase ? PHASE_LABEL[row.phase] : '—' }}</td>
              <td class="num">{{ row.attemptNo }}</td>
              <td class="mono small">{{ row.workerId ?? '—' }}</td>
              <td class="small muted">{{ formatDateTime(row.leaseUntil) }}</td>
              <td>
                <VerdictBadge v-if="row.verdict" :verdict="row.verdict" size="sm" />
                <span v-else-if="row.infraErrorCode" class="mono small">{{ row.infraErrorCode }}</span>
                <span v-else class="faint">—</span>
              </td>
              <td>
                <button
                  v-if="row.status === 'FAILED'"
                  class="btn btn--sm"
                  type="button"
                  @click="openRecover(row)"
                >
                  恢复
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="recovering" class="card mt-16 recover">
      <div class="card__head">
        <span class="card__title">人工恢复 #{{ recovering.submissionId }}</span>
        <button class="btn btn--ghost btn--sm" type="button" @click="recovering = null">取消</button>
      </div>
      <div class="card__body stack">
        <div class="alert alert--warn">
          <span class="alert__icon">!</span>
          <span>
            恢复会为同一逻辑提交创建新的执行尝试（attempt_no 递增），旧尝试保留为证据；
            幂等键保证重复点击不会创建第二个尝试。
          </span>
        </div>
        <label class="field">
          <span class="field__label">恢复原因（必填，会写入审计）</span>
          <textarea v-model="reason" class="textarea" rows="3" placeholder="例如：sandbox 启动失败，已重启监督进程" />
        </label>
        <div class="btn-row">
          <button class="btn btn--primary" type="button" :disabled="submitting" @click="submitRecover">
            <span v-if="submitting" class="spinner" aria-hidden="true" />
            确认恢复
          </button>
          <span class="small muted">已关闭（CLOSED）的考试提交会被拒绝恢复</span>
        </div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card__head">
        <span class="card__title">最近审计</span>
        <span class="small muted">敏感操作记录操作者、时间与对象</span>
      </div>
      <div v-if="audit.length === 0" class="card__body">
        <p class="small muted">暂无审计记录。</p>
      </div>
      <ul v-else class="audit">
        <li v-for="entry in audit" :key="entry.id" class="audit__item">
          <div class="audit__head">
            <span class="badge badge--neutral">{{ entry.action }}</span>
            <strong class="small">{{ entry.actorName }}</strong>
            <span class="small muted">{{ formatDateTime(entry.createdAt) }}</span>
          </div>
          <p class="small muted">
            {{ entry.targetType }} #{{ entry.targetId }} · {{ entry.detail }}
          </p>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.text-danger {
  color: var(--wa);
}

.recover {
  border-color: var(--ce);
  box-shadow: 0 0 0 3px var(--ce-soft);
}

.audit {
  margin: 0;
  padding: 0;
  list-style: none;
}

.audit__item {
  padding: 11px 18px;
  border-bottom: 1px solid var(--border);
}

.audit__item:last-child {
  border-bottom: none;
}

.audit__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 2px;
}
</style>
