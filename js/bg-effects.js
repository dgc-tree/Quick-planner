/**
 * bg-effects.js — Background accent movement
 * Desktop: cursor-reactive. Mobile/tablet: autonomous random drift.
 * Drives CSS custom properties that offset the radial-gradient positions.
 */

import { loadBgEffects, saveBgEffects } from './storage.js';

const DEFAULTS = {
  intensity: 10,
  smoothing: 0.3,
  accent1: true,
  accent2: true,
  active: true,
};

let cfg = { ...DEFAULTS };
let target = { x: 0, y: 0 };
let current = { x: 0, y: 0 };
let raf = null;
let running = false;
let isMobile = false;
const DRIFT_SMOOTHING = 0.004; // slow interpolation toward waypoint

/* ── Core ─────────────────────────────────────────── */

function pickWaypoint() {
  target.x = (Math.random() - 0.5) * 2; // range [-1, 1]
  target.y = (Math.random() - 0.5) * 2;
}

function onMouseMove(e) {
  target.x = (e.clientX / window.innerWidth - 0.5) * 2;
  target.y = (e.clientY / window.innerHeight - 0.5) * 2;
}

function updateDrift() {
  // When close enough to waypoint, pick a new one
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  if (dx * dx + dy * dy < 0.01) pickWaypoint();
}

function tick() {
  if (isMobile) updateDrift();

  const ease = isMobile ? DRIFT_SMOOTHING : cfg.smoothing;
  current.x += (target.x - current.x) * ease;
  current.y += (target.y - current.y) * ease;

  const dx = current.x * cfg.intensity;
  const dy = current.y * cfg.intensity;

  const bs = document.body.style;

  if (cfg.accent1) {
    bs.setProperty('--bg-a1-x', `${10 - dx * 0.6}%`);
    bs.setProperty('--bg-a1-y', `${90 - dy * 0.4}%`);
  }
  if (cfg.accent2) {
    // Accent 2 moves opposite direction
    bs.setProperty('--bg-a2-x', `${90 + dx}%`);
    bs.setProperty('--bg-a2-y', `${15 + dy}%`);
  }

  raf = requestAnimationFrame(tick);
}

function start() {
  if (running) return;
  running = true;
  if (isMobile) pickWaypoint();
  else document.addEventListener('mousemove', onMouseMove);
  raf = requestAnimationFrame(tick);
}

function stop() {
  running = false;
  if (!isMobile) document.removeEventListener('mousemove', onMouseMove);
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

  if (cfg.active && !wasActive) start();
  else if (!cfg.active && wasActive) stop();
}

export function resetConfig() {
  Object.assign(cfg, DEFAULTS);
  saveBgEffects(cfg);
  if (!running && cfg.active) start();
}

/* ── Init ─────────────────────────────────────────── */

export function initBgEffects() {
  isMobile = window.matchMedia('(hover: none)').matches || window.innerWidth < 900;

  const saved = loadBgEffects();
  if (saved) Object.assign(cfg, saved);

  if (cfg.active) start();
}
