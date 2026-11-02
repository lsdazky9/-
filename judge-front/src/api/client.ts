/**
 * 类型化接口封装：一个函数 = 文档 §6.1 表格中的一行。
 *
 * 页面只调用这里，不直接写 URL，也不直接拼参数。
 * 后端实现同一张表即可替换；Mock 也实现同一张表，因此两侧行为一致。
 */
import { http } from './http'
import type {
  AuditEntry,
  Difficulty,
  EnterExamResponse,
  ExamDetail,
  ExamDraft,
  ExamGradeSummary,
  ExamPublishCheck,
  ExamSummary,
  JudgeTaskRow,
  MeResponse,
  MyGrade,
  PageQuery,
  PageResult,
  PaperDetail,
  PaperItem,
  PaperSummary,
  ProblemDetail,
  ProblemSummary,
  ProblemVersionDraft,
  ProblemVersionInput,
  ReadyVersionOption,
  Role,
  SubmissionDetail,
  SubmissionListItem,
  SubmitRequest,
  SubmitResponse,
  UserSummary,
  Verdict
} from './types'

/* ---------------------------- 身份与会话 ---------------------------- */

export const authApi = {
  login: (username: string, password: string) =>
    http.post<MeResponse>('/auth/login', { body: { username, password } }),
  logout: () => http.post<void>('/auth/logout'),
  me: () => http.get<MeResponse>('/me')
}

/* ---------------------------- 学生 / 通用 --------------------------- */

export const problemApi = {
  list: (query: PageQuery) =>
    http.get<PageResult<ProblemSummary>>('/problems', { query }),
  detail: (problemId: string) => http.get<ProblemDetail>(`/problems/${problemId}`)
}

export const submissionApi = {
  /** 幂等键由调用方生成：一次用户主动提交一个键，网络重试复用（§4.8.1） */
  submit: (payload: SubmitRequest, idempotencyKey: string) =>
    http.post<SubmitResponse>('/submissions', { body: payload, idempotencyKey }),
  list: (query: PageQuery) =>
    http.get<PageResult<SubmissionListItem>>('/submissions', { query }),
  detail: (id: string) => http.get<SubmissionDetail>(`/submissions/${id}`)
}

/* ------------------------------- 考试 ------------------------------- */

export const examApi = {
  list: (query?: PageQuery) => http.get<PageResult<ExamSummary>>('/exams', { query }),
  detail: (examId: string) => http.get<ExamDetail>(`/exams/${examId}`),
  enter: (examId: string) => http.post<EnterExamResponse>(`/exams/${examId}/enter`),
  problem: (examId: string, problemId: string) =>
    http.get<ProblemDetail>(`/exams/${examId}/problems/${problemId}`),
  myGrade: (examId: string) => http.get<MyGrade>(`/exams/${examId}/my-grade`)
}

/* ------------------------------ 教师端 ------------------------------ */

export interface CreateProblemBody {
  title: string
  visibility: 'PUBLIC' | 'PRIVATE'
  statementMarkdown: string
  difficulty: Difficulty
}

