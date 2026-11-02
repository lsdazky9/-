/**
 * 浏览器草稿。
 *
 * 规则（§6.3）：
 * - key 按「用户 + 考试/练习 + 题目版本」隔离，退出登录时清理；
 * - 草稿不等于提交证据，仅用于恢复编辑内容；
 * - 写入做 300ms 防抖，避免每次按键都写 localStorage。
 */

const PREFIX = 'judge.draft'

export interface DraftPayload {
  sourceCode: string
  /** 记住上次选的语言，恢复草稿时一并恢复 */
  language?: string
  updatedAt: number
}

function keyOf(userId: string, contextKey: string, versionId: string): string {
  return `${PREFIX}.${userId}.${contextKey}.${versionId}`
}

export function readDraft(userId: string, contextKey: string, versionId: string): DraftPayload | null {
  try {
    const raw = localStorage.getItem(keyOf(userId, contextKey, versionId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftPayload
    return typeof parsed.sourceCode === 'string' ? parsed : null
  } catch {
    return null
  }
}

export function writeDraft(
  userId: string,
  contextKey: string,
  versionId: string,
  sourceCode: string,
  language?: string
): void {
  try {
    localStorage.setItem(
      keyOf(userId, contextKey, versionId),
      JSON.stringify({ sourceCode, language, updatedAt: Date.now() } satisfies DraftPayload)
    )
  } catch {
    /* 存储已满或被禁用时静默失败：草稿不是关键路径 */
  }
}

export function clearDraft(userId: string, contextKey: string, versionId: string): void {
  localStorage.removeItem(keyOf(userId, contextKey, versionId))
}

/** 退出登录时清理该用户的全部草稿（只清本应用前缀，不碰其他数据）。 */
export function clearAllDrafts(userId: string): void {
  const prefixes = `${PREFIX}.${userId}.`
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(prefixes)) keys.push(key)
  }
  keys.forEach((k) => localStorage.removeItem(k))
}
