/**
 * 结果轮询（NFR-06、ADR-06、§6.3）。
 *
 * - 起点 2 秒，长排队时逐步退避到 5 秒；
 * - 进入终态、页面卸载、切换路由立即停止；
 * - 页面不可见时暂停，可见时立即补一次，避免后台堆积请求；
 * - 服务端可通过 pollAfterMs 建议下一次间隔，前端取较大者，不做激进轮询。
 */
import { onBeforeUnmount, ref } from 'vue'

export interface PollingOptions<T> {
  fetcher: () => Promise<T>
  /** 是否继续轮询；返回 false 即停止 */
  shouldContinue: (value: T) => boolean
  /** 由服务端建议的间隔（毫秒） */
  suggestedDelayMs?: () => number | null
  minDelayMs?: number
  maxDelayMs?: number
  onError?: (error: unknown) => void
}

export function usePolling<T>(options: PollingOptions<T>) {
  const minDelay = options.minDelayMs ?? 2000
  const maxDelay = options.maxDelayMs ?? 5000
  const active = ref(false)
  const polling = ref(false)
  const lastUpdatedAt = ref<number | null>(null)
  let timer: number | null = null
  let delay = minDelay
  let stopped = false

  const clearTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  const schedule = (ms: number) => {
    clearTimer()
    if (stopped) return
    timer = window.setTimeout(tick, ms)
  }

  async function tick(): Promise<void> {
    if (stopped) return
    if (document.hidden) {
      schedule(minDelay)
      return
    }
    polling.value = true
    try {
      const value = await options.fetcher()
      lastUpdatedAt.value = Date.now()
      if (!options.shouldContinue(value)) {
        stop()
        return
      }
      const suggested = options.suggestedDelayMs?.() ?? null
      const next = Math.min(maxDelay, Math.max(delay, suggested ?? delay))
      delay = Math.min(maxDelay, Math.round(next * 1.25))
      schedule(next)
    } catch (e) {
      options.onError?.(e)
      delay = Math.min(maxDelay, delay + 1000)
      schedule(delay)
    } finally {
      polling.value = false
    }
  }

  function start(immediate = false): void {
    stopped = false
    active.value = true
    delay = minDelay
    if (immediate) {
      void tick()
      return
    }
    schedule(800)
  }

  function stop(): void {
    stopped = true
    active.value = false
    clearTimer()
  }

  function kick(): void {
    if (stopped) return
    void tick()
  }

  const onVisibility = () => {
    if (!document.hidden && active.value) kick()
  }
  document.addEventListener('visibilitychange', onVisibility)

  onBeforeUnmount(() => {
    stop()
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return { active, polling, lastUpdatedAt, start, stop, kick }
}