export const teacherApi = {
  problems: (query?: PageQuery) =>
    http.get<PageResult<ProblemSummary>>('/teacher/problems', { query }),
  createProblem: (body: CreateProblemBody) =>
    http.post<ProblemVersionDraft>('/teacher/problems', { body }),
  createVersion: (problemId: string) =>
    http.post<ProblemVersionDraft>(`/teacher/problems/${problemId}/versions`),
  version: (versionId: string) =>
    http.get<ProblemVersionDraft>(`/teacher/problem-versions/${versionId}`),
  /** revision 过期返回 409（乐观锁，§5.3.4） */
  saveVersion: (versionId: string, body: ProblemVersionInput) =>
    http.put<ProblemVersionDraft>(`/teacher/problem-versions/${versionId}`, { body }),
  /** 单文件上传：input / expected 分开传，服务端校验大小与哈希（§5.3.5） */
  uploadCase: (
    versionId: string,
    body: { ordinal: number; isSample: boolean; kind: 'input' | 'expected'; content: string }
  ) => http.post<ProblemVersionDraft>(`/teacher/problem-versions/${versionId}/cases`, { body }),
  validate: (versionId: string, referenceSource: string) =>
    http.post<{ submissionId: string; status: string }>(
      `/teacher/problem-versions/${versionId}/validate`,
      { body: { referenceSource } }
    ),
  publishProblem: (problemId: string, versionId: string, visibility: 'PUBLIC' | 'PRIVATE') =>
    http.post<{ problemId: string; currentVersionId: string }>(
      `/teacher/problems/${problemId}/publish`,
      { body: { versionId, visibility } }
    ),

  papers: (query?: PageQuery) =>
    http.get<PageResult<PaperSummary>>('/teacher/papers', { query }),
  paper: (paperId: string) => http.get<PaperDetail>(`/teacher/papers/${paperId}`),
  createPaper: (body: { title: string }) => http.post<PaperDetail>('/teacher/papers', { body }),
  /** 组卷用的已就绪版本列表（按 READY 过滤，含题目归属与版本号） */
  readyVersions: () => http.get<ReadyVersionOption[]>('/teacher/ready-versions'),
  /** 教师可导入名单的考生账户 */
  students: () => http.get<UserSummary[]>('/teacher/students'),
  /** 一次替换草稿试卷项，需 revision（整卷覆盖，避免逐项并发） */
  replacePaperItems: (paperId: string, revision: number, items: PaperItem[]) =>
    http.put<PaperDetail>(`/teacher/papers/${paperId}/items`, {
      body: { revision, items: items.map((i) => ({ problemVersionId: i.problemVersionId, ordinal: i.ordinal, fullScore: i.fullScore })) }
    }),

  exams: (query?: PageQuery) =>
    http.get<PageResult<ExamSummary>>('/teacher/exams', { query }),
  exam: (examId: string) => http.get<ExamDraft>(`/teacher/exams/${examId}`),
  createExam: (body: { title: string; paperId: string; startAt: string; endAt: string }) =>
    http.post<ExamDraft>('/teacher/exams', { body }),
  setMembers: (examId: string, userIds: string[]) =>
    http.put<ExamDraft>(`/teacher/exams/${examId}/members`, { body: { userIds } }),
  publishExam: (examId: string) => http.post<ExamPublishCheck>(`/teacher/exams/${examId}/publish`),
  cancelExam: (examId: string, reason: string) =>
    http.post<ExamDraft>(`/teacher/exams/${examId}/cancel`, { body: { reason } }),
  checkExam: (examId: string) => http.get<ExamPublishCheck>(`/teacher/exams/${examId}/publish-check`),

  grades: (examId: string) => http.get<ExamGradeSummary>(`/teacher/exams/${examId}/grades`),
  publishGrades: (examId: string) =>
    http.post<ExamGradeSummary>(`/teacher/exams/${examId}/grades/publish`)
}

/* ------------------------------ 管理员 ------------------------------ */

export const adminApi = {
  users: (query?: PageQuery) => http.get<PageResult<UserSummary>>('/admin/users', { query }),
  createUser: (body: { username: string; displayName: string; role: Role; initialPassword: string }) =>
    http.post<UserSummary>('/admin/users', { body }),
  setUserStatus: (userId: string, status: 'ACTIVE' | 'DISABLED') =>
    http.patch<UserSummary>(`/admin/users/${userId}/status`, { body: { status } }),
  tasks: (query: PageQuery) =>
    http.get<PageResult<JudgeTaskRow>>('/admin/judge/tasks', { query }),
  recover: (submissionId: string, reason: string, idempotencyKey: string) =>
    http.post<{ submissionId: string; attemptNo: number; status: string }>(
      `/admin/submissions/${submissionId}/recover`,
      { body: { reason }, idempotencyKey }
    ),
  audit: (query?: PageQuery) =>
    http.get<PageResult<AuditEntry>>('/admin/audit', { query })
}

export type { Verdict }
