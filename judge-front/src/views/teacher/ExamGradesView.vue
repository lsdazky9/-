<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { teacherApi } from '@/api/client'
import { ApiError, describeError } from '@/api/http'
import EmptyState from '@/components/EmptyState.vue'
import StatusPill from '@/components/StatusPill.vue'
import { formatDateTime, formatScore } from '@/utils/format'
import { toast } from '@/stores/toast'
import type { ExamGradeSummary } from '@/api/types'

const route = useRoute()
const router = useRouter()
const examId = computed(() => String(route.params.id))

const summary = ref<ExamGradeSummary | null>(null)
const loading = ref(true)
const error = ref('')
const publishing = ref(false)

const canPublish = computed(
  () => Boolean(summary.value) && !summary.value!.published && summary.value!.blockers.length === 0
)

const average = computed(() => {
  const rows = summary.value?.rows ?? []
  if (rows.length === 0) return 0
  const total = rows.reduce((sum, row) => sum + (row.totalScore ?? 0), 0)
  return total / rows.length
})

const notJoined = computed(() => (summary.value?.rows ?? []).filter((row) => !row.joinedAt).length)

async function load() {
  loading.value = true
  error.value = ''
  try {
    summary.value = await teacherApi.grades(examId.value)
  } catch (e) {
    error.value = describeError(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function publish() {
  publishing.value = true
  try {
    summary.value = await teacherApi.publishGrades(examId.value)
    toast.success('成绩已发布并冻结', '学生现在可以查询本人分题明细')
  } catch (e) {
    const err = e as ApiError
    if (err instanceof ApiError && err.status === 409) {
      toast.error('不能发布成绩', err.message)
    } else {
      toast.error('发布失败', describeError(e))
    }
    await load()
  } finally {
    publishing.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="crumb">
      <button class="btn btn--ghost btn--sm" type="button" @click="router.push({ name: 'teacher-exam', params: { id: examId } })">
        ← 返回考试配置
      </button>
    </div>

    <div v-if="loading" class="stack">
      <span class="skeleton" style="width: 34%; height: 24px" />
      <span class="skeleton" style="height: 120px" />
    </div>

    <div v-else-if="error" class="card">
      <div class="card__body">
        <div class="alert alert--danger">
          <span class="alert__icon">!</span>
          <div class="stack stack--sm">
            <strong>成绩汇总加载失败</strong>
            <span>{{ error }}</span>
            <button class="btn btn--sm" type="button" @click="load">重试</button>
          </div>
        </div>
      </div>
    </div>

    <template v-else-if="summary">
      <header class="page-head">
        <div class="page-head__main">
          <div class="row gap-8">
            <h1>成绩汇总</h1>
            <StatusPill kind="exam" :value="summary.state" />
            <span v-if="summary.published" class="badge badge--ac">已发布</span>
          </div>
          <p class="page-head__sub">
            每题取有效提交中的最高分；全对得满分，否则 0 分。系统故障不是 0 分依据，必须恢复后才能发布。
          </p>
        </div>
        <div class="btn-row">
          <button class="btn btn--sm" type="button" :disabled="loading" @click="load">刷新</button>
          <button class="btn btn--primary" type="button" :disabled="!canPublish || publishing" @click="publish">
            <span v-if="publishing" class="spinner" aria-hidden="true" />
            {{ summary.published ? '已发布' : publishing ? '发布中…' : '汇总并发布成绩' }}
          </button>
        </div>
      </header>

      <div class="grid-4">
        <div class="stat">
          <span class="stat__label">考生数</span>
          <span class="stat__value">{{ summary.rows.length }}</span>
          <span class="stat__hint">未进入考试 {{ notJoined }} 人</span>
        </div>
        <div class="stat">
          <span class="stat__label">平均分</span>
          <span class="stat__value">{{ formatScore(average) }}</span>
          <span class="stat__hint">满分 {{ formatScore(summary.maxScore) }}</span>
        </div>
        <div class="stat">
          <span class="stat__label">待处理任务</span>
          <span class="stat__value" :class="{ 'text-danger': summary.pendingTasks > 0 }">
            {{ summary.pendingTasks }}
          </span>
          <span class="stat__hint">截止前接受但未终态</span>
        </div>
        <div class="stat">
          <span class="stat__label">系统故障</span>
          <span class="stat__value" :class="{ 'text-danger': summary.systemErrors > 0 }">
            {{ summary.systemErrors }}
          </span>
          <span class="stat__hint">未解决时禁止发布</span>
        </div>
      </div>

      <div v-if="summary.published" class="alert alert--success mt-16">
        <span class="alert__icon">✓</span>
        <span>
          成绩已于 {{ formatDateTime(summary.publishedAt) }} 发布并冻结。发布后不再重评或改分，
          学生只能看到本人的分题明细。
        </span>
      </div>

      <div v-else-if="summary.blockers.length" class="alert alert--danger mt-16">
        <span class="alert__icon">!</span>
        <div>
          <strong>当前不能发布成绩</strong>
          <ul class="blocker-list">
            <li v-for="blocker in summary.blockers" :key="blocker.submissionId">
              <span class="mono">#{{ blocker.submissionId }}</span>
              <span>{{ blocker.reason }}</span>
              <RouterLink
                class="small"
                :to="{ name: 'submission-detail', params: { id: blocker.submissionId } }"
              >
                查看
              </RouterLink>
            </li>
          </ul>
          <p class="small mt-8">
            待处理任务需要等评测完成；系统故障需要管理员在运维页面恢复。P0 不提供“忽略故障强行发布”的后门。
          </p>
        </div>
      </div>

      <div class="card mt-16">
        <div class="card__head">
          <span class="card__title">考生成绩</span>
          <span class="small muted">未进入考试者发布时补建记录并记 0 分</span>
        </div>

        <EmptyState v-if="summary.rows.length === 0" title="还没有考生记录" hint="先发布考试并导入名单。" />

        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>考生</th>
                <th style="width: 100px">提交数</th>
                <th style="width: 110px">待处理</th>
                <th style="width: 110px">系统故障</th>
                <th style="width: 120px">进入时间</th>
                <th style="width: 100px">总分</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in summary.rows" :key="row.userId">
                <td>
                  <div class="row gap-8">
                    <strong>{{ row.displayName }}</strong>
                    <span class="mono small faint">{{ row.username }}</span>
                  </div>
                </td>
                <td class="num">{{ row.submittedCount }}</td>
                <td class="num" :class="{ 'text-danger': row.pendingCount > 0 }">{{ row.pendingCount || '—' }}</td>
                <td class="num" :class="{ 'text-danger': row.systemErrorCount > 0 }">
                  {{ row.systemErrorCount || '—' }}
                </td>
                <td class="small muted">{{ row.joinedAt ? formatDateTime(row.joinedAt) : '未进入' }}</td>
                <td class="num strong">
                  {{ summary.published ? formatScore(row.totalScore) : formatScore(row.totalScore) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.crumb {
  margin-bottom: 14px;
}

.text-danger {
  color: var(--wa);
}

.blocker-list {
  margin: 6px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12.5px;
}

.blocker-list li {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}
</style>
