/**
 * 前端侧接口契约（对应文档 §6.1 REST 约定、§5.3 字段清单）。
 *
 * 约定：
 * - 所有 ID 一律用十进制字符串，避免 JavaScript 大整数失真（§5.1）。
 * - 所有时间一律为带 Z 的 ISO-8601 字符串，服务端 UTC；界面展示时转 Asia/Shanghai。
 * - 前端不传题面版本、满分、环境摘要等由服务端裁决的字段。
 */

export type Role = 'STUDENT' | 'TEACHER' | 'ADMIN'
export type AccountStatus = 'ACTIVE' | 'DISABLED'

export interface UserSummary {
  id: string
  username: string
  displayName: string
  role: Role
  status: AccountStatus
}

export interface MeResponse {
  user: UserSummary
  /** 服务端当前时间，用于倒计时校准（§6.3） */
  serverTime: string
}

/* ------------------------------------------------------------------ */
/* 题目与版本                                                          */
/* ------------------------------------------------------------------ */

export type ProblemVisibility = 'PUBLIC' | 'PRIVATE'
export type ProblemStatus = 'ACTIVE' | 'ARCHIVED'
export type VersionStatus = 'DRAFT' | 'VALIDATING' | 'READY'
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD'
export type CheckerType = 'EXACT' | 'TOKENS'

/** 本期支持的语言；考试发布后 allowedLanguages 固定，练习默认全部可用。 */
export type Language = 'CPP17' | 'C11' | 'PY3' | 'JAVA17'

export const LANGUAGE_LABEL: Record<Language, string> = {
  CPP17: 'C++17',
  C11: 'C11',
  PY3: 'Python 3',
  JAVA17: 'Java 17'
}

export const LANGUAGE_OPTIONS: { value: Language; label: string; note: string }[] = [
  { value: 'CPP17', label: 'C++17', note: 'g++ 13 · -O2 -std=c++17' },
  { value: 'C11', label: 'C11', note: 'gcc 13 · -O2 -std=c11' },
  { value: 'PY3', label: 'Python 3', note: 'CPython 3.11 · 仅标准库' },
  { value: 'JAVA17', label: 'Java 17', note: 'OpenJDK 17 · Main 类' }
]

/** 语言到 Monaco 语法 id 的映射 */
export const LANGUAGE_MONACO: Record<Language, string> = {
  CPP17: 'cpp',
  C11: 'c',
  PY3: 'python',
  JAVA17: 'java'
}

export interface RunLimits {
  timeLimitMs: number
  wallLimitMs: number
  memoryLimitKb: number
  outputLimitBytes: number
}

export interface ProblemSummary {
  id: string
  title: string
  visibility: ProblemVisibility
  status: ProblemStatus
  difficulty: Difficulty
  /** 当前公开练习题面版本；PRIVATE 或未发布时为 null */
  currentVersionNo: number | null
  ownerName: string
  updatedAt: string
  /** 仅教师端返回：最近一个版本（草稿或就绪），用于进入版本编辑器 */
  latestVersionId?: string | null
}

/** 组卷时可选的已就绪版本 */
export interface ReadyVersionOption {
  versionId: string
  problemId: string
  title: string
  versionNo: number
  difficulty: Difficulty
}

export interface SampleCase {
  ordinal: number
  input: string
  expectedOutput: string
}

export interface ProblemDetail {
  id: string
  title: string
  /** 服务端解析出的固定版本；客户端不能指定（BR-03） */
  versionId: string
  versionNo: number
  statementMarkdown: string
  difficulty: Difficulty
  checkerType: CheckerType
  limits: RunLimits
  samples: SampleCase[]
  /** 服务端建议的默认语言 */
  language: Language
  /** 本次上下文允许的语言；考试取发布时固定的 allowedLanguages */
  languages: Language[]
  /** 是否处于考试上下文；决定反馈策略 */
  feedbackPolicy: 'FULL' | 'VERDICT_ONLY'
  hasVisibleCases: boolean
}

export interface CaseMeta {
  id: string
  ordinal: number
  isSample: boolean
  inputBytes: number
  expectedBytes: number
  inputHash: string
  expectedHash: string
}

export interface ProblemVersionDraft {
  id: string
  problemId: string
  problemTitle: string
  versionNo: number
  status: VersionStatus
  /** 乐观锁：过期 revision 保存返回 409 */
  revision: number
  statementMarkdown: string
  difficulty: Difficulty
  checkerType: CheckerType
  limits: RunLimits
  cases: CaseMeta[]
  contentHash: string | null
  /** VALIDATING 时关联的校验提交 */
  validationSubmissionId: string | null
  validationNote: string | null
  readyAt: string | null
}

