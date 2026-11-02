<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { submissionApi } from '@/api/client'
import { ApiError, describeError } from '@/api/http'
import CodeEditor from '@/components/CodeEditor.vue'
import StatusPill from '@/components/StatusPill.vue'
import VerdictBadge from '@/components/VerdictBadge.vue'
import {
  LANGUAGE_LABEL,
  LANGUAGE_MONACO,
  PHASE_LABEL,
  SUBMISSION_STATUS_LABEL,
  type Language,
  type SubmissionDetail
} from '@/api/types'
import { usePolling } from '@/composables/usePolling'
import { useAuthStore } from '@/stores/auth'
import { formatBytes, formatDateTime, formatMemory, formatMs } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const detail = ref<SubmissionDetail | null>(null)
const loading = ref(true)
const error = ref('')
const tab = ref<'result' | 'source' | 'attempts'>('result')

const id = computed(() => String(route.params.id))

const isTerminal = (d: SubmissionDetail) => d.status === 'FINISHED' || d.status === 'FAILED'

const poller = usePolling<SubmissionDetail>({
  fetcher: async () => {
    const value = await submissionApi.detail(id.value)
    detail.value = value
    return value
  },
  shouldContinue: (value) => !isTerminal(value),
  suggestedDelayMs: () => detail.value?.pollAfterMs ?? null
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const value = await submissionApi.detail(id.value)
    detail.value = value
    if (!isTerminal(value)) poller.start(true)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      error.value = '提交不存在，或你没有查看它的权限'
    } else {
      error.value = describeError(e)
    }
  } finally {
    loading.value = false
  }
}

onMounted(load)

const examHardHide = computed(() => {
  const d = detail.value
  if (!d) return false
  return d.contextType === 'EXAM' && auth.role === 'STUDENT'
})

const canSeeSource = computed(() => Boolean(detail.value))

const peak = computed(() => {
  const cases = detail.value?.cases ?? []
  return {
    cpu: cases.reduce((max, item) => Math.max(max, item.cpuMs), 0),
    memory: cases.reduce((max, item) => Math.max(max, item.memoryKb), 0)
  }
})
</script>

