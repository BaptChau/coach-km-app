// Routes, auth guard and document title (issue #10).
//
// Every view is lazy-loaded. `meta.public` pages (login, register) render without the
// app shell; every other route renders inside `AppLayout` (see App.vue).
import {
  createRouter,
  createWebHistory,
  type LocationQueryValue,
  type RouteRecordRaw,
  type RouterHistory,
} from 'vue-router'
import { useAuthStore } from '@/stores/auth'

/** Navigation entry a screen belongs to (Export, Profil and Admin live under "Plus"). */
export type NavKey = 'home' | 'trips' | 'vehicles' | 'more'

declare module 'vue-router' {
  interface RouteMeta {
    /** Reachable without a session; rendered without the app shell. */
    public?: boolean
    /** Screen title (app bar and `document.title`). */
    title?: string
    /** The screen shows one year: the app bar shows the year selector (`ui.year`). */
    perYear?: boolean
    /** President only; anyone else is sent to `/`. */
    presidentOnly?: boolean
    /** Highlighted navigation entry. */
    nav?: NavKey
  }
}

export const APP_NAME = 'Coach KM'

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true, title: 'Connexion' },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/RegisterView.vue'),
    meta: { public: true, title: 'Inscription' },
  },
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
    meta: { title: 'Accueil', perYear: true, nav: 'home' },
  },
  {
    path: '/trajets',
    name: 'trips',
    component: () => import('@/views/TripsView.vue'),
    meta: { title: 'Trajets', perYear: true, nav: 'trips' },
  },
  {
    path: '/vehicules',
    name: 'vehicles',
    component: () => import('@/views/VehiclesView.vue'),
    meta: { title: 'Véhicules', nav: 'vehicles' },
  },
  {
    path: '/plus',
    name: 'more',
    component: () => import('@/views/PlusView.vue'),
    meta: { title: 'Plus', nav: 'more' },
  },
  {
    path: '/export',
    name: 'export',
    component: () => import('@/views/ExportView.vue'),
    meta: { title: 'Export & abandon de frais', perYear: true, nav: 'more' },
  },
  {
    path: '/profil',
    name: 'profile',
    component: () => import('@/views/ProfileView.vue'),
    meta: { title: 'Profil', nav: 'more' },
  },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('@/views/AdminView.vue'),
    meta: { title: 'Admin', perYear: true, presidentOnly: true, nav: 'more' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

/**
 * A `?redirect=` value that is safe to follow: an in-app absolute path (no `//host`, no
 * URL), never a public page. Anything else gives `/`.
 */
export function safeRedirect(value: LocationQueryValue | LocationQueryValue[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return '/'
  if (raw.startsWith('/\\')) return '/'
  if (/^\/(login|register)(?=[/?#]|$)/.test(raw)) return '/'
  return raw
}

export function buildRouter(history: RouterHistory = createWebHistory(import.meta.env.BASE_URL)) {
  const router = createRouter({
    history,
    routes,
    scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
  })

  router.beforeEach((to) => {
    // Creating the store also wires the token into the API client: keep it first.
    const auth = useAuthStore()

    if (to.meta.public) {
      return auth.isAuthenticated ? safeRedirect(to.query.redirect) : true
    }
    if (!auth.isAuthenticated) {
      return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } }
    }
    if (to.meta.presidentOnly && !auth.isPresident) return { name: 'home' }
    return true
  })

  router.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} · ${APP_NAME}` : APP_NAME
  })

  return router
}

export default buildRouter()
