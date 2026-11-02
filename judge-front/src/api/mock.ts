/**
 * 开发期 Mock 后端。
 *
 * 目的：在后端（Spring Boot + MySQL + RabbitMQ + worker）尚未就绪时，
 * 让全部页面与全部状态可运行、可演示：排队、编译、运行、终态、重试、系统故障、
 * 考试未开始/进行中/已结束/成绩已发布、教师校验与发布、管理员恢复。
 *
 * 它实现的是**同一张接口表**（§6.1），因此联调时只需 VITE_USE_MOCK=false。
 * 这里不实现任何安全语义（租约、幂等唯一索引均以简化方式模拟），
 * 结论一律以真实后端为准。
 */
import type {
  AttemptView,
  AuditEntry,
  CaseMeta,
  CaseResultView,
  Difficulty,
  ExamDetail,
  ExamDraft,
  ExamGradeSummary,
  ExamPublishCheck,
  ExamState,
  ExamSummary,
  JudgePhase,
  JudgeTaskRow,
  Language,
  MeResponse,
  MyGrade,
  PageResult,
  PaperDetail,
  PaperItem,
  PaperSummary,
  ProblemDetail,
  ProblemSummary,
  ProblemVersionDraft,
  Role,
  RunLimits,
  SampleCase,
  StudentGradeRow,
  SubmissionDetail,
  SubmissionListItem,
  SubmissionStatus,
  UserSummary,
  Verdict
} from './types'

/* ----------------------------- 基础工具 ----------------------------- */

const now = () => Date.now()
const iso = (ms: number) => new Date(ms).toISOString()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function hash(input: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x1000193
  for (let i = 0; i < input.length; i++) {
    h1 = (h1 ^ input.charCodeAt(i)) * 16777619 >>> 0
    h2 = (h2 + input.charCodeAt(i) * (i + 7)) >>> 0
  }
  const part = (n: number) => n.toString(16).padStart(8, '0')
  return (part(h1) + part(h2) + part(h1 ^ h2) + part((h1 + h2) >>> 0) +
    part(h1 >>> 1) + part(h2 >>> 1) + part(h1 ^ 0x5555) + part(h2 ^ 0xaaaa)).slice(0, 64)
}

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(16).slice(2)}`

class MockError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfterMs?: number
  ) {
    super(message)
  }
}

function paginate<T>(rows: T[], query: URLSearchParams): PageResult<T> {
  const page = Math.max(1, Number(query.get('page') ?? 1))
  const size = Math.min(100, Math.max(1, Number(query.get('size') ?? 20)))
  const start = (page - 1) * size
  return { items: rows.slice(start, start + size), page, size, total: rows.length }
}

/* ------------------------------- 用户 ------------------------------- */

interface MockUser extends UserSummary {
  password: string
}

const users: MockUser[] = [
  { id: '10', username: 'student', displayName: '李同学', role: 'STUDENT', status: 'ACTIVE', password: 'demo1234' },
  { id: '11', username: 'student2', displayName: '赵同学', role: 'STUDENT', status: 'ACTIVE', password: 'demo1234' },
  { id: '12', username: 'student3', displayName: '陈同学', role: 'STUDENT', status: 'ACTIVE', password: 'demo1234' },
  { id: '20', username: 'teacher', displayName: '王老师', role: 'TEACHER', status: 'ACTIVE', password: 'demo1234' },
  { id: '30', username: 'admin', displayName: '平台管理员', role: 'ADMIN', status: 'ACTIVE', password: 'demo1234' }
]

const SESSION_KEY = 'judge.mock.session'
let currentUserId: string | null = localStorage.getItem(SESSION_KEY)

function currentUser(): MockUser {
  const user = users.find((u) => u.id === currentUserId)
  if (!user) throw new MockError(401, 'UNAUTHENTICATED', '未登录或会话已过期')
  if (user.status === 'DISABLED') throw new MockError(401, 'ACCOUNT_DISABLED', '账户已停用')
  return user
}

function requireRole(...roles: Role[]): MockUser {
  const user = currentUser()
  if (!roles.includes(user.role)) throw new MockError(403, 'FORBIDDEN', '当前角色无权访问该资源')
  return user
}

const toPublicUser = (u: MockUser): UserSummary => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  role: u.role,
  status: u.status
})

/* ------------------------------ 题目数据 ----------------------------- */

interface MockCase extends CaseMeta {
  input: string
  expected: string
}

interface MockVersion {
  id: string
  problemId: string
  versionNo: number
  status: ProblemVersionDraft['status']
  revision: number
  statementMarkdown: string
  difficulty: Difficulty
  checkerType: 'EXACT' | 'TOKENS'
  limits: RunLimits
  cases: MockCase[]
  contentHash: string | null
  validationSubmissionId: string | null
  validationNote: string | null
  readyAt: string | null
  validatingSince: number | null
}

interface MockProblem {
  id: string
  title: string
  ownerId: string
  visibility: 'PUBLIC' | 'PRIVATE'
  status: 'ACTIVE' | 'ARCHIVED'
  currentVersionId: string | null
  versions: MockVersion[]
  updatedAt: number
}

const DEFAULT_LIMITS: RunLimits = {
  timeLimitMs: 1000,
  wallLimitMs: 3000,
  memoryLimitKb: 262144,
  outputLimitBytes: 1048576
}

const STATEMENT_AB = `## 题目描述

给定两个整数 $a$ 与 $b$，输出它们的和。

## 输入格式

一行两个整数 $a, b$，满足 $-10^9 \\le a, b \\le 10^9$。

## 输出格式

一行一个整数，表示 $a + b$。

## 数据范围

- 所有输入均为 64 位整数范围内；
- 答案可能超出 32 位整数，请使用 \`long long\`。

## 提示

本题只用于跑通评测链路：提交后请观察排队、编译、运行三个阶段的推进，以及最终判定。`

const STATEMENT_SUM = `## 题目描述

给定长度为 $n$ 的整数序列 $a_1 \\dots a_n$ 与 $q$ 次询问，每次询问区间 $[l, r]$ 的元素和。请使用前缀和在 $O(n + q)$ 内完成。

## 输入格式

第一行两个整数 $n, q$（$1 \\le n, q \\le 2 \\times 10^5$）。
第二行 $n$ 个整数。
接下来 $q$ 行，每行两个整数 $l, r$（$1 \\le l \\le r \\le n$）。

## 输出格式

对每次询问输出一行一个整数。

## 提示

直接对每次询问求和会超时，请预处理前缀和数组 \`pre[i] = pre[i-1] + a[i]\`。`

const STATEMENT_LIS = `## 题目描述

给定长度为 $n$ 的序列，求最长严格上升子序列（LIS）的长度。

## 输入格式

第一行一个整数 $n$（$1 \\le n \\le 10^5$），第二行 $n$ 个整数。

## 输出格式

输出最长严格上升子序列的长度。

## 提示

$O(n^2)$ 的朴素做法会超时，请使用维护最小末尾元素的 $O(n \\log n)$ 做法。`

const STATEMENT_EXAM = `## 题目描述

给定 $n$ 个整数，请输出其中的最大值。

## 输入格式

第一行一个整数 $n$（$1 \\le n \\le 10^5$），第二行 $n$ 个整数。

## 输出格式

输出最大值。

> 本题为考试题：题面与判定在考试开始前不可读，隐藏测试点内容不返回。`

function makeCase(ordinal: number, isSample: boolean, input: string, expected: string): MockCase {
  return {
    id: `${ordinal}${Math.floor(Math.random() * 900 + 100)}`,
    ordinal,
    isSample,
    inputBytes: new TextEncoder().encode(input).length,
    expectedBytes: new TextEncoder().encode(expected).length,
    inputHash: hash(input),
    expectedHash: hash(expected),
    input,
    expected
  }
}

