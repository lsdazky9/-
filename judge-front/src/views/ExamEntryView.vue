<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { examApi } from '@/api/client'
import { ApiError, describeError } from '@/api/http'
import StatusPill from '@/components/StatusPill.vue'
import EmptyState from '@/components/EmptyState.vue'
import { DIFFICULTY_LABEL, EXAM_STATE_LABEL, type ExamDetail } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { useCountdown } from '@/composables/useCountdown'
import { formatDateTime, formatDuration, formatScore } from '@/utils/format'
import { toast } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const examId = computed(() => String(route.params.id))
const exam = ref<ExamDetail | null>(null)
const loading = ref(true)
const error = ref('')
const entering = ref(false)

const countdown = useCountdown(
  () => auth.serverNow(),
  () => exam.value?.endAt ?? null
)

const startCountdown = useCountdown(
  () => auth.serverNow(),
  () => exam.value?.startAt ?? null
)

const remainingText = computed(() =>
  countdown.remainingMs.value === null ? '—' : formatDuration(countdown.remainingMs.value)
)

const startInText = computed(() =>
  startCountdown.remainingMs.value === null ? '—' : formatDuration(startCountdown.remainingMs.value)
)

const effectiveState = computed(() => {
  if (!exam.value) return null
  if (exam.value.state === 'SCHEDULED' && !startCountdown.expired.value) return 'SCHEDULED'
  if (exam.value.state === 'SCHEDULED' && startCountdown.expired.value) return 'RUNNING'
  if (exam.value.state === 'RUNNING' && countdown.expired.value) return 'GRADING'
  return exam.value.state
})

const canEnter = computed(
  () => Boolean(exam.value) && exam.value!.isMember && effectiveState.value === 'RUNNING'
)

const problems = computed(() => exam.value?.problems ?? [])

