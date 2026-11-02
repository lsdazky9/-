/**
 * 以服务端时间为准的倒计时（BR-01、§6.3）。
 *
 * 前端倒计时只用于显示，"能不能提交" 永远由后端在接收事务里判定。
 * 这里把本地时钟与服务端时间的偏移算出来，避免用户改系统时间或时区造成误判显示。
 */
import { computed, onBeforeUnmount, ref } from 'vue'

export function useCountdown(serverNow: () => number, targetIso: () => string | null) {
  const tick = ref(Date.now())
  const timer = window.setInterval(() => {
    tick.value = Date.now()
  }, 1000)

  onBeforeUnmount(() => window.clearInterval(timer))

  const remainingMs = computed(() => {
    const target = targetIso()
    if (!target) return null
    const targetMs = Date.parse(target)
    if (!Number.isFinite(targetMs)) return null
    void tick.value
    return targetMs - serverNow()
  })

  const expired = computed(() => remainingMs.value !== null && remainingMs.value <= 0)

  return { remainingMs, expired }
}