const problems: MockProblem[] = [
  {
    id: '1001',
    title: '两数之和',
    ownerId: '20',
    visibility: 'PUBLIC',
    status: 'ACTIVE',
    currentVersionId: '9001',
    updatedAt: now() - 86400000 * 3,
    versions: [
      {
        id: '9001',
        problemId: '1001',
        versionNo: 1,
        status: 'READY',
        revision: 4,
        statementMarkdown: STATEMENT_AB,
        difficulty: 'EASY',
        checkerType: 'TOKENS',
        limits: { ...DEFAULT_LIMITS },
        cases: [
          makeCase(1, true, '1 2\n', '3\n'),
          makeCase(2, true, '100 -50\n', '50\n'),
          makeCase(3, false, '1000000000 1000000000\n', '2000000000\n'),
          makeCase(4, false, '-1000000000 -1000000000\n', '-2000000000\n'),
          makeCase(5, false, '0 0\n', '0\n')
        ],
        contentHash: hash('1001:v1'),
        validationSubmissionId: '7001',
        validationNote: null,
        readyAt: iso(now() - 86400000 * 3),
        validatingSince: null
      },
      {
        id: '9002',
        problemId: '1001',
        versionNo: 2,
        status: 'DRAFT',
        revision: 1,
        statementMarkdown: STATEMENT_AB + '\n\n## 扩展\n\n新增 $a - b$ 的说明（草稿，未发布）。',
        difficulty: 'EASY',
        checkerType: 'TOKENS',
        limits: { ...DEFAULT_LIMITS },
        cases: [makeCase(1, true, '1 2\n', '3\n')],
        contentHash: null,
        validationSubmissionId: null,
        validationNote: null,
        readyAt: null,
        validatingSince: null
      }
    ]
  },
  {
    id: '1002',
    title: '区间求和',
    ownerId: '20',
    visibility: 'PUBLIC',
    status: 'ACTIVE',
    currentVersionId: '9011',
    updatedAt: now() - 86400000 * 2,
    versions: [
      {
        id: '9011',
        problemId: '1002',
        versionNo: 1,
        status: 'READY',
        revision: 2,
        statementMarkdown: STATEMENT_SUM,
        difficulty: 'MEDIUM',
        checkerType: 'TOKENS',
        limits: { ...DEFAULT_LIMITS, timeLimitMs: 1500, wallLimitMs: 4000 },
        cases: [
          makeCase(1, true, '5 3\n1 2 3 4 5\n1 5\n2 3\n4 4\n', '15\n5\n4\n'),
          makeCase(2, false, '3 1\n1 1 1\n1 3\n', '3\n'),
          makeCase(3, false, '1 1\n100\n1 1\n', '100\n')
        ],
        contentHash: hash('1002:v1'),
        validationSubmissionId: '7002',
        validationNote: null,
        readyAt: iso(now() - 86400000 * 2),
        validatingSince: null
      }
    ]
  },
  {
    id: '1003',
    title: '最长上升子序列',
    ownerId: '20',
    visibility: 'PUBLIC',
    status: 'ACTIVE',
    currentVersionId: '9021',
    updatedAt: now() - 86400000,
    versions: [
      {
        id: '9021',
        problemId: '1003',
        versionNo: 1,
        status: 'READY',
        revision: 3,
        statementMarkdown: STATEMENT_LIS,
        difficulty: 'HARD',
        checkerType: 'EXACT',
        limits: { ...DEFAULT_LIMITS, timeLimitMs: 2000, wallLimitMs: 5000 },
        cases: [
          makeCase(1, true, '6\n1 7 2 8 3 9\n', '4\n'),
          makeCase(2, false, '5\n5 4 3 2 1\n', '1\n')
        ],
        contentHash: hash('1003:v1'),
        validationSubmissionId: '7003',
        validationNote: null,
        readyAt: iso(now() - 86400000),
        validatingSince: null
      }
    ]
  },
  {
    id: '1004',
    title: '序列最大值（考试题）',
    ownerId: '20',
    visibility: 'PRIVATE',
    status: 'ACTIVE',
    currentVersionId: '9031',
    updatedAt: now() - 3600_000 * 5,
    versions: [
      {
        id: '9031',
        problemId: '1004',
        versionNo: 1,
        status: 'READY',
        revision: 5,
        statementMarkdown: STATEMENT_EXAM,
        difficulty: 'EASY',
        checkerType: 'TOKENS',
        limits: { ...DEFAULT_LIMITS },
        cases: [
          makeCase(1, true, '5\n3 9 2 7 4\n', '9\n'),
          makeCase(2, false, '1\n7\n', '7\n'),
          makeCase(3, false, '4\n-1 -9 -2 -7\n', '-1\n')
        ],
        contentHash: hash('1004:v1'),
        validationSubmissionId: '7004',
        validationNote: null,
        readyAt: iso(now() - 3600_000 * 6),
        validatingSince: null
      }
    ]
  }
]

function findProblem(id: string): MockProblem {
  const p = problems.find((x) => x.id === id)
  if (!p) throw new MockError(404, 'RESOURCE_NOT_FOUND', '题目不存在或不可见')
  return p
}

function findVersion(id: string): { problem: MockProblem; version: MockVersion } {
  for (const problem of problems) {
    const version = problem.versions.find((v) => v.id === id)
    if (version) return { problem, version }
  }
  throw new MockError(404, 'RESOURCE_NOT_FOUND', '版本不存在')
}

function readyVersion(problem: MockProblem): MockVersion | null {
  return problem.versions.find((v) => v.id === problem.currentVersionId) ?? null
}

const toProblemSummary = (p: MockProblem): ProblemSummary => {
  const v = readyVersion(p)
  return {
    id: p.id,
    title: p.title,
    visibility: p.visibility,
    status: p.status,
    difficulty: v?.difficulty ?? p.versions[p.versions.length - 1].difficulty,
    currentVersionNo: v?.versionNo ?? null,
    ownerName: users.find((u) => u.id === p.ownerId)?.displayName ?? '教师',
    updatedAt: iso(p.updatedAt)
  }
}

const sampleCases = (v: MockVersion): SampleCase[] =>
  v.cases
    .filter((c) => c.isSample)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((c) => ({ ordinal: c.ordinal, input: c.input, expectedOutput: c.expected }))

function toVersionDraft(p: MockProblem, v: MockVersion): ProblemVersionDraft {
  return {
    id: v.id,
    problemId: p.id,
    problemTitle: p.title,
    versionNo: v.versionNo,
    status: v.status,
    revision: v.revision,
    statementMarkdown: v.statementMarkdown,
    difficulty: v.difficulty,
    checkerType: v.checkerType,
    limits: { ...v.limits },
    cases: v.cases.map((c) => ({
      id: c.id,
      ordinal: c.ordinal,
      isSample: c.isSample,
      inputBytes: c.inputBytes,
      expectedBytes: c.expectedBytes,
      inputHash: c.inputHash,
      expectedHash: c.expectedHash
    })),
    contentHash: v.contentHash,
    validationSubmissionId: v.validationSubmissionId,
    validationNote: v.validationNote,
    readyAt: v.readyAt
  }
}

/** 模拟异步校验：VALIDATING 超过 4 秒自动转 READY。 */
function tickValidation(): void {
  const t = now()
  for (const p of problems) {
    for (const v of p.versions) {
      if (v.status === 'VALIDATING' && v.validatingSince && t - v.validatingSince > 4000) {
        v.status = 'READY'
        v.validationNote = null
        v.contentHash = hash(`${p.id}:v${v.versionNo}:${v.statementMarkdown.length}`)
        v.readyAt = iso(t)
        v.validatingSince = null
        if (v.validationSubmissionId) {
          const sub = submissions.get(v.validationSubmissionId)
          if (sub) {
            sub.verdict = 'AC'
            sub.status = 'FINISHED'
          }
        }
      }
    }
  }
}

/* ------------------------------- 试卷 ------------------------------- */

interface MockPaper {
  id: string
  title: string
  ownerId: string
  status: 'DRAFT' | 'SEALED'
  revision: number
  items: PaperItem[]
  updatedAt: number
}

function toPaperItem(versionId: string, ordinal: number, fullScore: number): PaperItem {
  const { problem, version } = findVersion(versionId)
  return {
    problemVersionId: version.id,
    problemId: problem.id,
    title: problem.title,
    ordinal,
    fullScore,
    versionNo: version.versionNo,
    ready: version.status === 'READY'
  }
}

const papers: MockPaper[] = [
  {
    id: '6001',
    title: '第一次编程考试试卷（A 卷）',
    ownerId: '20',
    status: 'SEALED',
    revision: 6,
    updatedAt: now() - 86400000 * 2,
    items: [toPaperItem('9001', 1, 40), toPaperItem('9031', 2, 60)]
  },
  {
    id: '6002',
    title: '综合练习卷（草稿）',
    ownerId: '20',
    status: 'DRAFT',
    revision: 2,
    updatedAt: now() - 3600_000 * 8,
    items: [toPaperItem('9011', 1, 50)]
  }
]

const toPaperDetail = (p: MockPaper): PaperDetail => ({
  id: p.id,
  title: p.title,
  status: p.status,
  revision: p.revision,
  itemCount: p.items.length,
  updatedAt: iso(p.updatedAt),
  items: p.items
})

/* ------------------------------- 考试 ------------------------------- */

interface MockExam {
  id: string
  title: string
  ownerId: string
  paperId: string
  state: ExamState
  startAt: number
  endAt: number
  allowedLanguages: Language[]
  environmentDigest: string
  feedbackPolicy: 'VERDICT_ONLY'
  members: string[]
  gradesPublishedAt: number | null
  createdAt: number
}

const minutes = (n: number) => n * 60_000

const exams: MockExam[] = [
  {
    id: '3001',
    title: '软件工程实验 · 第一次编程考试',
    ownerId: '20',
    paperId: '6001',
    state: 'RUNNING',
    startAt: now() - minutes(25),
    endAt: now() + minutes(35),
    allowedLanguages: ['CPP17', 'C11', 'PY3', 'JAVA17'],
    environmentDigest: 'gcc:13.2-cpp17@sha256:5f1c…a91',
    feedbackPolicy: 'VERDICT_ONLY',
    members: ['10', '11', '12'],
    gradesPublishedAt: null,
    createdAt: now() - 86400000 * 2
  },
  {
    id: '3002',
    title: '软件工程实验 · 期中测验（已结束）',
    ownerId: '20',
    paperId: '6001',
    state: 'CLOSED',
    startAt: now() - 86400000 * 5,
    endAt: now() - 86400000 * 5 + minutes(90),
    allowedLanguages: ['CPP17', 'C11', 'PY3', 'JAVA17'],
    environmentDigest: 'gcc:13.2-cpp17@sha256:5f1c…a91',
    feedbackPolicy: 'VERDICT_ONLY',
    members: ['10', '11'],
    gradesPublishedAt: now() - 86400000 * 4,
    createdAt: now() - 86400000 * 8
  },
  {
    id: '3003',
    title: '软件工程实验 · 第二次编程考试',
    ownerId: '20',
    paperId: '6001',
    state: 'SCHEDULED',
    startAt: now() + 86400000 * 2,
    endAt: now() + 86400000 * 2 + minutes(60),
    allowedLanguages: ['CPP17', 'C11', 'PY3', 'JAVA17'],
    environmentDigest: 'gcc:13.2-cpp17@sha256:5f1c…a91',
    feedbackPolicy: 'VERDICT_ONLY',
    members: ['10', '11', '12'],
    gradesPublishedAt: null,
    createdAt: now() - 3600_000 * 12
  }
]

