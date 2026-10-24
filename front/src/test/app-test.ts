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

export interface MountInAppOptions {
  /** Props of the mounted component. */
  props?: Record<string, unknown>
  /**
   * Attach to `document.body`: needed for dialogs, which Vuetify teleports there. Query
   * them with `new DOMWrapper(document.body)` and call `wrapper.unmount()` after the test.
   */
  attach?: boolean
}

/** Mounts a component inside a real `<v-app>` (layout components need one). */
export function mountInApp(
  component: Component,
  pinia: Pinia,
  router: Router,
  options: MountInAppOptions = {},
) {
  const Host = defineComponent({
    setup: () => () => h(VApp, () => h(component, options.props ?? {})),
  })
  return mount(Host, {
    global: { plugins: [pinia, router, buildVuetify()] },
    attachTo: options.attach ? document.body : undefined,
  })
}

/**
 * `vi.waitFor` options for a navigation: the first visit of a lazy route imports (and, under
 * coverage, instruments) its view, which can exceed the default 1 s on a busy machine.
 */
export const ROUTE_WAIT = { timeout: 10_000 }
