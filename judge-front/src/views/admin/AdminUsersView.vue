<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminApi } from '@/api/client'
import { describeError } from '@/api/http'
import StatusPill from '@/components/StatusPill.vue'
import EmptyState from '@/components/EmptyState.vue'
import type { Role, UserSummary } from '@/api/types'
import { toast } from '@/stores/toast'

const users = ref<UserSummary[]>([])
const loading = ref(true)
const error = ref('')
const showForm = ref(false)
const creating = ref(false)
const pendingId = ref<string | null>(null)

const form = ref({
  username: '',
  displayName: '',
  role: 'STUDENT' as Role,
  initialPassword: 'demo1234'
})

const roleLabel: Record<Role, string> = { STUDENT: '学生', TEACHER: '教师', ADMIN: '管理员' }

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await adminApi.users({ page: 1, size: 100 })
    users.value = result.items
  } catch (e) {
    error.value = describeError(e)
    users.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function createUser() {
  if (form.value.username.trim().length < 3) {
    toast.warn('登录名至少 3 个字符')
    return
  }
  creating.value = true
  try {
    const created = await adminApi.createUser({
      username: form.value.username.trim(),
      displayName: form.value.displayName.trim() || form.value.username.trim(),
      role: form.value.role,
      initialPassword: form.value.initialPassword
    })
    toast.success('账户已创建', `${created.displayName}（${roleLabel[created.role]}）`)
    form.value.username = ''
    form.value.displayName = ''
    showForm.value = false
    await load()
  } catch (e) {
    toast.error('创建失败', describeError(e))
  } finally {
    creating.value = false
  }
}

async function toggleStatus(user: UserSummary) {
  const next = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
  if (next === 'DISABLED' && !window.confirm(`停用 ${user.displayName}？停用会立即撤销其全部会话。`)) return
  pendingId.value = user.id
  try {
    await adminApi.setUserStatus(user.id, next)
    toast.success(next === 'DISABLED' ? '账户已停用' : '账户已启用', '操作已写入审计日志')
    await load()
  } catch (e) {
    toast.error('操作失败', describeError(e))
  } finally {
    pendingId.value = null
  }
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head__main">
        <h1>账户管理</h1>
        <p class="page-head__sub">
          账户由管理员创建，本期不开放公开注册。停用账户会撤销其全部会话；历史提交与考试记录永久保留。
        </p>
      </div>
      <div class="btn-row">
        <button class="btn btn--sm" type="button" :disabled="loading" @click="load">刷新</button>
        <button class="btn btn--primary" type="button" @click="showForm = !showForm">
          {{ showForm ? '收起' : '创建账户' }}
        </button>
      </div>
    </header>

    <div v-if="showForm" class="card mb-16">
      <div class="card__head">
        <span class="card__title">创建账户</span>
        <span class="small muted">登录名归一化后唯一；密码只存哈希</span>
      </div>
      <div class="card__body">
        <div class="form-grid">
          <label class="field">
            <span class="field__label">登录名</span>
            <input v-model="form.username" class="input" placeholder="3—64 个字符" />
          </label>
          <label class="field">
            <span class="field__label">显示名</span>
            <input v-model="form.displayName" class="input" placeholder="例如：张同学" />
          </label>
          <label class="field">
            <span class="field__label">主角色</span>
            <select v-model="form.role" class="select">
              <option value="STUDENT">学生</option>
              <option value="TEACHER">教师</option>
              <option value="ADMIN">管理员</option>
            </select>
            <span class="field__hint">每个账户只有一个主角色</span>
          </label>
          <label class="field">
            <span class="field__label">初始密码</span>
            <input v-model="form.initialPassword" class="input" type="text" />
            <span class="field__hint">由管理员线下告知，首次登录后应重置</span>
          </label>
        </div>
        <div class="btn-row mt-16">
          <button class="btn btn--primary" type="button" :disabled="creating" @click="createUser">
            <span v-if="creating" class="spinner" aria-hidden="true" />
            创建
          </button>
          <button class="btn" type="button" @click="showForm = false">取消</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div v-if="loading" class="stack" style="padding: 20px">
        <span v-for="n in 4" :key="n" class="skeleton" style="height: 18px" />
      </div>

      <div v-else-if="error" class="card__body">
        <div class="alert alert--danger">
          <span class="alert__icon">!</span>
          <div class="stack stack--sm">
            <strong>账户列表加载失败</strong>
            <span>{{ error }}</span>
            <button class="btn btn--sm" type="button" @click="load">重试</button>
          </div>
        </div>
      </div>

      <EmptyState v-else-if="users.length === 0" title="还没有账户" hint="创建初始管理员与测试账户后再开始发布题目。" />

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th style="width: 90px">编号</th>
              <th>姓名 / 登录名</th>
              <th style="width: 110px">角色</th>
              <th style="width: 110px">状态</th>
              <th style="width: 130px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in users" :key="user.id">
              <td class="mono">{{ user.id }}</td>
              <td>
                <div class="row gap-8">
                  <strong>{{ user.displayName }}</strong>
                  <span class="mono small faint">{{ user.username }}</span>
                </div>
              </td>
              <td>
                <span class="badge" :class="user.role === 'ADMIN' ? 'badge--wa' : user.role === 'TEACHER' ? 'badge--brand' : 'badge--neutral'">
                  {{ roleLabel[user.role] }}
                </span>
              </td>
              <td><StatusPill kind="account" :value="user.status" /></td>
              <td>
                <button
                  class="btn btn--sm"
                  :class="{ 'btn--danger': user.status === 'ACTIVE' }"
                  type="button"
                  :disabled="pendingId === user.id"
                  @click="toggleStatus(user)"
                >
                  {{ user.status === 'ACTIVE' ? '停用' : '启用' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