function examStateOf(e: MockExam): ExamState {
  if (e.state === 'DRAFT' || e.state === 'CANCELED' || e.state === 'CLOSED') return e.state
  const t = now()
  if (t < e.startAt) return 'SCHEDULED'
  if (t < e.endAt) return 'RUNNING'
  if (e.gradesPublishedAt) return 'CLOSED'
  return 'GRADING'
}

function findExam(id: string): MockExam {
  const e = exams.find((x) => x.id === id)
  if (!e) throw new MockError(404, 'RESOURCE_NOT_FOUND', '考试不存在或不可见')
  return e
}

const toExamSummary = (e: MockExam, viewer: MockUser): ExamSummary => {
  const paper = papers.find((p) => p.id === e.paperId)
  return {
    id: e.id,
    title: e.title,
    state: examStateOf(e),
    startAt: iso(e.startAt),
    endAt: iso(e.endAt),
    paperTitle: paper?.title ?? '未命名试卷',
    ownerName: users.find((u) => u.id === e.ownerId)?.displayName ?? '教师',
    memberCount: e.members.length,
    isMember: e.members.includes(viewer.id)
  }
}

/* ------------------------------ 试卷成绩 ----------------------------- */

function paperItemsOf(e: MockExam): PaperItem[] {
  return papers.find((p) => p.id === e.paperId)?.items ?? []
}

/* ------------------------------ 提交数据 ----------------------------- */

interface MockSubmission {
  id: string
  userId: string
  problemId: string
  problemVersionId: string
  examId: string | null
  contextType: 'PRACTICE' | 'EXAM' | 'VALIDATION'
  language: Language
  sourceCode: string
  status: SubmissionStatus
  phase: JudgePhase | null
  verdict: Verdict | null
  acceptedAtMs: number
  finishedAtMs: number | null
  updatedAtMs: number
  retryAtMs: number | null
  retryCount: number
  environmentDigest: string
  attempts: AttemptView[]
  compileLog: string | null
  idempotencyKey: string
  requestHash: string
}

const submissions = new Map<string, MockSubmission>()
let submissionSeq = 5000

function judgeTimeline(ms: number) {
  if (ms < 1200) return { status: 'QUEUED' as SubmissionStatus, phase: null as JudgePhase | null }
  if (ms < 2600) return { status: 'RUNNING' as SubmissionStatus, phase: 'COMPILING' as JudgePhase }
  if (ms < 4200) return { status: 'RUNNING' as SubmissionStatus, phase: 'RUNNING' as JudgePhase }
  if (ms < 5000) return { status: 'RUNNING' as SubmissionStatus, phase: 'REPORTING' as JudgePhase }
  return { status: 'FINISHED' as SubmissionStatus, phase: null as JudgePhase | null }
}