export interface ProblemVersionInput {
  revision: number
  statementMarkdown: string
  difficulty: Difficulty
  checkerType: CheckerType
  limits: RunLimits
}

/* ------------------------------------------------------------------ */
/* 提交与评测                                                          */
/* ------------------------------------------------------------------ */

export type Verdict = 'AC' | 'WA' | 'CE' | 'TLE' | 'MLE' | 'RE' | 'OLE' | 'SYSTEM_ERROR'
export type SubmissionStatus = 'QUEUED' | 'RUNNING' | 'RETRY_WAIT' | 'FINISHED' | 'FAILED'
export type JudgePhase = 'PREPARING' | 'COMPILING' | 'RUNNING' | 'REPORTING'
export type AttemptStatus = 'CREATED' | 'LEASED' | 'SUCCEEDED' | 'INFRA_FAILED' | 'EXPIRED'

export interface CaseResultView {
  ordinal: number
  verdict: Verdict
  cpuMs: number
  memoryKb: number
  isSample: boolean
  /** 仅公开样例在练习终态可显示；隐藏点恒为 null（BR-08） */
  expectedOutput: string | null
  actualOutput: string | null
  truncated: boolean
}

export interface AttemptView {
  attemptNo: number
  status: AttemptStatus
  phase: JudgePhase | null
  workerId: string | null
  leaseUntil: string | null
  verdict: Verdict | null
  infraErrorCode: string | null
  startedAt: string | null
  finishedAt: string | null
}

export interface SubmissionDetail {
  id: string
  problemId: string
  problemTitle: string
  examId: string | null
  examTitle: string | null
  contextType: 'PRACTICE' | 'EXAM' | 'VALIDATION'
  language: Language
  sourceCode: string
  status: SubmissionStatus
  phase: JudgePhase | null
  verdict: Verdict | null
  acceptedAt: string
  updatedAt: string
  finishedAt: string | null
  /** RETRY_WAIT 时的下一次重试时间 */
  retryAt: string | null
  retryCount: number
  versionNo: number
  versionContentHash: string
  environmentDigest: string
  limits: RunLimits
  /** 实际执行到的最多测试点数量；隐藏点的通过数不向学生暴露（BR-12） */
  totalCaseCount: number
  cases: CaseResultView[]
  attempts: AttemptView[]
  compileLog: string | null
  /** 服务端建议的下一次轮询间隔（毫秒），用于 2s → 5s 退避（NFR-06） */
  pollAfterMs: number
  /** 只读说明：为何不能重试/重评 */
  policyNote: string | null
}

export interface SubmissionListItem {
  id: string
  problemTitle: string
  examTitle: string | null
  contextType: 'PRACTICE' | 'EXAM' | 'VALIDATION'
  status: SubmissionStatus
  verdict: Verdict | null
  acceptedAt: string
  language: Language
}

export interface SubmitRequest {
  problemId: string
  examId?: string | null
  language: Language
  sourceCode: string
}

export interface SubmitResponse {
  submissionId: string
  status: SubmissionStatus
  acceptedAt: string
  pollAfterMs: number
  requestId: string
}

/* ------------------------------------------------------------------ */
/* 考试                                                                */
/* ------------------------------------------------------------------ */

export type ExamState = 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'GRADING' | 'CLOSED' | 'CANCELED'

export interface ExamSummary {
  id: string
  title: string
  state: ExamState
  startAt: string
  endAt: string
  paperTitle: string
  ownerName: string
  memberCount: number | null
  /** 当前用户是否在该考试名单内（决定能否进入） */
  isMember: boolean
}

export interface ExamProblemSummary {
  problemId: string
  ordinal: number
  fullScore: number
  title: string
  versionNo: number
  difficulty: Difficulty
  /** 本人在该题的已提交次数 */
  submissionCount: number
}

export interface ExamDetail extends ExamSummary {
  /** 服务端时间，倒计时以它为准（BR-01） */
  serverTime: string
  feedbackPolicy: 'VERDICT_ONLY'
  allowedLanguages: string[]
  environmentDigest: string
  maxScore: number
  /** 未开始时考生不可读取题面，problems 为空数组 */
  problems: ExamProblemSummary[]
  myScore: number | null
  gradesPublishedAt: string | null
  /** 本人在该考试下是否已有考试记录 */
  entered: boolean
}

export interface EnterExamResponse {
  examRecordId: string
  serverTime: string
  state: ExamState
}

