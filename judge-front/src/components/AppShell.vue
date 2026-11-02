<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ROLE_HOME } from '@/router'
import { USE_MOCK } from '@/api/http'
import type { Role } from '@/api/types'

defineProps<{ flush?: boolean }>()

interface NavItem {
  label: string
  to: string
  roles: Role[]
}

const navItems: NavItem[] = [
  { label: '题库', to: '/problems', roles: ['STUDENT', 'TEACHER', 'ADMIN'] },
  { label: '考试', to: '/exams', roles: ['STUDENT', 'TEACHER', 'ADMIN'] },
  { label: '提交记录', to: '/submissions', roles: ['STUDENT', 'TEACHER', 'ADMIN'] },
  { label: '题库管理', to: '/teacher/problems', roles: ['TEACHER', 'ADMIN'] },
  { label: '试卷', to: '/teacher/papers', roles: ['TEACHER', 'ADMIN'] },
  { label: '考试管理', to: '/teacher/exams', roles: ['TEACHER', 'ADMIN'] },
  { label: '评测运维', to: '/admin/tasks', roles: ['ADMIN', 'TEACHER'] },
  { label: '账户', to: '/admin/users', roles: ['ADMIN'] }
]

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const menuOpen = ref(false)

const visibleNav = computed(() =>
  auth.role ? navItems.filter((item) => item.roles.includes(auth.role as Role)) : []
)

const roleLabel = computed(() => {
  switch (auth.role) {
    case 'STUDENT':
      return '学生'
    case 'TEACHER':
      return '教师'
    case 'ADMIN':
      return '管理员'
    default:
      return ''
  }
})

const isActive = (to: string) => route.path === to || route.path.startsWith(`${to}/`)

async function onLogout() {
  menuOpen.value = false
  await auth.logout()
  await router.push({ name: 'login' })
}

function goHome() {
  if (!auth.role) return
  router.push(ROLE_HOME[auth.role as Role] ?? '/problems')
}
</script>

<template>
  <div class="shell">
    <header class="shell__nav">
      <button class="brand" type="button" @click="goHome">
        <span class="brand__mark" aria-hidden="true">‹/›</span>
        <span class="brand__text">
          <strong>在线编程评测与考试平台</strong>
          <small>JUDGE · EXAM</small>
        </span>
      </button>

      <nav class="nav" aria-label="主导航">
        <RouterLink
          v-for="item in visibleNav"
          :key="item.to"
          :to="item.to"
          class="nav__link"
          :class="{ 'nav__link--active': isActive(item.to) }"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="shell__right">
        <span v-if="USE_MOCK" class="mock-chip" title="当前为内置 Mock 数据，未连接后端">
          MOCK 数据
        </span>

        <div class="user">
          <button class="user__btn" type="button" @click="menuOpen = !menuOpen">
            <span class="user__avatar" aria-hidden="true">{{ auth.displayName.slice(0, 1) || '?' }}</span>
            <span class="user__meta">
              <strong>{{ auth.displayName }}</strong>
              <small>{{ roleLabel }}</small>
            </span>
            <span class="user__caret" aria-hidden="true">▾</span>
          </button>

          <div v-if="menuOpen" class="user__menu" @mouseleave="menuOpen = false">
            <div class="user__menu-head">
              <strong>{{ auth.displayName }}</strong>
              <span class="muted small">{{ auth.user?.username }} · {{ roleLabel }}</span>
            </div>
            <RouterLink v-if="auth.role === 'STUDENT'" to="/submissions" class="user__menu-item" @click="menuOpen = false">
              我的提交
            </RouterLink>
            <RouterLink v-else to="/teacher/problems" class="user__menu-item" @click="menuOpen = false">
              教学管理
            </RouterLink>
            <button class="user__menu-item user__menu-item--danger" type="button" @click="onLogout">
              退出登录
            </button>
          </div>
        </div>
      </div>
    </header>

    <main class="shell__main" :class="{ 'shell__main--flush': flush }">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.shell__nav {
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 20px;
  height: var(--nav-h);
  padding: 0 20px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border);
}

.shell__main {
  flex: 1 1 auto;
  min-height: 0;
}

.shell__main--flush {
  display: flex;
  flex-direction: column;
  height: calc(100dvh - var(--nav-h));
  min-height: 520px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  flex: none;
}

.brand__mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: linear-gradient(140deg, #2f5fe0, #183a9e);
  color: #fff;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.5px;
  box-shadow: 0 2px 8px -2px rgba(47, 95, 224, 0.65);
}

.brand__text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
  text-align: left;
}

.brand__text strong {
  font-size: 13.5px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.brand__text small {
  font-size: 9.5px;
  letter-spacing: 0.14em;
  color: var(--ink-faint);
  font-weight: 600;
}

.nav {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  flex: 1 1 auto;
  scrollbar-width: none;
}

.nav::-webkit-scrollbar {
  display: none;
}

.nav__link {
  padding: 6px 11px;
  border-radius: var(--radius-sm);
  color: var(--ink-muted);
  font-size: 13px;
  font-weight: 550;
  white-space: nowrap;
  text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease;
}

.nav__link:hover {
  background: var(--bg-subtle);
  color: var(--ink);
  text-decoration: none;
}

.nav__link--active {
  background: var(--brand-soft);
  color: var(--brand-strong);
  font-weight: 650;
}

.shell__right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

.mock-chip {
  padding: 3px 8px;
  border-radius: 999px;
  background: #fff7e6;
  border: 1px dashed #e3c07b;
  color: #8a6414;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.user {
  position: relative;
}

.user__btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 4px 4px;
  background: none;
  border: 1px solid transparent;
  border-radius: 999px;
  cursor: pointer;
}

.user__btn:hover {
  border-color: var(--border);
  background: var(--surface-sunken);
}

.user__avatar {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-soft);
  flex: none;
}

.user__meta {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  text-align: left;
}

.user__meta strong {
  font-size: 12.5px;
  font-weight: 650;
}

.user__meta small {
  font-size: 10.5px;
  color: var(--ink-muted);
}

.user__caret {
  font-size: 9px;
  color: var(--ink-faint);
}

.user__menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  width: 200px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 50;
}

.user__menu-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px 10px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}

.user__menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 10px;
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--ink-soft);
  cursor: pointer;
  text-decoration: none;
}

.user__menu-item:hover {
  background: var(--bg-subtle);
  text-decoration: none;
}

.user__menu-item--danger {
  color: var(--wa);
}

@media (max-width: 900px) {
  .brand__text {
    display: none;
  }
  .shell__nav {
    gap: 12px;
    padding: 0 12px;
  }
  .user__meta {
    display: none;
  }
}
</style>
