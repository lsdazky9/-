<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { problemApi } from '@/api/client'
import { describeError } from '@/api/http'
import { DIFFICULTY_LABEL, type Difficulty, type ProblemSummary } from '@/api/types'
import { formatRelative } from '@/utils/format'
import EmptyState from '@/components/EmptyState.vue'
import PagerBar from '@/components/PagerBar.vue'

const router = useRouter()

const keyword = ref('')
const difficulty = ref<'' | Difficulty>('')
const page = ref(1)
const size = 10
const total = ref(0)
const rows = ref<ProblemSummary[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await problemApi.list({
      keyword: keyword.value.trim(),
      difficulty: difficulty.value,
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

let debounce: number | undefined
watch(keyword, () => {
  window.clearTimeout(debounce)
  debounce = window.setTimeout(() => {
    page.value = 1
    void load()
  }, 300)
})

watch([difficulty, page], () => void load())

function openProblem(row: ProblemSummary) {
  router.push({ name: 'problem-workbench', params: { id: row.id } })
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head__main">
        <h1>题库</h1>
        <p class="page-head__sub">
          这里只显示当前公开可练习的题面版本；考试中的题目只在名单与有效时间内可见。
        </p>
      </div>
      <div class="row">
        <span class="chip">语言 CPP17</span>
        <span class="chip">标准输入输出</span>
      </div>
    </header>

    <div class="card">
      <div class="toolbar">
        <input
          v-model="keyword"
          class="input"
          type="search"
          placeholder="搜索题目名称"
          aria-label="搜索题目名称"
          style="max-width: 260px"
        />
        <select v-model="difficulty" class="select" aria-label="按难度筛选" style="max-width: 140px">
          <option value="">全部难度</option>
          <option value="EASY">简单</option>
          <option value="MEDIUM">中等</option>
          <option value="HARD">困难</option>
        </select>
        <span class="grow" />
        <button class="btn btn--sm" type="button" :disabled="loading" @click="load">刷新</button>
      </div>

      <div v-if="loading" class="list-skeleton">
        <div v-for="n in 5" :key="n" class="list-skeleton__row">
          <span class="skeleton" style="width: 34%" />
          <span class="skeleton" style="width: 12%" />
          <span class="skeleton" style="width: 18%" />
        </div>
      </div>

      <div v-else-if="error" class="card__body">
        <div class="alert alert--danger">
          <span class="alert__icon">!</span>
          <div class="stack stack--sm">
            <strong>题目列表加载失败</strong>
            <span>{{ error }}</span>
            <button class="btn btn--sm" type="button" @click="load">重试</button>
          </div>
        </div>
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="没有符合条件的题目"
        hint="试试清空搜索词，或换一个难度筛选。教师发布的题需要先完成校验并设置为公开入口。"
      >
        <button class="btn btn--sm mt-8" type="button" @click="keyword = ''; difficulty = ''">清空筛选</button>
      </EmptyState>

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th style="width: 44%">题目</th>
              <th>难度</th>
              <th>当前版本</th>
              <th>可见性</th>
              <th>出题人</th>
              <th>更新</th>
              <th style="width: 100px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td>
                <button class="title-btn" type="button" @click="openProblem(row)">
                  <span class="title-btn__id mono">#{{ row.id }}</span>
                  <span class="title-btn__text">{{ row.title }}</span>
                </button>
              </td>
              <td>
                <span
                  class="badge"
                  :class="{
                    'badge--ac': row.difficulty === 'EASY',
                    'badge--ce': row.difficulty === 'MEDIUM',
                    'badge--wa': row.difficulty === 'HARD'
                  }"
                >
                  {{ DIFFICULTY_LABEL[row.difficulty] }}
                </span>
              </td>
              <td class="mono small muted">v{{ row.currentVersionNo ?? '—' }}</td>
              <td>
                <span class="badge" :class="row.visibility === 'PUBLIC' ? 'badge--brand' : 'badge--neutral'">
                  {{ row.visibility === 'PUBLIC' ? '公开' : '私有' }}
                </span>
              </td>
              <td class="small muted">{{ row.ownerName }}</td>
              <td class="small muted nowrap">{{ formatRelative(row.updatedAt) }}</td>
              <td>
                <button class="btn btn--sm btn--primary" type="button" @click="openProblem(row)">去做题</button>
              </td>
            </tr>
          </tbody>
        </table>
        <PagerBar :page="page" :size="size" :total="total" :disabled="loading" @change="page = $event" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.title-btn {
  display: flex;
  align-items: baseline;
  gap: 8px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
}

.title-btn__id {
  color: var(--ink-faint);
  font-size: 11.5px;
}

.title-btn__text {
  font-weight: 600;
  color: var(--ink);
  font-size: 13.5px;
}

.title-btn:hover .title-btn__text {
  color: var(--brand);
}

.list-skeleton {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 18px;
}

.list-skeleton__row {
  display: flex;
  gap: 16px;
}
</style>
