// Online/offline state and the offline-queue flush trigger (issue #10).
// Register it ONCE, in the app layout: it adds window listeners for the component's life.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useTripsStore } from '@/stores/trips'

export interface UseOnlineOptions {
  /** Flush the queue when the component mounts (app start, right after login). Default true. */
  flushOnMount?: boolean
}

export function useOnline(options: UseOnlineOptions = {}) {
  const auth = useAuthStore()
  const trips = useTripsStore()
  const isOnline = ref(typeof navigator === 'undefined' || navigator.onLine !== false)

  /** Replays the offline queue when signed in. Concurrent calls share one run. */
  function flush(): void {
    if (!auth.isAuthenticated) return
    trips.flushQueue().catch(() => {
      // The store reports failures itself (snackbar); nothing more to do here.
    })
  }

  const onOnline = () => {
    isOnline.value = true
    flush()
  }
  const onOffline = () => {
    isOnline.value = false
  }

  onMounted(() => {
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    if (options.flushOnMount ?? true) flush()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  })

  return { isOnline, flush }
}
