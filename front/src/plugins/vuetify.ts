import 'vuetify/styles'

import { createVuetify, type ThemeDefinition } from 'vuetify'
import { fr } from 'vuetify/locale'
import { aliases, mdi } from './icons'

// Theme tokens from front/UX.md section 6. Theme names are `light` and `dark`;
// `defaultTheme: 'system'` follows `prefers-color-scheme`.
//
// `fab` (issue #12): the brand orange `secondary` (#F28C28) with white text is only 2.45:1,
// below WCAG AA. The FAB uses a darker orange instead: #B35900 with white text is 4.83:1.
// In the dark theme the light orange keeps dark text: #F5A55B with #121418 is 9.14:1.
// `secondary` stays the brand orange for decorative highlights (no text on it).
export const lightTheme: ThemeDefinition = {
  dark: false,
  colors: {
    primary: '#1E5AA8',
    secondary: '#F28C28',
    fab: '#B35900',
    'on-fab': '#FFFFFF',
    background: '#F6F7F9',
    surface: '#FFFFFF',
    success: '#2E7D32',
    warning: '#ED6C02',
    error: '#C62828',
    info: '#1E5AA8',
  },
  variables: {
    // Vuetify's 0.6 makes field labels (0.87 × 0.6 of black) 4.23:1 on the #F6F7F9
    // background, below AA; 0.7 brings them to about 5.9:1 (Lighthouse, issue #12).
    'medium-emphasis-opacity': 0.7,
  },
}

export const darkTheme: ThemeDefinition = {
  dark: true,
  colors: {
    primary: '#7FAEEB',
    secondary: '#F5A55B',
    fab: '#F5A55B',
    'on-fab': '#121418',
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
      // SVG icons from `@mdi/js` (see ./icons.ts): the existing icon names keep working.
      defaultSet: 'mdi',
      aliases,
      sets: { mdi },
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
      VFab: { color: 'fab', rounded: 'xl' },
      VSnackbar: { location: 'bottom' },
    },
  })
}

export default buildVuetify()
