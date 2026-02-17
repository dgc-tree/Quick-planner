/**
 * Runtime theme customizer — generates OKLCH ramps from user seed colors
 * and injects them as CSS custom properties.
 */
import { generateRamp, generateNeutralRamp, STEPS, hexToRgb, srgbToLinear } from '../shared/ramp-generator.js';
import { loadCustomColors, saveCustomColors, clearCustomColors } from './storage.js';

/**
 * Return black or white hex depending on WCAG AA contrast against the given bg color.
 */
function contrastTextColor(hex) {
  const [r, g, b] = hexToRgb(hex);
  const L = 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  return L > 0.179 ? '#000000' : '#ffffff';
}

const STYLE_ID = 'user-theme';

/**
 * Apply custom seed colors. Pass null for a ramp to use neutral.
 * @param {{ primary1?: string|null, secondary1?: string|null, secondary2?: string|null }} colors
 */
export function applyCustomColors(colors) {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }

  const ramps = {};
  ramps.primary1 = colors.primary1 ? generateRamp(colors.primary1) : generateNeutralRamp();
  ramps.secondary1 = colors.secondary1 ? generateRamp(colors.secondary1) : generateNeutralRamp();
  ramps.secondary2 = colors.secondary2 ? generateRamp(colors.secondary2) : generateNeutralRamp();

  let css = ':root {\n';
  for (const [name, ramp] of Object.entries(ramps)) {
    for (const step of STEPS) {
      css += `  --color-${name}-${step}: ${ramp[step]};\n`;
    }
  }

  // Update semantic accent tokens — use exact seed color, not ramp step
  css += `  --accent-primary1: ${colors.primary1 || 'var(--color-primary1-400)'};\n`;
  css += `  --accent-secondary1: ${colors.secondary1 || 'var(--color-secondary1-600)'};\n`;
  css += `  --accent-secondary2: ${colors.secondary2 || 'var(--color-secondary2-600)'};\n`;

  // WCAG-adaptive text color for each accent
  if (colors.primary1) css += `  --on-accent-primary1: ${contrastTextColor(colors.primary1)};\n`;
  if (colors.secondary1) css += `  --on-accent-secondary1: ${contrastTextColor(colors.secondary1)};\n`;
  if (colors.secondary2) css += `  --on-accent-secondary2: ${contrastTextColor(colors.secondary2)};\n`;
  css += `  --surface-canvas: var(--color-primary1-100);\n`;
  css += `}\n\n`;

  // Dark theme — same exact seed colors, same contrast text
  css += `[data-theme="dark"] {\n`;
  css += `  --accent-primary1: ${colors.primary1 || 'var(--color-primary1-400)'};\n`;
  css += `  --accent-secondary1: ${colors.secondary1 || 'var(--color-secondary1-500)'};\n`;
  css += `  --accent-secondary2: ${colors.secondary2 || 'var(--color-secondary2-500)'};\n`;
  if (colors.primary1) css += `  --on-accent-primary1: ${contrastTextColor(colors.primary1)};\n`;
  if (colors.secondary1) css += `  --on-accent-secondary1: ${contrastTextColor(colors.secondary1)};\n`;
  if (colors.secondary2) css += `  --on-accent-secondary2: ${contrastTextColor(colors.secondary2)};\n`;
  css += `  --surface-canvas: var(--color-primary1-800);\n`;
  css += `  --surface-header: color-mix(in srgb, var(--color-primary1-1200) 70%, transparent);\n`;
  css += `}\n`;

  style.textContent = css;
}

/**
 * Remove all custom color overrides
 */
export function removeCustomColors() {
  const style = document.getElementById(STYLE_ID);
  if (style) style.remove();
  clearCustomColors();
}

/**
 * Initialize — apply saved colors if present
 */
export function initCustomColors() {
  const saved = loadCustomColors();
  if (saved) {
    applyCustomColors(saved);
  }
}
