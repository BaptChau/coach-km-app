import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'

import App from '@/App.vue'
import { buildRouter } from '@/router'
import { buildVuetify, darkTheme, lightTheme } from '@/plugins/vuetify'

describe('app shell', () => {
  it('uses the UX.md theme tokens', () => {
    expect(lightTheme.colors?.primary).toBe('#1E5AA8')
    expect(lightTheme.colors?.secondary).toBe('#F28C28')
    expect(lightTheme.colors?.background).toBe('#F6F7F9')
    expect(darkTheme.dark).toBe(true)
  })

  it('renders the Accueil placeholder inside v-app', async () => {
    const router = buildRouter()
    router.push('/')
    await router.isReady()

    const wrapper = mount(App, {
      global: { plugins: [createPinia(), router, buildVuetify()] },
    })

    expect(wrapper.find('.v-application').exists()).toBe(true)
    expect(wrapper.text()).toContain('Accueil')
  })
})
