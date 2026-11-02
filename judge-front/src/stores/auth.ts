/**
 * 会话与角色。
 *
 * 前端只保存「我是谁」，权限判断一律以后端 401/403/404 为准：
 * 这里的路由守卫只用于改善体验，不能作为安全边界（§3.1、BR-07）。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { authApi } from '@/api/client'
import { ApiError, setCsrfToken } from '@/api/http'
import type { MeResponse, UserSummary } from '@/api/types'
import { clearAllDrafts } from '@/utils/draft'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserSummary | null>(null)
  /** 服务端时间基准：localNow + offset = serverNow（BR-01） */
  const serverOffsetMs = ref(0)
  const initializing = ref(true)
  const pending = ref(false)

  const isAuthenticated = computed(() => user.value !== null)
  const role = computed(() => user.value?.role ?? null)
  const isStudent = computed(() => role.value === 'STUDENT')
  const isTeacher = computed(() => role.value === 'TEACHER' || role.value === 'ADMIN')
  const isAdmin = computed(() => role.value === 'ADMIN')
  const displayName = computed(() => user.value?.displayName ?? '')

  function applyMe(me: MeResponse): void {
    user.value = me.user
    const serverMs = Date.parse(me.serverTime)
    if (Number.isFinite(serverMs)) serverOffsetMs.value = serverMs - Date.now()
  }

  function serverNow(): number {
    return Date.now() + serverOffsetMs.value
  }

  /** 用任意接口返回的 serverTime 校准本地偏移（BR-01：以服务端时间为裁决依据）。 */
  function syncServerTime(serverTime: string): void {
    const serverMs = Date.parse(serverTime)
    if (Number.isFinite(serverMs)) serverOffsetMs.value = serverMs - Date.now()
  }

  async function restore(): Promise<void> {
    initializing.value = true
    try {
      applyMe(await authApi.me())
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) {
        // 后端整体不可用时不要反复弹错，交由页面空态提示
      }
      user.value = null
    } finally {
      initializing.value = false
    }
  }

  async function login(username: string, password: string): Promise<void> {
    pending.value = true
    try {
      applyMe(await authApi.login(username, password))
    } finally {
      pending.value = false
    }
  }

  async function logout(): Promise<void> {
    const current = user.value
    try {
      await authApi.logout()
    } catch {
      /* 会话可能已过期，仍按本地退出处理 */
    }
    if (current) clearAllDrafts(current.id)
    setCsrfToken(null)
    user.value = null
    serverOffsetMs.value = 0
  }

  return {
    user,
    role,
    initializing,
    pending,
    isAuthenticated,
    isStudent,
    isTeacher,
    isAdmin,
    displayName,
    serverOffsetMs,
    serverNow,
    syncServerTime,
    restore,
    login,
    logout
  }
})
