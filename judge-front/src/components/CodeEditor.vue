<script setup lang="ts">
/**
 * 代码编辑器。
 *
 * - 首选 Monaco（文档 §4.2 技术栈），按需动态加载，不进入首屏包；
 * - 加载失败（离线、worker 被 CSP 拦截等）自动回退为等宽 textarea，
 *   保证「提交」这条主链路在任何环境下都能走通；
 * - Ctrl/Cmd + Enter 触发提交，与页面上的按钮是同一个动作。
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    readOnly?: boolean
    language?: string
    ariaLabel?: string
  }>(),
  { readOnly: false, language: 'cpp', ariaLabel: '代码编辑器' }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
}>()

const host = ref<HTMLDivElement | null>(null)
const fallbackValue = ref(props.modelValue)
const failed = ref(false)
const ready = ref(false)
const editorRef = shallowRef<any>(null)
const monacoRef = shallowRef<any>(null)
let disposable: { dispose: () => void } | null = null
let applyingExternal = false

function updateFromEditor(value: string) {
  if (applyingExternal) return
  fallbackValue.value = value
  emit('update:modelValue', value)
}

function onFallbackInput(event: Event) {
  const value = (event.target as HTMLTextAreaElement).value
  fallbackValue.value = value
  emit('update:modelValue', value)
}

onMounted(async () => {
  try {
    // 只加载编辑器核心 + 本期四种语言的语法定义，避免把全部语言打进产物。
    const [monaco, , , , workerModule] = await Promise.all([
      import('monaco-editor/editor/editor.api'),
      import('monaco-editor/languages/definitions/cpp/register'),
      import('monaco-editor/languages/definitions/python/register'),
      import('monaco-editor/languages/definitions/java/register'),
      import('monaco-editor/editor/editor.worker?worker')
    ])

    const WorkerCtor = workerModule.default
    ;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
      getWorker: () => new WorkerCtor()
    }

    monaco.editor.defineTheme('judge-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '7d8799', fontStyle: 'italic' },
        { token: 'keyword', foreground: '1f4bc4' },
        { token: 'string', foreground: '0f7a52' },
        { token: 'number', foreground: 'a2400c' },
        { token: 'type', foreground: '7a3fd4' }
      ],
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#1a1f27',
        'editorLineNumber.foreground': '#b3bdc9',
        'editorLineNumber.activeForeground': '#4a5464',
        'editor.lineHighlightBackground': '#f6f8fb',
        'editor.selectionBackground': '#d9e4ff',
        'editorIndentGuide.background1': '#eef1f5',
        'editorCursor.foreground': '#2f5fe0',
        'editorWidget.border': '#e2e6ec',
        'editorSuggestWidget.background': '#ffffff',
        'editorSuggestWidget.border': '#e2e6ec'
      }
    })

    if (!host.value) return
    const editor = monaco.editor.create(host.value, {
      value: props.modelValue,
      language: props.language,
      theme: 'judge-light',
      readOnly: props.readOnly,
      automaticLayout: true,
      fontSize: 13,
      lineHeight: 21,
      fontFamily:
        "'Cascadia Code', 'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'all',
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      tabSize: 4,
      insertSpaces: true,
      padding: { top: 12, bottom: 12 },
      glyphMargin: false,
      folding: true,
      lineNumbersMinChars: 3,
      wordWrap: 'off',
      contextmenu: true,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
    })

    editorRef.value = editor
    monacoRef.value = monaco
    disposable = editor.onDidChangeModelContent(() => {
      updateFromEditor(editor.getValue())
    })

    editor.addAction({
      id: 'judge.submit',
      label: '提交代码',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => emit('submit')
    })

    ready.value = true
  } catch (e) {
    failed.value = true
    // 回退到 textarea：仅提示到控制台，不打断提交链路
    console.warn('[CodeEditor] Monaco 加载失败，已回退为纯文本编辑器', e)
  }
})

watch(
  () => props.modelValue,
  (value) => {
    fallbackValue.value = value
    const editor = editorRef.value
    if (!editor || editor.getValue() === value) return
    applyingExternal = true
    editor.setValue(value)
    applyingExternal = false
  }
)

watch(
  () => props.readOnly,
  (value) => editorRef.value?.updateOptions({ readOnly: value })
)

/** 切换语言时同步语法高亮，不重建编辑器（保留光标与撤销栈之外的内容）。 */
watch(
  () => props.language,
  (value) => {
    const editor = editorRef.value
    const monacoApi = monacoRef.value
    const model = editor?.getModel()
    if (!model || !monacoApi) return
    monacoApi.editor.setModelLanguage(model, value)
  }
)

onBeforeUnmount(() => {
  disposable?.dispose()
  editorRef.value?.dispose()
  editorRef.value = null
  monacoRef.value = null
})

function focus() {
  if (editorRef.value) {
    editorRef.value.focus()
  }
}

defineExpose({ focus })
</script>

<template>
  <div class="editor">
    <div v-if="!failed" ref="host" class="editor__monaco" :aria-label="ariaLabel" />
    <div v-else class="editor__fallback">
      <p class="editor__hint">
        编辑器组件加载失败，已切换为纯文本编辑（功能不受影响，仍可提交）。
      </p>
      <textarea
        class="editor__textarea"
        :value="fallbackValue"
        :readonly="readOnly"
        spellcheck="false"
        :aria-label="ariaLabel"
        @input="onFallbackInput"
        @keydown.ctrl.enter.prevent="emit('submit')"
        @keydown.meta.enter.prevent="emit('submit')"
      />
    </div>
    <div v-if="!ready && !failed" class="editor__loading">
      <span class="skeleton" style="width: 60%; height: 12px" />
      <span class="skeleton" style="width: 84%; height: 12px" />
      <span class="skeleton" style="width: 46%; height: 12px" />
      <p class="editor__hint">正在加载 Monaco 编辑器…</p>
    </div>
  </div>
</template>

<style scoped>
.editor {
  position: relative;
  height: 100%;
  min-height: 240px;
  background: var(--surface);
  overflow: hidden;
}

.editor__monaco {
  position: absolute;
  inset: 0;
}

.editor__fallback {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 8px;
  padding: 10px;
}

.editor__hint {
  font-size: 12px;
  color: var(--ink-muted);
  margin: 0;
}

.editor__textarea {
  flex: 1 1 auto;
  width: 100%;
  resize: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  tab-size: 4;
  background: var(--surface);
  color: var(--ink);
  outline: none;
}

.editor__textarea:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.editor__loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px;
  background: var(--surface);
  z-index: 2;
}
</style>
