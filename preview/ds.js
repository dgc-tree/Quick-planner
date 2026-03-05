/* ═══════════════════════════════════════════════════
   Quick Planner Design System — Shared JS
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Theme ── */
  const saved = localStorage.getItem('qp-theme');
  if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

  document.addEventListener('DOMContentLoaded', () => {
    initThemeToggle();
    initMobileNav();
    initCodePanels();
    markActiveNav();
  });

  function initThemeToggle() {
    const btn = document.getElementById('ds-theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (isDark) {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('qp-theme', 'light');
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('qp-theme', 'dark');
      }
    });
  }

  /* ── Mobile Nav ── */
  function initMobileNav() {
    const hamburger = document.getElementById('ds-hamburger');
    const nav = document.querySelector('.ds-nav');
    const overlay = document.querySelector('.ds-nav-overlay');
    if (!hamburger || !nav) return;

    function toggle() {
      nav.classList.toggle('open');
      if (overlay) overlay.classList.toggle('open');
    }

    hamburger.addEventListener('click', toggle);
    if (overlay) overlay.addEventListener('click', toggle);
  }

  /* ── Code Panels ── */
  function initCodePanels() {
    document.querySelectorAll('.ds-specimen').forEach(specimen => {
      const toolbar = specimen.querySelector('.ds-specimen-toolbar');
      if (!toolbar) return;

      const tabs = toolbar.querySelectorAll('[data-tab]');
      const panels = specimen.querySelectorAll('.ds-code-panel');
      const copyBtn = toolbar.querySelector('.ds-copy-btn');

      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => t.classList.remove('active'));
          panels.forEach(p => p.classList.remove('active'));
          tab.classList.add('active');
          const target = specimen.querySelector(`[data-panel="${tab.dataset.tab}"]`);
          if (target) target.classList.add('active');
        });
      });

      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          const activePanel = specimen.querySelector('.ds-code-panel.active pre');
          if (!activePanel) {
            // If no panel is open, open first
            if (tabs.length) tabs[0].click();
            return;
          }
          copyToClipboard(activePanel.textContent);
        });
      }
    });
  }

  /* ── Copy ── */
  window.copyToClipboard = function (text) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard'));
  };

  /* ── Toast ── */
  let toastTimer;
  function showToast(msg) {
    let toast = document.querySelector('.ds-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'ds-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    clearTimeout(toastTimer);
    requestAnimationFrame(() => {
      toast.classList.add('show');
      toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
    });
  }

  window.dsShowToast = showToast;

  /* ── Active Nav ── */
  function markActiveNav() {
    const page = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.ds-nav-link').forEach(link => {
      const href = link.getAttribute('href');
      if (href === page || (page === '' && href === 'index.html')) {
        link.classList.add('active');
      }
    });
  }

  /* ── Swatch click-to-copy ── */
  document.addEventListener('click', (e) => {
    const swatch = e.target.closest('.ds-swatch[data-token]');
    if (swatch) {
      copyToClipboard(`var(${swatch.dataset.token})`);
    }
  });

})();
