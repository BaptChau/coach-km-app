// Generates the PWA PNG icons from the SVG sources in public/icons/ (issue #12).
//
//   npm run icons
//
// Uses sharp through `npx sharp-cli` (pinned), so sharp and its native binaries are not a
// project dependency. Commit the SVG sources and the generated PNGs together.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SHARP_CLI = 'sharp-cli@6.1.0'
const iconsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

/**
 * [source SVG, output PNG, size]. The SVGs have a 512 viewBox, so every output is a
 * downscale. `icon-maskable.svg` is full-bleed (opaque), which also suits iOS, where a
 * transparent apple-touch-icon gets a black background.
 */
const targets = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon.svg', 'favicon-32.png', 32],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
  ['icon-maskable.svg', 'apple-touch-icon-180.png', 180],
]

for (const [source, output, size] of targets) {
  execFileSync(
    'npx',
    [
      '--yes',
      SHARP_CLI,
      '--input',
      join(iconsDir, source),
      '--output',
      join(iconsDir, output),
      'resize',
      String(size),
      String(size),
    ],
    { stdio: 'inherit' },
  )
  console.log(`${output} (${size}x${size})`)
}
