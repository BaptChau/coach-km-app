// Déconnexion: clears the session, then goes to the login page (no `?redirect`).
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

export function useLogout() {
  const auth = useAuthStore()
  const router = useRouter()

  return async function logout(): Promise<void> {
    auth.logout()
    // Supersedes the session watcher's `/login?redirect=…` (App.vue): a deliberate logout
    // should not send the next user back to this screen.
    await router.replace({ name: 'login' })
  }
}
