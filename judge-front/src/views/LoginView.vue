<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { describeError, USE_MOCK } from '@/api/http'
import { ROLE_HOME } from '@/router'
import type { Role } from '@/api/types'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const error = ref('')
const usernameError = ref('')

const demoAccounts: { label: string; username: string; role: string }[] = [
  { label: '学生', username: 'student', role: '看题 · 提交' },
  { label: '教师', username: 'teacher', role: '出题 · 组卷' },
  { label: '管理员', username: 'admin', role: '账户 · 运维' }
]

const canSubmit = computed(() => username.value.trim().length > 0 && password.value.length > 0)

function fill(account: string) {
  username.value = account
  password.value = 'demo1234'
  error.value = ''
}

async function onSubmit() {
  error.value = ''
  usernameError.value = ''
  if (!username.value.trim()) {
    usernameError.value = '请输入登录名'
    return
  }
  try {
    await auth.login(username.value.trim(), password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    const fallback = ROLE_HOME[(auth.role as Role) ?? 'STUDENT'] ?? '/problems'
    await router.replace(redirect || fallback)
  } catch (e) {
    error.value = describeError(e)
  }
}
</script>

<template>
  <div class="login">
    <section class="login__brand">
      <div class="login__brand-top">
        <span class="mark">‹/›</span>
        <span class="mark-label">在线编程评测与考试平台</span>
      </div>

      <div class="login__pitch">
        <h1>让每一次提交<br />都有可解释的结果</h1>
        <p class="login__lead">
          课程练习 + 编程考试。提交异步接收，评测在隔离环境真实执行，
          考试以服务端时间裁决，故障恢复后可继续，不把系统问题算成学生的错。
        </p>

        <ul class="pitch-list">
          <li>
            <strong>异步接收</strong>
            <span>202 返回提交编号，排队、编译、运行阶段可追踪。</span>
          </li>
          <li>
            <strong>执行隔离</strong>
            <span>学生程序拿不到答案、凭据与宿主路径；编译同样隔离。</span>
          </li>
          <li>
            <strong>可解释闭环</strong>
            <span>AC / WA / CE / TLE / MLE / RE / OLE 与系统故障分列。</span>
          </li>
        </ul>
      </div>

      <p class="login__foot">系统分析与设计 v1.0 · 五人团队 · 三个两周迭代</p>
    </section>

    <section class="login__panel">
      <div class="login__card">
        <header class="login__head">
          <h2>登录</h2>
          <p class="muted small">账户由管理员创建，本期不开放公开注册。</p>
        </header>

        <form class="stack" @submit.prevent="onSubmit">
          <label class="field">
            <span class="field__label">登录名</span>
            <input
              v-model="username"
              class="input"
              name="username"
              autocomplete="username"
              placeholder="请输入登录名"
              :aria-invalid="Boolean(usernameError)"
            />
            <span v-if="usernameError" class="field__error">{{ usernameError }}</span>
          </label>

          <label class="field">
            <span class="field__label">密码</span>
            <input
              v-model="password"
              class="input"
              name="password"
              type="password"
              autocomplete="current-password"
              placeholder="请输入密码"
            />
          </label>

          <div v-if="error" class="alert alert--danger" role="alert">
            <span class="alert__icon">!</span>
            <span>{{ error }}</span>
          </div>

          <button class="btn btn--primary btn--lg btn--block" type="submit" :disabled="!canSubmit || auth.pending">
            <span v-if="auth.pending" class="spinner" aria-hidden="true" />
            {{ auth.pending ? '正在登录…' : '登录' }}
          </button>
        </form>

        <div v-if="USE_MOCK" class="login__demo">
          <p class="small muted">演示账户（Mock 模式，密码均为 <code>demo1234</code>）</p>
          <div class="login__demo-list">
            <button
              v-for="item in demoAccounts"
              :key="item.username"
              type="button"
              class="login__demo-item"
              @click="fill(item.username)"
            >
              <strong>{{ item.label }}</strong>
              <span class="mono small">{{ item.username }}</span>
              <small>{{ item.role }}</small>
            </button>
          </div>
        </div>

        <p class="login__note small muted">
          登录失败统一提示，不区分「用户不存在」与「密码错误」，避免账户探测。
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.login {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  min-height: 100vh;
  background: var(--bg);
}

.login__brand {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 32px;
  padding: 40px 48px;
  color: #eaf0ff;
  background:
    radial-gradient(900px 500px at 12% -10%, rgba(96, 141, 255, 0.4), transparent 60%),
    radial-gradient(700px 500px at 90% 110%, rgba(20, 40, 120, 0.6), transparent 55%),
    linear-gradient(160deg, #101a35 0%, #16224a 46%, #0d1430 100%);
  overflow: hidden;
}

.login__brand::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.045) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(circle at 30% 20%, #000 20%, transparent 72%);
  pointer-events: none;
}

.login__brand-top {
  display: flex;
  align-items: center;
  gap: 10px;
  position: relative;
  z-index: 1;
}

.mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: linear-gradient(140deg, #5b8cff, #2f5fe0);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  color: #fff;
}

.mark-label {
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.login__pitch {
  position: relative;
  z-index: 1;
  max-width: 460px;
}

.login__pitch h1 {
  font-size: 38px;
  line-height: 1.22;
  letter-spacing: -0.02em;
  color: #fff;
  font-weight: 680;
}

.login__lead {
  margin-top: 16px;
  color: rgba(234, 240, 255, 0.72);
  font-size: 14px;
  line-height: 1.75;
}

.pitch-list {
  margin: 28px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pitch-list li {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 12px;
  align-items: baseline;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}

.pitch-list strong {
  font-size: 12.5px;
  color: #fff;
  letter-spacing: 0.02em;
}

.pitch-list span {
  font-size: 12.5px;
  color: rgba(234, 240, 255, 0.66);
  line-height: 1.6;
}

.login__foot {
  position: relative;
  z-index: 1;
  font-size: 11.5px;
  color: rgba(234, 240, 255, 0.42);
  letter-spacing: 0.02em;
}

.login__panel {
  display: grid;
  place-items: center;
  padding: 40px 24px;
}

.login__card {
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  padding: 28px;
}

.login__head h2 {
  font-size: 22px;
}

.login__head p {
  margin-top: 4px;
}

.login__demo {
  border-top: 1px dashed var(--border-strong);
  padding-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.login__demo-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.login__demo-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  align-items: flex-start;
  padding: 8px 10px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.login__demo-item:hover {
  border-color: var(--brand-line);
  background: var(--brand-soft);
}

.login__demo-item strong {
  font-size: 12.5px;
  color: var(--ink);
}

.login__demo-item small {
  font-size: 10.5px;
  color: var(--ink-muted);
}

.login__note {
  line-height: 1.55;
}

@media (max-width: 900px) {
  .login {
    grid-template-columns: minmax(0, 1fr);
  }
  .login__brand {
    padding: 28px 24px 32px;
  }
  .login__pitch h1 {
    font-size: 28px;
  }
  .login__panel {
    padding: 24px 16px 48px;
  }
}
</style>
