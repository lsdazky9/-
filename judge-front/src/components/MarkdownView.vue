<script setup lang="ts">
/**
 * 题面渲染（§6.3 安全要求）。
 *
 * 只做白名单渲染：先整体转义 HTML，再套用有限的 Markdown 语法，
 * 因此即使题面里出现 <script> 或 onerror=，也只会显示成文本。
 * 不使用 v-html 之外的任何注入路径；代码块内容同样已转义。
 */
import { computed } from 'vue'

const props = defineProps<{ source: string }>()

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const MATH_SYMBOLS: [RegExp, string][] = [
  [/\\le(q)?/g, '≤'],
  [/\\ge(q)?/g, '≥'],
  [/\\times/g, '×'],
  [/\\cdot/g, '·'],
  [/\\dots/g, '…'],
  [/\\to/g, '→'],
  [/\\infty/g, '∞'],
  [/\\sum/g, 'Σ'],
  [/\\lfloor/g, '⌊'],
  [/\\rfloor/g, '⌋'],
  [/\\lceil/g, '⌈'],
  [/\\rceil/g, '⌉'],
  [/\\neq/g, '≠'],
  [/\\approx/g, '≈'],
  [/\\in(?![a-zA-Z])/g, '∈'],
  [/\\forall/g, '∀'],
  [/\\exists/g, '∃'],
  [/\\pm/g, '±'],
  [/\\pmod/g, 'mod ']
]

/** 轻量数学排版：不引入 KaTeX，只做符号替换与上下标，避免题面出现裸露的 $ 与反斜杠。 */
function renderMath(expr: string): string {
  let out = escapeHtml(expr)
  for (const [pattern, symbol] of MATH_SYMBOLS) out = out.replace(pattern, symbol)
  // 未列入映射的命令（\log、\max 等）保留名字、去掉反斜杠，避免出现 "O(n n)" 这类空洞
  out = out.replace(/\\([a-zA-Z]+)/g, '$1')
  out = out.replace(/\^\{([^}]*)\}/g, '<sup>$1</sup>').replace(/\^(-?\w)/g, '<sup>$1</sup>')
  out = out.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>').replace(/_(-?\w)/g, '<sub>$1</sub>')
  return out
}

function inline(text: string): string {
  let out = escapeHtml(text)
  // 行内代码优先，避免内部内容被其他规则改写
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => `<code class="md-code">${code}</code>`)
  out = out.replace(/\$([^$\n]+)\$/g, (_m, expr: string) => `<span class="md-math">${renderMath(expr)}</span>`)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>')
  // 只允许 http/https 链接，且强制 noopener
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  )
  return out
}

const html = computed(() => {
  const src = props.source.replace(/\r\n/g, '\n')
  const lines = src.split('\n')
  const out: string[] = []
  let i = 0

  const closeList = (tag: 'ul' | 'ol' | null) => {
    if (tag) out.push(`</${tag}>`)
  }

  let openList: 'ul' | 'ol' | null = null

  while (i < lines.length) {
    const line = lines[i]

    // 围栏代码块
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/)
    if (fence) {
      closeList(openList)
      openList = null
      const lang = fence[1] ?? ''
      i += 1
      const body: string[] = []
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      i += 1
      out.push(
        `<pre class="md-pre" data-lang="${escapeHtml(lang)}"><code>${escapeHtml(body.join('\n'))}</code></pre>`
      )
      continue
    }

    // 标题
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      closeList(openList)
      openList = null
      const level = heading[1].length
      out.push(`<h${level + 1} class="md-h">${inline(heading[2])}</h${level + 1}>`)
      i += 1
      continue
    }

    // 分隔线
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      closeList(openList)
      openList = null
      out.push('<hr class="md-hr" />')
      i += 1
      continue
    }

    // 引用
    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      closeList(openList)
      openList = null
      const body: string[] = [quote[1]]
      i += 1
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      out.push(`<blockquote class="md-quote">${inline(body.join(' '))}</blockquote>`)
      continue
    }

    // 无序列表
    const ul = line.match(/^\s*[-*+]\s+(.*)$/)
    if (ul) {
      if (openList !== 'ul') {
        closeList(openList)
        out.push('<ul class="md-list">')
        openList = 'ul'
      }
      out.push(`<li>${inline(ul[1])}</li>`)
      i += 1
      continue
    }

    // 有序列表
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (ol) {
      if (openList !== 'ol') {
        closeList(openList)
        out.push('<ol class="md-list">')
        openList = 'ol'
      }
      out.push(`<li>${inline(ol[1])}</li>`)
      i += 1
      continue
    }

    closeList(openList)
    openList = null

    if (line.trim() === '') {
      i += 1
      continue
    }

    // 段落：合并连续非空行
    const para: string[] = [line]
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*(#{1,4}\s|```|>|\d+[.)]\s|[-*+]\s)/.test(lines[i])
    ) {
      para.push(lines[i])
      i += 1
    }
    out.push(`<p class="md-p">${inline(para.join(' '))}</p>`)
  }

  closeList(openList)
  return out.join('\n')
})
</script>

<template>
  <!-- 内容已整体转义，白名单标签由本地生成 -->
  <div class="markdown" v-html="html" />
</template>

<style scoped>
.markdown {
  font-size: 14px;
  line-height: 1.72;
  color: var(--ink-soft);
  word-break: break-word;
}

.markdown :deep(.md-h) {
  margin: 20px 0 8px;
  color: var(--ink);
  font-weight: 650;
  line-height: 1.4;
}

.markdown :deep(h2.md-h) {
  font-size: 19px;
}
.markdown :deep(h3.md-h) {
  font-size: 16px;
}
.markdown :deep(h4.md-h) {
  font-size: 14px;
}
.markdown :deep(h5.md-h) {
  font-size: 13px;
  color: var(--ink-muted);
}

.markdown :deep(.md-h:first-child) {
  margin-top: 0;
}

.markdown :deep(.md-p) {
  margin: 8px 0;
}

.markdown :deep(.md-list) {
  margin: 8px 0;
  padding-left: 20px;
}

.markdown :deep(.md-list li) {
  margin: 3px 0;
}

.markdown :deep(.md-code) {
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 12.5px;
  color: #1c3faa;
}

.markdown :deep(.md-math) {
  font-family: var(--font-mono);
  font-size: 12.8px;
  color: #1c3faa;
  white-space: nowrap;
}

.markdown :deep(.md-math sup),
.markdown :deep(.md-math sub) {
  font-size: 0.72em;
}

.markdown :deep(.md-pre) {
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  color: var(--ink);
  border-radius: var(--radius);
  padding: 12px 14px;
  overflow: auto;
  font-size: 12.5px;
  line-height: 1.65;
  margin: 12px 0;
}

.markdown :deep(.md-pre code) {
  font-family: var(--font-mono);
  background: none;
  border: none;
  padding: 0;
  color: inherit;
}

.markdown :deep(.md-quote) {
  margin: 10px 0;
  padding: 8px 14px;
  border-left: 3px solid var(--brand-line);
  background: var(--brand-soft);
  color: var(--brand-strong);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-size: 13px;
}

.markdown :deep(.md-hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 18px 0;
}

.markdown :deep(a) {
  color: var(--brand);
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
