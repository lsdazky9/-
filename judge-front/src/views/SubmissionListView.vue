<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { submissionApi } from '@/api/client'
import { describeError } from '@/api/http'
import type { SubmissionListItem, SubmissionStatus } from '@/api/types'
import { SUBMISSION_STATUS_LABEL } from '@/api/types'
import VerdictBadge from '@/components/VerdictBadge.vue'
import StatusPill from '@/components/StatusPill.vue'
import EmptyState from '@/components/EmptyState.vue'
import PagerBar from '@/components/PagerBar.vue'
import { formatDateTime } from '@/utils/format'

const router = useRouter()

const context = ref<'' | 'PRACTICE' | 'EXAM'>('')
const status = ref<'' | SubmissionStatus>('')
const page = ref(1)
const size = 15
const total = ref(0)
const rows = ref<SubmissionListItem[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await submissionApi.list({
      context: context.value,
      status: status.value,
      page: page.value,
      size
    })
    rows.value = result.items
    total.value = result.total
  } catch (e) {
    error.value = describeError(e)
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([context, status], () => {
  page.value = 1
  void load()
})
watch(page, () => void load())

const summary = computed(() => {
  const running = rows.value.filter((r) => r.status === 'RUNNING' || r.status === 'QUEUED').length
  const ok = rows.value.filter((r) => r.verdict === 'AC').length
  return { running, ok }
})

function openDetail(row: SubmissionListItem) {
  router.push({ name: 'submission-detail', params: { id: row.id } })
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head__main">
        <h1>提交记录</h1>
        <p class="page-head__sub">
          学生只能看到自己的提交；教师只能看到自己考试内的考生提交。对象级权限由后端判定，
          越权访问统一返回 404。
        </p>
      </div>
      <div class="row gap-8">
        <span class="chip">本页通过 {{ summary.ok }}</span>
        <span class="chip">进行中 {{ summary.running }}</span>
      </div>
    </header>

    <div class="card">
      <div class="toolbar">
        <div class="seg">
          <button
            v-for="item in [
              { value: '', label: '全部' },
              { value: 'PRACTICE', label: '练习' },
              { value: 'EXAM', label: '考试' }
            ]"
            :key="item.value"
            class="seg__btn"
            :class="{ 'seg__btn--active': context === item.value }"
            type="button"
            @click="context = item.value as '' | 'PRACTICE' | 'EXAM'"
          >
            {{ item.label }}
          </button>
        </div>

        <select v-model="status" class="select" aria-label="按状态筛选" style="max-width: 160px">
          <option value="">全部状态</option>
          <option v-for="(label, key) in SUBMISSION_STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
        </select>

        <span class="grow" />
        <button class="btn btn--sm" type="button" :disabled="loading" @click="load">刷新</button>
      </div>

      <div v-if="loading" class="skeleton-wrap">
        <span v-for="n in 6" :key="n" class="skeleton" style="width: 100%" />
      </div>

      <div v-else-if="error" class="card__body">
        <div class="alert alert--danger">
          <span class="alert__icon">!</span>
          <div class="stack stack--sm">
            <strong>提交列表加载失败</strong>
            <span>{{ error }}</span>
            <button class="btn btn--sm" type="button" @click="load">重试</button>
          </div>
        </div>
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="还没有提交"
        hint="去题库选一道题提交代码，这里会出现提交编号、评测状态和最终判定。"
      >
        <RouterLink class="btn btn--sm mt-8" to="/problems">去题库</RouterLink>
      </EmptyState>

      <template v-else>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th style="width: 90px">编号</th>
                <th>题目</th>
                <th>上下文</th>
                <th style="width: 120px">状态</th>
                <th style="width: 160px">判定</th>
                <th style="width: 170px">提交时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.id" class="clickable" @click="openDetail(row)">
                <td class="mono">#{{ row.id }}</td>
                <td>
                  <span class="strong">{{ row.problemTitle }}</span>
                </td>
                <td>
                  <span v-if="row.examTitle" class="small">{{ row.examTitle }}</span>
                  <span v-else class="badge badge--neutral">{{ row.contextType === 'VALIDATION' ? '题目校验' : '练习' }}</span>
                </td>
                <td><StatusPill kind="submission" :value="row.status" /></td>
                <td><VerdictBadge :verdict="row.verdict" size="sm" :placeholder="SUBMISSION_STATUS_LABEL[row.status]" /></td>
                <td class="small muted nowrap">{{ formatDateTime(row.acceptedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <PagerBar :page="page" :size="size" :total="total" :disabled="loading" @change="page = $event" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.seg {
  display: inline-flex;
  padding: 2px;
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
  gap: 2px;
}

.seg__btn {
  border: none;
  background: transparent;
  padding: 5px 12px;
  border-radius: 4px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-muted);
  cursor: pointer;
}

.seg__btn--active {
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-sm);
}

.clickable {
  cursor: pointer;
}

.skeleton-wrap {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 16px;
}
</style>
