<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const from = typeof route.query.from === 'string' ? route.query.from : ''
</script>

<template>
  <div class="page page--narrow">
    <div class="card">
      <div class="card__body state">
        <span class="state__code">403</span>
        <h1>没有访问权限</h1>
        <p class="muted">
          当前账户的角色不能打开这个页面。前端隐藏入口不等于授权：
          真正的对象级权限由后端在每个接口上校验，越权请求会得到统一的 404 或 403。
        </p>
        <p v-if="from" class="mono small faint">目标路径：{{ from }}</p>
        <div class="btn-row mt-16">
          <button class="btn btn--primary" type="button" @click="router.back()">返回上一页</button>
          <RouterLink class="btn" to="/problems">回到题库</RouterLink>
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
  color: var(--wa);
  background: var(--wa-soft);
  border: 1px solid #f6c9c6;
  border-radius: 999px;
  padding: 2px 10px;
}
</style>
