/**
 * Helper: render a Frutiger-Aero / Zen-style grainy gradient JPEG that
 * `build-warp-theme.mjs` references via `background_image:` in the YAML.
 *
 * Composition (bottom → top):
 *   1. Vertical linear gradient (gradient.top → gradient.bottom)
 *   2. Radial hot-spot — soft accent-colored glow, lower-center
 *   3. Monochromatic film grain — raw RGBA noise buffer composited
 *      with `over` blend
 *
 * Why a raw buffer and not SVG `feTurbulence`: sharp uses librsvg, which
 * historically has spotty / no support for feTurbulence. Earlier attempts
 * via `<filter><feTurbulence/><feColorMatrix/></filter>` rendered as a
 * uniform alpha wash with no visible noise. Generating the grain as raw
 * pixel bytes and compositing through sharp is reliable across versions.
 *
 * Output dimensions are intentionally larger than typical terminal panes
 * (2400×1500) so the noise survives downscale + JPEG DCT compression.
 * Bumping NOISE_ALPHA_MAX above ~30 reads as "dirty" rather than "filmic"
 * once the texture composites at Warp's window opacity.
 *
 * Warp's custom-theme schema only accepts JPEG (.jpg/.jpeg); see
 * https://docs.warp.dev/terminal/appearance/custom-themes#background-images-and-gradients
 */

import sharp from "sharp";

const WIDTH = 2400;
const HEIGHT = 1500;
const JPEG_QUALITY = 92;
// Defaults for the grain knobs. Per-theme overrides flow through the
// `noiseAlphaMax` / `noiseDarkProb` params and ultimately come from a
// theme's `controls.warp` block via `scripts/build-warp-theme.mjs`.
const DEFAULT_NOISE_ALPHA_MAX = 140; // 0–255; ~55% peak grain opacity. Heavy on purpose: at low Warp window opacity (e.g. OverrideOpacity=15), the grain has to survive a 0.15× multiplier, so the in-image variance has to be much larger than the final visible variance.
const DEFAULT_NOISE_DARK_PROBABILITY = 0.5; // 0–1: fraction of grain pixels that darken (vs. brighten) the surface. Salt-and-pepper noise modulates the surface in BOTH directions — dark pixels still darken the wallpaper at low window opacity, which keeps text legible. Pure white noise can only brighten and disappears against bright wallpapers.

/**
 * @param {object} opts
 * @param {{top: string, bottom: string}} opts.gradient - hex strings, no alpha
 * @param {string} opts.hotspotColor - hex string for the radial glow
 * @param {string} opts.outPath - absolute path to write the .jpg
 * @param {number} [opts.noiseAlphaMax] - peak grain alpha 0..255, default 140
 * @param {number} [opts.noiseDarkProb] - fraction of grain pixels that darken (0..1), default 0.5
 * @returns {Promise<void>}
 */
export async function generateWarpBackground({
  gradient,
  hotspotColor,
  outPath,
  noiseAlphaMax = DEFAULT_NOISE_ALPHA_MAX,
  noiseDarkProb = DEFAULT_NOISE_DARK_PROBABILITY,
}) {
  // Layer 1+2: gradient + radial hot-spot via SVG (librsvg handles these
  // shapes correctly; only the filter primitives are unreliable).
  const baseSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${gradient.top}"/>
      <stop offset="100%" stop-color="${gradient.bottom}"/>
    </linearGradient>
    <radialGradient id="hotspot" cx="55%" cy="68%" r="55%" fx="55%" fy="68%">
      <stop offset="0%" stop-color="${hotspotColor}" stop-opacity="0.35"/>
      <stop offset="45%" stop-color="${hotspotColor}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${hotspotColor}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#hotspot)"/>
</svg>`;

  // Layer 3: salt-and-pepper noise buffer. Each pixel is either fully bright
  // (255) or fully dark (0) with random alpha 0..NOISE_ALPHA_MAX, composited
  // via sharp's `over` blend. The dark pepper grains are what keep text
  // backing readable at low Warp window opacity — pure white noise can only
  // brighten the wallpaper and washes out against pale backdrops, while
  // bidirectional noise produces local contrast that survives any window
  // opacity setting.
  const pixelCount = WIDTH * HEIGHT;
  const noise = Buffer.allocUnsafe(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const off = i * 4;
    const value = Math.random() < noiseDarkProb ? 0 : 255;
    noise[off] = value;
    noise[off + 1] = value;
    noise[off + 2] = value;
    noise[off + 3] = Math.floor(Math.random() * noiseAlphaMax);
  }

  await sharp(Buffer.from(baseSvg))
    .composite([
      {
        input: noise,
        raw: { width: WIDTH, height: HEIGHT, channels: 4 },
        blend: "over",
      },
    ])
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(outPath);
}
