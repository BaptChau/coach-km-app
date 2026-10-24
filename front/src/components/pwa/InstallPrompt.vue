<script setup lang="ts">
// "Install the app" card (issue #12), mounted once in AppLayout.
//
// - Chrome/Edge/Android: captures `beforeinstallprompt` and offers an "Installer" button.
// - iOS Safari (no `beforeinstallprompt`): a one-time hint "Partager → Sur l'écran d'accueil".
// - Never when the app already runs installed (`display-mode: standalone`).
// - Not in the first seconds: it waits SHOW_DELAY_MS, then appears on the next in-app
//   navigation, at the top of the new screen (no layout shift under the user's finger).
// - "Plus tard" hides it for 30 days (localStorage); the iOS hint is shown only once.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

/** Minimum time in the app before offering the install. */
const SHOW_DELAY_MS = 30_000
const DISMISS_DAYS = 30
const DISMISSED_KEY = 'coach-km:install-dismissed-at'
const IOS_HINT_KEY = 'coach-km:ios-install-hint-shown'

/** The non-standard `beforeinstallprompt` event (Chromium). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode: the card may come back next time, which is acceptable.
  }
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent
  const ios =
    /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  return ios && /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua)
}

function recentlyDismissed(): boolean {
  const at = Number(readStorage(DISMISSED_KEY))
  return at > 0 && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000
}

const router = useRouter()
const deferred = ref<BeforeInstallPromptEvent | null>(null)
const ios = ref(false)
const armed = ref(false)
const visible = ref(false)
const installing = ref(false)

const mode = computed<'prompt' | 'ios' | null>(() => {
  if (deferred.value) return 'prompt'
  if (ios.value) return 'ios'
  return null
})

let timer: ReturnType<typeof setTimeout> | undefined
let removeAfterEach: (() => void) | undefined

function onBeforeInstallPrompt(event: Event): void {
  // Keep the browser's mini-infobar away; the card offers the install instead.
  event.preventDefault()
  deferred.value = event as BeforeInstallPromptEvent
}

function onInstalled(): void {
  deferred.value = null
  visible.value = false
}

function dismiss(): void {
  visible.value = false
  if (mode.value === 'ios') {
    writeStorage(IOS_HINT_KEY, '1')
    ios.value = false
  } else {
    writeStorage(DISMISSED_KEY, String(Date.now()))
  }
}

async function install(): Promise<void> {
  const event = deferred.value
  if (!event) return
  installing.value = true
  try {
    await event.prompt()
    const { outcome } = await event.userChoice
    if (outcome === 'dismissed') writeStorage(DISMISSED_KEY, String(Date.now()))
  } catch {
    // The prompt can only be used once; nothing else to do.
  } finally {
    installing.value = false
    deferred.value = null
    visible.value = false
  }
}

onMounted(() => {
  if (isStandalone() || recentlyDismissed()) return
  ios.value = isIosSafari() && !readStorage(IOS_HINT_KEY)
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.addEventListener('appinstalled', onInstalled)
  timer = setTimeout(() => (armed.value = true), SHOW_DELAY_MS)
  removeAfterEach = router.afterEach((_to, _from, failure) => {
    if (!failure && armed.value && mode.value) visible.value = true
  })
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  removeAfterEach?.()
  window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.removeEventListener('appinstalled', onInstalled)
})
</script>

<template>
  <v-expand-transition>
    <v-card
      v-if="visible && mode"
      class="install-prompt mb-4"
      variant="tonal"
      color="primary"
      role="region"
      aria-label="Installer l'application"
      data-testid="install-prompt"
    >
      <div class="d-flex align-start pa-4 ga-3">
        <v-icon icon="mdi-cellphone-arrow-down" size="28" class="mt-1" aria-hidden="true" />
        <div class="flex-grow-1">
          <p class="text-subtitle-1 font-weight-medium mb-1">
            Installer l'application sur l'écran d'accueil
          </p>
          <p v-if="mode === 'prompt'" class="text-body-2 mb-0">
            Accès en un geste, même hors connexion.
          </p>
          <p v-else class="text-body-2 mb-0" data-testid="install-ios-hint">
            Touchez <v-icon icon="mdi-export-variant" size="18" aria-label="Partager" />
            <strong>Partager</strong>, puis
            <v-icon icon="mdi-plus-box-outline" size="18" aria-hidden="true" />
            <strong>Sur l'écran d'accueil</strong>.
          </p>
        </div>
      </div>
      <v-card-actions class="justify-end px-4 pb-3 pt-0">
        <v-btn variant="text" min-height="48" data-testid="install-dismiss" @click="dismiss">
          {{ mode === 'ios' ? 'Compris' : 'Plus tard' }}
        </v-btn>
        <v-btn
          v-if="mode === 'prompt'"
          variant="flat"
          color="primary"
          min-height="48"
          :loading="installing"
          data-testid="install-accept"
          @click="install"
        >
          Installer
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-expand-transition>
</template>
