<script setup lang="ts">
import { computed } from 'vue'
import {
  EXAM_STATE_LABEL,
  SUBMISSION_STATUS_LABEL,
  VERSION_STATUS_LABEL,
  type ExamState,
  type SubmissionStatus,
  type VersionStatus
} from '@/api/types'

type Kind = 'submission' | 'exam' | 'version' | 'paper' | 'account'

const props = defineProps<{ kind: Kind; value: string }>()

const TONE: Record<string, string> = {
  QUEUED: 'badge--neutral',
  RUNNING: 'badge--brand',
  RETRY_WAIT: 'badge--ce',
  FINISHED: 'badge--ac',
  FAILED: 'badge--sys',

  DRAFT: 'badge--neutral',
  SCHEDULED: 'badge--brand',
  GRADING: 'badge--ce',
  CLOSED: 'badge--neutral',
  CANCELED: 'badge--wa',

  VALIDATING: 'badge--ce',
  READY: 'badge--ac',

  SEALED: 'badge--brand',
  ACTIVE: 'badge--ac',
  DISABLED: 'badge--wa'
}

const label = computed(() => {
  if (props.kind === 'submission') {
    return SUBMISSION_STATUS_LABEL[props.value as SubmissionStatus] ?? props.value
  }
  if (props.kind === 'exam') {
    return EXAM_STATE_LABEL[props.value as ExamState] ?? props.value
  }
  if (props.kind === 'version') {
    return VERSION_STATUS_LABEL[props.value as VersionStatus] ?? props.value
  }
  if (props.kind === 'paper') {
    return props.value === 'SEALED' ? '已封存' : '草稿'
  }
  return props.value === 'DISABLED' ? '已停用' : '正常'
})

const pulsing = computed(() => ['QUEUED', 'RUNNING', 'VALIDATING', 'GRADING'].includes(props.value))
</script>

<template>
  <span class="badge" :class="TONE[value] ?? 'badge--neutral'">
    <span class="dot" :class="{ 'dot--pulse': pulsing }" aria-hidden="true" />
    {{ label }}
  </span>
</template>

<style scoped>
.dot--pulse {
  animation: pulse 1.4s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}
</style>
