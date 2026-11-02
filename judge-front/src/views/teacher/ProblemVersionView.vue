<script setup lang="ts">
/**
 * 题目版本编辑器。
 *
 * 体现文档里的三条约束：
 * - 乐观锁：保存必须带 revision，过期返回 409 并提示重新加载（§5.3.4）；
 * - 状态机：DRAFT → VALIDATING → READY；VALIDATING 与 READY 不可编辑（BR-04）；
 * - 校验复用评测链路：发起校验得到一个 VALIDATION 提交，轮询其状态即可（§5.3.4 说明）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { teacherApi } from '@/api/client'
import { ApiError, describeError } from '@/api/http'
import MarkdownView from '@/components/MarkdownView.vue'
import StatusPill from '@/components/StatusPill.vue'
import { VERSION_STATUS_LABEL, type ProblemVersionDraft, type RunLimits } from '@/api/types'
import { formatBytes, formatDateTime, formatMemory, formatMs } from '@/utils/format'
import { toast } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const versionId = computed(() => String(route.params.versionId))

const draft = ref<ProblemVersionDraft | null>(null)
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const dirty = ref(false)

const form = ref({
  statementMarkdown: '',
  difficulty: 'EASY' as ProblemVersionDraft['difficulty'],
  checkerType: 'TOKENS' as ProblemVersionDraft['checkerType'],
  limits: {
    timeLimitMs: 1000,
    wallLimitMs: 3000,
    memoryLimitKb: 262144,
    outputLimitBytes: 1048576
  } as RunLimits
})

const caseForm = ref({
  ordinal: 1,
  isSample: false,
  input: '',
  expected: ''
})

/* 内存与输出在界面上统一用 MB 输入，内部仍按 KiB / 字节存储（与数据库字段一致）。 */
const memoryLimitMb = computed<number>({
  get: () => Math.round(form.value.limits.memoryLimitKb / 1024),
  set: (value) => {
    const mb = Number(value)
    if (!Number.isFinite(mb) || mb <= 0) return
    form.value.limits.memoryLimitKb = Math.round(mb * 1024)
    markDirty()
  }
})

const outputLimitMb = computed<number>({
  get: () => Math.round((form.value.limits.outputLimitBytes / 1024 / 1024) * 100) / 100,
  set: (value) => {
    const mb = Number(value)
    if (!Number.isFinite(mb) || mb <= 0) return
    form.value.limits.outputLimitBytes = Math.round(mb * 1024 * 1024)
    markDirty()
  }
})

const referenceSource = ref('')
const validating = ref(false)
const publishing = ref(false)
const showPreview = ref(false)

const editable = computed(() => draft.value?.status === 'DRAFT')
const ready = computed(() => draft.value?.status === 'READY')
const validatingState = computed(() => draft.value?.status === 'VALIDATING')

const readVersionNote = computed(() => {
  const value = draft.value
  if (!value) return ''
  if (value.status === 'VALIDATING') return '校验期间版本被锁定，禁止编辑。'
  if (value.status === 'READY') return 'READY 版本不可原地修改，需要修改请创建新版本。'
  return `当前状态：${VERSION_STATUS_LABEL[value.status]}`
})

let pollTimer: number | null = null

async function load(silent = false) {
  if (!silent) loading.value = true
  error.value = ''
  try {
    const value = await teacherApi.version(versionId.value)
    draft.value = value
    if (!dirty.value) syncForm(value)
    if (value.status === 'VALIDATING') startValidationPolling()
  } catch (e) {
    error.value = describeError(e)
  } finally {
    loading.value = false
  }
}

function syncForm(value: ProblemVersionDraft) {
  form.value = {
    statementMarkdown: value.statementMarkdown,
    difficulty: value.difficulty,
    checkerType: value.checkerType,
    limits: { ...value.limits }
  }
  const nextOrdinal = Math.min(10, (value.cases.reduce((max, c) => Math.max(max, c.ordinal), 0) || 0) + 1)
  caseForm.value.ordinal = nextOrdinal
}

onMounted(async () => {
  await load()
  const stored = localStorage.getItem('judge.referenceSource')
  if (stored) referenceSource.value = stored
})

onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer)
})

function markDirty() {
  dirty.value = true
}

async function save() {
  if (!draft.value) return
  saving.value = true
  try {
    const value = await teacherApi.saveVersion(draft.value.id, {
      revision: draft.value.revision,
      statementMarkdown: form.value.statementMarkdown,
      difficulty: form.value.difficulty,
      checkerType: form.value.checkerType,
      limits: { ...form.value.limits }
    })
    draft.value = value
    dirty.value = false
    syncForm(value)
    toast.success('草稿已保存', `revision ${value.revision}`)
  } catch (e) {
    const err = e as ApiError
    if (err instanceof ApiError && err.status === 409) {
      toast.error('保存被拒绝', `${err.message}（已重新加载最新草稿）`)
      dirty.value = false
      await load(true)
    } else {
      toast.error('保存失败', describeError(e))
    }
  } finally {
    saving.value = false
  }
}

