<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { teacherApi } from '@/api/client'
import { describeError } from '@/api/http'
import { DIFFICULTY_LABEL, type Difficulty, type ProblemSummary } from '@/api/types'
import EmptyState from '@/components/EmptyState.vue'
import { formatRelative } from '@/utils/format'
import { toast } from '@/stores/toast'

const router = useRouter()

const rows = ref<ProblemSummary[]>([])
const loading = ref(true)
const error = ref('')
const creating = ref(false)
const showForm = ref(false)
const actionPending = ref<string | null>(null)

const form = ref({
  title: '',
  visibility: 'PUBLIC' as 'PUBLIC' | 'PRIVATE',
  difficulty: 'EASY' as Difficulty,
  statementMarkdown: '## 题目描述\n\n请描述题意。\n\n## 输入格式\n\n## 输出格式\n\n## 样例\n\n```\n\n```'
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await teacherApi.problems({ page: 1, size: 50 })
    rows.value = result.items
  } catch (e) {
    error.value = describeError(e)
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function createProblem() {
  if (!form.value.title.trim()) {
    toast.warn('请填写题目名称')
    return
  }
  creating.value = true
  try {
    const draft = await teacherApi.createProblem({
      title: form.value.title.trim(),
      visibility: form.value.visibility,
      difficulty: form.value.difficulty,
      statementMarkdown: form.value.statementMarkdown
    })
    toast.success('已创建题目草稿', '下一步：补全题面与测试点，然后发起校验')
    showForm.value = false
    form.value.title = ''
    await router.push({ name: 'teacher-version', params: { versionId: draft.id } })
  } catch (e) {
    toast.error('创建失败', describeError(e))
  } finally {
    creating.value = false
  }
}

async function newVersion(row: ProblemSummary) {
  actionPending.value = row.id
  try {
    const draft = await teacherApi.createVersion(row.id)
    toast.success('已创建新草稿版本', '旧版本与引用它的历史提交保持不变')
    await router.push({ name: 'teacher-version', params: { versionId: draft.id } })
  } catch (e) {
    toast.error('创建版本失败', describeError(e))
  } finally {
    actionPending.value = null
  }
}

function openVersion(row: ProblemSummary) {
  if (!row.latestVersionId) {
    toast.warn('该题还没有可编辑的版本')
    return
  }
  router.push({ name: 'teacher-version', params: { versionId: row.latestVersionId } })
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head__main">
        <h1>题库管理</h1>
        <p class="page-head__sub">
          题目版本一经 READY 即不可修改：修正题面或数据必须创建新版本，旧提交仍然引用旧内容。
        </p>
      </div>
      <div class="btn-row">
        <button class="btn btn--sm" type="button" :disabled="loading" @click="load">刷新</button>
        <button class="btn btn--primary" type="button" @click="showForm = !showForm">
          {{ showForm ? '收起' : '新建题目' }}
        </button>
      </div>
    </header>

    <div v-if="showForm" class="card mb-16">
      <div class="card__head">
        <span class="card__title">新建题目</span>
        <span class="small muted">创建后为草稿版本，校验通过后才能作为公开入口</span>
      </div>
      <div class="card__body">
        <div class="form-grid">
          <label class="field form-grid--full">
            <span class="field__label">题目名称</span>
            <input v-model="form.title" class="input" placeholder="例如：区间求和" maxlength="200" />
          </label>
          <label class="field">
            <span class="field__label">可见性</span>
            <select v-model="form.visibility" class="select">
              <option value="PUBLIC">公开练习</option>
              <option value="PRIVATE">私有（仅用于考试）</option>
            </select>
            <span class="field__hint">私有题不会出现在学生题库列表中</span>
          </label>
          <label class="field">
            <span class="field__label">难度</span>
            <select v-model="form.difficulty" class="select">
              <option value="EASY">简单</option>
              <option value="MEDIUM">中等</option>
              <option value="HARD">困难</option>
            </select>
          </label>
          <label class="field form-grid--full">
            <span class="field__label">题面（Markdown）</span>
            <textarea v-model="form.statementMarkdown" class="textarea" rows="8" />
            <span class="field__hint">渲染时先转义再套用有限语法，不执行原始 HTML</span>
          </label>
        </div>
        <div class="btn-row mt-16">
          <button class="btn btn--primary" type="button" :disabled="creating" @click="createProblem">
            <span v-if="creating" class="spinner" aria-hidden="true" />
            {{ creating ? '创建中…' : '创建并进入编辑器' }}
          </button>
          <button class="btn" type="button" @click="showForm = false">取消</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div v-if="loading" class="skeleton-wrap">
        <span v-for="n in 4" :key="n" class="skeleton" style="height: 20px" />
      </div>

      <div v-else-if="error" class="card__body">
        <div class="alert alert--danger">
          <span class="alert__icon">!</span>
          <div class="stack stack--sm">
            <strong>加载失败</strong>
            <span>{{ error }}</span>
            <button class="btn btn--sm" type="button" @click="load">重试</button>
          </div>
        </div>
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="还没有题目"
        hint="点击右上角「新建题目」开始：先写题面，再上传测试点，最后用参考程序发起校验。"
      />

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>题目</th>
              <th style="width: 90px">难度</th>
              <th style="width: 100px">可见性</th>
              <th style="width: 110px">当前公开版本</th>
              <th style="width: 120px">更新</th>
              <th style="width: 210px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td>
                <div class="row gap-8">
                  <span class="mono small faint">#{{ row.id }}</span>
                  <strong>{{ row.title }}</strong>
                </div>
              </td>
              <td>
                <span class="badge" :class="{
                  'badge--ac': row.difficulty === 'EASY',
                  'badge--ce': row.difficulty === 'MEDIUM',
                  'badge--wa': row.difficulty === 'HARD'
                }">{{ DIFFICULTY_LABEL[row.difficulty] }}</span>
              </td>
              <td>
                <span class="badge" :class="row.visibility === 'PUBLIC' ? 'badge--brand' : 'badge--neutral'">
                  {{ row.visibility === 'PUBLIC' ? '公开' : '私有' }}
                </span>
              </td>
              <td class="mono small">
                {{ row.currentVersionNo === null ? '未发布' : `v${row.currentVersionNo}` }}
              </td>
              <td class="small muted nowrap">{{ formatRelative(row.updatedAt) }}</td>
              <td>
                <div class="btn-row">
                  <button class="btn btn--sm" type="button" @click="openVersion(row)">编辑版本</button>
                  <button
                    class="btn btn--sm"
                    type="button"
                    :disabled="actionPending === row.id"
                    @click="newVersion(row)"
                  >
                    {{ actionPending === row.id ? '创建中…' : '新建版本' }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.skeleton-wrap {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px 18px;
}
</style>