export interface GradeItem {
  problemId: string
  title: string
  ordinal: number
  fullScore: number
  score: number
  verdict: Verdict | null
  submissionId: string | null
}

export interface MyGrade {
  examId: string
  examTitle: string
  totalScore: number | null
  maxScore: number
  publishedAt: string | null
  published: boolean
  items: GradeItem[]
}

/* ------------------------------------------------------------------ */
/* 教师端                                                              */
/* ------------------------------------------------------------------ */

export type PaperStatus = 'DRAFT' | 'SEALED'

export interface PaperItem {
  problemVersionId: string
  problemId: string
  title: string
  ordinal: number
  fullScore: number
  versionNo: number
  ready: boolean
}

export interface PaperSummary {
  id: string
  title: string
  status: PaperStatus
  revision: number
  itemCount: number
  updatedAt: string
}

export interface PaperDetail extends PaperSummary {
  items: PaperItem[]
}

export interface ExamDraft {
  id: string
  title: string
  paperId: string
  paperTitle: string
  state: ExamState
  startAt: string
  endAt: string
  allowedLanguages: string[]
  environmentDigest: string
  feedbackPolicy: 'VERDICT_ONLY'
  members: { userId: string; displayName: string; username: string; joinedAt: string | null }[]
}

export interface ExamPublishCheck {
  ok: boolean
  problems: { level: 'error' | 'warn'; code: string; message: string }[]
}

export interface StudentGradeRow {
  userId: string
  displayName: string
  username: string
  totalScore: number | null
  submittedCount: number
  pendingCount: number
  systemErrorCount: number
  joinedAt: string | null
}

export interface ExamGradeSummary {
  examId: string
  state: ExamState
  published: boolean
  publishedAt: string | null
  maxScore: number
  /** 阻止发布的原因（BR-13、§5.4） */
  blockers: { submissionId: string; reason: string }[]
  pendingTasks: number
  systemErrors: number
  rows: StudentGradeRow[]
}

/* ------------------------------------------------------------------ */
/* 运维                                                                */
/* ------------------------------------------------------------------ */

export interface JudgeTaskRow {
  submissionId: string
  problemTitle: string
  contextType: 'PRACTICE' | 'EXAM' | 'VALIDATION'
  status: SubmissionStatus
  phase: JudgePhase | null
  attemptNo: number
  workerId: string | null
  leaseUntil: string | null
  verdict: Verdict | null
  infraErrorCode: string | null
  acceptedAt: string
  updatedAt: string
}

export interface AuditEntry {
  id: string
  actorName: string
  action: string
  targetType: string
  targetId: string
  detail: string
  createdAt: string
}

/* ------------------------------------------------------------------ */
/* 通用                                                               */
/* ------------------------------------------------------------------ */

export interface PageQuery {
  page?: number
  size?: number
  [key: string]: string | number | boolean | undefined
}

export interface PageResult<T> {
  items: T[]
  page: number
  size: number
  total: number
}

export interface ApiErrorBody {
  code: string
  message: string
  requestId: string
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  AC: '通过',
  WA: '答案错误',
  CE: '编译错误',
  TLE: '超出时间限制',
  MLE: '超出内存限制',
  RE: '运行时错误',
  OLE: '输出超限',
  SYSTEM_ERROR: '系统故障'
}

/** 判定优先级：基础设施 → MLE → OLE → TLE → RE → 输出比较（§4.8.4） */
export const VERDICT_PRIORITY: Verdict[] = ['SYSTEM_ERROR', 'MLE', 'OLE', 'TLE', 'RE', 'WA', 'CE', 'AC']

export const PHASE_LABEL: Record<JudgePhase, string> = {
  PREPARING: '准备数据',
  COMPILING: '编译中',
  RUNNING: '运行测试点',
  REPORTING: '回报结果'
}

export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  QUEUED: '排队中',
  RUNNING: '评测中',
  RETRY_WAIT: '等待重试',
  FINISHED: '已出结果',
  FAILED: '系统故障'
}

export const EXAM_STATE_LABEL: Record<ExamState, string> = {
  DRAFT: '草稿',
  SCHEDULED: '已发布',
  RUNNING: '进行中',
  GRADING: '阅卷中',
  CLOSED: '已结束',
  CANCELED: '已取消'
}

export const VERSION_STATUS_LABEL: Record<VersionStatus, string> = {
  DRAFT: '草稿',
  VALIDATING: '校验中',
  READY: '已就绪'
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  EASY: '简单',
  MEDIUM: '中等',
  HARD: '困难'
}
