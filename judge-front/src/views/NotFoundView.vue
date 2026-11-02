<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <div class="page page--narrow">
    <div class="card">
      <div class="card__body state">
        <span class="state__code">404</span>
        <h1>页面不存在</h1>
        <p class="muted">地址可能已经变更，或者这个资源对你不可见。</p>
        <div class="btn-row mt-16">
          <RouterLink class="btn btn--primary" to="/problems">回到题库</RouterLink>
          <RouterLink class="btn" to="/exams">查看考试</RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 44px 40px;
}

.state__code {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ink-muted);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 10px;
}
</style>
