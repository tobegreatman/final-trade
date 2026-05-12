<template>
  <NavBar />
  <main class="main-content">
    <router-view />
  </main>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import NavBar from './components/NavBar.vue'
import { useWatchlistStore } from './stores/watchlist.js'

const watchlistStore = useWatchlistStore()

function onVisibilityChange() {
  if (document.hidden) {
    watchlistStore.stopAutoRefresh()
  } else {
    watchlistStore.startAutoRefresh()
  }
}

onMounted(() => {
  watchlistStore.startAutoRefresh()
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  watchlistStore.stopAutoRefresh()
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>