async function load() {
  loading.value = true
  error.value = ''
  try {
    const detail = await examApi.detail(examId.value)
    exam.value = detail
    auth.syncServerTime(detail.serverTime)
  } catch (e) {
    error.value = describeError(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function enterExam() {
  if (!exam.value) return
  entering.value = true
  try {
    await examApi.enter(examId.value)
    toast.success('已进入考试', '若中途断线，重新进入会复用同一条考试记录')
    await load()
  } catch (e) {
    const err = e as ApiError
    if (err instanceof ApiError && err.status === 409) {
      toast.warn('暂时无法进入', err.message)
    } else {
      toast.error('进入考试失败', describeError(e))
    }
    await load()
  } finally {
    entering.value = false
  }
}

function openProblem(problemId: string) {
  router.push({ name: 'exam-workbench', params: { id: examId.value, problemId } })
}
</script>

<template>
  <div class="page">
    <div class="crumb">
      <RouterLink class="btn btn--ghost btn--sm" to="/exams">← 返回考试列表</RouterLink>
    </div>

    <div v-if="loading" class="stack">
      <span class="skeleton" style="width: 42%; height: 24px" />
      <span class="skeleton" style="height: 110px" />
      <span class="skeleton" style="height: 220px" />
    </div>

    <div v-else-if="error" class="card">
      <div class="card__body">
        <div class="alert alert--danger">
          <span class="alert__icon">!</span>
          <div class="stack stack--sm">
            <strong>无法打开这场考试</strong>
            <span>{{ error }}</span>
            <span class="small">不在名单内、未发布或已取消的考试，一律返回统一的不可见响应。</span>
            <button class="btn btn--sm" type="button" @click="load">重试</button>
          </div>
        </div>
      </div>
    </div>

    <template v-else-if="exam">
      <header class="exam-head card">
        <div class="exam-head__main">
          <div class="row gap-8">
            <h1>{{ exam.title }}</h1>
            <StatusPill kind="exam" :value="effectiveState ?? exam.state" />
          </div>
          <p class="page-head__sub">
            {{ exam.paperTitle }} · 出题人 {{ exam.ownerName }} · 满分
            {{ formatScore(exam.maxScore) }}
          </p>
          <div class="exam-head__time mono small">
            {{ formatDateTime(exam.startAt) }} → {{ formatDateTime(exam.endAt) }}
          </div>
        </div>

        <div class="exam-head__clock" :class="{ 'exam-head__clock--danger': countdown.expired.value }">
          <span class="small muted">
            {{ effectiveState === 'SCHEDULED' ? '距开始' : effectiveState === 'RUNNING' ? '剩余时间' : '已截止' }}
          </span>
          <strong class="mono">
            {{ effectiveState === 'SCHEDULED' ? startInText : effectiveState === 'RUNNING' ? remainingText : '00:00' }}
          </strong>
          <span class="small muted">服务端时间校准</span>
        </div>
      </header>

      <div class="grid-2 mt-16">
        <div class="card">
          <div class="card__head">
            <span class="card__title">考试须知</span>
            <span class="chip">{{ exam.allowedLanguages.join(' / ') }}</span>
          </div>
          <div class="card__body">
            <ul class="rules">
              <li>
                <strong>时间以服务器为准。</strong>
                只有后端资格校验时读取的数据库时间落在
                <code>[开始, 截止)</code> 内的提交才会被接受；前端倒计时仅用于提示。
              </li>
              <li>
                <strong>截止前已接受的提交仍会计分。</strong>
                接收与执行分离，截止后才跑完的评测结果依然归属本次考试。
              </li>
              <li>
                <strong>反馈只给判定类型。</strong>
                考试中不返回隐藏测试点数量、逐点耗时与通过点数量；总成绩待教师发布。
              </li>
              <li>
                <strong>不提供考试实时榜。</strong>
                学生不能查看他人成绩，教师只能查看自己所负责考试的考生提交。
              </li>
            </ul>
            <div class="alert alert--info mt-12">
              <span class="alert__icon">i</span>
              <span>
                环境摘要 <code class="mono">{{ exam.environmentDigest }}</code>
                在发布时固定，同一场考试使用同一编译环境与执行槽位规格。
              </span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card__head">
            <span class="card__title">状态与操作</span>
          </div>
          <div class="card__body stack">
            <div v-if="!exam.isMember" class="alert alert--danger">
              <span class="alert__icon">!</span>
              <span>你不在本场考试的名单中，无法进入作答。</span>
            </div>

            <template v-else>
              <div v-if="effectiveState === 'SCHEDULED'" class="alert alert--warn">
                <span class="alert__icon">!</span>
                <span>考试尚未开始。开始前不返回题面，请到时间后刷新本页。</span>
              </div>

              <div v-else-if="effectiveState === 'RUNNING'" class="stack stack--sm">
                <div class="row row--between">
                  <span class="small muted">考试记录</span>
                  <span class="small">{{ exam.entered ? '已创建' : '尚未进入' }}</span>
                </div>
                <button
                  v-if="!exam.entered"
                  class="btn btn--primary btn--lg btn--block"
                  type="button"
                  :disabled="entering || !canEnter"
                  @click="enterExam"
                >
                  <span v-if="entering" class="spinner" aria-hidden="true" />
                  {{ entering ? '正在进入…' : '进入考试' }}
                </button>
                <RouterLink
                  v-else
                  class="btn btn--primary btn--lg btn--block"
                  :to="problems.length ? { name: 'exam-workbench', params: { id: exam.id, problemId: problems[0].problemId } } : { name: 'exams' }"
                >
                  继续作答
                </RouterLink>
                <p class="small muted">
                  断线或刷新后重新进入会复用同一条考试记录，不会重复创建。
                </p>
              </div>

              <div v-else-if="effectiveState === 'GRADING'" class="alert alert--info">
                <span class="alert__icon">i</span>
                <span>
                  考试已截止，正在等待截止前接受的提交全部完成。教师汇总并发布成绩后才能查看本人分数。
                </span>
              </div>

              <div v-else-if="effectiveState === 'CLOSED'" class="stack stack--sm">
                <div class="row row--between">
                  <span class="small muted">本人总分</span>
                  <strong>{{ exam.myScore === null ? '待发布' : formatScore(exam.myScore) }}</strong>
                </div>
                <RouterLink class="btn btn--primary btn--block" :to="{ name: 'my-grade', params: { id: exam.id } }">
                  查看本人成绩
                </RouterLink>
              </div>

              <div v-else class="alert alert--warn">
                <span class="alert__icon">!</span>
                <span>{{ EXAM_STATE_LABEL[effectiveState ?? exam.state] }}：当前不可作答。</span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <div class="card mt-16">
        <div class="card__head">
          <span class="card__title">试卷题目</span>
          <span v-if="problems.length" class="small muted">共 {{ problems.length }} 题</span>
          <span v-else class="small muted">开始后显示</span>
        </div>

        <EmptyState
          v-if="problems.length === 0"
          :title="effectiveState === 'SCHEDULED' ? '题目在开始前不可见' : '暂无可显示的题目'"
          :hint="
            effectiveState === 'SCHEDULED'
              ? '这是有意为之：未开始的考试不泄露题面，避免提前作答。'
              : '如果考试正在进行而这里为空，请联系任课教师确认试卷配置。'
          "
        />

        <div v-else class="problem-list">
          <article v-for="item in problems" :key="item.problemId" class="problem">
            <div class="problem__main">
              <span class="problem__ordinal mono">{{ item.ordinal }}</span>
              <div class="stack stack--sm grow">
                <div class="row gap-8">
                  <strong class="problem__title">{{ item.title }}</strong>
                  <span class="badge" :class="{
                    'badge--ac': item.difficulty === 'EASY',
                    'badge--ce': item.difficulty === 'MEDIUM',
                    'badge--wa': item.difficulty === 'HARD'
                  }">{{ DIFFICULTY_LABEL[item.difficulty] }}</span>
                </div>
                <span class="small muted">
                  分值 {{ formatScore(item.fullScore) }} · 版本 v{{ item.versionNo }} ·
                  已提交 {{ item.submissionCount }} 次
                </span>
              </div>
            </div>
            <button
              class="btn btn--sm"
              :class="{ 'btn--primary': effectiveState === 'RUNNING' }"
              type="button"
              :disabled="effectiveState !== 'RUNNING' && effectiveState !== 'CLOSED'"
              @click="openProblem(item.problemId)"
            >
              打开题目
            </button>
          </article>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.crumb {
  margin-bottom: 14px;
}

.exam-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 22px;
  flex-wrap: wrap;
}

.exam-head__main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.exam-head__time {
  color: var(--ink-muted);
  margin-top: 2px;
}

.exam-head__clock {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  padding: 10px 16px;
  border-radius: var(--radius);
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  min-width: 170px;
}

.exam-head__clock strong {
  font-size: 26px;
  letter-spacing: 0.01em;
  color: var(--brand-strong);
  line-height: 1.2;
}

.exam-head__clock--danger {
  background: var(--wa-soft);
  border-color: #f6c9c6;
}

.exam-head__clock--danger strong {
  color: var(--wa);
}

.rules {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  color: var(--ink-soft);
  line-height: 1.6;
}

.rules li::marker {
  color: var(--brand);
}

.problem-list {
  display: flex;
  flex-direction: column;
}

.problem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}

.problem:last-child {
  border-bottom: none;
}

.problem__main {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  min-width: 0;
}

.problem__ordinal {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--bg-subtle);
  color: var(--ink-muted);
  font-size: 12px;
  font-weight: 700;
  flex: none;
}

.problem__title {
  font-size: 14px;
}
</style>
