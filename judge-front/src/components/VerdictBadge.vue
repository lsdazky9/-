<script setup lang="ts">
import { computed } from 'vue'
import { VERDICT_LABEL, type Verdict } from '@/api/types'

const props = withDefaults(
  defineProps<{
    verdict: Verdict | null | undefined
    /** 未出结果时显示占位文案 */
    placeholder?: string
    size?: 'sm' | 'md'
  }>(),
  { placeholder: '评测中', size: 'md' }
)

const toneClass = computed(() => {
  const map: Record<Verdict, string> = {
    AC: 'badge--ac',
    WA: 'badge--wa',
    CE: 'badge--ce',
    TLE: 'badge--tle',
    MLE: 'badge--mle',
    RE: 'badge--re',
    OLE: 'badge--ole',
    SYSTEM_ERROR: 'badge--sys'
  }
  return props.verdict ? map[props.verdict] : 'badge--neutral'
})

const label = computed(() => (props.verdict ? VERDICT_LABEL[props.verdict] : props.placeholder))
</script>

<template>
  <span class="badge" :class="[toneClass, size === 'sm' ? 'badge--sm' : '']">
    <span v-if="verdict" class="dot" aria-hidden="true" />
    <span class="verdict__code">{{ verdict ?? '…' }}</span>
    <span class="verdict__label">{{ label }}</span>
  </span>
</template>

<style scoped>
.badge--sm {
  height: 20px;
  font-size: 11px;
  padding: 0 7px;
}

.verdict__code {
  font-family: var(--font-mono);
  font-size: 0.94em;
  letter-spacing: 0.01em;
}

.verdict__label {
  opacity: 0.78;
  font-weight: 550;
}

@media (max-width: 560px) {
  .verdict__label {
    display: none;
  }
}
</style>