async function saveCase() {
  if (!draft.value) return
  if (!caseForm.value.input && !caseForm.value.expected) {
    toast.warn('请至少填写输入或答案内容')
    return
  }
  try {
    await teacherApi.uploadCase(draft.value.id, {
      ordinal: caseForm.value.ordinal,
      isSample: caseForm.value.isSample,
      kind: 'input',
      content: caseForm.value.input
    })
    const value = await teacherApi.uploadCase(draft.value.id, {
      ordinal: caseForm.value.ordinal,
      isSample: caseForm.value.isSample,
      kind: 'expected',
      content: caseForm.value.expected
    })
    draft.value = value
    caseForm.value.input = ''
    caseForm.value.expected = ''
    caseForm.value.ordinal = Math.min(10, caseForm.value.ordinal + 1)
    toast.success(`测试点 #${value.cases.length} 已保存`)
  } catch (e) {
    toast.error('测试点保存失败', describeError(e))
  }
}

function editCase(ordinal: number) {
  caseForm.value.ordinal = ordinal
  const target = draft.value?.cases.find((c) => c.ordinal === ordinal)
  caseForm.value.isSample = target?.isSample ?? false
  caseForm.value.input = ''
  caseForm.value.expected = ''
  toast.info('已选中测试点', `序号 #${ordinal}，重新填写内容即可覆盖`)
}

async function validateVersion() {
  if (!draft.value) return
  if (!referenceSource.value.trim()) {
    toast.warn('请粘贴参考程序源码')
    return
  }
  validating.value = true
  try {
    localStorage.setItem('judge.referenceSource', referenceSource.value)
    await teacherApi.validate(draft.value.id, referenceSource.value)
    toast.success('校验任务已入队', '校验通过与内容摘要一致后版本自动变为 READY')
    dirty.value = false
    await load(true)
  } catch (e) {
    toast.error('发起校验失败', describeError(e))
  } finally {
    validating.value = false
  }
}

function startValidationPolling() {
  if (pollTimer) return
  pollTimer = window.setInterval(async () => {
    if (!draft.value) return
    const value = await teacherApi.version(draft.value.id).catch(() => null)
    if (!value) return
    draft.value = value
    if (value.status !== 'VALIDATING') {
      if (pollTimer) window.clearInterval(pollTimer)
      pollTimer = null
      if (value.status === 'READY') {
        toast.success('校验通过，版本已就绪', '现在可以作为公开入口或加入试卷')
      } else {
        toast.error('校验未通过', value.validationNote ?? '版本已回到 DRAFT，请修正后重新校验')
      }
      syncForm(value)
    }
  }, 2000)
}

