/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module '*?worker' {
  const workerConstructor: new () => Worker
  export default workerConstructor
}

/**
 * Monaco 0.5x 的 exports 只给根入口配了类型；
 * 这里为「编辑器核心」和「语言注册」几个深层入口补声明，
 * 使按需加载也能获得完整类型。
 */
declare module 'monaco-editor/editor/editor.api' {
  export * from 'monaco-editor'
}

declare module 'monaco-editor/languages/definitions/cpp/register'
declare module 'monaco-editor/languages/definitions/python/register'
declare module 'monaco-editor/languages/definitions/java/register'


interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_USE_MOCK?: string
  readonly VITE_DEV_PROXY_TARGET?: string
  readonly VITE_DEV_PORT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
