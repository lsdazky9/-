<script setup lang="ts">
/**
 * 考试配置：名单、发布校验、取消。
 *
 * 对应 UC-06 与 S03：发布是一次事务内的校验 + 封存 + 状态变更，
 * 前端只负责把服务端返回的阻塞原因明确展示出来，不自行“放行”。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { teacherApi } from '@/api/client'
import { ApiError, describeError } from '@/api/http'
import StatusPill from '@/components/StatusPill.vue'
import { formatDateTime } from '@/utils/format'
import { toast } from '@/stores/toast'
import type { ExamDraft, ExamPublishCheck, UserSummary } from '@/api/types'

const route = useRoute()
const router = useRouter()
const examId = computed(() => String(route.params.id))

const exam = ref<ExamDraft | null>(null)
const students = ref<UserSummary[]>([])
const check = ref<ExamPublishCheck | null>(null)
const loading = ref(true)
const error = ref('')
const savingMembers = ref(false)
const publishing = ref(false)
const cancelling = ref(false)
const cancelReason = ref('')
const showCancel = ref(false)
const memberIds = ref<string[]>([])

const editable = computed(() => exam.value?.state === 'DRAFT')
const memberSet = computed(() => new Set(memberIds.value))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [detail, studentList] = await Promise.all([
      teacherApi.exam(examId.value),
      teacherApi.students()
    ])
    exam.value = detail
    students.value = studentList
    memberIds.value = detail.members.map((m) => m.userId)
    check.value = await teacherApi.checkExam(examId.value)
  } catch (e) {
    error.value = describeError(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

function toggleMember(userId: string) {
  if (!editable.value) return
  const index = memberIds.value.indexOf(userId)
  if (index >= 0) memberIds.value.splice(index, 1)
  else memberIds.value.push(userId)
}

async function saveMembers() {
  savingMembers.value = true
  try {
    exam.value = await teacherApi.setMembers(examId.value, memberIds.value)
    check.value = await teacherApi.checkExam(examId.value)
    toast.success('名单已保存', `当前 ${memberIds.value.length} 名考生`)
  } catch (e) {
    toast.error('保存名单失败', describeError(e))
  } finally {
    savingMembers.value = false
  }
}

async function publish() {
  publishing.value = true
  try {
    check.value = await teacherApi.publishExam(examId.value)
    toast.success('考试已发布', '试卷、名单、时间与环境已封存')
    await load()
  } catch (e) {
    const err = e as ApiError
    if (err instanceof ApiError && (err.status === 409 || err.status === 422)) {
      toast.error('发布被拒绝', err.message)
      check.value = await teacherApi.checkExam(examId.value).catch(() => check.value)
    } else {
      toast.error('发布失败', describeError(e))
    }
    await load()
  } finally {
    publishing.value = false
  }
}

async function cancel() {
  if (!cancelReason.value.trim()) {
    toast.warn('取消原因必填')
    return
  }
  cancelling.value = true
  try {
    await teacherApi.cancelExam(examId.value, cancelReason.value.trim())
    toast.success('考试已取消', '取消原因已写入审计日志')
    showCancel.value = false
    await load()
  } catch (e) {
    toast.error('取消失败', describeError(e))
  } finally {
    cancelling.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="crumb">
      <button class="btn btn--ghost btn--sm" type="button" @click="router.push({ name: 'teacher-exams' })">
        ← 返回考试管理
      </button>
    </div>

    <div v-if="loading" class="stack">
      <span class="skeleton" style="width: 40%; height: 24px" />
      <span class="skeleton" style="height: 260px" />
    </div>

    <div v-else-if="error" class="card">
      <div class="card__body">
        <div class="alert alert--danger">
          <span class="alert__icon">!</span>
          <div class="stack stack--sm">
            <strong>考试加载失败</strong>
            <span>{{ error }}</span>
            <button class="btn btn--sm" type="button" @click="load">重试</button>
          </div>
        </div>
      </div>
    </div>

    <template v-else-if="exam">
      <header class="page-head">
        <div class="page-head__main">
          <div class="row gap-8">
            <h1>{{ exam.title }}</h1>
            <StatusPill kind="exam" :value="exam.state" />
          </div>
          <p class="page-head__sub">
            {{ exam.paperTitle }} · {{ formatDateTime(exam.startAt) }} → {{ formatDateTime(exam.endAt) }}
          </p>
        </div>
        <div class="btn-row">
          <RouterLink class="btn btn--sm" :to="{ name: 'teacher-grades', params: { id: exam.id } }">
            成绩汇总
          </RouterLink>
          <button
            class="btn btn--primary"
            type="button"
            :disabled="!editable || publishing"
            :title="editable ? '' : '只有草稿状态的考试可以发布'"
            @click="publish"
          >
            <span v-if="publishing" class="spinner" aria-hidden="true" />
            {{ publishing ? '发布中…' : '发布考试' }}
          </button>
        </div>
      </header>

      <div v-if="!editable" class="alert alert--info mb-16">
        <span class="alert__icon">i</span>
        <span>
          考试已 {{ exam.state === 'DRAFT' ? '草稿' : '发布' }}，名单与试卷内容冻结。
          需要变更时，请在开始前取消考试并重新建一场，不要尝试直接修改历史数据。
        </span>
      </div>

      <div class="detail-grid">
        <div class="stack">
          <div class="card">
            <div class="card__head">
              <span class="card__title">考生名单</span>
              <span class="small muted">已选 {{ memberIds.length }} 人</span>
            </div>
            <div class="card__body">
              <div v-if="students.length === 0" class="empty">
                <p class="empty__title">没有可导入的学生账户</p>
              </div>
              <div v-else class="member-grid">
                <label
                  v-for="student in students"
                  :key="student.id"
                  class="member"
                  :class="{ 'member--selected': memberSet.has(student.id) }"
                >
                  <input
                    type="checkbox"
                    :checked="memberSet.has(student.id)"
                    :disabled="!editable"
                    @change="toggleMember(student.id)"
                  />
                  <span class="member__meta">
                    <strong>{{ student.displayName }}</strong>
                    <small class="mono">{{ student.username }} · #{{ student.id }}</small>
                  </span>
                </label>
              </div>

              <div class="btn-row mt-12">
                <button class="btn" type="button" :disabled="!editable || savingMembers" @click="saveMembers">
                  <span v-if="savingMembers" class="spinner spinner--dark" aria-hidden="true" />
                  保存名单
                </button>
                <span class="small muted">保存会整体替换名单，后端在发布后拒绝再次修改</span>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card__head">
              <span class="card__title">发布校验</span>
              <span
                v-if="check"
                class="badge"
                :class="check.ok ? 'badge--ac' : 'badge--wa'"
              >
                {{ check.ok ? '可以发布' : '存在阻塞项' }}
              </span>
            </div>
            <div class="card__body">
              <ul v-if="check && check.problems.length" class="check-list">
                <li v-for="item in check.problems" :key="item.code">
                  <span class="badge" :class="item.level === 'error' ? 'badge--wa' : 'badge--ce'">
                    {{ item.level === 'error' ? '阻塞' : '提示' }}
                  </span>
                  <span class="small">{{ item.message }}</span>
                  <code class="mono small faint">{{ item.code }}</code>
                </li>
              </ul>
              <p v-else class="small muted">所有校验项通过：题目版本 READY、分值合法、名单非空、时间范围合法。</p>
              <button class="btn btn--sm mt-12" type="button" @click="load">重新校验</button>
            </div>
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card__head">
              <span class="card__title">冻结基线</span>
            </div>
            <div class="card__body">
              <dl class="kv">
                <dt>试卷</dt>
                <dd>{{ exam.paperTitle }}</dd>
                <dt>允许语言</dt>
                <dd>{{ exam.allowedLanguages.join(' / ') }}</dd>
                <dt>环境摘要</dt>
                <dd class="mono small">{{ exam.environmentDigest }}</dd>
                <dt>反馈策略</dt>
                <dd>{{ exam.feedbackPolicy === 'VERDICT_ONLY' ? '仅判定类型' : exam.feedbackPolicy }}</dd>
                <dt>开始 / 结束</dt>
                <dd class="small">{{ formatDateTime(exam.startAt) }} → {{ formatDateTime(exam.endAt) }}</dd>
              </dl>
              <p class="small muted mt-12">
                这些值在发布时固定，写入每次提交的上下文快照，保证历史结果可复核。
              </p>
            </div>
          </div>

          <div class="card">
            <div class="card__head">
              <span class="card__title">危险操作</span>
            </div>
            <div class="card__body stack">
              <p class="small muted">
                取消只在考试开始前允许，必须填写原因并写入审计。开始后一律不允许取消或修改时间。
              </p>
              <button
                v-if="!showCancel"
                class="btn btn--danger"
                type="button"
                :disabled="!editable"
                @click="showCancel = true"
              >
                取消考试
              </button>
              <template v-else>
                <label class="field">
                  <span class="field__label">取消原因（必填）</span>
                  <textarea v-model="cancelReason" class="textarea" rows="3" placeholder="例如：教室停电，改期至下周" />
                </label>
                <div class="btn-row">
                  <button class="btn btn--danger" type="button" :disabled="cancelling" @click="cancel">
                    <span v-if="cancelling" class="spinner" aria-hidden="true" />
                    确认取消
                  </button>
                  <button class="btn" type="button" @click="showCancel = false">返回</button>
                </div>
              </template>
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

.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.member-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.member {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.member:hover {
  border-color: var(--brand-line);
}

.member--selected {
  background: var(--brand-soft);
  border-color: var(--brand-line);
}

.member input {
  accent-color: var(--brand);
  width: 15px;
  height: 15px;
}

.member__meta {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.member__meta strong {
  font-size: 13px;
}

.member__meta small {
  font-size: 11px;
  color: var(--ink-muted);
}

.check-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.check-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.kv {
  margin: 0;
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 8px 12px;
  font-size: 13px;
}

.kv dt {
  color: var(--ink-muted);
  font-size: 12px;
}

.kv dd {
  margin: 0;
  color: var(--ink-soft);
  word-break: break-word;
}

@media (max-width: 1024px) {
  .detail-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .member-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
