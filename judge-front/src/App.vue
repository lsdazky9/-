<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppShell from '@/components/AppShell.vue'
import ToastHost from '@/components/ToastHost.vue'

const route = useRoute()
const isLogin = computed(() => route.name === 'login')
const flush = computed(() => Boolean(route.meta.flush))
</script>

<template>
  <RouterView v-if="isLogin" />
  <AppShell v-else :flush="flush">
    <RouterView />
  </AppShell>
  <ToastHost />
</template>
