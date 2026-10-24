// Helpers for component and router specs: a fresh pinia, an in-memory router and Vuetify.
// Mock `@/api` in the spec first (see api-mock.ts).
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { defineComponent, h, type Component } from 'vue'
import { createMemoryHistory, type Router } from 'vue-router'
import { VApp } from 'vuetify/components'
import { buildVuetify } from '@/plugins/vuetify'
import { buildRouter } from '@/router'
import { useAuthStore } from '@/stores/auth'
import type { Coach } from '@/types'

export const coachUser: Coach = {
  id: 7,
  email: 'coach@club.fr',
  registrationNumber: '5655006000001',
  firstName: 'Camille',
  lastName: 'Martin',
  role: 'coach',
  address: { line: '', postalCode: '', city: '' },
  createdAt: '2026-01-01T00:00:00Z',
}

export const presidentUser: Coach = {
  ...coachUser,
  id: 1,
  email: 'president@club.fr',
  role: 'president',
}

export function freshPinia(): Pinia {
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

/** Signs a user in directly in the store (no API call). */
export function signIn(user: Coach = coachUser): void {
  const auth = useAuthStore()
  auth.token = `token-${user.id}`
  auth.coach = user
}

export function testRouter() {
  return buildRouter(createMemoryHistory())
}

/** Mounts a component inside a real `<v-app>` (layout components need one). */
export function mountInApp(component: Component, pinia: Pinia, router: Router) {
  const Host = defineComponent({ setup: () => () => h(VApp, () => h(component)) })
  return mount(Host, { global: { plugins: [pinia, router, buildVuetify()] } })
}
