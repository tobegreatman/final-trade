<template>
  <nav class="navbar">
    <div class="navbar-inner">
      <router-link to="/" class="navbar-logo">SmartStock</router-link>
      <div class="navbar-links">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="navbar-link"
          :class="{ active: $route.path === item.path }"
        >
          <span class="navbar-icon">{{ item.icon }}</span>
          <span class="navbar-label">{{ item.label }}</span>
        </router-link>
      </div>
    </div>
  </nav>
</template>

<script setup>
const navItems = [
  { path: '/', icon: '📊', label: 'Dashboard' },
  { path: '/watchlist', icon: '⭐', label: 'Watchlist' },
  { path: '/screener', icon: '🔍', label: 'Screener' },
  { path: '/position', icon: '📐', label: 'Position' },
  { path: '/journal', icon: '📓', label: 'Journal' },
  { path: '/guide', icon: '📖', label: 'Guide' }
]
</script>

<style scoped>
.navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 52px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  z-index: 100;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.navbar-inner {
  max-width: 1440px;
  margin: 0 auto;
  height: 100%;
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 24px;
}

.navbar-logo {
  font-size: 16px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: -0.02em;
  flex-shrink: 0;
}

.navbar-links {
  display: flex;
  gap: 2px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.navbar-links::-webkit-scrollbar {
  display: none;
}

.navbar-link {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  transition: all 0.2s;
  white-space: nowrap;
}

.navbar-link:hover {
  color: var(--text-primary);
  background: var(--bg-surface-alt);
}

.navbar-link.active {
  color: var(--accent);
  background: var(--accent-dim);
}

.navbar-icon {
  font-size: 14px;
}

@media (max-width: 768px) {
  .navbar-inner {
    gap: 12px;
    padding: 0 12px;
  }

  .navbar-label {
    display: none;
  }

  .navbar-icon {
    font-size: 16px;
  }
}
</style>
