import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'

import { createVuetify, type ThemeDefinition } from 'vuetify'
import { fr } from 'vuetify/locale'

// Theme tokens from front/UX.md section 6. Theme names are `light` and `dark`;
// `defaultTheme: 'system'` follows `prefers-color-scheme`.
export const lightTheme: ThemeDefinition = {
  dark: false,
  colors: {
    primary: '#1E5AA8',
    secondary: '#F28C28',
    background: '#F6F7F9',
    surface: '#FFFFFF',
    success: '#2E7D32',
    warning: '#ED6C02',
    error: '#C62828',
    info: '#1E5AA8',
  },
}

export const darkTheme: ThemeDefinition = {
  dark: true,
  colors: {
    primary: '#7FAEEB',
    secondary: '#F5A55B',
    background: '#121418',
    surface: '#1C1F25',
    success: '#66BB6A',
    warning: '#FFA54F',
    error: '#EF6B6B',
    info: '#7FAEEB',
  },
}

export function buildVuetify() {
  return createVuetify({
    theme: {
      defaultTheme: 'system',
      themes: { light: lightTheme, dark: darkTheme },
    },
    locale: {
      locale: 'fr',
      fallback: 'fr',
      messages: { fr },
    },
    icons: {
      defaultSet: 'mdi',
    },
    defaults: {
      VTextField: { variant: 'outlined', density: 'comfortable', color: 'primary' },
      VTextarea: { variant: 'outlined', density: 'comfortable', color: 'primary' },
      VSelect: { variant: 'outlined', density: 'comfortable', color: 'primary' },
      VAutocomplete: { variant: 'outlined', density: 'comfortable', color: 'primary' },
      VCombobox: { variant: 'outlined', density: 'comfortable', color: 'primary' },
      VBtn: { rounded: 'lg', size: 'large' },
      VCard: { rounded: 'lg', elevation: 1 },
      VSwitch: { color: 'primary', inset: true },
      VFab: { color: 'secondary', rounded: 'xl' },
      VSnackbar: { location: 'bottom' },
    },
  })
}

export default buildVuetify()
