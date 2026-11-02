<script setup lang="ts">
/**
 * 做题工作台（练习 / 考试共用）。
 *
 * 布局按 §6.3：题面约 45%、编辑器约 55%、结果在编辑器下方，小屏上下排列。
 *
 * 交互要点：
 * - 提交使用幂等键：一次用户点击一个键，网络失败重试复用，成功后换新键；
 * - 结果轮询 2 秒起、长排队退避到 5 秒，终态立即停止；
 * - 考试期间只展示阶段与最终判定，隐藏测试点数量与逐点细节（BR-12）；
 * - 倒计时用服务端时间校准，只用于显示，能否提交由后端裁决（BR-01）；
 * - 刷新页面后能恢复上次已接受的提交并继续轮询（FT-14）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import CodeEditor from '@/components/CodeEditor.vue'
import MarkdownView from '@/components/MarkdownView.vue'
import VerdictBadge from '@/components/VerdictBadge.vue'
import StatusPill from '@/components/StatusPill.vue'
import { examApi, problemApi, submissionApi } from '@/api/client'
import { ApiError, describeError } from '@/api/http'
import {
  LANGUAGE_LABEL,
  LANGUAGE_MONACO,
  LANGUAGE_OPTIONS,
  PHASE_LABEL,
  SUBMISSION_STATUS_LABEL,
  type ExamDetail,
  type Language,
  type ProblemDetail,
  type SubmissionDetail
} from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { usePolling } from '@/composables/usePolling'
import { useCountdown } from '@/composables/useCountdown'
import { clearDraft, readDraft, writeDraft } from '@/utils/draft'
import { uuid } from '@/utils/id'
import { formatBytes, formatDateTime, formatMs, formatMemory, formatDuration } from '@/utils/format'
import { toast } from '@/stores/toast'

const props = defineProps<{
  mode: 'practice' | 'exam'
  problemId: string
  examId?: string
}>()

const auth = useAuthStore()
const router = useRouter()

/** 各语言的起始模板：切换语言且代码为空（或仍是上一份模板）时自动替换。 */
const TEMPLATES: Record<Language, string> = {
  CPP17: `#include <iostream>

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    // 在此编写你的代码

    return 0;
}
`,
  C11: `#include <stdio.h>

int main(void) {
    // 在此编写你的代码

    return 0;
}
`,
  PY3: `import sys


def main() -> None:
    data = sys.stdin.read().split()
    # 在此编写你的代码


if __name__ == "__main__":
    main()
`,
  JAVA17: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        // 在此编写你的代码
    }
}
`
}

const problem = ref<ProblemDetail | null>(null)
const exam = ref<ExamDetail | null>(null)
const loading = ref(true)
const loadError = ref('')

const sourceCode = ref('')
const language = ref<Language>('CPP17')
const submitting = ref(false)
const submitError = ref('')
const submitNotice = ref('')
const idempotencyKey = ref<string | null>(null)

/** 本次上下文可选语言：考试取发布时固定的列表，练习取题目标注的支持列表。 */
const availableLanguages = computed<Language[]>(() => {
  if (isExam.value && exam.value) return exam.value.allowedLanguages as Language[]
  return problem.value?.languages ?? ['CPP17']
})

const languageOptions = computed(() =>
  LANGUAGE_OPTIONS.filter((option) => availableLanguages.value.includes(option.value))
)

const currentLanguageNote = computed(
  () => LANGUAGE_OPTIONS.find((option) => option.value === language.value)?.note ?? ''
)

const editorLanguage = computed(() => LANGUAGE_MONACO[language.value])

const submission = ref<SubmissionDetail | null>(null)
const restoring = ref(false)

const draftFrom = ref<number | null>(null)
const showDraftBanner = ref(false)

const tab = ref<'result' | 'code'>('result')

const isExam = computed(() => props.mode === 'exam')
const contextKey = computed(() => (isExam.value ? `exam-${props.examId}` : 'practice'))

const examCountdown = useCountdown(
  () => auth.serverNow(),
  () => exam.value?.endAt ?? null
)

const examRemainingText = computed(() => {
  if (!isExam.value) return ''
  const remaining = examCountdown.remainingMs.value
  return remaining === null ? '—' : formatDuration(remaining)
})

const examStarted = computed(() => {
  if (!isExam.value) return true
  if (!exam.value) return false
  return Date.parse(exam.value.startAt) <= auth.serverNow()
})

const examEnded = computed(() => {
  if (!isExam.value) return false
  if (!exam.value) return false
  return examCountdown.expired.value || exam.value.state === 'CLOSED' || exam.value.state === 'CANCELED'
})

const canSubmit = computed(() => {
  if (submitting.value) return false
  if (!problem.value) return false
  if (!sourceCode.value.trim()) return false
  if (isExam.value && (examEnded.value || !examStarted.value)) return false
  return true
})

const submitBlockedReason = computed(() => {
  if (!problem.value) return '题面尚未加载'
  if (!sourceCode.value.trim()) return '代码不能为空'
  if (isExam.value && !examStarted.value) return '考试尚未开始，不能提交'
  if (isExam.value && examEnded.value) return '考试已截止，服务器将拒绝提交'
  return ''
})

const isTerminal = (detail: SubmissionDetail) => detail.status === 'FINISHED' || detail.status === 'FAILED'

const poller = usePolling<SubmissionDetail>({
  fetcher: async () => {
    const id = submission.value?.id
    if (!id) throw new Error('no submission')
    const detail = await submissionApi.detail(id)
    submission.value = detail
    return detail
  },
  shouldContinue: (detail) => !isTerminal(detail),
  suggestedDelayMs: () => submission.value?.pollAfterMs ?? null,
  onError: (e) => {
    if (e instanceof ApiError && e.status === 401) {
      poller.stop()
      void router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
    }
  }
})

const pollingActive = computed(() => poller.active.value)

const stepIndex = computed(() => {
  const detail = submission.value
  if (!detail) return -1
  if (detail.status === 'FINISHED' || detail.status === 'FAILED') return 5
  if (detail.status === 'QUEUED') return 0
  if (detail.status === 'RUNNING') {
    switch (detail.phase) {
      case 'PREPARING':
      case 'COMPILING':
        return 1
      case 'RUNNING':
        return 2
      case 'REPORTING':
        return 3
      default:
        return 1
    }
  }
  return 4
})

const steps = ['已接收', '编译', '运行测试点', '回报结果', '完成']
const examCaseHidden = computed(() => isExam.value)

const visibleCases = computed(() => {
  const detail = submission.value
  if (!detail) return []
  if (isExam.value) return []
  return detail.cases
})

const acPeak = computed(() => {
  const cases = submission.value?.cases ?? []
  return {
    cpu: cases.reduce((max, item) => Math.max(max, item.cpuMs), 0),
    memory: cases.reduce((max, item) => Math.max(max, item.memoryKb), 0)
  }
})

async function loadAll() {
  loading.value = true
  loadError.value = ''
  try {
    if (isExam.value && props.examId) {
      const [detail, examDetail] = await Promise.all([
        examApi.problem(props.examId, props.problemId),
        examApi.detail(props.examId)
      ])
      problem.value = detail
      exam.value = examDetail
      auth.syncServerTime(examDetail.serverTime)
    } else {
      problem.value = await problemApi.detail(props.problemId)
    }
    prepareEditor()
    await restoreLastSubmission()
  } catch (e) {
    loadError.value = describeError(e)
  } finally {
    loading.value = false
  }
}

function prepareEditor() {
  const user = auth.user
  if (!user || !problem.value) return
  const draft = readDraft(user.id, contextKey.value, problem.value.versionId)
  const fallback = (problem.value.language ?? 'CPP17') as Language
  const allowed = availableLanguages.value
  if (draft && draft.sourceCode.trim()) {
    sourceCode.value = draft.sourceCode
    const draftLanguage = draft.language as Language | undefined
    if (draftLanguage && allowed.includes(draftLanguage)) language.value = draftLanguage
    else if (allowed.includes(fallback)) language.value = fallback
    else language.value = allowed[0] ?? 'CPP17'
    draftFrom.value = draft.updatedAt
    showDraftBanner.value = true
  } else {
    if (allowed.includes(fallback)) language.value = fallback
    else language.value = allowed[0] ?? 'CPP17'
    sourceCode.value = ''
  }
}

function lastSubmissionKey(): string {
  return `judge.lastSubmission.${auth.user?.id ?? 'anon'}.${contextKey.value}.${props.problemId}`
}

async function restoreLastSubmission() {
  const id = sessionStorage.getItem(lastSubmissionKey())
  if (!id) return
  restoring.value = true
  try {
    const detail = await submissionApi.detail(id)
    submission.value = detail
    if (!isTerminal(detail)) poller.start(true)
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) {
      submitError.value = describeError(e)
    }
    sessionStorage.removeItem(lastSubmissionKey())
  } finally {
    restoring.value = false
  }
}

let draftTimer: number | undefined
function scheduleDraftSave() {
  const user = auth.user
  const currentProblem = problem.value
  if (!user || !currentProblem) return
  window.clearTimeout(draftTimer)
  draftTimer = window.setTimeout(() => {
    writeDraft(user.id, contextKey.value, currentProblem.versionId, sourceCode.value, language.value)
  }, 400)
}

watch(sourceCode, () => scheduleDraftSave())

/** 切换语言：只有空代码或仍是某个内置模板时才自动换成新语言模板，避免覆盖用户代码。 */
function onLanguageChange(next: Language) {
  const previous = language.value
  const isTemplate = !sourceCode.value.trim() || sourceCode.value === TEMPLATES[previous]
  language.value = next
  if (isTemplate) sourceCode.value = TEMPLATES[next]
  scheduleDraftSave()
}

function discardDraft() {
  const user = auth.user
  if (!user || !problem.value) return
  clearDraft(user.id, contextKey.value, problem.value.versionId)
  sourceCode.value = ''
  draftFrom.value = null
  showDraftBanner.value = false
}

function insertTemplate() {
  if (!sourceCode.value.trim()) sourceCode.value = TEMPLATES[language.value]
}

async function onSubmit() {
  if (!problem.value) return
  if (!sourceCode.value.trim()) {
    submitError.value = '代码不能为空'
    return
  }
  submitting.value = true
  submitError.value = ''
  submitNotice.value = ''
  idempotencyKey.value = idempotencyKey.value ?? uuid()

  try {
    const result = await submissionApi.submit(
      {
        problemId: problem.value.id,
        examId: isExam.value ? props.examId ?? null : null,
        language: language.value,
        sourceCode: sourceCode.value
      },
      idempotencyKey.value
    )
    idempotencyKey.value = null
    sessionStorage.setItem(lastSubmissionKey(), result.submissionId)
    submitNotice.value = `已接收，提交编号 ${result.submissionId}`
    tab.value = 'result'
    submission.value = await submissionApi.detail(result.submissionId)
    poller.start(true)
    toast.success('提交已进入评测队列', `编号 ${result.submissionId}`)
  } catch (e) {
    const err = e as ApiError
    submitError.value = describeError(e)
    if (err instanceof ApiError && err.status === 409 && err.code === 'IDEMPOTENCY_CONFLICT') {
      idempotencyKey.value = null
    }
    if (err instanceof ApiError && err.status === 429) {
      toast.warn(
        '提交被限流',
        err.retryAfterMs ? `建议 ${Math.ceil(err.retryAfterMs / 1000)} 秒后再试` : undefined
      )
    }
  } finally {
    submitting.value = false
  }
}

function copyText(text: string, label: string) {
  navigator.clipboard
    ?.writeText(text)
    .then(() => toast.success(`${label}已复制`))
    .catch(() => toast.error('复制失败，请手动选择文本'))
}

/* ---------------------- 可拖动：评测结果区域高度 ---------------------- */

const RESULT_MIN = 150
const RESULT_DEFAULT = 300
const RESULT_STORAGE_KEY = 'judge.resultPanelHeight'

const shell = ref<HTMLElement | null>(null)
const dragging = ref(false)
const resultHeight = ref(readSavedHeight())

function readSavedHeight(): number {
  const raw = Number(localStorage.getItem(RESULT_STORAGE_KEY))
  return Number.isFinite(raw) && raw >= RESULT_MIN ? raw : RESULT_DEFAULT
}

function clampResultHeight(value: number): number {
  const total = shell.value?.clientHeight ?? window.innerHeight
  const max = Math.max(RESULT_MIN + 80, total - 260)
  return Math.min(max, Math.max(RESULT_MIN, value))
}

function saveResultHeight(): void {
  localStorage.setItem(RESULT_STORAGE_KEY, String(Math.round(resultHeight.value)))
}

function startResize(event: PointerEvent): void {
  if (window.innerWidth <= 1024) return
  dragging.value = true
  const startY = event.clientY
  const startHeight = resultHeight.value

  const onMove = (moveEvent: PointerEvent) => {
    // 向上拖拽 → 结果区变高
    resultHeight.value = clampResultHeight(startHeight + (startY - moveEvent.clientY))
  }
  const onUp = () => {
    dragging.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    saveResultHeight()
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  event.preventDefault()
}

function onSplitterKey(event: KeyboardEvent): void {
  const step = event.shiftKey ? 60 : 20
  if (event.key === 'ArrowUp') {
    resultHeight.value = clampResultHeight(resultHeight.value + step)
  } else if (event.key === 'ArrowDown') {
    resultHeight.value = clampResultHeight(resultHeight.value - step)
  } else if (event.key === 'Enter') {
    resultHeight.value = RESULT_DEFAULT
  } else {
    return
  }
  event.preventDefault()
  saveResultHeight()
}

function resetResultHeight(): void {
  resultHeight.value = RESULT_DEFAULT
  saveResultHeight()
}

onMounted(loadAll)
</script>

<template>
  <div ref="shell" class="wb">
    <div class="wb__bar">
      <button
        class="btn btn--ghost btn--sm"
        type="button"
        @click="router.push(isExam ? { name: 'exam-entry', params: { id: examId } } : { name: 'problems' })"
      >
        ← {{ isExam ? '返回考试' : '返回题库' }}
      </button>

      <div class="wb__title">
        <span class="mono small faint">#{{ problemId }}</span>
        <strong>{{ problem?.title ?? '加载中…' }}</strong>
        <span v-if="isExam" class="badge badge--brand">考试作答</span>
        <span v-else class="badge badge--neutral">练习</span>
      </div>

      <span class="grow" />

      <div v-if="isExam" class="wb__countdown" :class="{ 'wb__countdown--danger': examEnded }">
        <span class="small muted">剩余</span>
        <strong class="mono">{{ examRemainingText }}</strong>
      </div>

      <div class="wb__bar-actions">
        <button
          class="btn btn--primary"
          type="button"
          :disabled="!canSubmit"
          :title="submitBlockedReason"
          @click="onSubmit"
        >
          <span v-if="submitting" class="spinner" aria-hidden="true" />
          {{ submitting ? '提交中…' : '提交评测' }}
        </button>
        <span class="wb__kbd small muted"><kbd class="kbd">Ctrl</kbd>+<kbd class="kbd">↵</kbd></span>
      </div>
    </div>

    <div class="wb__body">
      <section class="wb__pane wb__pane--statement">
        <div v-if="loading" class="wb__skeleton">
          <span class="skeleton" style="width: 42%; height: 18px" />
          <span class="skeleton" style="width: 88%" />
          <span class="skeleton" style="width: 76%" />
          <span class="skeleton" style="width: 64%" />
          <span class="skeleton" style="width: 80%" />
        </div>

        <div v-else-if="loadError" class="wb__state">
          <div class="alert alert--danger">
            <span class="alert__icon">!</span>
            <div class="stack stack--sm">
              <strong>题面加载失败</strong>
              <span>{{ loadError }}</span>
              <button class="btn btn--sm" type="button" @click="loadAll">重试</button>
            </div>
          </div>
        </div>

        <template v-else-if="problem">
          <div class="wb__pane-head">
            <h2>{{ problem.title }}</h2>
            <div class="row gap-4">
              <span class="chip">v{{ problem.versionNo }}</span>
              <span class="chip">{{ problem.checkerType }}</span>
            </div>
          </div>

          <div class="wb__limits">
            <span class="chip">CPU {{ formatMs(problem.limits.timeLimitMs) }}</span>
            <span class="chip">Wall {{ formatMs(problem.limits.wallLimitMs) }}</span>
            <span class="chip">内存 {{ formatMemory(problem.limits.memoryLimitKb) }}</span>
            <span class="chip">输出 {{ formatBytes(problem.limits.outputLimitBytes) }}</span>
          </div>

          <div class="wb__statement">
            <MarkdownView :source="problem.statementMarkdown" />
          </div>

          <div v-if="problem.samples.length" class="wb__samples">
            <h3 class="wb__section-title">样例</h3>
            <div v-for="sample in problem.samples" :key="sample.ordinal" class="sample">
              <div class="sample__head">
                <span class="small muted">样例 {{ sample.ordinal }}</span>
                <button class="btn btn--ghost btn--sm" type="button" @click="copyText(sample.input, '输入')">
                  复制输入
                </button>
              </div>
              <div class="sample__grid">
                <div class="sample__cell">
                  <span class="sample__label">输入</span>
                  <pre class="sample__pre">{{ sample.input }}</pre>
                </div>
                <div class="sample__cell">
                  <span class="sample__label">输出</span>
                  <pre class="sample__pre">{{ sample.expectedOutput }}</pre>
                </div>
              </div>
            </div>
          </div>

          <div v-if="isExam" class="alert alert--warn mt-16">
            <span class="alert__icon">!</span>
            <span>
              考试期间只返回任务阶段与最终判定，不展示隐藏测试点数量、耗时明细与逐点结果；
              总成绩需等待教师发布。
            </span>
          </div>
        </template>
      </section>

      <section class="wb__pane wb__pane--code">
        <div class="wb__code-head">
          <div class="row gap-8">
            <select
              class="select select--lang"
              :value="language"
              aria-label="编程语言"
              @change="onLanguageChange(($event.target as HTMLSelectElement).value as Language)"
            >
              <option v-for="option in languageOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
            <span class="muted small">{{ currentLanguageNote }}</span>
          </div>
          <div class="row gap-8">
            <button v-if="!sourceCode.trim()" class="btn btn--sm" type="button" @click="insertTemplate">
              插入模板
            </button>
            <button class="btn btn--sm" type="button" @click="copyText(sourceCode, '代码')">复制</button>
          </div>
        </div>

        <div v-if="showDraftBanner" class="wb__draft">
          <span class="small">
            已恢复 {{ draftFrom ? formatDateTime(new Date(draftFrom).toISOString()) : '上次' }} 的浏览器草稿。
            草稿仅在本机保存，不是提交证据。
          </span>
          <button class="btn btn--ghost btn--sm" type="button" @click="discardDraft">清除草稿</button>
        </div>

        <div class="wb__editor">
          <CodeEditor
            v-model="sourceCode"
            :read-only="examEnded"
            :language="editorLanguage"
            :aria-label="`${LANGUAGE_LABEL[language]} 源码编辑器`"
            @submit="onSubmit"
          />
        </div>

        <div v-if="submitError" class="wb__inline-alert">
          <div class="alert alert--danger">
            <span class="alert__icon">!</span>
            <div class="grow">
              <span>{{ submitError }}</span>
              <button
                v-if="idempotencyKey"
                class="btn btn--sm mt-8"
                type="button"
                :disabled="submitting"
                @click="onSubmit"
              >
                用同一幂等键重试
              </button>
            </div>
          </div>
        </div>
        <p v-else-if="submitBlockedReason" class="wb__blocked small muted">{{ submitBlockedReason }}</p>
        <p v-else-if="submitNotice" class="wb__blocked small muted">{{ submitNotice }}</p>
      </section>
    </div>

    <div
      class="wb__splitter"
      :class="{ 'wb__splitter--active': dragging }"
      role="separator"
      aria-orientation="horizontal"
      aria-label="拖动调整评测结果区域高度，方向键微调，双击复位"
      :aria-valuenow="Math.round(resultHeight)"
      aria-valuemin="150"
      tabindex="0"
      @pointerdown="startResize"
      @keydown="onSplitterKey"
      @dblclick="resetResultHeight"
    >
      <span class="wb__splitter-grip" aria-hidden="true" />
      <span class="wb__splitter-hint">拖动调整结果区高度</span>
    </div>

    <section class="wb__result" :style="{ height: `${resultHeight}px` }">
      <div class="wb__result-head">
        <div class="tabs">
          <button class="tab" :class="{ 'tab--active': tab === 'result' }" type="button" @click="tab = 'result'">
            评测结果
          </button>
          <button class="tab" :class="{ 'tab--active': tab === 'code' }" type="button" @click="tab = 'code'">
            我的源码
          </button>
        </div>
        <div class="row gap-8 small muted">
          <span v-if="submission" class="mono">#{{ submission.id }}</span>
          <span v-if="pollingActive" class="row gap-4">
            <span class="spinner spinner--dark" aria-hidden="true" />
            每 {{ Math.round((submission?.pollAfterMs ?? 2000) / 1000) }} 秒刷新
          </span>
          <RouterLink
            v-if="submission"
            :to="{ name: 'submission-detail', params: { id: submission.id } }"
            class="small"
          >
            查看详情 ↗
          </RouterLink>
        </div>
      </div>

      <div v-if="restoring" class="wb__result-body">
        <span class="skeleton" style="width: 40%" />
      </div>

      <div v-else-if="tab === 'code'" class="wb__result-body">
        <pre class="code-block">{{ sourceCode || '（尚未编写代码）' }}</pre>
      </div>

      <div v-else-if="!submission" class="wb__result-body">
        <div class="empty">
          <span class="empty__icon">◍</span>
          <p class="empty__title">还没有提交</p>
          <p class="empty__hint">
            提交后在这里观察评测推进：已接收 → 编译 → 运行测试点 → 回报结果。
            排队与执行分离，提交编号在结果出来之前就可以追踪。
          </p>
        </div>
      </div>

      <div v-else class="wb__result-body">
        <div class="result-head">
          <div class="result-head__verdict">
            <VerdictBadge :verdict="submission.verdict" :placeholder="SUBMISSION_STATUS_LABEL[submission.status]" />
            <div class="result-head__meta">
              <span class="small muted">{{ formatDateTime(submission.acceptedAt) }} 提交</span>
              <span v-if="submission.finishedAt" class="small muted">
                · {{ formatDateTime(submission.finishedAt) }} 完成
              </span>
            </div>
          </div>

          <div class="result-head__stats">
            <div class="stat">
              <span class="stat__label">状态</span>
              <StatusPill kind="submission" :value="submission.status" />
            </div>
            <div class="stat">
              <span class="stat__label">阶段</span>
              <strong class="small">{{ submission.phase ? PHASE_LABEL[submission.phase] : '—' }}</strong>
            </div>
            <div class="stat">
              <span class="stat__label">版本</span>
              <strong class="small mono">v{{ submission.versionNo }}</strong>
            </div>
            <div class="stat">
              <span class="stat__label">重试</span>
              <strong class="small num">{{ submission.retryCount }} / 2</strong>
            </div>
          </div>
        </div>

        <ol class="steps">
          <li
            v-for="(label, index) in steps"
            :key="label"
            class="steps__item"
            :class="{
              'steps__item--done': index < stepIndex,
              'steps__item--active': index === stepIndex,
              'steps__item--failed': submission.status === 'FAILED' && index === 4
            }"
          >
            <span class="steps__dot" aria-hidden="true" />
            <span class="steps__label">{{ label }}</span>
          </li>
        </ol>

        <div v-if="submission.status === 'RETRY_WAIT'" class="alert alert--warn mt-12">
          <span class="alert__icon">!</span>
          <span>
            评测遇到基础设施问题，正在按退避策略重试（本轮自动重试 {{ submission.retryCount }} 次），
            预计 {{ submission.retryAt ? formatDateTime(submission.retryAt) : '稍后' }} 重新领取。
            这不是你的代码错误。
          </span>
        </div>

        <div v-if="submission.verdict === 'SYSTEM_ERROR'" class="alert alert--danger mt-12">
          <span class="alert__icon">!</span>
          <span>
            系统故障：sandbox 或基础设施未能完成评测。它不会被算作答案错误，
            也不会阻止你继续练习；考试中该题成绩需等管理员恢复后才能发布。
          </span>
        </div>

        <div v-if="submission.finishedAt && submission.verdict === 'AC'" class="result-ac mt-12">
          <strong>通过全部测试点</strong>
          <span class="small">
            峰值 CPU {{ formatMs(acPeak.cpu) }} · 峰值内存 {{ formatMemory(acPeak.memory) }}
          </span>
        </div>

        <div v-if="examCaseHidden && submission.finishedAt" class="alert alert--info mt-12">
          <span class="alert__icon">i</span>
          <span>{{ submission.policyNote ?? '考试期间不展示逐点细节。' }}</span>
        </div>

        <div v-if="!examCaseHidden && visibleCases.length" class="table-wrap mt-12">
          <table class="table table--compact">
            <thead>
              <tr>
                <th style="width: 70px">测试点</th>
                <th style="width: 150px">判定</th>
                <th>CPU</th>
                <th>内存</th>
                <th>类型</th>
                <th>差异</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in visibleCases" :key="item.ordinal">
                <td class="mono">#{{ item.ordinal }}</td>
                <td><VerdictBadge :verdict="item.verdict" size="sm" /></td>
                <td class="num small">{{ formatMs(item.cpuMs) }}</td>
                <td class="num small">{{ formatMemory(item.memoryKb) }}</td>
                <td>
                  <span class="badge" :class="item.isSample ? 'badge--brand' : 'badge--neutral'">
                    {{ item.isSample ? '公开样例' : '隐藏' }}
                  </span>
                </td>
                <td class="small">
                  <details v-if="item.expectedOutput !== null">
                    <summary>查看样例差异</summary>
                    <div class="diff">
                      <pre class="diff__col">期望：{{ item.expectedOutput }}</pre>
                      <pre class="diff__col">实际：{{ item.actualOutput ?? '（无输出）' }}</pre>
                    </div>
                  </details>
                  <span v-else class="faint">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="submission.compileLog" class="mt-12">
          <h4>编译日志</h4>
          <pre class="code-block mt-8">{{ submission.compileLog }}</pre>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wb {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  background: var(--bg);
}

.wb__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
  flex: none;
}

.wb__title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.wb__title strong {
  font-size: 14px;
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40ch;
}

.wb__countdown {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
}

.wb__countdown strong {
  font-size: 15px;
  letter-spacing: 0.02em;
  color: var(--brand-strong);
}

.wb__countdown--danger {
  background: var(--wa-soft);
  border-color: #f6c9c6;
}

.wb__countdown--danger strong {
  color: var(--wa);
}

.wb__bar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wb__kbd {
  display: flex;
  align-items: center;
  gap: 2px;
}

.wb__body {
  display: grid;
  grid-template-columns: minmax(0, 45fr) minmax(0, 55fr);
  gap: 1px;
  background: var(--border);
  flex: 1 1 auto;
  min-height: 0;
}

.wb__pane {
  background: var(--surface);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}

.wb__pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 20px 10px;
  flex-wrap: wrap;
}

.wb__pane-head h2 {
  font-size: 16px;
}

.wb__limits {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 0 20px 12px;
  border-bottom: 1px solid var(--border);
}

.wb__statement {
  padding: 16px 20px 4px;
}

.wb__skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px 20px;
}

.wb__state {
  padding: 20px;
}

.wb__samples {
  padding: 4px 20px 20px;
}

.wb__section-title {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-muted);
  margin: 12px 0 8px;
}

.sample {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 10px;
  overflow: hidden;
}

.sample__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--surface-sunken);
  border-bottom: 1px solid var(--border);
}

.sample__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.sample__cell {
  padding: 8px 10px;
  min-width: 0;
}

.sample__cell + .sample__cell {
  border-left: 1px solid var(--border);
}

.sample__label {
  font-size: 11px;
  color: var(--ink-faint);
  font-weight: 600;
}

.sample__pre {
  margin: 4px 0 0;
  font-family: var(--font-mono);
  font-size: 12.5px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--ink-soft);
}

.wb__pane--code {
  overflow: hidden;
}

.wb__code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-sunken);
  flex: none;
}

.wb__draft {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 14px;
  background: var(--brand-soft);
  border-bottom: 1px solid var(--brand-line);
  color: var(--brand-strong);
  flex: none;
}

.wb__editor {
  flex: 1 1 auto;
  min-height: 220px;
  overflow: hidden;
}

.wb__inline-alert {
  padding: 10px 14px;
  border-top: 1px solid var(--border);
  flex: none;
}

.wb__blocked {
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  flex: none;
}

.wb__result {
  flex: none;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* 拖拽条：上下拖动改变结果区高度 */
.wb__splitter {
  flex: none;
  height: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: row-resize;
  background: var(--bg-subtle);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  user-select: none;
  touch-action: none;
  transition: background 0.15s ease;
}

.wb__splitter:hover,
.wb__splitter--active {
  background: var(--brand-soft);
}

.wb__splitter:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: -2px;
}

.wb__splitter-grip {
  width: 46px;
  height: 3px;
  border-radius: 999px;
  background: var(--border-strong);
  transition: background 0.15s ease;
}

.wb__splitter:hover .wb__splitter-grip,
.wb__splitter--active .wb__splitter-grip {
  background: var(--brand);
}

.wb__splitter-hint {
  font-size: 10.5px;
  color: var(--ink-faint);
  letter-spacing: 0.02em;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.wb__splitter:hover .wb__splitter-hint,
.wb__splitter--active .wb__splitter-hint,
.wb__splitter:focus-visible .wb__splitter-hint {
  opacity: 1;
}

/* 细滚动条，避免在分栏边界出现抢眼的深色滑轨 */
.wb__pane,
.wb__result-body {
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.wb__pane::-webkit-scrollbar,
.wb__result-body::-webkit-scrollbar {
  width: 9px;
  height: 9px;
}

.wb__pane::-webkit-scrollbar-thumb,
.wb__result-body::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: content-box;
}

.wb__pane::-webkit-scrollbar-thumb:hover,
.wb__result-body::-webkit-scrollbar-thumb:hover {
  background: var(--ink-faint);
  background-clip: content-box;
}

.wb__pane::-webkit-scrollbar-track,
.wb__result-body::-webkit-scrollbar-track {
  background: transparent;
}

.select--lang {
  height: 28px;
  width: auto;
  min-width: 108px;
  padding: 0 26px 0 9px;
  font-size: 12.5px;
  font-weight: 600;
}

.wb__result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
  flex: none;
}

.wb__result-body {
  padding: 14px 18px 18px;
  overflow: auto;
}

.result-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.result-head__verdict {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.result-head__meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.result-head__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(90px, auto));
  gap: 10px;
}

.stat {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: flex-start;
}

.steps {
  display: flex;
  align-items: center;
  gap: 0;
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
  flex-wrap: wrap;
}

.steps__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px 0 0;
  margin-right: 14px;
  position: relative;
  color: var(--ink-faint);
  font-size: 12.5px;
}

.steps__item::after {
  content: '';
  position: absolute;
  right: 0;
  width: 10px;
  height: 1px;
  background: var(--border-strong);
}

.steps__item:last-child::after {
  display: none;
}

.steps__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid currentColor;
  background: transparent;
}

.steps__item--done {
  color: var(--ac);
}

.steps__item--done .steps__dot {
  background: currentColor;
}

.steps__item--active {
  color: var(--brand);
  font-weight: 650;
}

.steps__item--active .steps__dot {
  background: currentColor;
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.steps__item--failed {
  color: var(--wa);
}

.result-ac {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius);
  background: var(--ac-soft);
  border: 1px solid #bfe8d5;
  color: #0b6a49;
}

.diff {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 6px;
}

.diff__col {
  margin: 0;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 1024px) {
  .wb__body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto;
    overflow: auto;
  }
  .wb__result {
    height: auto !important;
    max-height: none;
  }
  .wb__splitter {
    display: none;
  }
  .result-head__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