<template>
  <div class="page">
    <div class="crumb">
      <button class="btn btn--ghost btn--sm" type="button" @click="router.back()">← 返回</button>
      <span class="mono small faint">提交 #{{ id }}</span>
    </div>

    <div v-if="loading" class="stack">
      <span class="skeleton" style="width: 30%; height: 20px" />
      <span class="skeleton" style="width: 100%; height: 90px" />
      <span class="skeleton" style="width: 100%; height: 160px" />
    </div>

    <div v-else-if="error" class="card">
      <div class="card__body">
        <div class="alert alert--danger">
          <span class="alert__icon">!</span>
          <div class="stack stack--sm">
            <strong>{{ error }}</strong>
            <span>统一 404 响应是有意的：不向无权者泄露资源是否存在。</span>
            <RouterLink class="btn btn--sm" to="/submissions">回到提交记录</RouterLink>
          </div>
        </div>
      </div>
    </div>

    <template v-else-if="detail">
      <header class="page-head">
        <div class="page-head__main">
          <div class="row gap-8">
            <h1>{{ detail.problemTitle }}</h1>
            <VerdictBadge :verdict="detail.verdict" :placeholder="SUBMISSION_STATUS_LABEL[detail.status]" />
          </div>
          <p class="page-head__sub">
            <span v-if="detail.examTitle">{{ detail.examTitle }} · 考试提交</span>
            <span v-else>{{ detail.contextType === 'VALIDATION' ? '题目发布校验' : '练习提交' }}</span>
            <span class="mono"> · 版本 v{{ detail.versionNo }}</span>
          </p>
        </div>
        <div class="row gap-8">
          <StatusPill kind="submission" :value="detail.status" />
          <span v-if="detail.phase" class="badge badge--brand">{{ PHASE_LABEL[detail.phase] }}</span>
          <RouterLink
            v-if="detail.examId"
            class="btn btn--sm"
            :to="{ name: 'exam-workbench', params: { id: detail.examId, problemId: detail.problemId } }"
          >
            打开题目
          </RouterLink>
        </div>
      </header>

      <div class="meta-grid">
        <div class="meta">
          <span class="meta__label">提交编号</span>
          <span class="meta__value mono">{{ detail.id }}</span>
        </div>
        <div class="meta">
          <span class="meta__label">提交时间（UTC+8）</span>
          <span class="meta__value">{{ formatDateTime(detail.acceptedAt) }}</span>
        </div>
        <div class="meta">
          <span class="meta__label">完成时间</span>
          <span class="meta__value">{{ formatDateTime(detail.finishedAt) }}</span>
        </div>
        <div class="meta">
          <span class="meta__label">语言</span>
          <span class="meta__value">{{ LANGUAGE_LABEL[detail.language] }}</span>
        </div>
        <div class="meta">
          <span class="meta__label">题目版本</span>
          <span class="meta__value mono">v{{ detail.versionNo }}</span>
        </div>
        <div class="meta">
          <span class="meta__label">环境摘要</span>
          <span class="meta__value mono truncate" :title="detail.environmentDigest">{{ detail.environmentDigest }}</span>
        </div>
        <div class="meta">
          <span class="meta__label">内容摘要</span>
          <span class="meta__value mono truncate" :title="detail.versionContentHash">{{ detail.versionContentHash }}</span>
        </div>
        <div class="meta">
          <span class="meta__label">自动重试</span>
          <span class="meta__value">{{ detail.retryCount }} / 2</span>
        </div>
      </div>

      <div v-if="detail.policyNote" class="alert alert--info mt-16">
        <span class="alert__icon">i</span>
        <span>{{ detail.policyNote }}</span>
      </div>

      <div v-if="detail.status === 'FAILED'" class="alert alert--danger mt-12">
        <span class="alert__icon">!</span>
        <div>
          <strong>系统故障（SYSTEM_ERROR）</strong>
          <p class="small">
            基础设施未能完成这次评测：自动重试已用尽。它不等同于答案错误，也不会被计入学生错误；
            管理员可填写原因后人工恢复，恢复会创建新的执行尝试并留下审计记录。
          </p>
          <RouterLink v-if="auth.isAdmin" class="btn btn--sm mt-8" to="/admin/tasks">去运维页面处理</RouterLink>
        </div>
      </div>

      <div class="card mt-16">
        <div class="card__head">
          <div class="tabs" style="border-bottom: none">
            <button class="tab" :class="{ 'tab--active': tab === 'result' }" type="button" @click="tab = 'result'">
              判定与测试点
            </button>
            <button class="tab" :class="{ 'tab--active': tab === 'source' }" type="button" @click="tab = 'source'">
              源代码
            </button>
            <button class="tab" :class="{ 'tab--active': tab === 'attempts' }" type="button" @click="tab = 'attempts'">
              执行尝试
            </button>
          </div>
          <div class="row gap-8">
            <span v-if="poller.active.value" class="row gap-4 small muted">
              <span class="spinner spinner--dark" aria-hidden="true" /> 自动刷新中
            </span>
            <button class="btn btn--sm" type="button" @click="load">刷新</button>
          </div>
        </div>

        <div class="card__body">
          <template v-if="tab === 'result'">
            <div class="row gap-8 mb-12">
              <span class="chip">CPU 上限 {{ formatMs(detail.limits.timeLimitMs) }}</span>
              <span class="chip">Wall 上限 {{ formatMs(detail.limits.wallLimitMs) }}</span>
              <span class="chip">内存上限 {{ formatMemory(detail.limits.memoryLimitKb) }}</span>
              <span class="chip">输出上限 {{ formatBytes(detail.limits.outputLimitBytes) }}</span>
              <span v-if="detail.verdict === 'AC'" class="chip">峰值 CPU {{ formatMs(peak.cpu) }}</span>
              <span v-if="detail.verdict === 'AC'" class="chip">峰值内存 {{ formatMemory(peak.memory) }}</span>
            </div>

            <div v-if="examHardHide && detail.finishedAt" class="alert alert--warn">
              <span class="alert__icon">!</span>
              <span>
                考试反馈策略为 VERDICT_ONLY：只展示最终判定类型，不返回隐藏测试点数量、
                通过点数量与逐点耗时。
              </span>
            </div>

            <div v-else-if="detail.cases.length === 0" class="empty">
              <p class="empty__title">还没有逐点结果</p>
              <p class="empty__hint">
                编译失败时没有 case_result；排队与执行中也还没有逐点数据。
              </p>
            </div>

            <div v-else class="table-wrap">
              <table class="table table--compact">
                <thead>
                  <tr>
                    <th>测试点</th>
                    <th>判定</th>
                    <th>CPU</th>
                    <th>内存</th>
                    <th>类型</th>
                    <th>输出预览</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in detail.cases" :key="item.ordinal">
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
                      <template v-if="item.expectedOutput !== null">
                        期望 <code>{{ item.expectedOutput }}</code> / 实际
                        <code>{{ item.actualOutput ?? '（无输出）' }}</code>
                      </template>
                      <span v-else class="faint">隐藏测试点不返回内容</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="detail.compileLog" class="mt-16">
              <h4>编译日志（截断至 64 KB，已清除主机路径）</h4>
              <pre class="code-block mt-8">{{ detail.compileLog }}</pre>
            </div>
          </template>

          <template v-else-if="tab === 'source'">
            <div v-if="canSeeSource" class="source">
              <CodeEditor
            :model-value="detail.sourceCode"
            read-only
            :language="LANGUAGE_MONACO[detail.language as Language]"
            :aria-label="`${LANGUAGE_LABEL[detail.language]} 源代码`"
          />
            </div>
          </template>

          <template v-else>
            <div v-if="detail.attempts.length === 0" class="empty">
              <p class="empty__title">还没有执行尝试记录</p>
            </div>
            <div v-else class="table-wrap">
              <table class="table table--compact">
                <thead>
                  <tr>
                    <th>尝试</th>
                    <th>状态</th>
                    <th>阶段</th>
                    <th>工作进程</th>
                    <th>租约截止</th>
                    <th>判定</th>
                    <th>故障编码</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="attempt in detail.attempts" :key="attempt.attemptNo">
                    <td class="mono">#{{ attempt.attemptNo }}</td>
                    <td class="small">{{ attempt.status }}</td>
                    <td class="small">{{ attempt.phase ? PHASE_LABEL[attempt.phase] : '—' }}</td>
                    <td class="mono small">{{ attempt.workerId ?? '—' }}</td>
                    <td class="small muted">{{ formatDateTime(attempt.leaseUntil) }}</td>
                    <td><VerdictBadge :verdict="attempt.verdict" size="sm" placeholder="—" /></td>
                    <td class="mono small">{{ attempt.infraErrorCode ?? '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="small muted mt-12">
              每次基础设施执行都是一个 attempt：租约到期或基础设施故障会创建新的 attempt，
              旧的迟到回报被标记为 stale，不会覆盖当前有效结果。
            </p>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.meta {
  background: var(--surface);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.meta__label {
  font-size: 11.5px;
  color: var(--ink-muted);
}

.meta__value {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-soft);
}

.source {
  height: 460px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

@media (max-width: 900px) {
  .meta-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
