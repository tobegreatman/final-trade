import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'Dashboard', component: () => import('../views/Dashboard.vue') },
  { path: '/watchlist', name: 'Watchlist', component: () => import('../views/Watchlist.vue') },
  { path: '/stock-analysis', name: 'StockAnalysis', component: () => import('../views/StockAnalysis.vue') },
  { path: '/analysis', name: 'Analysis', component: () => import('../views/MarketAnalysis.vue') },
  { path: '/screener', name: 'Screener', component: () => import('../views/Screener.vue') },
  { path: '/position', name: 'Position', component: () => import('../views/Position.vue') },
  { path: '/journal', name: 'Journal', component: () => import('../views/Journal.vue') },
  { path: '/guide', name: 'Guide', component: () => import('../views/Guide.vue') }
]

export default createRouter({
  history: createWebHistory(),
  routes
})
