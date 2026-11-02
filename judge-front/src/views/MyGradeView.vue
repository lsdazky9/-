<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { examApi } from '@/api/client'
import { describeError } from '@/api/http'
import VerdictBadge from '@/components/VerdictBadge.vue'
import { formatDateTime, formatScore } from '@/utils/format'
import type { MyGrade } from '@/api/types'

const route = useRoute()
const examId = computed(() => String(route.params.id))

const grade = ref<MyGrade | null>(null)
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    grade.value = await examApi.myGrade(examId.value)
  } catch (e) {
    error.value = describeError(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

const answered = computed(() => grade.value?.items.filter((i) => i.submissionId).length ?? 0)
</script>

<template>
  <div class="page page--narrow">
    <div class="crumb">
      <RouterLink class="btn btn--ghost btn--sm" :to="{ name: 'exam-entry', params: { id: examId } }">
        ← 返回考试
      </RouterLink>
    </div>

    <div v-if="loading" class="stack">
      <span class="skeleton" style="width: 40%; height: 22px" />
      <span class="skeleton" style="height: 120px" />
      <span class="skeleton" style="height: 200px" />
    </div>

    <div v-else-if="error" class="card">
      <div class="card__body">
        <div class="alert alert--danger">
          <span class="alert__icon">!</span>
          <span>{{ error }}</span>
        </div>
      </div>
    </div>

    <template v-else-if="grade">
      <header class="page-head">
        <div class="page-head__main">
          <h1>本人成绩</h1>
          <p class="page-head__sub">{{ grade.examTitle }}</p>
        </div>
        <span v-if="grade.published" class="badge badge--ac">已发布</span>
        <span v-else class="badge badge--neutral">待发布</span>
      </header>

      <div v-if="!grade.published" class="card">
        <div class="card__body stack">
          <div class="alert alert--info">
            <span class="alert__icon">i</span>
            <span>
              成绩尚未发布。教师需要等待截止前接受的所有正式提交进入终态、且没有未解决的系统故障，
              才能汇总并冻结成绩。
            </span>
          </div>
          <p class="small muted">
            未发布前不展示分题得分，避免部分结果被误读为最终成绩。
          </p>
        </div>
      </div>

      <template v-else>
        <div class="score-card card">
          <div class="score-card__main">
            <span class="small muted">总分</span>
            <div class="score-card__value">
              <strong>{{ formatScore(grade.totalScore) }}</strong>
              <span class="muted">/ {{ formatScore(grade.maxScore) }}</span>
            </div>
            <span class="small muted">
              发布于 {{ formatDateTime(grade.publishedAt) }} · 已作答 {{ answered }} / {{ grade.items.length }} 题
            </span>
          </div>
          <div class="score-card__hint">
            <p class="small">
              每题取该题有效提交中的最高分，全对得满分，否则 0 分；成绩发布后冻结，不再重评或改分。
              系统故障不计入学生错误，发布前必须完成恢复。
            </p>
          </div>
        </div>

        <div class="card mt-16">
          <div class="card__head">
            <span class="card__title">分题明细</span>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th style="width: 60px">序号</th>
                  <th>题目</th>
                  <th style="width: 110px">判定</th>
                  <th style="width: 110px">得分</th>
                  <th style="width: 110px">满分</th>
                  <th style="width: 110px"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in grade.items" :key="item.problemId">
                  <td class="mono">{{ item.ordinal }}</td>
                  <td class="strong">{{ item.title }}</td>
                  <td><VerdictBadge :verdict="item.verdict" size="sm" placeholder="未提交" /></td>
                  <td class="num strong">{{ formatScore(item.score) }}</td>
                  <td class="num muted">{{ formatScore(item.fullScore) }}</td>
                  <td>
                    <RouterLink
                      v-if="item.submissionId"
                      class="small"
                      :to="{ name: 'submission-detail', params: { id: item.submissionId } }"
                    >
                      查看提交
                    </RouterLink>
                    <span v-else class="small faint">未提交</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.crumb {
  margin-bottom: 14px;
}

.score-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 20px;
  padding: 22px;
}

.score-card__main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.score-card__value {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.score-card__value strong {
  font-size: 40px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.1;
  color: var(--ac);
}

.score-card__value span {
  font-size: 16px;
}

.score-card__hint {
  border-left: 2px solid var(--border);
  padding-left: 18px;
  color: var(--ink-muted);
  font-size: 12.5px;
  line-height: 1.7;
}

@media (max-width: 720px) {
  .score-card {
    grid-template-columns: minmax(0, 1fr);
  }
  .score-card__hint {
    border-left: none;
    border-top: 1px solid var(--border);
    padding-left: 0;
    padding-top: 12px;
  }
}
</style>
