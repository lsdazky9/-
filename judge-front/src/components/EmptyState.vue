<script setup lang="ts">
defineProps<{
  title: string
  hint?: string
  icon?: string
}>()
</script>

<template>
  <div class="empty">
    <span class="empty__icon" aria-hidden="true">{{ icon ?? '◍' }}</span>
    <p class="empty__title">{{ title }}</p>
    <p v-if="hint" class="empty__hint">{{ hint }}</p>
    <slot />
  </div>
</template>

<style scoped>
.empty__icon {
  font-size: 26px;
  color: var(--ink-faint);
  line-height: 1;
}

.empty {
  padding: 40px 20px;
}
</style>
