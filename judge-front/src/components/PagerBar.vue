<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  page: number
  size: number
  total: number
  disabled?: boolean
}>()

const emit = defineEmits<{ change: [page: number] }>()

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / Math.max(1, props.size))))
const from = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.size + 1))
const to = computed(() => Math.min(props.total, props.page * props.size))

function go(page: number) {
  const next = Math.min(totalPages.value, Math.max(1, page))
  if (next !== props.page) emit('change', next)
}
</script>

<template>
  <div class="pager">
    <span class="num">共 {{ total }} 条<template v-if="total > 0"> · 当前 {{ from }}–{{ to }}</template></span>
    <div class="btn-row">
      <button class="btn btn--sm" type="button" :disabled="disabled || page <= 1" @click="go(page - 1)">
        上一页
      </button>
      <span class="num small muted">{{ page }} / {{ totalPages }}</span>
      <button
        class="btn btn--sm"
        type="button"
        :disabled="disabled || page >= totalPages"
        @click="go(page + 1)"
      >
        下一页
      </button>
    </div>
  </div>
</template>
