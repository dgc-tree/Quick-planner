#!/usr/bin/env node
/**
 * Build script: reads DTCG token files, generates color ramps, outputs css/tokens.css
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateRamp, generateNeutralRamp } from '../shared/ramp-generator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Read token files
const base = JSON.parse(readFileSync(join(ROOT, 'tokens/base.colors.json'), 'utf8'));
const roles = JSON.parse(readFileSync(join(ROOT, 'tokens/roles.colors.json'), 'utf8'));
const lightTheme = JSON.parse(readFileSync(join(ROOT, 'themes/light.colors.json'), 'utf8'));
const darkTheme = JSON.parse(readFileSync(join(ROOT, 'themes/dark.colors.json'), 'utf8'));

// Generate ramps
const ramps = {};
for (const [name, config] of Object.entries(base)) {
  if (name.startsWith('$')) continue;
  if (!config.seed) {
    // No seed = neutral ramp
    ramps[name] = generateNeutralRamp();
  } else {
    ramps[name] = generateRamp(config.seed);
  }
}

/**
 * Resolve a reference like "{neutral.500}" to a hex color
 */
function resolveRef(ref) {
  const match = ref.match(/^\{(\w+)\.(\d+)\}$/);
  if (!match) return ref; // literal color
  const [, rampName, step] = match;
  if (!ramps[rampName] || !ramps[rampName][step]) {
    console.warn(`Unresolved ref: ${ref}`);
    return '#ff00ff'; // magenta = error
  }
  return ramps[rampName][step];
}

/**
 * Convert hex to rgba with alpha
 */
