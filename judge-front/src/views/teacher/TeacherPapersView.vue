<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { teacherApi } from '@/api/client'
import { describeError } from '@/api/http'
import StatusPill from '@/components/StatusPill.vue'
import EmptyState from '@/components/EmptyState.vue'
import { formatRelative } from '@/utils/format'
import { toast } from '@/stores/toast'
import type { PaperSummary } from '@/api/types'

const router = useRouter()
const rows = ref<PaperSummary[]>([])
const loading = ref(true)
const error = ref('')
const creating = ref(false)
const showForm = ref(false)
const title = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await teacherApi.papers({ page: 1, size: 50 })
    rows.value = result.items
  } catch (e) {
    error.value = describeError(e)
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function createPaper() {
  if (!title.value.trim()) {
    toast.warn('请填写试卷名称')
    return
  }
  creating.value = true
  try {
    const paper = await teacherApi.createPaper({ title: title.value.trim() })
    toast.success('已创建试卷草稿')
    await router.push({ name: 'teacher-paper', params: { id: paper.id } })
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
        <h1>试卷</h1>
        <p class="page-head__sub">
          试卷由固定的题目版本与分值组成。发布考试时试卷被封存；封存后需要修改，只能复制为新试卷。
        </p>
      </div>
      <div class="btn-row">
        <button class="btn btn--sm" type="button" :disabled="loading" @click="load">刷新</button>
        <button class="btn btn--primary" type="button" @click="showForm = !showForm">
          {{ showForm ? '收起' : '新建试卷' }}
        </button>
      </div>
    </header>

    <div v-if="showForm" class="card mb-16">
      <div class="card__head">
        <span class="card__title">新建试卷</span>
      </div>
      <div class="card__body">
        <div class="row gap-8">
          <input v-model="title" class="input" placeholder="例如：第二次编程考试试卷（A 卷）" style="max-width: 420px" />
          <button class="btn btn--primary" type="button" :disabled="creating" @click="createPaper">
            <span v-if="creating" class="spinner" aria-hidden="true" />
            创建并编辑
          </button>
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
        v-else-if="rows.length === 0"
        title="还没有试卷"
        hint="先创建试卷，再从 READY 的题目版本中挑选题目并设置分值。"
      />

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>试卷名称</th>
              <th style="width: 110px">状态</th>
              <th style="width: 100px">题目数</th>
              <th style="width: 90px">revision</th>
              <th style="width: 130px">更新</th>
              <th style="width: 110px"></th>
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
              <td><StatusPill kind="paper" :value="row.status" /></td>
              <td class="num">{{ row.itemCount }}</td>
              <td class="mono small">{{ row.revision }}</td>
              <td class="small muted nowrap">{{ formatRelative(row.updatedAt) }}</td>
              <td>
                <RouterLink class="btn btn--sm" :to="{ name: 'teacher-paper', params: { id: row.id } }">
                  打开
                </RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
