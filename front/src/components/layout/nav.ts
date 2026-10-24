// Navigation entries shared by the bottom nav (mobile), the drawer (md+) and the Plus screen.
import type { NavKey } from '@/router'

export interface NavItem {
  key: NavKey
  label: string
  icon: string
  to: string
}

/** The 4 bottom-nav tabs (UX.md section 3: max 4 items). */
export const MAIN_NAV: readonly NavItem[] = [
  { key: 'home', label: 'Accueil', icon: 'mdi-home', to: '/' },
  { key: 'trips', label: 'Trajets', icon: 'mdi-map-marker-path', to: '/trajets' },
  { key: 'vehicles', label: 'Véhicules', icon: 'mdi-car', to: '/vehicules' },
  { key: 'more', label: 'Plus', icon: 'mdi-dots-horizontal', to: '/plus' },
]

export interface MoreItem {
  label: string
  icon: string
  to: string
  subtitle?: string
  presidentOnly?: boolean
}

/** What "Plus" opens (Déconnexion is an action, rendered separately). */
export const MORE_NAV: readonly MoreItem[] = [
  {
    label: 'Export & abandon de frais',
    icon: 'mdi-file-download-outline',
    to: '/export',
    subtitle: 'PDF, CSV et reçu fiscal',
  },
  {
    label: 'Profil',
    icon: 'mdi-account-circle-outline',
    to: '/profil',
    subtitle: 'Nom et adresse',
  },
  {
    label: 'Admin',
    icon: 'mdi-shield-account-outline',
    to: '/admin',
    subtitle: 'Reçus des coachs',
    presidentOnly: true,
  },
]