function hexToRgba(hex, alpha) {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Generate CSS vars for a theme config
 */
function generateThemeVars(theme) {
  const lines = [];

  // Surface tokens
  if (theme.surface) {
    for (const [name, config] of Object.entries(theme.surface)) {
      const resolved = resolveRef(config.$value);
      if (config.$alpha !== undefined) {
        lines.push(`  --surface-${name}: ${hexToRgba(resolved, config.$alpha)};`);
      } else {
        lines.push(`  --surface-${name}: ${resolved};`);
      }
    }
  }

  // Content tokens
  if (theme.content) {
    for (const [name, config] of Object.entries(theme.content)) {
      lines.push(`  --content-${name}: ${resolveRef(config.$value)};`);
    }
  }

  // Accent tokens
  if (theme.accent) {
    for (const [name, config] of Object.entries(theme.accent)) {
      lines.push(`  --accent-${name}: ${resolveRef(config.$value)};`);
    }
  }

  // Outline tokens
  if (theme.outline) {
    for (const [name, config] of Object.entries(theme.outline)) {
      const resolved = resolveRef(config.$value);
      if (config.$alpha !== undefined) {
        lines.push(`  --outline-${name}: ${hexToRgba(resolved, config.$alpha)};`);
      } else {
        lines.push(`  --outline-${name}: ${resolved};`);
      }
    }
  }

  return lines;
}

/**
 * Generate CSS for category and status tokens from roles
 */
function generateComponentVars() {
  const lines = [];

  // Category tokens
  if (roles.category) {
    for (const [name, config] of Object.entries(roles.category)) {
      if (name.startsWith('$')) continue;
      lines.push(`  --category-${name}-bg: ${resolveRef(config.bg.$value)};`);
      lines.push(`  --category-${name}-text: ${resolveRef(config.text.$value)};`);
    }
  }

  // Status tokens
  if (roles.status) {
    for (const [name, config] of Object.entries(roles.status)) {
      if (name.startsWith('$')) continue;
      lines.push(`  --status-${name}-bg: ${resolveRef(config.bg.$value)};`);
      lines.push(`  --status-${name}-text: ${resolveRef(config.text.$value)};`);
    }
  }

  // Feedback tokens (light only — dark handled separately)
  if (roles.feedback) {
    for (const [name, config] of Object.entries(roles.feedback)) {
      if (name.startsWith('$')) continue;
      lines.push(`  --${name}-text: ${resolveRef(config.text.$value)};`);
      const bgResolved = resolveRef(config.bg.$value);
      if (config.bg.$alpha !== undefined) {
        lines.push(`  --${name}-bg: ${hexToRgba(bgResolved, config.bg.$alpha)};`);
      } else {
        lines.push(`  --${name}-bg: ${bgResolved};`);
      }
      if (config.border) {
        const borderResolved = resolveRef(config.border.$value);
        if (config.border.$alpha !== undefined) {
          lines.push(`  --${name}-border: ${hexToRgba(borderResolved, config.border.$alpha)};`);
        } else {
          lines.push(`  --${name}-border: ${borderResolved};`);
        }
      }
      if (config.solid) {
        lines.push(`  --${name}-solid: ${resolveRef(config.solid.$value)};`);
      }
      if (config.hover) {
        lines.push(`  --${name}-hover: ${resolveRef(config.hover.$value)};`);
      }
    }
  }

  // On-accent tokens
  if (roles['on-accent']) {
    for (const [name, config] of Object.entries(roles['on-accent'])) {
      if (name.startsWith('$')) continue;
      lines.push(`  --on-accent-${name}: ${resolveRef(config.$value)};`);
    }
  }

  return lines;
}

// Build the CSS output
let css = `/* Auto-generated by scripts/build-tokens.js — DO NOT EDIT */\n\n`;

// Base ramp vars (always available)
css += `:root {\n`;
css += `  /* === Base Ramps === */\n`;
for (const [name, ramp] of Object.entries(ramps)) {
  for (const [step, hex] of Object.entries(ramp)) {
    css += `  --color-${name}-${step}: ${hex};\n`;
  }
}
css += `\n`;

// Light theme semantic vars
css += `  /* === Semantic Roles (Light) === */\n`;
css += generateThemeVars(lightTheme).join('\n') + '\n';
css += `\n`;

// Component vars (same in both themes for now)
css += `  /* === Component Tokens === */\n`;
css += generateComponentVars().join('\n') + '\n';
css += `}\n\n`;

// Dark theme overrides
css += `[data-theme="dark"] {\n`;
css += `  /* === Semantic Roles (Dark) === */\n`;
css += generateThemeVars(darkTheme).join('\n') + '\n';

// Dark feedback token overrides
if (roles.feedback) {
  for (const [name, config] of Object.entries(roles.feedback)) {
    if (name.startsWith('$')) continue;
    if (config['text-dark']) css += `  --${name}-text: ${resolveRef(config['text-dark'].$value)};\n`;
    if (config['bg-dark']) {
      const bgResolved = resolveRef(config['bg-dark'].$value);
      if (config['bg-dark'].$alpha !== undefined) {
        css += `  --${name}-bg: ${hexToRgba(bgResolved, config['bg-dark'].$alpha)};\n`;
      } else {
        css += `  --${name}-bg: ${bgResolved};\n`;
      }
    }
    if (config['border-dark']) {
      const borderResolved = resolveRef(config['border-dark'].$value);
      if (config['border-dark'].$alpha !== undefined) {
        css += `  --${name}-border: ${hexToRgba(borderResolved, config['border-dark'].$alpha)};\n`;
      } else {
        css += `  --${name}-border: ${borderResolved};\n`;
      }
    }
    if (config['solid-dark']) css += `  --${name}-solid: ${resolveRef(config['solid-dark'].$value)};\n`;
    if (config['hover-dark']) css += `  --${name}-hover: ${resolveRef(config['hover-dark'].$value)};\n`;
  }
}
css += `}\n`;

// Write output
const outPath = join(ROOT, 'css/tokens.css');
writeFileSync(outPath, css, 'utf8');
console.log(`Wrote ${outPath}`);
console.log(`  ${Object.keys(ramps).length} ramps, ${Object.values(ramps)[0] ? Object.keys(Object.values(ramps)[0]).length : 0} steps each`);
