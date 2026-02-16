/**
 * Ramp generator — takes a seed hex color and produces a 13-step ramp (100–1300)
 * using OKLCH color space. Works in both Node and browser (ES module).
 */

// Lightness curve: step 100 = 95%, step 1300 = 10%
const STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300];
const L_MAX = 0.95;
const L_MIN = 0.10;

/**
 * Convert hex to sRGB [0-1] components
 */
function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const n = parseInt(hex, 16);
  return [(n >> 16) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

/**
 * Linear sRGB to linear (remove gamma)
 */
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Linear to sRGB (apply gamma)
 */
function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1/2.4) - 0.055;
}

/**
 * sRGB to OKLab via linear sRGB -> LMS -> OKLab
 */
function srgbToOklab(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

/**
 * OKLab to linear sRGB
 */
function oklabToLinearSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

/**
 * OKLab to OKLCH
 */
function oklabToOklch(L, a, b) {
  const C = Math.sqrt(a * a + b * b);
  let H = Math.atan2(b, a) * (180 / Math.PI);
  if (H < 0) H += 360;
  return [L, C, H];
}

/**
 * OKLCH to OKLab
 */
function oklchToOklab(L, C, H) {
  const hRad = H * (Math.PI / 180);
  return [L, C * Math.cos(hRad), C * Math.sin(hRad)];
}

/**
 * Clamp a value to [0, 1]
 */
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Check if linear RGB values are within sRGB gamut (with small tolerance)
 */
function inGamut(r, g, b) {
  const eps = 0.001;
  return r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps;
}

/**
 * Gamut-map an OKLCH color by reducing chroma until it fits sRGB
 */
function gamutMapOklch(L, C, H) {
  let lo = 0, hi = C;
  const [labL, labA, labB] = oklchToOklab(L, C, H);
  const [lr, lg, lb] = oklabToLinearSrgb(labL, labA, labB);
  if (inGamut(lr, lg, lb)) return [L, C, H];

  // Binary search for max in-gamut chroma
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const [mL, mA, mB] = oklchToOklab(L, mid, H);
    const [mr, mg, mb] = oklabToLinearSrgb(mL, mA, mB);
    if (inGamut(mr, mg, mb)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return [L, lo, H];
}

/**
 * Convert OKLCH to hex, gamut-mapping if necessary
 */
function oklchToHex(L, C, H) {
  const [gL, gC, gH] = gamutMapOklch(L, C, H);
  const [labL, labA, labB] = oklchToOklab(gL, gC, gH);
  const [lr, lg, lb] = oklabToLinearSrgb(labL, labA, labB);
  const r = Math.round(clamp01(linearToSrgb(lr)) * 255);
  const g = Math.round(clamp01(linearToSrgb(lg)) * 255);
  const b = Math.round(clamp01(linearToSrgb(lb)) * 255);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a 13-step color ramp from a seed hex color.
 * Returns an object: { 100: '#...', 200: '#...', ..., 1300: '#...' }
 */
export function generateRamp(seedHex) {
  const [r, g, b] = hexToRgb(seedHex);
  const [labL, labA, labB] = srgbToOklab(r, g, b);
  const [, seedC, seedH] = oklabToOklch(labL, labA, labB);

  const ramp = {};
  for (const step of STEPS) {
    // Interpolate lightness: step 100 → L_MAX, step 1300 → L_MIN
    const t = (step - 100) / (1300 - 100);
    const L = L_MAX - t * (L_MAX - L_MIN);
    ramp[step] = oklchToHex(L, seedC, seedH);
  }
  return ramp;
}

/**
 * Generate a neutral ramp (no chroma) — pure grays
 */
export function generateNeutralRamp() {
  const ramp = {};
  for (const step of STEPS) {
    const t = (step - 100) / (1300 - 100);
    const L = L_MAX - t * (L_MAX - L_MIN);
    ramp[step] = oklchToHex(L, 0, 0);
  }
  return ramp;
}

export { STEPS, hexToRgb, srgbToLinear, srgbToOklab, oklabToOklch, oklchToHex };
