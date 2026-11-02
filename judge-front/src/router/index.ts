/**
 * 路由。
 *
 * 守卫只做体验层面的拦截：未登录跳登录页、角色不符提示 403。
 * 真正的对象级授权由后端每个读取接口完成（BR-07、§5.4 第 1 条），
 * 前端隐藏菜单不代表安全边界。
 */
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import type { Role } from '@/api/types'
import { useAuthStore } from '@/stores/auth'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    roles?: Role[]
    title?: string
    /** 该页面自行管理高度（做题工作台） */
    flush?: boolean
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true, title: '登录' }
  },
  {
    path: '/',
    redirect: '/problems'
  },
  {
    path: '/problems',
    name: 'problems',
    component: () => import('@/views/ProblemListView.vue'),
    meta: { title: '题库' }
  },
  {
    path: '/problems/:id',
    name: 'problem-workbench',
    component: () => import('@/views/WorkbenchView.vue'),
    props: (route) => ({ mode: 'practice', problemId: route.params.id }),
    meta: { title: '做题工作台', flush: true }
  },
  {
    path: '/exams',
    name: 'exams',
    component: () => import('@/views/ExamListView.vue'),
    meta: { title: '考试' }
  },
  {
    path: '/exams/:id',
    name: 'exam-entry',
    component: () => import('@/views/ExamEntryView.vue'),
    meta: { title: '考试入口' }
  },
  {
    path: '/exams/:id/problems/:problemId',
    name: 'exam-workbench',
    component: () => import('@/views/WorkbenchView.vue'),
    props: (route) => ({ mode: 'exam', examId: route.params.id, problemId: route.params.problemId }),
    meta: { title: '考试作答', flush: true }
  },
  {
    path: '/exams/:id/my-grade',
    name: 'my-grade',
    component: () => import('@/views/MyGradeView.vue'),
    meta: { title: '本人成绩' }
  },
  {
    path: '/submissions',
    name: 'submissions',
    component: () => import('@/views/SubmissionListView.vue'),
    meta: { title: '提交记录' }
  },
  {
    path: '/submissions/:id',
    name: 'submission-detail',
    component: () => import('@/views/SubmissionDetailView.vue'),
    meta: { title: '提交详情' }
  },
  {
    path: '/teacher/problems',
    name: 'teacher-problems',
    component: () => import('@/views/teacher/TeacherProblemsView.vue'),
    meta: { roles: ['TEACHER', 'ADMIN'], title: '题库管理' }
  },
  {
    path: '/teacher/versions/:versionId',
    name: 'teacher-version',
    component: () => import('@/views/teacher/ProblemVersionView.vue'),
    meta: { roles: ['TEACHER', 'ADMIN'], title: '题目版本' }
  },
  {
    path: '/teacher/papers',
    name: 'teacher-papers',
    component: () => import('@/views/teacher/TeacherPapersView.vue'),
    meta: { roles: ['TEACHER', 'ADMIN'], title: '试卷管理' }
  },
  {
    path: '/teacher/papers/:id',
    name: 'teacher-paper',
    component: () => import('@/views/teacher/PaperEditorView.vue'),
    meta: { roles: ['TEACHER', 'ADMIN'], title: '编辑试卷' }
  },
  {
    path: '/teacher/exams',
    name: 'teacher-exams',
    component: () => import('@/views/teacher/TeacherExamsView.vue'),
    meta: { roles: ['TEACHER', 'ADMIN'], title: '考试管理' }
  },
  {
    path: '/teacher/exams/:id',
    name: 'teacher-exam',
    component: () => import('@/views/teacher/TeacherExamDetailView.vue'),
    meta: { roles: ['TEACHER', 'ADMIN'], title: '考试配置' }
  },
  {
    path: '/teacher/exams/:id/grades',
    name: 'teacher-grades',
    component: () => import('@/views/teacher/ExamGradesView.vue'),
    meta: { roles: ['TEACHER', 'ADMIN'], title: '成绩汇总' }
  },
  {
    path: '/admin/users',
    name: 'admin-users',
    component: () => import('@/views/admin/AdminUsersView.vue'),
    meta: { roles: ['ADMIN'], title: '账户管理' }
  },
  {
    path: '/admin/tasks',
    name: 'admin-tasks',
    component: () => import('@/views/admin/AdminTasksView.vue'),
    meta: { roles: ['ADMIN', 'TEACHER'], title: '评测运维' }
  },
  {
    path: '/403',
    name: 'forbidden',
    component: () => import('@/views/ForbiddenView.vue'),
    meta: { title: '无权限' }
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { public: true, title: '页面不存在' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, _from, saved) {
    if (saved) return saved
    if (to.hash) return { el: to.hash, top: 80, behavior: 'smooth' }
    return { top: 0 }
  }
})

const ROLE_HOME: Record<Role, string> = {
  STUDENT: '/problems',
  TEACHER: '/teacher/problems',
  ADMIN: '/admin/tasks'
}

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (auth.initializing && !auth.isAuthenticated) {
    await auth.restore()
  }

  if (!to.meta.public && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  if (to.name === 'login' && auth.isAuthenticated) {
    return ROLE_HOME[auth.role as Role] ?? '/problems'
  }

  const required = to.meta.roles
  if (required && auth.role && !required.includes(auth.role)) {
    return { name: 'forbidden', query: { from: to.fullPath } }
  }

  return true
})

router.afterEach((to) => {
  const base = '在线编程评测与考试平台'
  document.title = to.meta.title ? `${to.meta.title} · ${base}` : base
})

export { ROLE_HOME }
export default router
