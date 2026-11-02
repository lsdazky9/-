<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { teacherApi } from '@/api/client'
import { ApiError, describeError } from '@/api/http'
import StatusPill from '@/components/StatusPill.vue'
import type { PaperDetail, PaperItem, ReadyVersionOption } from '@/api/types'
import { formatScore } from '@/utils/format'
import { toast } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const paperId = computed(() => String(route.params.id))

const paper = ref<PaperDetail | null>(null)
const readyVersions = ref<ReadyVersionOption[]>([])
const items = ref<PaperItem[]>([])
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const dirty = ref(false)
const selectedVersionId = ref('')
const selectedScore = ref(50)

const sealed = computed(() => paper.value?.status === 'SEALED')

const available = computed(() =>
  readyVersions.value.filter((v) => !items.value.some((i) => i.problemId === v.problemId))
)

const totalScore = computed(() => items.value.reduce((sum, item) => sum + Number(item.fullScore || 0), 0))

const problems = computed(() => {
  const seen = new Set<string>()
  const issues: string[] = []
  for (const item of items.value) {
    if (seen.has(item.problemId)) issues.push('同一道题的不同版本不能同时放入试卷')
    seen.add(item.problemId)
    if (!item.ready) issues.push(`《${item.title}》的版本不是 READY`)
    if (Number(item.fullScore) <= 0) issues.push(`《${item.title}》分值必须大于 0`)
  }
  if (items.value.length === 0) issues.push('试卷至少包含一道题目')
  return [...new Set(issues)]
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [detail, options] = await Promise.all([teacherApi.paper(paperId.value), teacherApi.readyVersions()])
    paper.value = detail
    readyVersions.value = options
    items.value = detail.items.map((item) => ({ ...item }))
    dirty.value = false
  } catch (e) {
    error.value = describeError(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

function addItem() {
  if (sealed.value) return
  const option = readyVersions.value.find((v) => v.versionId === selectedVersionId.value)
  if (!option) {
    toast.warn('请选择要加入的题目版本')
    return
  }
  if (items.value.some((i) => i.problemId === option.problemId)) {
    toast.warn('该题已在试卷中', '同一道题只能放入一个版本')
    return
  }
  items.value.push({
    problemVersionId: option.versionId,
    problemId: option.problemId,
    title: option.title,
    ordinal: items.value.length + 1,
    fullScore: Number(selectedScore.value) || 50,
    versionNo: option.versionNo,
    ready: true
  })
  renumber()
  selectedVersionId.value = ''
  dirty.value = true
}

function removeItem(index: number) {
  if (sealed.value) return
  items.value.splice(index, 1)
  renumber()
  dirty.value = true
}

function move(index: number, delta: number) {
  if (sealed.value) return
  const target = index + delta
  if (target < 0 || target >= items.value.length) return
  const [item] = items.value.splice(index, 1)
  items.value.splice(target, 0, item)
  renumber()
  dirty.value = true
}

function renumber() {
  items.value.forEach((item, index) => {
    item.ordinal = index + 1
  })
}

async function save() {
  if (!paper.value) return
  if (problems.value.length > 0) {
    toast.warn('试卷校验未通过', problems.value[0])
    return
  }
  saving.value = true
  try {
    const updated = await teacherApi.replacePaperItems(
      paper.value.id,
      paper.value.revision,
      items.value
    )
    paper.value = updated
    items.value = updated.items.map((item) => ({ ...item }))
    dirty.value = false
    toast.success('试卷已保存', `revision ${updated.revision}`)
  } catch (e) {
    const err = e as ApiError
    if (err instanceof ApiError && err.status === 409) {
      toast.error('保存被拒绝', err.message)
      await load()
    } else {
      toast.error('保存失败', describeError(e))
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="crumb">
      <button class="btn btn--ghost btn--sm" type="button" @click="router.push({ name: 'teacher-papers' })">
        ← 返回试卷列表
      </button>
    </div>

    <div v-if="loading" class="stack">
      <span class="skeleton" style="width: 34%; height: 24px" />
      <span class="skeleton" style="height: 240px" />
    </div>

    <div v-else-if="error" class="card">
      <div class="card__body">
        <div class="alert alert--danger">
          <span class="alert__icon">!</span>
          <div class="stack stack--sm">
            <strong>试卷加载失败</strong>
            <span>{{ error }}</span>
            <button class="btn btn--sm" type="button" @click="load">重试</button>
          </div>
        </div>
      </div>
    </div>

    <template v-else-if="paper">
      <header class="page-head">
        <div class="page-head__main">
          <div class="row gap-8">
            <h1>{{ paper.title }}</h1>
            <StatusPill kind="paper" :value="paper.status" />
          </div>
          <p class="page-head__sub">
            试卷 ID <span class="mono">{{ paper.id }}</span> · revision
            <span class="mono">{{ paper.revision }}</span> · 共 {{ items.length }} 题 · 合计
            {{ formatScore(totalScore) }} 分
          </p>
        </div>
        <div class="btn-row">
          <button class="btn btn--sm" type="button" @click="load">重新加载</button>
          <button class="btn btn--primary" type="button" :disabled="sealed || saving || !dirty" @click="save">
            <span v-if="saving" class="spinner" aria-hidden="true" />
            {{ saving ? '保存中…' : '保存试卷项' }}
          </button>
        </div>
      </header>

      <div v-if="sealed" class="alert alert--warn mb-16">
        <span class="alert__icon">!</span>
        <div>
          <strong>试卷已封存（SEALED），不可修改。</strong>
          <p class="small">
            封存发生在发布考试时：题目版本、分值、运行环境与名单一起成为该次考试的基线。
            需要调整内容，请复制为新试卷并新建考试，不要把已发布的考试当成草稿。
          </p>
        </div>
      </div>

      <div v-if="problems.length" class="alert alert--danger mb-16">
        <span class="alert__icon">!</span>
        <div>
          <strong>试卷校验未通过</strong>
          <ul class="issue-list">
            <li v-for="issue in problems" :key="issue">{{ issue }}</li>
          </ul>
        </div>
      </div>

      <div class="card">
        <div class="card__head">
          <span class="card__title">试卷项</span>
          <span class="small muted">总分 {{ formatScore(totalScore) }} / 上限 1000</span>
        </div>

        <div v-if="items.length === 0" class="empty">
          <p class="empty__title">试卷还没有题目</p>
          <p class="empty__hint">从下方选择 READY 的题目版本加入试卷。</p>
        </div>

        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th style="width: 60px">序号</th>
                <th>题目</th>
                <th style="width: 90px">版本</th>
                <th style="width: 130px">满分</th>
                <th style="width: 150px">顺序</th>
                <th style="width: 70px"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in items" :key="item.problemVersionId">
                <td class="mono">{{ item.ordinal }}</td>
                <td>
                  <div class="row gap-8">
                    <strong>{{ item.title }}</strong>
                    <span v-if="!item.ready" class="badge badge--wa">版本未就绪</span>
                  </div>
                </td>
                <td class="mono small">v{{ item.versionNo }}</td>
                <td>
                  <input
                    v-model.number="item.fullScore"
                    class="input"
                    type="number"
                    min="1"
                    max="1000"
                    :disabled="sealed"
                    style="max-width: 100px"
                    @input="dirty = true"
                  />
                </td>
                <td>
                  <div class="btn-row">
                    <button
                      class="btn btn--sm move-btn"
                      type="button"
                      :disabled="sealed || index === 0"
                      title="上移"
                      @click="move(index, -1)"
                    >
                      ↑
                    </button>
                    <button
                      class="btn btn--sm move-btn"
                      type="button"
                      :disabled="sealed || index === items.length - 1"
                      title="下移"
                      @click="move(index, 1)"
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td>
                  <button class="btn btn--sm btn--ghost" type="button" :disabled="sealed" @click="removeItem(index)">
                    移除
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="!sealed" class="card__body add-row">
          <div class="row gap-8">
            <select v-model="selectedVersionId" class="select" style="max-width: 380px">
              <option value="">选择已就绪的题目版本…</option>
              <option v-for="option in available" :key="option.versionId" :value="option.versionId">
                #{{ option.problemId }} {{ option.title }} · v{{ option.versionNo }}
              </option>
            </select>
            <input
              v-model.number="selectedScore"
              class="input"
              type="number"
              min="1"
              max="1000"
              style="max-width: 110px"
              aria-label="分值"
            />
            <button class="btn" type="button" @click="addItem">加入试卷</button>
            <span v-if="available.length === 0" class="small muted">没有更多可选的 READY 版本</span>
          </div>
          <p class="field__hint mt-8">
            只列 READY 版本；同一道题只能放一个版本。DRAFT 或 VALIDATING 的版本不会出现在这里。
          </p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.crumb {
  margin-bottom: 14px;
}

.add-row {
  border-top: 1px solid var(--border);
}

.issue-list {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 12.5px;
}

.move-btn {
  width: 30px;
  padding: 0;
}
</style>
