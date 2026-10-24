// SVG icon set for Vuetify (issue #12), replacing the `@mdi/font` webfont (~80 KB gzip of CSS
// plus the font files) by the paths of the icons the app actually uses.
//
// - `mdi-xxx` names (in components and views) resolve through `MDI_ICONS`.
// - Vuetify's internal aliases (`$close`, `$dropdown`, `$checkboxOn`, ...) come from
//   Vuetify's own `mdi-svg` set, which already holds them as inline SVG paths.
import { h } from 'vue'
import type { IconAliases, IconProps, IconSet } from 'vuetify'
import { aliases as svgAliases, mdi as svgSet } from 'vuetify/iconsets/mdi-svg'
import { MDI_ICONS } from './mdi-icons'

export const aliases: IconAliases = svgAliases

/** The SVG path of an `mdi-xxx` name, or `undefined` when it is not in the map. */
export function resolveMdiIcon(name: unknown): string | undefined {
  return typeof name === 'string' ? MDI_ICONS[name.trim()] : undefined
}

export const mdi: IconSet = {
  component: (props: IconProps) => {
    const path = resolveMdiIcon(props.icon)
    if (path === undefined && import.meta.env.DEV) {
      console.warn(`[icons] "${String(props.icon)}" is missing from src/plugins/mdi-icons.ts`)
    }
    // An unknown name renders an empty icon (same box size) rather than breaking the layout.
    return h(svgSet.component, { ...props, icon: path ?? '' })
  },
}
