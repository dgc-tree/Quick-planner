/**
 * bg-effects.js — Background accent drift
 * Two radial-gradient sprites drift slowly across the page, each with a
 * gentle Y bobble. Like motes of dust in a sunbeam on a still day.
 * Drives CSS custom properties that offset the radial-gradient positions.
 *
 * cfg.speed / width / height are 1-100 sliders. Mappings live in
 * speedToPeriod / widthToSwing / heightToBobble below.
 */

import { loadBgEffects, saveBgEffects } from './storage.js';

const DEFAULTS = {
  speed: 80,    // 1 = glacial, 100 = brisk
  width: 100,   // 1 = barely drifts, 100 = full sweep + spillover
  height: 100,  // 1 = flat, 100 = floats high and low
  accent1: true,
  accent2: true,
  active: true,
};

// One-shot migration — bake the tuned production defaults into existing
// localStorage on next load. Future tuning persists normally afterwards.
const BGFX_VERSION_KEY = 'qp-bgfx-version';
const BGFX_CURRENT_VERSION = 2;

// Origins. Sine oscillation about (xBase, yBase) ± (xSwing, yBobble).
const ACCENT_1 = { xBase: 50, yBase: 90 };
const ACCENT_2 = { xBase: 50, yBase: 15 };

// Slider 1-100 mappings — defaults at 50 reproduce the original feel.
function speedToPeriod(speed) {
  // Exponential: speed=1 → 600s half-cycle, 50 → ~128s, 100 → 24s.
  const minP = 24000, maxP = 600000;
  const t = (Math.max(1, Math.min(100, speed)) - 1) / 99;
  return Math.round(maxP * Math.pow(minP / maxP, t));
}
function widthToSwing(width)  { return (Math.max(1, Math.min(100, width))  / 100) * 80; }
function heightToBobble(height) { return (Math.max(1, Math.min(100, height)) / 100) * 30; }

const Y1_PERIOD_MS = 23000;
const Y2_PERIOD_MS = 31000;

let cfg = { ...DEFAULTS };
let raf = null;
let running = false;
let startTime = 0;
let phase1 = 0;
let phase2 = 0;

// Derived from cfg — recomputed whenever cfg changes.
let xPeriod = speedToPeriod(DEFAULTS.speed);
let xSwing = widthToSwing(DEFAULTS.width);
let yBobble = heightToBobble(DEFAULTS.height);

function recomputeDerived() {
  xPeriod = speedToPeriod(cfg.speed);
  xSwing = widthToSwing(cfg.width);
  yBobble = heightToBobble(cfg.height);
}

/* ── Core ─────────────────────────────────────────── */

function tick() {
  const t = performance.now() - startTime;

  // X drift: sin from -1..+1, half-cycle = xPeriod, full bounce = 2x.
  // Accent 2 offset by π so it drifts in counter-phase to accent 1.
  const xSin1 = Math.sin((t / xPeriod) * Math.PI + phase1);
  const xSin2 = Math.sin((t / xPeriod) * Math.PI + phase2 + Math.PI);

  // Y bobble: independent slower period per sprite for a non-repeating feel.
  const ySin1 = Math.sin((t / Y1_PERIOD_MS) * Math.PI * 2 + phase1 * 1.7);
  const ySin2 = Math.sin((t / Y2_PERIOD_MS) * Math.PI * 2 + phase2 * 1.3);

  const a1x = ACCENT_1.xBase + xSin1 * xSwing;
  const a1y = ACCENT_1.yBase + ySin1 * yBobble;
  const a2x = ACCENT_2.xBase + xSin2 * xSwing;
  const a2y = ACCENT_2.yBase + ySin2 * yBobble;

  const bs = document.body.style;
  if (cfg.accent1) {
    bs.setProperty('--bg-a1-x', `${a1x}%`);
    bs.setProperty('--bg-a1-y', `${a1y}%`);
  }
  if (cfg.accent2) {
    bs.setProperty('--bg-a2-x', `${a2x}%`);
    bs.setProperty('--bg-a2-y', `${a2y}%`);
  }

  raf = requestAnimationFrame(tick);
}

function start() {
  if (running) return;
  // Honour OS-level reduced-motion preference: hold sprites at their origin.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  running = true;
  recomputeDerived();
  startTime = performance.now();
  phase1 = Math.random() * Math.PI * 2;
  phase2 = Math.random() * Math.PI * 2;
  raf = requestAnimationFrame(tick);
}

function stop() {
  running = false;
  cancelAnimationFrame(raf);
  const bs = document.body.style;
  bs.removeProperty('--bg-a1-x');
  bs.removeProperty('--bg-a1-y');
  bs.removeProperty('--bg-a2-x');
  bs.removeProperty('--bg-a2-y');
}

/* ── Public API ───────────────────────────────────── */

export function getConfig() {
  return { ...cfg };
}

export function setConfig(newCfg) {
  const wasActive = cfg.active;
  Object.assign(cfg, newCfg);
  saveBgEffects(cfg);
  recomputeDerived();

  if (cfg.active && !wasActive) start();
  else if (!cfg.active && wasActive) stop();
}

export function resetConfig() {
  Object.assign(cfg, DEFAULTS);
  saveBgEffects(cfg);
  recomputeDerived();
  if (!running && cfg.active) start();
}

/* ── Init ─────────────────────────────────────────── */

export function initBgEffects() {
  const savedVersion = Number(localStorage.getItem(BGFX_VERSION_KEY) || '1');
  if (savedVersion < BGFX_CURRENT_VERSION) {
    // First load on this version — write the new tuned defaults, regardless
    // of any prior tuning. End users see the production-ready feel.
    Object.assign(cfg, DEFAULTS);
    saveBgEffects(cfg);
    localStorage.setItem(BGFX_VERSION_KEY, String(BGFX_CURRENT_VERSION));
  } else {
    const saved = loadBgEffects();
    if (saved) Object.assign(cfg, saved);
  }
  recomputeDerived();

  if (cfg.active) start();
}
