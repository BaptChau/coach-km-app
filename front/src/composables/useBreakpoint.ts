// Mobile vs. tablet/desktop switch (UX.md section 3). Below `md` is "mobile": bottom nav,
// full-screen form dialogs. From `md` up: navigation drawer, centred dialogs (max 560 px).
import { computed } from 'vue'
import { useDisplay } from 'vuetify'

export function useBreakpoint() {
  const display = useDisplay()
  const isMobile = computed(() => display.smAndDown.value)
  return {
    isMobile,
    isDesktop: computed(() => !isMobile.value),
    /** `md` only: the drawer collapses to a rail. */
    isRail: computed(() => display.md.value),
    display,
  }
}
