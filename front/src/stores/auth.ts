// Session: token + coach, persisted (issue #9). Plugs itself into the API client.
// The router (#10) watches `isAuthenticated` to redirect to the login page.
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { auth as authApi, onUnauthorized, setTokenProvider } from '@/api'
import type { AuthResponse, Coach, LoginInput, ProfilePatch, RegisterInput } from '@/types'
import { useAdminStore } from './admin'
import { useSummaryStore } from './summary'
import { useTripsStore } from './trips'
import { useVehiclesStore } from './vehicles'
import { useWaiversStore } from './waivers'

export interface LogoutOptions {
  /**
   * Keep this coach's offline queue (default false). Used when the session expired (401):
   * trips logged offline must survive a re-login and sync then.
   */
  keepQueue?: boolean
}

export const useAuthStore = defineStore(
  'auth',
  () => {
    const token = ref<string | null>(null)
    const coach = ref<Coach | null>(null)

    const isAuthenticated = computed(() => !!token.value)
    const isPresident = computed(() => coach.value?.role === 'president')
    /** The postal address is complete (required before a waiver). */
    const hasAddress = computed(() => {
      const a = coach.value?.address
      return !!(a && a.line.trim() && a.postalCode.trim() && a.city.trim())
    })

    function setSession(res: AuthResponse): Coach {
      token.value = res.token
      coach.value = res.coach
      return res.coach
    }

    async function login(input: LoginInput): Promise<Coach> {
      return setSession(await authApi.login(input))
    }

    async function register(input: RegisterInput): Promise<Coach> {
      return setSession(await authApi.register(input))
    }

    /** Clears the session and every per-coach store (and, by default, the coach's offline queue). */
    function logout(options: LogoutOptions = {}): void {
      const coachId = coach.value?.id ?? null
      token.value = null
      coach.value = null
      const trips = useTripsStore()
      trips.reset()
      if (!options.keepQueue) trips.clearQueue(coachId)
      useVehiclesStore().reset()
      useSummaryStore().reset()
      useWaiversStore().reset()
      useAdminStore().reset()
    }

    async function fetchMe(): Promise<Coach> {
      coach.value = await authApi.me()
      return coach.value
    }

    async function updateProfile(patch: ProfilePatch): Promise<Coach> {
      coach.value = await authApi.updateMe(patch)
      return coach.value
    }

    setTokenProvider(() => token.value)
    // A 401 on an authenticated call means the session expired: keep the offline queue.
    onUnauthorized(() => logout({ keepQueue: true }))

    return {
      token,
      coach,
      isAuthenticated,
      isPresident,
      hasAddress,
      login,
      register,
      logout,
      fetchMe,
      updateProfile,
    }
  },
  { persist: { key: 'coach-km:auth', pick: ['token', 'coach'] } },
)