/** 按代码特征模拟判定结果，覆盖 AC/WA/CE/TLE/MLE/RE/OLE/SYSTEM_ERROR 七类。 */
function decideVerdict(code: string, isValidation: boolean, language: Language = 'CPP17'): Verdict {
  const src = code
  if (!src.trim()) return 'CE'
  if (src.includes('infra_fail')) return 'SYSTEM_ERROR'

  if (language === 'PY3') {
    if (!/print\s*\(|sys\.stdout/.test(src)) return 'CE'
    if (/while\s+True\s*:/.test(src)) return 'TLE'
    if (/list\s*\(\s*range\s*\(\s*10\s*\*\*\s*8\s*\)\s*\)|\[0\]\s*\*\s*10\s*\*\*\s*8/.test(src)) return 'MLE'
    if (/1\s*\/\s*0|raise\s+RuntimeError/.test(src)) return 'RE'
    if (src.includes('infinite_output') || /while\s+True\s*:\s*print/.test(src)) return 'OLE'
    if (/print\s*\(\s*['"]hello|print\s*\(\s*['"]wrong/.test(src)) return 'WA'
    if (isValidation) return 'AC'
    return /a\s*\+\s*b|int\(input|map\(int/.test(src) ? 'AC' : 'WA'
  }

  if (language === 'JAVA17' || language === 'C11') {
    const hasEntry = language === 'JAVA17' ? /class\s+Main|static\s+void\s+main/.test(src) : /main\s*\(/.test(src)
    if (!hasEntry) return 'CE'
    if (/while\s*\(\s*(1|true)\s*\)|for\s*\(\s*;\s*;\s*\)/.test(src)) return 'TLE'
    if (/new\s+long\s*\[\s*100000000\s*\]|malloc\s*\(\s*1\s*<<\s*30\s*\)|new\s+int\s*\[\s*100000000\s*\]/.test(src)) return 'MLE'
    if (/return\s+1\s*\/\s*0|throw\s+new\s+RuntimeException/.test(src)) return 'RE'
    if (/printf\s*\(\s*"%s"/.test(src) || src.includes('infinite_output')) return 'OLE'
    if (src.includes('"hello"') || src.includes('"wrong"')) return 'WA'
    if (isValidation) return 'AC'
    return /a\s*\+\s*b|scanf|System\.out\.println\s*\(\s*a\s*\+\s*b/.test(src) ? 'AC' : 'WA'
  }

  if (!src.includes('main')) return 'CE'
  if (/while\s*\(\s*(1|true)\s*\)|for\s*\(\s*;\s*;\s*\)/.test(src)) return 'TLE'
  if (/new\s+long\s+long\s*\[\s*100000000\s*\]|malloc\s*\(\s*1\s*<<\s*30\s*\)|bad_alloc/.test(src)) return 'MLE'
  if (/return\s+1\s*\/\s*0|throw\s+std::runtime_error/.test(src)) return 'RE'
  if (/printf\s*\(\s*"%s"/.test(src) || src.includes('infinite_output')) return 'OLE'
  if (/cout\s*<<\s*"hello"|cout\s*<<\s*"wrong"/.test(src)) return 'WA'
  if (isValidation) return 'AC'
  if (/a\s*\+\s*b|scanf|cpp17_demo/.test(src)) return 'AC'
  return 'WA'
}

function buildCases(problem: MockProblem, verdict: Verdict, hideDetails: boolean): CaseResultView[] {
  const version = readyVersion(problem) ?? problem.versions[0]
  const cases = version.cases
  if (verdict === 'CE') return []
  const list: CaseResultView[] = []
  let failed = false
  for (const c of cases) {
    const caseVerdict: Verdict = failed ? 'AC' : c.isSample ? 'AC' : 'AC'
    if (failed) {
      list.push({
        ordinal: c.ordinal,
        verdict: caseVerdict,
        cpuMs: 0,
        memoryKb: 0,
        isSample: c.isSample,
        expectedOutput: null,
        actualOutput: null,
        truncated: false
      })
      continue
    }
    const isFailPoint = !failed && c.ordinal === (cases.find((x) => !x.isSample)?.ordinal ?? 1)
    const v: Verdict = verdict === 'AC' ? 'AC' : isFailPoint ? verdict : 'AC'
    if (v !== 'AC') failed = true
    list.push({
      ordinal: c.ordinal,
      verdict: v,
      cpuMs: v === 'TLE' ? version.limits.timeLimitMs : 12 + c.ordinal * 7,
      memoryKb: v === 'MLE' ? version.limits.memoryLimitKb : 2048 + c.ordinal * 512,
      isSample: c.isSample,
      expectedOutput: !hideDetails && c.isSample ? c.expected : null,
      actualOutput: !hideDetails && c.isSample && v !== 'AC' ? '3\n' : null,
      truncated: false
    })
  }
  return list
}

function submissionDetail(s: MockSubmission, viewer: MockUser): SubmissionDetail {
  const problem = findProblem(s.problemId)
  const version = problem.versions.find((v) => v.id === s.problemVersionId) ?? problem.versions[0]
  const elapsed = now() - s.acceptedAtMs
  const live = s.status === 'FINISHED' || s.status === 'FAILED' ? s : { ...s, ...judgeTimeline(elapsed) }
  const isOwner = s.userId === viewer.id
  const isStaff = viewer.role === 'TEACHER' || viewer.role === 'ADMIN'
  if (!isOwner && !isStaff) throw new MockError(404, 'RESOURCE_NOT_FOUND', '提交不存在或不可见')

  const hideDetails = s.contextType === 'EXAM' && isOwner
  const finished = live.status === 'FINISHED' || live.status === 'FAILED'
  const verdict: Verdict | null = finished
    ? live.status === 'FAILED'
      ? 'SYSTEM_ERROR'
      : decideVerdict(s.sourceCode, false, s.language)
    : null

  const cases = finished ? buildCases(problem, verdict as Verdict, hideDetails) : []
  const attempts: AttemptView[] = [
    {
      attemptNo: 1,
      status: finished ? (live.status === 'FAILED' ? 'INFRA_FAILED' : 'SUCCEEDED') : live.phase ? 'LEASED' : 'CREATED',
      phase: live.phase,
      workerId: live.phase || finished ? 'worker-1' : null,
      leaseUntil: finished ? null : iso(now() + 25000),
      verdict,
      infraErrorCode: live.status === 'FAILED' ? 'SANDBOX_START_FAILED' : null,
      startedAt: iso(s.acceptedAtMs + 1200),
      finishedAt: finished ? iso(s.finishedAtMs ?? s.acceptedAtMs + 5000) : null
    }
  ]

  return {
    id: s.id,
    problemId: s.problemId,
    problemTitle: problem.title,
    examId: s.examId,
    examTitle: s.examId ? exams.find((e) => e.id === s.examId)?.title ?? null : null,
    contextType: s.contextType,
    language: s.language,
    sourceCode: s.sourceCode,
    status: live.status,
    phase: live.phase,
    verdict,
    acceptedAt: iso(s.acceptedAtMs),
    updatedAt: iso(now()),
    finishedAt: finished ? iso(s.finishedAtMs ?? s.acceptedAtMs + 5000) : null,
    retryAt: live.status === 'RETRY_WAIT' ? iso(now() + 15000) : null,
    retryCount: s.retryCount,
    versionNo: version.versionNo,
    versionContentHash: version.contentHash ?? hash('draft'),
    environmentDigest: s.environmentDigest,
    limits: { ...version.limits },
    totalCaseCount: version.cases.length,
    cases,
    attempts,
    compileLog: verdict === 'CE'
      ? `solution.cpp: In function 'int main()':\nsolution.cpp:3:5: error: expected ';' before '}' token\n    3 |     return 0\n      |             ^\n      |             ;\n[日志已截断至 64 KB，并清除主机路径]`
      : null,
    pollAfterMs: finished ? 5000 : elapsed < 6000 ? 2000 : 5000,
    policyNote:
      s.contextType === 'EXAM'
        ? '考试期间仅展示阶段与最终判定；隐藏测试点的数量、耗时与逐点细节不返回（BR-12）。'
        : verdict === 'SYSTEM_ERROR'
          ? '系统故障不计入学生错误次数；自动重试耗尽后由管理员恢复，恢复前成绩不能发布（BR-09）。'
          : null
  }
}

/* ---------------------------- 种子提交数据 --------------------------- */

function seedSubmission(
  id: string,
  userId: string,
  problemId: string,
  source: string,
  context: 'PRACTICE' | 'EXAM',
  examId: string | null,
  acceptedOffsetMs: number,
  finished: boolean
): void {
  const problem = findProblem(problemId)
  const version = readyVersion(problem) ?? problem.versions[0]
  const acceptedAtMs = now() - acceptedOffsetMs
  const verdict = decideVerdict(source, false)
  const failed = verdict === 'SYSTEM_ERROR'
  submissions.set(id, {
    id,
    userId,
    problemId,
    problemVersionId: version.id,
    examId,
    contextType: context,
    language: 'CPP17',
    sourceCode: source,
    status: finished ? (failed ? 'FAILED' : 'FINISHED') : 'QUEUED',
    phase: null,
    verdict: finished ? verdict : null,
    acceptedAtMs,
    finishedAtMs: finished ? acceptedAtMs + 5000 : null,
    updatedAtMs: now(),
    retryAtMs: null,
    retryCount: failed ? 2 : 0,
    environmentDigest: 'gcc:13.2-cpp17@sha256:5f1c…a91',
    attempts: [],
    compileLog: null,
    idempotencyKey: uuid(),
    requestHash: hash(source)
  })
}

const SAMPLE_AC = `#include <iostream>

int main() {
    long long a, b;
    std::cin >> a >> b;
    std::cout << a + b << '\\n';
    return 0;
}
`

const SAMPLE_WA = `#include <iostream>

int main() {
    int a, b;
    std::cin >> a >> b;
    std::cout << "hello" << '\\n';
    return 0;
}
`

const SAMPLE_CE = `#include <iostream>
int main() {
    long long a, b;
    std::cin >> a >> b
    return 0
}
`

const SAMPLE_TLE = `#include <iostream>
int main() {
    long long a = 0;
    while (1) { a++; }
    return 0;
}
`

const SAMPLE_FAILED = `#include <iostream>
// infra_fail: 用于演示 SYSTEM_ERROR 与管理员恢复
int main() {
    return 0;
}
`

seedSubmission('5001', '10', '1001', SAMPLE_AC, 'PRACTICE', null, 86400000 * 2, true)
seedSubmission('5002', '10', '1001', SAMPLE_WA, 'PRACTICE', null, 3600_000 * 20, true)
seedSubmission('5003', '10', '1002', SAMPLE_CE, 'PRACTICE', null, 3600_000 * 9, true)
seedSubmission('5004', '10', '1003', SAMPLE_TLE, 'PRACTICE', null, 3600_000 * 4, true)
seedSubmission('5005', '11', '1001', SAMPLE_AC, 'PRACTICE', null, 3600_000 * 30, true)
seedSubmission('5006', '10', '1001', SAMPLE_AC, 'EXAM', '3001', minutes(18.5), true)
seedSubmission('5007', '11', '1004', SAMPLE_FAILED, 'EXAM', '3001', minutes(9), true)
// 已结束并发布成绩的考试：为李同学补一条 AC，保证"总分/分题明细"互相一致
seedSubmission('5008', '10', '1001', SAMPLE_AC, 'EXAM', '3002', 86400_000 * 5 + 60_000, true)

submissionSeq = 5009

/* ------------------------------- 审计 ------------------------------- */

const audits: AuditEntry[] = [
  {
    id: '1',
    actorName: '王老师',
    action: 'EXAM_PUBLISHED',
    targetType: 'exam',
    targetId: '3001',
    detail: '封存试卷 6001，固定环境摘要 gcc:13.2-cpp17，名单 3 人',
    createdAt: iso(now() - 86400000 * 2)
  },
  {
    id: '2',
    actorName: '系统恢复调度器',
    action: 'ATTEMPT_RECOVERED',
    targetType: 'submission',
    targetId: '5007',
    detail: '租约到期自动重试，attempt_no=2；次数用尽后转 SYSTEM_ERROR',
    createdAt: iso(now() - 3600_000 * 2)
  }
]

/* ------------------------------- 路由 ------------------------------- */

export async function handleMock(req: {
  method: string
  path: string
  query: URLSearchParams
  body: any
  headers: Record<string, string>
  requestId: string
}): Promise<{ status: number; body: unknown; retryAfterMs?: number }> {
  // 模拟网络与后端延迟，让加载态可见
  await sleep(120 + Math.random() * 180)
  tickValidation()

  const { method, path, query, body } = req
  const seg = path.split('/').filter(Boolean)

  try {
    const result = route(method, seg, query, body, req.headers)
    return { status: 200, body: result }
  } catch (e) {
    if (e instanceof MockError) {
      return {
        status: e.status,
        body: { code: e.code, message: e.message, requestId: req.requestId },
        retryAfterMs: e.retryAfterMs
      }
    }
    return {
      status: 500,
      body: { code: 'INTERNAL', message: (e as Error).message, requestId: req.requestId }
    }
  }
}

function route(
  method: string,
  seg: string[],
  query: URLSearchParams,
  body: any,
  headers: Record<string, string>
): unknown {
  const [a, b, c, d, e] = seg

  /* ------------------------------ 认证 ------------------------------ */
  if (a === 'auth' && b === 'login' && method === 'POST') {
    const user = users.find((u) => u.username === body?.username)
    if (!user || user.password !== body?.password) {
      throw new MockError(401, 'INVALID_CREDENTIALS', '用户名或密码错误')
    }
    if (user.status === 'DISABLED') {
      throw new MockError(403, 'ACCOUNT_DISABLED', '账户已停用，请联系管理员')
    }
    currentUserId = user.id
    localStorage.setItem(SESSION_KEY, user.id)
    const me: MeResponse = { user: toPublicUser(user), serverTime: iso(now()) }
    return me
  }
  if (a === 'auth' && b === 'logout' && method === 'POST') {
    currentUserId = null
    localStorage.removeItem(SESSION_KEY)
    return null
  }
  if (a === 'me' && method === 'GET') {
    const user = currentUser()
    return { user: toPublicUser(user), serverTime: iso(now()) } satisfies MeResponse
  }

  /* ------------------------------ 题目 ------------------------------ */
  if (a === 'problems' && !b && method === 'GET') {
    const user = currentUser()
    const keyword = (query.get('keyword') ?? '').trim()
    const difficulty = query.get('difficulty') ?? ''
    let rows = problems
      .filter((p) => p.visibility === 'PUBLIC' && p.status === 'ACTIVE' && readyVersion(p))
      .filter((p) => (keyword ? p.title.includes(keyword) : true))
      .filter((p) => (difficulty ? readyVersion(p)?.difficulty === difficulty : true))
      .sort((x, y) => y.updatedAt - x.updatedAt)
      .map(toProblemSummary)
    if (user.role !== 'STUDENT') {
      // 教师/管理员列表额外包含自己可见的私有题备查
      rows = rows.concat(
        problems
          .filter((p) => p.visibility === 'PRIVATE' && p.ownerId === user.id && readyVersion(p))
          .map(toProblemSummary)
      )
    }
    return paginate(rows, query)
  }

  if (a === 'problems' && b && !c && method === 'GET') {
    const user = currentUser()
    const problem = findProblem(b)
    const version = readyVersion(problem)
    if (!version) throw new MockError(409, 'VERSION_NOT_READY', '该题暂无已发布版本')
    if (problem.visibility === 'PRIVATE' && problem.ownerId !== user.id && user.role === 'STUDENT') {
      throw new MockError(404, 'RESOURCE_NOT_FOUND', '题目不存在或不可见')
    }
    const detail: ProblemDetail = {
      id: problem.id,
      title: problem.title,
      versionId: version.id,
      versionNo: version.versionNo,
      statementMarkdown: version.statementMarkdown,
      difficulty: version.difficulty,
      checkerType: version.checkerType,
      limits: { ...version.limits },
      samples: sampleCases(version),
      language: 'CPP17',
      languages: ['CPP17', 'C11', 'PY3', 'JAVA17'],
      feedbackPolicy: 'FULL',
      hasVisibleCases: version.cases.some((x) => x.isSample)
    }
    return detail
  }

  /* ------------------------------ 提交 ------------------------------ */
  if (a === 'submissions' && !b && method === 'POST') {
    const user = currentUser()
    const key = headers['Idempotency-Key']
    if (!key) throw new MockError(422, 'MISSING_IDEMPOTENCY_KEY', '缺少 Idempotency-Key')
    const payload = body ?? {}
    const code = String(payload.sourceCode ?? '')
    if (!code.trim()) throw new MockError(422, 'EMPTY_SOURCE', '代码不能为空')
    if (new TextEncoder().encode(code).length > 65536) {
      throw new MockError(422, 'SOURCE_TOO_LARGE', '代码不得超过 65536 字节')
    }
    const SUPPORTED: Language[] = ['CPP17', 'C11', 'PY3', 'JAVA17']
    const language = (SUPPORTED.includes(payload.language) ? payload.language : 'CPP17') as Language
    if (payload.language !== undefined && !SUPPORTED.includes(payload.language)) {
      throw new MockError(422, 'UNSUPPORTED_LANGUAGE', '不支持该语言')
    }
    const requestHash = hash(`${payload.problemId}|${payload.examId ?? ''}|${language}|${code}`)

    // 幂等：同用户同键同载荷返回原编号；不同载荷 409
    for (const s of submissions.values()) {
      if (s.userId === user.id && s.idempotencyKey === key) {
        if (s.requestHash === requestHash) {
          return {
            submissionId: s.id,
            status: s.status,
            acceptedAt: iso(s.acceptedAtMs),
            pollAfterMs: 2000,
            requestId: uuid()
          }
        }
        throw new MockError(409, 'IDEMPOTENCY_CONFLICT', '相同幂等键对应了不同载荷')
      }
    }

    const exam = payload.examId ? findExam(String(payload.examId)) : null
    if (exam) {
      const state = examStateOf(exam)
      if (!exam.members.includes(user.id)) {
        throw new MockError(403, 'NOT_A_MEMBER', '你不在本次考试的名单中')
      }
      if (state === 'SCHEDULED' || state === 'DRAFT') {
        throw new MockError(409, 'EXAM_NOT_STARTED', '考试尚未开始，不能提交')
      }
      if (state === 'CLOSED' || state === 'CANCELED' || state === 'GRADING') {
        throw new MockError(409, 'EXAM_ENDED', '考试已截止，提交被拒绝（以服务端时间为准）')
      }
      if (!exam.allowedLanguages.includes(language)) {
        throw new MockError(422, 'LANGUAGE_NOT_ALLOWED', '本场考试未开放该语言')
      }
    }

    const pending = [...submissions.values()].filter(
      (s) => s.userId === user.id && (s.status === 'QUEUED' || s.status === 'RUNNING' || s.status === 'RETRY_WAIT')
    )
    if (pending.length >= 3) {
      throw new MockError(429, 'USER_QUOTA_EXCEEDED', '你已有 3 个未完成提交，请等待结果', 2000)
    }

    const problem = findProblem(String(payload.problemId))
    if (exam && !paperItemsOf(exam).some((i) => i.problemId === problem.id)) {
      throw new MockError(403, 'NOT_IN_PAPER', '该题不在本次试卷中')
    }
    const version = exam
      ? problem.versions.find((v) => v.id === paperItemsOf(exam).find((i) => i.problemId === problem.id)?.problemVersionId) ?? readyVersion(problem)
      : readyVersion(problem)
    if (!version) throw new MockError(409, 'VERSION_NOT_READY', '题目版本未就绪')

    const id = String(submissionSeq++)
    const record: MockSubmission = {
      id,
      userId: user.id,
      problemId: problem.id,
      problemVersionId: version.id,
      examId: exam?.id ?? null,
      contextType: exam ? 'EXAM' : 'PRACTICE',
      language,
      sourceCode: code,
      status: 'QUEUED',
      phase: null,
      verdict: null,
      acceptedAtMs: now(),
      finishedAtMs: null,
      updatedAtMs: now(),
      retryAtMs: null,
      retryCount: 0,
      environmentDigest: exam?.environmentDigest ?? 'gcc:13.2-cpp17@sha256:5f1c…a91',
      attempts: [],
      compileLog: null,
      idempotencyKey: key,
      requestHash
    }
    submissions.set(id, record)
    const verdictPreview = decideVerdict(code, false, language)
    if (verdictPreview === 'SYSTEM_ERROR') record.status = 'QUEUED'

    const examRecord = exam ? examRecordFor(exam.id, user.id) : null
    if (exam && !examRecord) {
      examRecords.push({ examId: exam.id, userId: user.id, joinedAt: now(), totalScore: null })
    }

    return {
      submissionId: id,
      status: 'QUEUED',
      acceptedAt: iso(record.acceptedAtMs),
      pollAfterMs: 2000,
      requestId: uuid()
    }
  }

  if (a === 'submissions' && !b && method === 'GET') {
    const user = currentUser()
    const context = query.get('context') ?? ''
    const rows = [...submissions.values()]
      .filter((s) => (user.role === 'STUDENT' ? s.userId === user.id : true))
      .filter((s) => (context ? s.contextType === context : true))
      .sort((x, y) => y.acceptedAtMs - x.acceptedAtMs)
      .map<SubmissionListItem>((s) => {
        const detail = submissionDetail(s, user)
        return {
          id: s.id,
          problemTitle: detail.problemTitle,
          examTitle: detail.examTitle,
          contextType: s.contextType,
          status: detail.status,
          verdict: detail.verdict,
          acceptedAt: detail.acceptedAt,
          language: s.language
        }
      })
    return paginate(rows, query)
  }

  if (a === 'submissions' && b && method === 'GET') {
    const user = currentUser()
    const s = submissions.get(b)
    if (!s) throw new MockError(404, 'RESOURCE_NOT_FOUND', '提交不存在或不可见')
    return submissionDetail(s, user)
  }

  /* ------------------------------ 考试 ------------------------------ */
  if (a === 'exams' && !b && method === 'GET') {
    const user = currentUser()
    const rows = exams
      .filter((e) => e.ownerId === user.id || e.members.includes(user.id))
      .map((e) => toExamSummary(e, user))
      .sort((x, y) => Date.parse(y.startAt) - Date.parse(x.startAt))
    return paginate(rows, query)
  }

  if (a === 'exams' && b && !c && method === 'GET') {
    const user = currentUser()
    const exam = findExam(b)
    if (exam.ownerId !== user.id && !exam.members.includes(user.id)) {
      throw new MockError(404, 'RESOURCE_NOT_FOUND', '考试不存在或不可见')
    }
    const state = examStateOf(exam)
    const isOwner = exam.ownerId === user.id
    const visible = isOwner || state === 'RUNNING' || state === 'GRADING' || state === 'CLOSED'
    const items = paperItemsOf(exam)
    const record = examRecordFor(exam.id, user.id)
    const detail: ExamDetail = {
      ...toExamSummary(exam, user),
      state,
      serverTime: iso(now()),
      feedbackPolicy: 'VERDICT_ONLY',
      allowedLanguages: exam.allowedLanguages,
      environmentDigest: exam.environmentDigest,
      maxScore: items.reduce((sum, i) => sum + i.fullScore, 0),
      problems: visible
        ? items.map((i) => ({
            problemId: i.problemId,
            ordinal: i.ordinal,
            fullScore: i.fullScore,
            title: i.title,
            versionNo: i.versionNo,
            difficulty: problems.find((p) => p.id === i.problemId)?.versions[0].difficulty ?? 'EASY',
            submissionCount: [...submissions.values()].filter(
              (s) => s.examId === exam.id && s.userId === user.id && s.problemId === i.problemId
            ).length
          }))
        : [],
      myScore: record?.totalScore ?? null,
      gradesPublishedAt: exam.gradesPublishedAt ? iso(exam.gradesPublishedAt) : null,
      entered: Boolean(record)
    }
    return detail
  }

  if (a === 'exams' && b && c === 'enter' && method === 'POST') {
    const user = currentUser()
    const exam = findExam(b)
    if (!exam.members.includes(user.id)) {
      throw new MockError(403, 'NOT_A_MEMBER', '你不在本次考试的名单中')
    }
    const state = examStateOf(exam)
    if (state === 'CANCELED' || state === 'DRAFT') {
      throw new MockError(409, 'EXAM_NOT_AVAILABLE', '考试未发布或已取消')
    }
    let record = examRecordFor(exam.id, user.id)
    if (!record) {
      record = { examId: exam.id, userId: user.id, joinedAt: now(), totalScore: null }
      examRecords.push(record)
    }
    return { examRecordId: `${exam.id}-${user.id}`, serverTime: iso(now()), state }
  }

  if (a === 'exams' && b && c === 'problems' && d && method === 'GET') {
    const user = currentUser()
    const exam = findExam(b)
    if (!exam.members.includes(user.id) && exam.ownerId !== user.id) {
      throw new MockError(404, 'RESOURCE_NOT_FOUND', '考试不存在或不可见')
    }
    const state = examStateOf(exam)
    if (state !== 'RUNNING' && state !== 'CLOSED' && state !== 'GRADING' && exam.ownerId !== user.id) {
      throw new MockError(409, 'EXAM_NOT_STARTED', '考试尚未开始，题面不可读取')
    }
    const item = paperItemsOf(exam).find((i) => i.problemId === d)
    if (!item) throw new MockError(404, 'RESOURCE_NOT_FOUND', '该题不在本次试卷中')
    const problem = findProblem(item.problemId)
    const version = problem.versions.find((v) => v.id === item.problemVersionId) as MockVersion
    const detail: ProblemDetail = {
      id: problem.id,
      title: problem.title,
      versionId: version.id,
      versionNo: version.versionNo,
      statementMarkdown: version.statementMarkdown,
      difficulty: version.difficulty,
      checkerType: version.checkerType,
      limits: { ...version.limits },
      samples: sampleCases(version),
      language: exam.allowedLanguages[0] ?? 'CPP17',
      languages: exam.allowedLanguages,
      feedbackPolicy: 'VERDICT_ONLY',
      hasVisibleCases: true
    }
    return detail
  }

  if (a === 'exams' && b && c === 'my-grade' && method === 'GET') {
    const user = currentUser()
    const exam = findExam(b)
    const published = Boolean(exam.gradesPublishedAt)
    const record = examRecordFor(exam.id, user.id)
    const items = paperItemsOf(exam).map<MyGrade['items'][number]>((item) => {
      const subs = [...submissions.values()]
        .filter((s) => s.examId === exam.id && s.userId === user.id && s.problemId === item.problemId)
        .sort((x, y) => y.acceptedAtMs - x.acceptedAtMs)
      const best = subs.find((s) => {
        const detail = submissionDetail(s, user)
        return detail.status === 'FINISHED' && detail.verdict === 'AC'
      })
      const latest = subs[0]
      const verdict = latest ? submissionDetail(latest, user).verdict : null
      return {
        problemId: item.problemId,
        title: item.title,
        ordinal: item.ordinal,
        fullScore: item.fullScore,
        score: published ? (best ? item.fullScore : 0) : 0,
        verdict,
        submissionId: latest?.id ?? null
      }
    })
    return {
      examId: exam.id,
      examTitle: exam.title,
      totalScore: record?.totalScore ?? null,
      maxScore: items.reduce((sum, i) => sum + i.fullScore, 0),
      publishedAt: exam.gradesPublishedAt ? iso(exam.gradesPublishedAt) : null,
      published,
      items
    } satisfies MyGrade
  }

  /* ------------------------------ 教师端 ----------------------------- */
  if (a === 'teacher' && b === 'problems' && !c && method === 'GET') {
    const user = requireRole('TEACHER', 'ADMIN')
    const rows = problems
      .filter((p) => p.ownerId === user.id || user.role === 'ADMIN')
      .map((p) => ({
        ...toProblemSummary(p),
        latestVersionId: p.versions[p.versions.length - 1].id
      }))
      .sort((x, y) => Date.parse(y.updatedAt) - Date.parse(x.updatedAt))
    return paginate(rows, query)
  }

  if (a === 'teacher' && b === 'ready-versions' && method === 'GET') {
    requireRole('TEACHER', 'ADMIN')
    return problems.flatMap((p) =>
      p.versions
        .filter((v) => v.status === 'READY')
        .map((v) => ({
          versionId: v.id,
          problemId: p.id,
          title: p.title,
          versionNo: v.versionNo,
          difficulty: v.difficulty
        }))
    )
  }

  if (a === 'teacher' && b === 'students' && method === 'GET') {
    requireRole('TEACHER', 'ADMIN')
    return users.filter((u) => u.role === 'STUDENT').map(toPublicUser)
  }

  if (a === 'teacher' && b === 'problems' && !c && method === 'POST') {
    const user = requireRole('TEACHER', 'ADMIN')
    const id = String(1100 + problems.length)
    const versionId = String(9100 + problems.length)
    const problem: MockProblem = {
      id,
      title: body?.title ?? '新题目',
      ownerId: user.id,
      visibility: body?.visibility ?? 'PUBLIC',
      status: 'ACTIVE',
      currentVersionId: null,
      updatedAt: now(),
      versions: [
        {
          id: versionId,
          problemId: id,
          versionNo: 1,
          status: 'DRAFT',
          revision: 0,
          statementMarkdown: body?.statementMarkdown ?? '## 题目描述\n\n（待填写）',
          difficulty: body?.difficulty ?? 'EASY',
          checkerType: 'TOKENS',
          limits: { ...DEFAULT_LIMITS },
          cases: [],
          contentHash: null,
          validationSubmissionId: null,
          validationNote: null,
          readyAt: null,
          validatingSince: null
        }
      ]
    }
    problems.push(problem)
    return toVersionDraft(problem, problem.versions[0])
  }

  if (a === 'teacher' && b === 'problems' && c && d === 'versions' && method === 'POST') {
    requireRole('TEACHER', 'ADMIN')
    const problem = findProblem(c)
    const base = problem.versions[problem.versions.length - 1]
    const version: MockVersion = {
      ...base,
      id: String(9200 + problem.versions.length + Number(problem.id)),
      versionNo: base.versionNo + 1,
      status: 'DRAFT',
      revision: 0,
      contentHash: null,
      validationSubmissionId: null,
      validationNote: null,
      readyAt: null,
      validatingSince: null,
      cases: base.cases.map((x) => ({ ...x }))
    }
    problem.versions.push(version)
    problem.updatedAt = now()
    return toVersionDraft(problem, version)
  }

  if (a === 'teacher' && b === 'problem-versions' && c && !d && method === 'GET') {
    requireRole('TEACHER', 'ADMIN')
    const { problem, version } = findVersion(c)
    return toVersionDraft(problem, version)
  }

  if (a === 'teacher' && b === 'problem-versions' && c && !d && method === 'PUT') {
    requireRole('TEACHER', 'ADMIN')
    const { problem, version } = findVersion(c)
    if (version.status === 'VALIDATING') {
      throw new MockError(409, 'VERSION_VALIDATING', '校验中的版本禁止编辑')
    }
    if (version.status === 'READY') {
      throw new MockError(409, 'VERSION_READY', 'READY 版本不可原地修改，请创建新版本')
    }
    if (Number(body?.revision) !== version.revision) {
      throw new MockError(409, 'STALE_REVISION', '页面数据已过期（revision 不一致），请重新加载草稿')
    }
    version.statementMarkdown = body.statementMarkdown ?? version.statementMarkdown
    version.difficulty = body.difficulty ?? version.difficulty
    version.checkerType = body.checkerType ?? version.checkerType
    version.limits = { ...version.limits, ...(body.limits ?? {}) }
    version.revision += 1
    problem.updatedAt = now()
    return toVersionDraft(problem, version)
  }

  if (a === 'teacher' && b === 'problem-versions' && c && d === 'cases' && method === 'POST') {
    requireRole('TEACHER', 'ADMIN')
    const { problem, version } = findVersion(c)
    if (version.status !== 'DRAFT') {
      throw new MockError(409, 'VERSION_FROZEN', '只有草稿版本可以修改测试点')
    }
    const ordinal = Number(body?.ordinal)
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 10) {
      throw new MockError(422, 'INVALID_ORDINAL', '测试点序号必须在 1—10 之间')
    }
    const content = String(body?.content ?? '')
    const bytes = new TextEncoder().encode(content).length
    if (bytes > 1048576) throw new MockError(422, 'FILE_TOO_LARGE', '单个文件不得超过 1 MB')
    let target = version.cases.find((x) => x.ordinal === ordinal)
    if (!target) {
      target = makeCase(ordinal, Boolean(body?.isSample), '', '')
      target.input = ''
      target.expected = ''
      version.cases.push(target)
    }
    if (body?.kind === 'input') {
      target.input = content
      target.inputBytes = bytes
      target.inputHash = hash(content)
    } else {
      target.expected = content
      target.expectedBytes = bytes
      target.expectedHash = hash(content)
    }
    if (typeof body?.isSample === 'boolean') target.isSample = body.isSample
    version.cases.sort((x, y) => x.ordinal - y.ordinal)
    problem.updatedAt = now()
    return toVersionDraft(problem, version)
  }

  if (a === 'teacher' && b === 'problem-versions' && c && d === 'validate' && method === 'POST') {
    requireRole('TEACHER', 'ADMIN')
    const { problem, version } = findVersion(c)
    if (version.status === 'VALIDATING') {
      throw new MockError(409, 'ALREADY_VALIDATING', '校验任务已在进行中')
    }
    if (version.cases.length === 0) {
      throw new MockError(422, 'NO_TEST_CASES', '至少需要一个测试点才能校验')
    }
    if (!version.cases.some((x) => x.isSample) || !version.cases.some((x) => !x.isSample)) {
      throw new MockError(422, 'CASE_KIND_REQUIRED', '至少各需要一个公开样例与一个隐藏测试点')
    }
    const reference = String(body?.referenceSource ?? '')
    if (!reference.trim()) throw new MockError(422, 'REFERENCE_REQUIRED', '请提供参考程序源码')
    version.status = 'VALIDATING'
    version.validatingSince = now()
    const submissionId = String(submissionSeq++)
    version.validationSubmissionId = submissionId
    submissions.set(submissionId, {
      id: submissionId,
      userId: currentUser().id,
      problemId: problem.id,
      problemVersionId: version.id,
      examId: null,
      contextType: 'VALIDATION',
      language: 'CPP17',
      sourceCode: reference,
      status: 'QUEUED',
      phase: null,
      verdict: null,
      acceptedAtMs: now(),
      finishedAtMs: null,
      updatedAtMs: now(),
      retryAtMs: null,
      retryCount: 0,
      environmentDigest: 'gcc:13.2-cpp17@sha256:5f1c…a91',
      attempts: [],
      compileLog: null,
      idempotencyKey: uuid(),
      requestHash: hash(reference)
    })
    return { submissionId, status: 'QUEUED' }
  }

  if (a === 'teacher' && b === 'problems' && c && d === 'publish' && method === 'POST') {
    requireRole('TEACHER', 'ADMIN')
    const problem = findProblem(c)
    const { version } = findVersion(String(body?.versionId))
    if (version.problemId !== problem.id) {
      throw new MockError(422, 'VERSION_MISMATCH', '该版本不属于此题目')
    }
    if (version.status !== 'READY') {
      throw new MockError(409, 'VERSION_NOT_READY', '只有 READY 版本才能作为公开入口')
    }
    problem.currentVersionId = version.id
    problem.visibility = body?.visibility ?? 'PUBLIC'
    problem.updatedAt = now()
    return { problemId: problem.id, currentVersionId: version.id }
  }

  if (a === 'teacher' && b === 'papers' && !c && method === 'GET') {
    const user = requireRole('TEACHER', 'ADMIN')
    const rows = papers
      .filter((p) => p.ownerId === user.id || user.role === 'ADMIN')
      .map<PaperSummary>((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        revision: p.revision,
        itemCount: p.items.length,
        updatedAt: iso(p.updatedAt)
      }))
    return paginate(rows, query)
  }

  if (a === 'teacher' && b === 'papers' && !c && method === 'POST') {
    const user = requireRole('TEACHER', 'ADMIN')
    const paper: MockPaper = {
      id: String(6100 + papers.length),
      title: body?.title ?? '新试卷',
      ownerId: user.id,
      status: 'DRAFT',
      revision: 0,
      items: [],
      updatedAt: now()
    }
    papers.push(paper)
    return toPaperDetail(paper)
  }

  if (a === 'teacher' && b === 'papers' && c && d === 'items' && method === 'PUT') {
    requireRole('TEACHER', 'ADMIN')
    const paper = papers.find((p) => p.id === c)
    if (!paper) throw new MockError(404, 'RESOURCE_NOT_FOUND', '试卷不存在')
    if (paper.status === 'SEALED') {
      throw new MockError(409, 'PAPER_SEALED', '已封存试卷不可修改，请复制为新试卷')
    }
    if (Number(body?.revision) !== paper.revision) {
      throw new MockError(409, 'STALE_REVISION', '试卷已被修改，请刷新后重试')
    }
    const incoming = Array.isArray(body?.items) ? body.items : []
    const seenProblems = new Set<string>()
    const items = incoming.map((item: any, index: number) => {
      const { problem, version } = findVersion(String(item.problemVersionId))
      if (version.status !== 'READY') {
        throw new MockError(422, 'VERSION_NOT_READY', `《${problem.title}》的版本未就绪`)
      }
      if (seenProblems.has(problem.id)) {
        throw new MockError(422, 'DUPLICATE_PROBLEM', '同一道题的不同版本不能同时放入试卷')
      }
      seenProblems.add(problem.id)
      if (Number(item.fullScore) <= 0) {
        throw new MockError(422, 'INVALID_SCORE', '分值必须大于 0')
      }
      return toPaperItem(version.id, index + 1, Number(item.fullScore))
    })
    paper.items = items
    paper.revision += 1
    paper.updatedAt = now()
    return toPaperDetail(paper)
  }

  if (a === 'teacher' && b === 'papers' && c && !d && method === 'GET') {
    requireRole('TEACHER', 'ADMIN')
    const paper = papers.find((p) => p.id === c)
    if (!paper) throw new MockError(404, 'RESOURCE_NOT_FOUND', '试卷不存在')
    return toPaperDetail(paper)
  }

  if (a === 'teacher' && b === 'exams' && !c && method === 'GET') {
    const user = requireRole('TEACHER', 'ADMIN')
    const rows = exams
      .filter((e) => e.ownerId === user.id || user.role === 'ADMIN')
      .map<ExamSummary>((e) => toExamSummary(e, user))
    return paginate(rows, query)
  }

  if (a === 'teacher' && b === 'exams' && !c && method === 'POST') {
    const user = requireRole('TEACHER', 'ADMIN')
    const paper = papers.find((p) => p.id === body?.paperId)
    if (!paper) throw new MockError(422, 'PAPER_REQUIRED', '请选择试卷')
    const startAt = Date.parse(body?.startAt)
    const endAt = Date.parse(body?.endAt)
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
      throw new MockError(422, 'INVALID_TIME', '开始与结束时间必填')
    }
    if (endAt <= startAt) {
      throw new MockError(422, 'INVALID_TIME_RANGE', '结束时间必须晚于开始时间')
    }
    const exam: MockExam = {
      id: String(3100 + exams.length),
      title: body?.title ?? '新考试',
      ownerId: user.id,
      paperId: paper.id,
      state: 'DRAFT',
      startAt,
      endAt,
      allowedLanguages: ['CPP17', 'C11', 'PY3', 'JAVA17'],
      environmentDigest: 'gcc:13.2-cpp17@sha256:5f1c…a91',
      feedbackPolicy: 'VERDICT_ONLY',
      members: [],
      gradesPublishedAt: null,
      createdAt: now()
    }
    exams.push(exam)
    return toExamDraft(exam)
  }

  if (a === 'teacher' && b === 'exams' && c && !d && method === 'GET') {
    requireRole('TEACHER', 'ADMIN')
    return toExamDraft(findExam(c))
  }

  if (a === 'teacher' && b === 'exams' && c && d === 'members' && method === 'PUT') {
    requireRole('TEACHER', 'ADMIN')
    const exam = findExam(c)
    if (examStateOf(exam) !== 'DRAFT') {
      throw new MockError(409, 'EXAM_SEALED', '发布后名单冻结，不可修改')
    }
    const ids = Array.isArray(body?.userIds) ? body.userIds.map(String) : []
    for (const id of ids) {
      if (!users.some((u) => u.id === id && u.role === 'STUDENT')) {
        throw new MockError(422, 'INVALID_MEMBER', `用户 ${id} 不是有效考生账户`)
      }
    }
    exam.members = ids
    return toExamDraft(exam)
  }

  if (a === 'teacher' && b === 'exams' && c && d === 'publish-check' && method === 'GET') {
    requireRole('TEACHER', 'ADMIN')
    return publishCheck(findExam(c))
  }

  if (a === 'teacher' && b === 'exams' && c && d === 'publish' && method === 'POST') {
    requireRole('TEACHER', 'ADMIN')
    const exam = findExam(c)
    const check = publishCheck(exam)
    if (!check.ok) {
      const err = new MockError(422, 'PUBLISH_CHECK_FAILED', check.problems[0]?.message ?? '发布校验未通过')
      throw err
    }
    exam.state = 'SCHEDULED'
    const paper = papers.find((p) => p.id === exam.paperId)
    if (paper) paper.status = 'SEALED'
    audits.unshift({
      id: uuid(),
      actorName: currentUser().displayName,
      action: 'EXAM_PUBLISHED',
      targetType: 'exam',
      targetId: exam.id,
      detail: `封存试卷 ${exam.paperId}，固定环境摘要，名单 ${exam.members.length} 人`,
      createdAt: iso(now())
    })
    return check
  }

  if (a === 'teacher' && b === 'exams' && c && d === 'cancel' && method === 'POST') {
    requireRole('TEACHER', 'ADMIN')
    const exam = findExam(c)
    if (now() >= exam.startAt) {
      throw new MockError(409, 'EXAM_STARTED', '考试已开始，不允许取消（P0 规则）')
    }
    if (!String(body?.reason ?? '').trim()) {
      throw new MockError(422, 'REASON_REQUIRED', '取消原因必填')
    }
    exam.state = 'CANCELED'
    audits.unshift({
      id: uuid(),
      actorName: currentUser().displayName,
      action: 'EXAM_CANCELED',
      targetType: 'exam',
      targetId: exam.id,
      detail: String(body.reason),
      createdAt: iso(now())
    })
    return toExamDraft(exam)
  }

  if (a === 'teacher' && b === 'exams' && c && d === 'grades' && !e && method === 'GET') {
    requireRole('TEACHER', 'ADMIN')
    return gradeSummary(findExam(c))
  }

  if (a === 'teacher' && b === 'exams' && c && d === 'grades' && e === 'publish' && method === 'POST') {
    const user = requireRole('TEACHER', 'ADMIN')
    const exam = findExam(c)
    const summary = gradeSummary(exam)
    if (summary.blockers.length > 0) {
      throw new MockError(
        409,
        'GRADES_BLOCKED',
        `仍有 ${summary.pendingTasks} 个待处理任务、${summary.systemErrors} 个系统故障，不能发布成绩`
      )
    }
    exam.gradesPublishedAt = now()
    exam.state = 'CLOSED'
    for (const row of summary.rows) {
      const record = examRecordFor(exam.id, row.userId)
      if (record) record.totalScore = row.totalScore
    }
    audits.unshift({
      id: uuid(),
      actorName: user.displayName,
      action: 'GRADES_PUBLISHED',
      targetType: 'exam',
      targetId: exam.id,
      detail: `发布 ${summary.rows.length} 名考生成绩，总分上限 ${summary.maxScore}`,
      createdAt: iso(now())
    })
    return gradeSummary(exam)
  }

  /* ------------------------------ 管理员 ----------------------------- */
  if (a === 'admin' && b === 'users' && !c && method === 'GET') {
    requireRole('ADMIN')
    const rows = users.map(toPublicUser)
    return paginate(rows, query)
  }

  if (a === 'admin' && b === 'users' && !c && method === 'POST') {
    requireRole('ADMIN')
    const username = String(body?.username ?? '').trim()
    if (username.length < 3) throw new MockError(422, 'INVALID_USERNAME', '用户名至少 3 个字符')
    if (users.some((u) => u.username === username)) {
      throw new MockError(409, 'USERNAME_TAKEN', '用户名已存在')
    }
    const user: MockUser = {
      id: String(100 + users.length),
      username,
      displayName: body?.displayName ?? username,
      role: body?.role ?? 'STUDENT',
      status: 'ACTIVE',
      password: body?.initialPassword ?? 'demo1234'
    }
    users.push(user)
    return toPublicUser(user)
  }

  if (a === 'admin' && b === 'users' && c && d === 'status' && method === 'PATCH') {
    requireRole('ADMIN')
    const user = users.find((u) => u.id === c)
    if (!user) throw new MockError(404, 'RESOURCE_NOT_FOUND', '用户不存在')
    user.status = body?.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE'
    audits.unshift({
      id: uuid(),
      actorName: currentUser().displayName,
      action: user.status === 'DISABLED' ? 'ACCOUNT_DISABLED' : 'ACCOUNT_ENABLED',
      targetType: 'user',
      targetId: user.id,
      detail: user.status === 'DISABLED' ? '停用账户并撤销全部会话' : '启用账户',
      createdAt: iso(now())
    })
    return toPublicUser(user)
  }

  if (a === 'admin' && b === 'judge' && c === 'tasks' && method === 'GET') {
    const user = requireRole('ADMIN', 'TEACHER')
    const status = query.get('status') ?? ''
    const rows = [...submissions.values()]
      .map((s) => submissionDetail(s, user))
      .filter((d) => (status ? d.status === status : d.status !== 'FINISHED'))
      .sort((x, y) => Date.parse(y.acceptedAt) - Date.parse(x.acceptedAt))
      .map<JudgeTaskRow>((d) => ({
        submissionId: d.id,
        problemTitle: d.problemTitle,
        contextType: d.contextType,
        status: d.status,
        phase: d.phase,
        attemptNo: d.attempts.length,
        workerId: d.attempts[0]?.workerId ?? null,
        leaseUntil: d.attempts[0]?.leaseUntil ?? null,
        verdict: d.verdict,
        infraErrorCode: d.attempts[0]?.infraErrorCode ?? null,
        acceptedAt: d.acceptedAt,
        updatedAt: d.updatedAt
      }))
    return paginate(rows, query)
  }

  if (a === 'admin' && b === 'submissions' && c && d === 'recover' && method === 'POST') {
    const user = requireRole('ADMIN')
    const s = submissions.get(c)
    if (!s) throw new MockError(404, 'RESOURCE_NOT_FOUND', '提交不存在')
    if (s.status !== 'FAILED') {
      throw new MockError(409, 'NOT_FAILED', '只有 FAILED 状态允许人工恢复')
    }
    if (!String(body?.reason ?? '').trim()) {
      throw new MockError(422, 'REASON_REQUIRED', '人工恢复必须填写原因')
    }
    s.status = 'QUEUED'
    s.acceptedAtMs = now()
    s.retryCount = 0
    s.verdict = null
    audits.unshift({
      id: uuid(),
      actorName: user.displayName,
      action: 'SUBMISSION_RECOVERED',
      targetType: 'submission',
      targetId: s.id,
      detail: String(body.reason),
      createdAt: iso(now())
    })
    return { submissionId: s.id, attemptNo: s.attempts.length + 1, status: 'QUEUED' }
  }

  if (a === 'admin' && b === 'audit' && method === 'GET') {
    requireRole('ADMIN')
    return paginate(audits, query)
  }

  throw new MockError(404, 'NO_ROUTE', `Mock 未实现该接口：${method} ${seg.join('/')}`)
}

/* --------------------------- 辅助：考试记录 -------------------------- */

interface MockExamRecord {
  examId: string
  userId: string
  joinedAt: number | null
  totalScore: number | null
}

const examRecords: MockExamRecord[] = [
  { examId: '3001', userId: '10', joinedAt: now() - minutes(24), totalScore: null },
  { examId: '3001', userId: '11', joinedAt: now() - minutes(20), totalScore: null },
  { examId: '3002', userId: '10', joinedAt: now() - 86400000 * 5, totalScore: 40 },
  { examId: '3002', userId: '11', joinedAt: now() - 86400000 * 5, totalScore: 0 }
]

function examRecordFor(examId: string, userId: string): MockExamRecord | undefined {
  return examRecords.find((r) => r.examId === examId && r.userId === userId)
}

/* --------------------------- 辅助：发布校验 -------------------------- */

function publishCheck(exam: MockExam): ExamPublishCheck {
  const issues: ExamPublishCheck['problems'] = []
  const items = paperItemsOf(exam)
  if (items.length === 0) {
    issues.push({ level: 'error', code: 'PAPER_EMPTY', message: '试卷至少包含一道题目' })
  }
  for (const item of items) {
    if (!item.ready) {
      issues.push({ level: 'error', code: 'ITEM_NOT_READY', message: `《${item.title}》的版本不是 READY` })
    }
    if (item.fullScore <= 0) {
      issues.push({ level: 'error', code: 'INVALID_SCORE', message: `《${item.title}》分值必须大于 0` })
    }
  }
  if (exam.members.length === 0) {
    issues.push({ level: 'error', code: 'MEMBERS_EMPTY', message: '考生名单为空' })
  }
  if (!(exam.endAt > exam.startAt)) {
    issues.push({ level: 'error', code: 'INVALID_TIME_RANGE', message: '结束时间必须晚于开始时间' })
  }
  if (exam.endAt - exam.startAt > 8 * 3600_000) {
    issues.push({ level: 'error', code: 'EXAM_TOO_LONG', message: '考试时长不得超过 8 小时' })
  }
  return { ok: issues.filter((i) => i.level === 'error').length === 0, problems: issues }
}

function toExamDraft(exam: MockExam): ExamDraft {
  const paper = papers.find((p) => p.id === exam.paperId)
  return {
    id: exam.id,
    title: exam.title,
    paperId: exam.paperId,
    paperTitle: paper?.title ?? '',
    state: examStateOf(exam),
    startAt: iso(exam.startAt),
    endAt: iso(exam.endAt),
    allowedLanguages: exam.allowedLanguages,
    environmentDigest: exam.environmentDigest,
    feedbackPolicy: 'VERDICT_ONLY',
    members: exam.members.map((id) => {
      const u = users.find((x) => x.id === id)
      const record = examRecordFor(exam.id, id)
      return {
        userId: id,
        displayName: u?.displayName ?? id,
        username: u?.username ?? id,
        joinedAt: record?.joinedAt ? iso(record.joinedAt) : null
      }
    })
  }
}

/* ---------------------------- 辅助：成绩汇总 -------------------------- */

function gradeSummary(exam: MockExam): ExamGradeSummary {
  const items = paperItemsOf(exam)
  const maxScore = items.reduce((sum, i) => sum + i.fullScore, 0)
  const blockers: ExamGradeSummary['blockers'] = []
  let pendingTasks = 0
  let systemErrors = 0

  const rows: StudentGradeRow[] = exam.members.map((userId) => {
    const u = users.find((x) => x.id === userId)
    const subs = [...submissions.values()].filter((s) => s.examId === exam.id && s.userId === userId)
    let total = 0
    let submitted = 0
    let pending = 0
    let failures = 0
    for (const item of items) {
      const itemSubs = subs.filter((s) => s.problemId === item.problemId)
      submitted += itemSubs.length
      const details = itemSubs.map((s) => submissionDetail(s, { ...users[3], role: 'TEACHER' }))
      for (const d of details) {
        if (d.status === 'QUEUED' || d.status === 'RUNNING' || d.status === 'RETRY_WAIT') {
          pending += 1
          pendingTasks += 1
          if (blockers.length < 6) {
            blockers.push({ submissionId: d.id, reason: '仍有待处理的有效提交' })
          }
        }
        if (d.status === 'FAILED') {
          failures += 1
          systemErrors += 1
          if (blockers.length < 6) {
            blockers.push({ submissionId: d.id, reason: '存在未解决的 SYSTEM_ERROR，需先恢复' })
          }
        }
      }
      const best = details.find((d) => d.status === 'FINISHED' && d.verdict === 'AC')
      if (best) total += item.fullScore
    }
    const record = examRecordFor(exam.id, userId)
    return {
      userId,
      displayName: u?.displayName ?? userId,
      username: u?.username ?? userId,
      totalScore: exam.gradesPublishedAt ? record?.totalScore ?? total : total,
      submittedCount: submitted,
      pendingCount: pending,
      systemErrorCount: failures,
      joinedAt: record?.joinedAt ? iso(record.joinedAt) : null
    }
  })

  return {
    examId: exam.id,
    state: examStateOf(exam),
    published: Boolean(exam.gradesPublishedAt),
    publishedAt: exam.gradesPublishedAt ? iso(exam.gradesPublishedAt) : null,
    maxScore,
    blockers,
    pendingTasks,
    systemErrors,
    rows
  }
}
