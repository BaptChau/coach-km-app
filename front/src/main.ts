import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

import App from '@/App.vue'
import { enableMocks } from '@/mocks'
import router from '@/router'
import vuetify from '@/plugins/vuetify'
import { setupPwa } from '@/plugins/pwa'
import '@/styles/main.scss'

const app = createApp(App)

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

app.use(pinia)
app.use(router)
app.use(vuetify)

// Dev mock API (VITE_USE_MOCKS): must intercept before the first request.
await enableMocks()

app.mount('#app')

// Service worker + update flow (issue #12), after the first render.
void setupPwa(router)
