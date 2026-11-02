<script setup lang="ts">
import { toasts, dismissToast } from '@/stores/toast'
</script>

<template>
  <div class="toast-host" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div
        v-for="item in toasts"
        :key="item.id"
        class="toast"
        :class="`toast--${item.kind}`"
        @click="dismissToast(item.id)"
      >
        <span class="toast__icon" aria-hidden="true">
          {{ item.kind === 'error' ? '!' : item.kind === 'success' ? '✓' : item.kind === 'warn' ? '!' : 'i' }}
        </span>
        <div class="toast__body">
          <strong>{{ item.message }}</strong>
          <span v-if="item.detail" class="toast__detail">{{ item.detail }}</span>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  right: 20px;
  bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 100;
  max-width: min(380px, calc(100vw - 32px));
}

.toast {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 11px 14px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  cursor: pointer;
  font-size: 13px;
}

.toast__icon {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 800;
  color: #fff;
  background: var(--ink-muted);
  flex: none;
  margin-top: 1px;
}

.toast--success .toast__icon {
  background: var(--ac);
}
.toast--error .toast__icon {
  background: var(--wa);
}
.toast--warn .toast__icon {
  background: var(--ce);
}
.toast--info .toast__icon {
  background: var(--brand);
}

.toast__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.toast__body strong {
  font-weight: 600;
  line-height: 1.45;
}

.toast__detail {
  color: var(--ink-muted);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.22s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
