/**
 * 统一 HTTP 层。
 *
 * 只做四件事：
 * 1. 拼接口前缀与查询串（前缀来自 VITE_API_BASE_URL，不硬编码）；
 * 2. 同源 Cookie 会话 + 写请求携带 CSRF token；
 * 3. 把后端的 { code, message, requestId } 归一化成 ApiError；
 * 4. Mock 开关：所有路径仍走同一份 URL 契约，联调时只改环境变量。
 *
 * 这里不做任何业务规则判断——资格、时间、配额一律由后端裁决（BR-01、§5.4）。
 */
import type { ApiErrorBody, PageQuery } from './types'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string
  readonly retryAfterMs: number | null

  constructor(
    status: number,
    code: string,
    message: string,
    requestId = '',
    retryAfterMs: number | null = null
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.retryAfterMs = retryAfterMs
  }

  get isAuthError(): boolean {
    return this.status === 401
  }
}

export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1'
export const USE_MOCK = String(import.meta.env.VITE_USE_MOCK ?? 'false') === 'true'

let csrfOverride: string | null = null

/** 登录响应若下发 token 可在此注入；否则回退到同源 Cookie。 */
export function setCsrfToken(token: string | null): void {
  csrfOverride = token
}

export function getCsrfToken(): string | null {
  if (csrfOverride) return csrfOverride
  const names = ['csrf_token', 'XSRF-TOKEN', 'csrftoken']
  for (const raw of document.cookie.split(';')) {
    const [k, ...rest] = raw.trim().split('=')
    if (names.includes(k)) return decodeURIComponent(rest.join('='))
  }
  return null
}

export interface RequestOptions {
  query?: PageQuery
  body?: unknown
  headers?: Record<string, string>
  /** 提交类请求的幂等键（UUID）；网络重试复用，用户再次点击换新键 */
  idempotencyKey?: string
  signal?: AbortSignal
}

function buildQuery(query?: PageQuery): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `req-${Math.random().toString(16).slice(2)}-${Date.now()}`
}

export type MockHandler = (req: {
  method: string
  path: string
  query: URLSearchParams
  body: any
  headers: Record<string, string>
  requestId: string
}) => Promise<{ status: number; body: unknown; retryAfterMs?: number }> | {
  status: number
  body: unknown
  retryAfterMs?: number
}

let mockHandler: MockHandler | null = null

/** 仅开发模式加载 Mock，生产构建不会打包它。 */
async function ensureMock(): Promise<MockHandler> {
  if (mockHandler) return mockHandler
  if (!import.meta.env.DEV) throw new Error('Mock 数据仅在开发模式下可用')
  const mod = await import('./mock')
  mockHandler = mod.handleMock
  return mockHandler
}

const TERMINAL_STATUS = [401, 403, 404, 409, 422, 429, 503]

export async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const url = `${API_BASE}${path}${buildQuery(options.query)}`
  const requestId = newRequestId()

  if (USE_MOCK) {
    const handler = await ensureMock()
    const resolvedPath = path.split('?')[0]
    const query = new URLSearchParams(buildQuery(options.query).replace(/^\?/, ''))
    try {
      const reply = await handler({
        method,
        path: resolvedPath,
        query,
        body: options.body,
        headers: { 'Idempotency-Key': options.idempotencyKey ?? '', 'X-Request-Id': requestId },
        requestId
      })
      if (reply.status >= 200 && reply.status < 300) return reply.body as T
      const err = reply.body as ApiErrorBody
      throw new ApiError(
        reply.status,
        err?.code ?? 'MOCK_ERROR',
        err?.message ?? '请求失败',
        err?.requestId ?? requestId,
        reply.retryAfterMs ?? null
      )
    } catch (e) {
      if (e instanceof ApiError) throw e
      throw new ApiError(503, 'MOCK_FAILURE', (e as Error).message, requestId)
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Request-Id': requestId,
    ...options.headers
  }
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey
  if (options.body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8'
  if (method !== 'GET') {
    const csrf = getCsrfToken()
    if (csrf) headers['X-CSRF-Token'] = csrf
  }

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'NETWORK_ERROR', '网络不可用，请检查连接后重试', requestId)
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const body = (payload ?? {}) as Partial<ApiErrorBody>
    const retryAfter = response.headers.get('Retry-After')
    throw new ApiError(
      response.status,
      body.code ?? `HTTP_${response.status}`,
      body.message ?? `请求失败（HTTP ${response.status}）`,
      body.requestId ?? requestId,
      retryAfter ? Number(retryAfter) * 1000 : null
    )
  }
  return payload as T
}

export const http = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, options?: RequestOptions) => request<T>('POST', path, options),
  put: <T>(path: string, options?: RequestOptions) => request<T>('PUT', path, options),
  patch: <T>(path: string, options?: RequestOptions) => request<T>('PATCH', path, options)
}

/** 供 UI 展示的错误文案：区分「业务拒绝」与「系统/网络故障」。 */
export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.status) {
      case 0:
        return e.message
      case 401:
        return '登录状态已失效，请重新登录'
      case 403:
        return e.message || '没有访问权限'
      case 404:
        return e.message || '资源不存在或不可见'
      case 409:
        return e.message || '当前状态不允许该操作'
      case 422:
        return e.message || '请求内容不合法'
      case 429:
        return e.message || '提交过于频繁或队列已满，请稍后重试'
      case 503:
        return e.message || '评测或后端服务暂时不可用'
      default:
        return e.message || '请求失败'
    }
  }
  return (e as Error)?.message ?? '未知错误'
}

export { TERMINAL_STATUS }
