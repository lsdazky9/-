/** 展示层格式化：时间统一由 UTC 转 Asia/Shanghai（§5.1），分数保留 2 位。 */

const SHANGHAI = 'Asia/Shanghai'

const dateTimeFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SHANGHAI,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
})

const shortFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SHANGHAI,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
})

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  return dateTimeFormat.format(new Date(ms)).replace(/\//g, '-')
}

export function formatShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  return shortFormat.format(new Date(ms)).replace(/\//g, '-')
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const diff = Date.now() - ms
  if (diff < 0) {
    const ahead = -diff
    if (ahead < 60_000) return `${Math.ceil(ahead / 1000)} 秒后`
    if (ahead < 3600_000) return `${Math.ceil(ahead / 60_000)} 分钟后`
    return formatShort(iso)
  }
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))} 秒前`
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  return formatShort(iso)
}

/** 把毫秒差格式化为 mm:ss 或 hh:mm:ss，用于考试倒计时。 */
export function formatDuration(ms: number): string {
  const clamped = Math.max(0, ms)
  const totalSeconds = Math.floor(clamped / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/** 按 1024 进制换算，但单位统一用 KB / MB（界面不再出现 KiB、MiB）。 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${trimZero(bytes / 1024)} KB`
  return `${trimZero(bytes / 1024 / 1024)} MB`
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  return ms >= 1000 ? `${trimZero(ms / 1000)} s` : `${ms} ms`
}

/** 去掉多余的 .0 / 末尾 0：2.50 → 2.5、2.00 → 2 */
function trimZero(value: number): string {
  const fixed = value >= 100 ? value.toFixed(0) : value.toFixed(value >= 10 ? 1 : 2)
  return fixed.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1')
}

/** 内存一律用 MB 展示（入参为 KiB）。 */
export function formatMemory(kb: number | null | undefined): string {
  if (kb === null || kb === undefined) return '—'
  return `${trimZero(kb / 1024)} MB`
}

/** 输出上限等字节值转 MB（用于输入框附近的说明）。 */
export function formatMbFromBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  return `${trimZero(bytes / 1024 / 1024)} MB`
}

export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return '—'
  return Number.isInteger(score) ? String(score) : score.toFixed(2)
}

/** 截断长文本（编译日志、输出预览等），避免占据整屏。 */
export function truncate(text: string | null | undefined, max = 400): string {
  if (!text) return ''
  return text.length <= max ? text : `${text.slice(0, max)}\n…（已截断）`
}

/** 输入框使用的 datetime-local 值 ↔ ISO（UTC）。 */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms - new Date().getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

export function fromLocalInput(value: string): string {
  if (!value) return ''
  return new Date(value).toISOString()
}
