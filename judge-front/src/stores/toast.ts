import { reactive } from 'vue'

export type ToastKind = 'info' | 'success' | 'error' | 'warn'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  detail?: string
}

let seq = 1

export const toasts = reactive<ToastItem[]>([])

export function dismissToast(id: number): void {
  const index = toasts.findIndex((t) => t.id === id)
  if (index >= 0) toasts.splice(index, 1)
}

export function pushToast(kind: ToastKind, message: string, detail?: string): number {
  const id = seq++
  toasts.push({ id, kind, message, detail })
  const ttl = kind === 'error' ? 6000 : 3500
  window.setTimeout(() => dismissToast(id), ttl)
  return id
}

export const toast = {
  info: (message: string, detail?: string) => pushToast('info', message, detail),
  success: (message: string, detail?: string) => pushToast('success', message, detail),
  error: (message: string, detail?: string) => pushToast('error', message, detail),
  warn: (message: string, detail?: string) => pushToast('warn', message, detail)
}