async function publish(visibility: 'PUBLIC' | 'PRIVATE') {
  if (!draft.value) return
  publishing.value = true
  try {
    await teacherApi.publishProblem(draft.value.problemId, draft.value.id, visibility)
    toast.success(
      visibility === 'PUBLIC' ? '已设为公开练习入口' : '已设为私有（考试用）',
      '旧提交仍引用它创建时的版本，不会被改写'
    )
    await load(true)
  } catch (e) {
    toast.error('发布失败', describeError(e))
  } finally {
    publishing.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="crumb">
      <button class="btn btn--ghost btn--sm" type="button" @click="router.push({ name: 'teacher-problems' })">
        ← 返回题库管理
      </button>
    </div>

    <div v-if="loading" class="stack">
      <span class="skeleton" style="width: 36%; height: 24px" />
      <span class="skeleton" style="height: 300px" />
    </div>

    <div v-else-if="error" class="card">
      <div class="card__body">
        <div class="alert alert--danger">
          <span class="alert__icon">!</span>
          <div class="stack stack--sm">
            <strong>版本加载失败</strong>
            <span>{{ error }}</span>
            <button class="btn btn--sm" type="button" @click="load()">重试</button>
          </div>
        </div>
      </div>
    </div>

    <template v-else-if="draft">
      <header class="page-head">
        <div class="page-head__main">
          <div class="row gap-8">
            <h1>{{ draft.problemTitle }}</h1>
            <span class="chip">v{{ draft.versionNo }}</span>
            <StatusPill kind="version" :value="draft.status" />
          </div>
          <p class="page-head__sub">
            版本 ID <span class="mono">{{ draft.id }}</span> · revision
            <span class="mono">{{ draft.revision }}</span>
            <template v-if="draft.readyAt"> · 就绪于 {{ formatDateTime(draft.readyAt) }}</template>
          </p>
        </div>
        <div class="btn-row">
          <button class="btn btn--sm" type="button" @click="load()">重新加载</button>
          <button class="btn btn--sm" type="button" @click="showPreview = !showPreview">
            {{ showPreview ? '编辑题面' : '预览题面' }}
          </button>
          <button
            class="btn btn--primary"
            type="button"
            :disabled="!editable || saving || !dirty"
            :title="editable ? '' : '只有草稿版本可以保存'"
            @click="save"
          >
            <span v-if="saving" class="spinner" aria-hidden="true" />
            {{ saving ? '保存中…' : '保存草稿' }}
          </button>
        </div>
      </header>

      <div v-if="validatingState" class="alert alert--warn mb-16">
        <span class="alert__icon">!</span>
        <div>
          <strong>校验进行中（VALIDATING），版本已锁定，不能编辑。</strong>
          <p class="small">
            服务器正在用固定环境运行参考程序并核对内容摘要；页面每 2 秒刷新一次状态。
            校验任务复用正式评测队列与隔离执行链路。
          </p>
        </div>
      </div>
      <div v-else-if="ready" class="alert alert--success mb-16">
        <span class="alert__icon">✓</span>
        <div>
          <strong>已就绪（READY）。</strong>
          <p class="small">
            题面与测试点已冻结，无法原地修改。需要修正请创建新版本，旧提交仍引用旧版本内容。
          </p>
        </div>
      </div>

      <div class="editor-grid">
        <div class="stack">
          <div class="card">
            <div class="card__head">
              <span class="card__title">题面</span>
              <span class="small muted">Markdown · 限 256 KiB</span>
            </div>
            <div class="card__body">
              <textarea
                v-if="!showPreview"
                v-model="form.statementMarkdown"
                class="textarea textarea--code"
                rows="16"
                :readonly="!editable"
                @input="markDirty"
              />
              <div v-else class="preview">
                <MarkdownView :source="form.statementMarkdown" />
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card__head">
              <span class="card__title">评测配置</span>
              <span class="small muted">修改后需重新校验</span>
            </div>
            <div class="card__body">
              <div class="form-grid">
                <label class="field">
                  <span class="field__label">难度</span>
                  <select v-model="form.difficulty" class="select" :disabled="!editable" @change="markDirty">
                    <option value="EASY">简单</option>
                    <option value="MEDIUM">中等</option>
                    <option value="HARD">困难</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field__label">输出比较方式</span>
                  <select v-model="form.checkerType" class="select" :disabled="!editable" @change="markDirty">
                    <option value="TOKENS">TOKENS（按空白拆分比较）</option>
                    <option value="EXACT">EXACT（CRLF 归一后逐字节）</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field__label">CPU 上限（毫秒）</span>
                  <input
                    v-model.number="form.limits.timeLimitMs"
                    class="input"
                    type="number"
                    min="100"
                    max="3000"
                    :disabled="!editable"
                    @input="markDirty"
                  />
                </label>
                <label class="field">
                  <span class="field__label">Wall 上限（毫秒）</span>
                  <input
                    v-model.number="form.limits.wallLimitMs"
                    class="input"
                    type="number"
                    min="100"
                    max="5000"
                    :disabled="!editable"
                    @input="markDirty"
                  />
                </label>
                <label class="field">
                  <span class="field__label">内存上限（MB）</span>
                  <input
                    v-model.number="memoryLimitMb"
                    class="input"
                    type="number"
                    min="64"
                    max="256"
                    step="16"
                    :disabled="!editable"
                  />
                </label>
                <label class="field">
                  <span class="field__label">输出上限（MB）</span>
                  <input
                    v-model.number="outputLimitMb"
                    class="input"
                    type="number"
                    min="0.5"
                    max="16"
                    step="0.5"
                    :disabled="!editable"
                  />
                </label>
              </div>
              <p class="small muted mt-12">
                当前限制：CPU {{ formatMs(form.limits.timeLimitMs) }} · Wall
                {{ formatMs(form.limits.wallLimitMs) }} · 内存
                {{ formatMemory(form.limits.memoryLimitKb) }} · 输出
                {{ formatBytes(form.limits.outputLimitBytes) }}
              </p>
            </div>
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card__head">
              <span class="card__title">测试点</span>
              <span class="small muted">至少 1 个公开样例 + 1 个隐藏点</span>
            </div>
            <div class="card__body">
              <div v-if="draft.cases.length === 0" class="alert alert--warn">
                <span class="alert__icon">!</span>
                <span>还没有测试点，无法发起校验。</span>
              </div>
              <table v-else class="table table--compact">
                <thead>
                  <tr>
                    <th>序号</th>
                    <th>类型</th>
                    <th>输入</th>
                    <th>答案</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in draft.cases" :key="item.id">
                    <td class="mono">#{{ item.ordinal }}</td>
                    <td>
                      <span class="badge" :class="item.isSample ? 'badge--brand' : 'badge--neutral'">
                        {{ item.isSample ? '公开样例' : '隐藏' }}
                      </span>
                    </td>
                    <td class="mono small">{{ formatBytes(item.inputBytes) }}</td>
                    <td class="mono small">{{ formatBytes(item.expectedBytes) }}</td>
                    <td>
                      <button
                        class="btn btn--sm btn--ghost"
                        type="button"
                        :disabled="!editable"
                        @click="editCase(item.ordinal)"
                      >
                        编辑
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>

              <div class="case-form mt-12">
                <div class="row gap-8">
                  <label class="field" style="width: 110px">
                    <span class="field__label">序号</span>
                    <input
                      v-model.number="caseForm.ordinal"
                      class="input"
                      type="number"
                      min="1"
                      max="10"
                      :disabled="!editable"
                    />
                  </label>
                  <label class="checkbox" style="margin-top: 20px">
                    <input v-model="caseForm.isSample" type="checkbox" :disabled="!editable" />
                    公开样例
                  </label>
                </div>
                <label class="field mt-8">
                  <span class="field__label">输入</span>
                  <textarea v-model="caseForm.input" class="textarea textarea--code" rows="3" :readonly="!editable" />
                </label>
                <label class="field mt-8">
                  <span class="field__label">期望输出</span>
                  <textarea v-model="caseForm.expected" class="textarea textarea--code" rows="3" :readonly="!editable" />
                </label>
                <button class="btn btn--block mt-12" type="button" :disabled="!editable" @click="saveCase">
                  保存测试点
                </button>
                <p class="field__hint mt-8">
                  单文件保存：服务端校验大小与哈希后按内容摘要存为只读对象；文件路径由服务端生成。
                </p>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card__head">
              <span class="card__title">发布校验</span>
              <span v-if="draft.contentHash" class="mono small faint truncate" :title="draft.contentHash">
                {{ draft.contentHash.slice(0, 16) }}…
              </span>
            </div>
            <div class="card__body stack">
              <label class="field">
                <span class="field__label">参考程序（C++17）</span>
                <textarea
                  v-model="referenceSource"
                  class="textarea textarea--code"
                  rows="7"
                  :readonly="validatingState || ready"
                  placeholder="粘贴一份正确的参考程序：服务器会用与正式评测相同的隔离环境运行它"
                />
                <span class="field__hint">参考程序必须全部通过所有测试点，版本才会变为 READY</span>
              </label>

              <div v-if="draft.validationSubmissionId" class="row gap-8">
                <span class="small muted">校验提交</span>
                <RouterLink
                  class="mono small"
                  :to="{ name: 'submission-detail', params: { id: draft.validationSubmissionId } }"
                >
                  #{{ draft.validationSubmissionId }}
                </RouterLink>
              </div>

              <div v-if="draft.validationNote" class="alert alert--danger">
                <span class="alert__icon">!</span>
                <span>{{ draft.validationNote }}</span>
              </div>

              <button
                class="btn btn--block"
                type="button"
                :disabled="validating || validatingState || ready || !editable"
                @click="validateVersion"
              >
                <span v-if="validating" class="spinner spinner--dark" aria-hidden="true" />
                {{ validatingState ? '校验中…' : '发起校验' }}
              </button>

              <div class="divider" />

              <p class="small muted">
                发布只是把 READY 版本设置为题目入口，不会修改题目内容。
              </p>
              <div class="btn-row">
                <button
                  class="btn btn--primary"
                  type="button"
                  :disabled="!ready || publishing"
                  @click="publish('PUBLIC')"
                >
                  设为公开练习
                </button>
                <button class="btn" type="button" :disabled="!ready || publishing" @click="publish('PRIVATE')">
                  设为私有（考试用）
                </button>
              </div>
              <p v-if="readVersionNote" class="small muted">{{ readVersionNote }}</p>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.crumb {
  margin-bottom: 14px;
}

.editor-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.18fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.textarea--code {
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.6;
}

.preview {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  background: var(--surface-sunken);
  max-height: 420px;
  overflow: auto;
}

.case-form {
  border-top: 1px dashed var(--border-strong);
  padding-top: 12px;
}

.divider {
  height: 1px;
  background: var(--border);
}

@media (max-width: 1024px) {
  .editor-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
