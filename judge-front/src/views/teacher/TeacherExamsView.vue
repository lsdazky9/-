<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { teacherApi } from '@/api/client'
import { describeError } from '@/api/http'
import StatusPill from '@/components/StatusPill.vue'
import EmptyState from '@/components/EmptyState.vue'
import { formatDateTime, fromLocalInput } from '@/utils/format'
import { toast } from '@/stores/toast'
import type { ExamSummary, PaperSummary } from '@/api/types'

const router = useRouter()

const exams = ref<ExamSummary[]>([])
const papers = ref<PaperSummary[]>([])
const loading = ref(true)
const error = ref('')
const showForm = ref(false)
const creating = ref(false)

const form = ref({
  title: '',
  paperId: '',
  startAt: '',
  endAt: ''
})

const durationHint = computed(() => {
  if (!form.value.startAt || !form.value.endAt) return ''
  const start = Date.parse(fromLocalInput(form.value.startAt))
  const end = Date.parse(fromLocalInput(form.value.endAt))
  if (!Number.isFinite(start) || !Number.isFinite(end)) return ''
  if (end <= start) return '结束时间必须晚于开始时间'
  const minutes = Math.round((end - start) / 60000)
  if (minutes > 480) return '考试总时长不得超过 8 小时'
  return `时长 ${minutes} 分钟`
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [examResult, paperResult] = await Promise.all([
      teacherApi.exams({ page: 1, size: 50 }),
      teacherApi.papers({ page: 1, size: 50 })
    ])
    exams.value = examResult.items
    papers.value = paperResult.items.filter((p) => p.status === 'DRAFT')
  } catch (e) {
    error.value = describeError(e)
    exams.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function createExam() {
  if (!form.value.title.trim()) {
    toast.warn('请填写考试名称')
    return
  }
  if (!form.value.paperId) {
    toast.warn('请选择试卷')
    return
  }
  if (!form.value.startAt || !form.value.endAt) {
    toast.warn('请填写开始与结束时间')
    return
  }
  creating.value = true
  try {
    const exam = await teacherApi.createExam({
      title: form.value.title.trim(),
      paperId: form.value.paperId,
      startAt: fromLocalInput(form.value.startAt),
      endAt: fromLocalInput(form.value.endAt)
    })
    toast.success('已创建考试草稿', '接下来配置考生名单，然后发布')
    await router.push({ name: 'teacher-exam', params: { id: exam.id } })
  } catch (e) {
    toast.error('创建失败', describeError(e))
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head__main">
        <h1>考试管理</h1>
        <p class="page-head__sub">
          发布考试会固定试卷、时间、环境与名单；发布后这些内容全部冻结，需要变更只能在开始前取消并重建。
        </p>
      </div>
      <div class="btn-row">
        <button class="btn btn--sm" type="button" :disabled="loading" @click="load">刷新</button>
        <button class="btn btn--primary" type="button" @click="showForm = !showForm">
          {{ showForm ? '收起' : '新建考试' }}
        </button>
      </div>
    </header>

    <div v-if="showForm" class="card mb-16">
      <div class="card__head">
        <span class="card__title">新建考试草稿</span>
        <span class="small muted">只有 DRAFT 试卷可以被新考试绑定</span>
      </div>
      <div class="card__body">
        <div class="form-grid">
          <label class="field form-grid--full">
            <span class="field__label">考试名称</span>
            <input v-model="form.title" class="input" placeholder="例如：软件工程实验 · 第二次编程考试" maxlength="200" />
          </label>
          <label class="field form-grid--full">
            <span class="field__label">绑定试卷</span>
            <select v-model="form.paperId" class="select">
              <option value="">选择草稿试卷…</option>
              <option v-for="paper in papers" :key="paper.id" :value="paper.id">
                #{{ paper.id }} {{ paper.title }}（{{ paper.itemCount }} 题）
              </option>
            </select>
            <span v-if="papers.length === 0" class="field__hint">没有可用草稿试卷，请先在「试卷」页创建</span>
          </label>
          <label class="field">
            <span class="field__label">开始时间</span>
            <input v-model="form.startAt" class="input" type="datetime-local" />
          </label>
          <label class="field">
            <span class="field__label">结束时间</span>
            <input v-model="form.endAt" class="input" type="datetime-local" />
          </label>
        </div>
        <p class="field__hint mt-8">
          界面按本地时区输入，提交时转成 UTC；后端只使用数据库时间判断资格。
          <span v-if="durationHint" class="strong"> {{ durationHint }}</span>
        </p>
        <div class="btn-row mt-16">
          <button class="btn btn--primary" type="button" :disabled="creating" @click="createExam">
            <span v-if="creating" class="spinner" aria-hidden="true" />
            {{ creating ? '创建中…' : '创建并配置名单' }}
          </button>
          <button class="btn" type="button" @click="showForm = false">取消</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div v-if="loading" class="stack" style="padding: 20px">
        <span v-for="n in 3" :key="n" class="skeleton" style="height: 18px" />
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
        v-else-if="exams.length === 0"
        title="还没有考试"
        hint="创建考试草稿 → 配置名单 → 发布。发布时会校验题目版本、分值、人数与时间范围。"
      />

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>考试</th>
              <th style="width: 110px">状态</th>
              <th style="width: 90px">名单</th>
              <th>时间</th>
              <th style="width: 190px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in exams" :key="row.id">
              <td>
                <div class="row gap-8">
                  <span class="mono small faint">#{{ row.id }}</span>
                  <strong>{{ row.title }}</strong>
                </div>
                <span class="small muted">{{ row.paperTitle }}</span>
              </td>
              <td><StatusPill kind="exam" :value="row.state" /></td>
              <td class="num">{{ row.memberCount ?? '—' }}</td>
              <td class="small muted nowrap">
                {{ formatDateTime(row.startAt) }}<br />
                {{ formatDateTime(row.endAt) }}
              </td>
              <td>
                <div class="btn-row">
                  <RouterLink class="btn btn--sm" :to="{ name: 'teacher-exam', params: { id: row.id } }">
                    配置
                  </RouterLink>
                  <RouterLink class="btn btn--sm" :to="{ name: 'teacher-grades', params: { id: row.id } }">
                    成绩
                  </RouterLink>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
