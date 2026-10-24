import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { defineComponent, h } from 'vue'

// Placeholder route only. Real routes (lazy views), the auth guard and the layout
// shell arrive with issue #10.
const PlaceholderHome = defineComponent({
  name: 'PlaceholderHome',
  setup: () => () => h('h1', { class: 'text-h5 pa-4' }, 'Accueil'),
})

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: PlaceholderHome, meta: { title: 'Accueil' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export function buildRouter() {
  return createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
  })
}

export default buildRouter()
