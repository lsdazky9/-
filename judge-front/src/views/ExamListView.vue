<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { examApi } from '@/api/client'
import { describeError } from '@/api/http'
import { EXAM_STATE_LABEL, type ExamState, type ExamSummary } from '@/api/types'
import EmptyState from '@/components/EmptyState.vue'
import { formatDateTime } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const exams = ref<ExamSummary[]>([])
const loading = ref(true)
const error = ref('')
const filter = ref<'' | 'active' | 'upcoming' | 'ended'>('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await examApi.list({ page: 1, size: 50 })
    exams.value = result.items
  } catch (e) {
    error.value = describeError(e)
    exams.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)

const grouped = computed(() => {
  const bucket = { active: [] as ExamSummary[], upcoming: [] as ExamSummary[], ended: [] as ExamSummary[] }
  for (const exam of exams.value) {
    if (exam.state === 'RUNNING') bucket.active.push(exam)
    else if (exam.state === 'SCHEDULED' || exam.state === 'DRAFT') bucket.upcoming.push(exam)
    else bucket.ended.push(exam)
  }
  if (filter.value === 'active') return [{ key: 'active', title: '进行中', rows: bucket.active }]
  if (filter.value === 'upcoming') return [{ key: 'upcoming', title: '待开始', rows: bucket.upcoming }]
  if (filter.value === 'ended') return [{ key: 'ended', title: '已结束', rows: bucket.ended }]
  return [
    { key: 'active', title: '进行中', rows: bucket.active },
    { key: 'upcoming', title: '待开始', rows: bucket.upcoming },
    { key: 'ended', title: '已结束 / 已取消', rows: bucket.ended }
  ]
})

const hasAny = computed(() => exams.value.length > 0)

function stateTone(state: ExamState) {
  return state === 'RUNNING' ? 'badge--ac' : state === 'SCHEDULED' ? 'badge--brand' : 'badge--neutral'
}

function openExam(exam: ExamSummary) {
  router.push({ name: 'exam-entry', params: { id: exam.id } })
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head__main">
        <h1>考试</h1>
        <p class="page-head__sub">
          你只能看到自己名单内的考试，以及自己作为教师拥有的考试。开始时间与截止时间一律由服务端裁决。
        </p>
      </div>
      <button class="btn btn--sm" type="button" :disabled="loading" @click="load">刷新</button>
    </header>

    <div class="filters">
      <button
        v-for="item in [
          { value: '', label: '全部' },
          { value: 'active', label: '进行中' },
          { value: 'upcoming', label: '待开始' },
          { value: 'ended', label: '已结束' }
        ]"
        :key="item.value"
        class="filter"
        :class="{ 'filter--active': filter === item.value }"
        type="button"
        @click="filter = item.value as '' | 'active' | 'upcoming' | 'ended'"
      >
        {{ item.label }}
      </button>
    </div>

    <div v-if="loading" class="stack">
      <span v-for="n in 3" :key="n" class="skeleton" style="height: 84px" />
    </div>

    <div v-else-if="error" class="card">
      <div class="card__body">
        <div class="alert alert--danger">
          <span class="alert__icon">!</span>
          <div class="stack stack--sm">
            <strong>考试列表加载失败</strong>
            <span>{{ error }}</span>
            <button class="btn btn--sm" type="button" @click="load">重试</button>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="!hasAny" class="card">
      <EmptyState
        title="当前没有考试"
        hint="考试由教师创建并发布。发布后你会在名单内看到入口，开始前不显示题面。"
      />
    </div>

    <template v-else>
      <section v-for="group in grouped" :key="group.key" class="group">
        <h2 class="group__title">
          {{ group.title }}
          <span class="group__count">{{ group.rows.length }}</span>
        </h2>

        <div v-if="group.rows.length === 0" class="group__empty small muted">没有{{ group.title }}的考试</div>

        <div v-else class="exam-list">
          <article
            v-for="exam in group.rows"
            :key="exam.id"
            class="exam"
            :class="{ 'exam--active': exam.state === 'RUNNING' }"
            @click="openExam(exam)"
          >
            <div class="exam__main">
              <div class="exam__title-row">
                <h3>{{ exam.title }}</h3>
                <span class="badge" :class="stateTone(exam.state)">{{ EXAM_STATE_LABEL[exam.state] }}</span>
                <span v-if="!exam.isMember && auth.isStudent" class="badge badge--neutral">不在名单</span>
              </div>
              <div class="exam__meta">
                <span>{{ exam.paperTitle }}</span>
                <span class="dot-sep">·</span>
                <span>出题人 {{ exam.ownerName }}</span>
                <span v-if="exam.memberCount !== null" class="dot-sep">·</span>
                <span v-if="exam.memberCount !== null">{{ exam.memberCount }} 名考生</span>
              </div>
              <div class="exam__time mono small">
                {{ formatDateTime(exam.startAt) }} → {{ formatDateTime(exam.endAt) }}
              </div>
            </div>

            <div class="exam__side">
              <div v-if="exam.state === 'CLOSED'" class="btn-row">
                <RouterLink class="btn btn--sm" :to="{ name: 'my-grade', params: { id: exam.id } }" @click.stop>
                  查看成绩
                </RouterLink>
              </div>
              <span class="exam__go small">进入 →</span>
            </div>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 6px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}

.filter {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 999px;
  padding: 5px 14px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-muted);
  cursor: pointer;
}

.filter--active {
  background: var(--ink);
  border-color: var(--ink);
  color: #fff;
}

.group {
  margin-bottom: 26px;
}

.group__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 650;
  color: var(--ink-soft);
  margin-bottom: 10px;
}

.group__count {
  display: inline-grid;
  place-items: center;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--ink-muted);
  font-size: 11px;
  font-weight: 700;
}

.group__empty {
  padding: 14px 16px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface-sunken);
}

.exam-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.exam {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}

.exam:hover {
  border-color: var(--brand-line);
  box-shadow: var(--shadow);
}

.exam--active {
  border-left: 3px solid var(--ac);
}

.exam__main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.exam__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.exam__title-row h3 {
  font-size: 14.5px;
  font-weight: 650;
}

.exam__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--ink-muted);
  flex-wrap: wrap;
}

.dot-sep {
  color: var(--ink-faint);
}

.exam__time {
  color: var(--ink-faint);
  font-size: 11.5px;
}

.exam__side {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}

.exam__go {
  color: var(--brand);
  font-weight: 600;
}

@media (max-width: 640px) {
  .exam {
    flex-direction: column;
    align-items: flex-start;
  }
  .exam__go {
    display: none;
  }
}
</style>
