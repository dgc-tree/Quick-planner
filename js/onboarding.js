/**
 * First-visit onboarding — single-step color picker with preset swatches.
 */
import { hasVisited, markVisited, saveCustomColors } from './storage.js';
import { applyCustomColors } from './theme-customizer.js';

const PRESETS = [
  { hex: '#00E3FF', label: 'Cyan' },
  { hex: '#4F86F7', label: 'Blue' },
  { hex: '#7C5CFC', label: 'Purple' },
  { hex: '#E84393', label: 'Pink' },
  { hex: '#FF6B35', label: 'Orange' },
  { hex: '#2ECC71', label: 'Green' },
  { hex: '#F1C40F', label: 'Gold' },
  { hex: '#C9B458', label: 'Deep Gold' },
  { hex: '#A8998A', label: 'Warm Grey' },
];

export function shouldShowOnboarding() {
  return !hasVisited();
}

export function showOnboarding() {
  const colors = { primary1: '#00E3FF', secondary1: null, secondary2: null };
  let selected = '#00E3FF';

  const overlay = document.createElement('div');
  overlay.className = 'onboarding-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'onboarding-dialog';

  dialog.innerHTML = `
    <h2 class="onboarding-title">Welcome to Quick Planner</h2>
    <p class="onboarding-body">Pick a theme color to get started.</p>
    <div class="onboarding-swatches"></div>
    <div class="onboarding-custom-row" style="display:none;">
      <input type="color" class="onboarding-color-input">
      <div class="onboarding-custom-actions">
        <button class="modal-btn modal-cancel onboarding-custom-cancel">Cancel</button>
        <button class="modal-btn modal-save onboarding-custom-save">Save</button>
      </div>
    </div>
    <div class="onboarding-actions">
      <button class="modal-btn modal-cancel onboarding-skip">Skip</button>
      <button class="modal-btn modal-save onboarding-done">Done</button>
    </div>
  `;

  const swatchContainer = dialog.querySelector('.onboarding-swatches');
  const customRow = dialog.querySelector('.onboarding-custom-row');
  const colorInput = dialog.querySelector('.onboarding-color-input');

  function selectSwatch(hex) {
    selected = hex;
    colors.primary1 = hex;
    applyCustomColors(colors);
    swatchContainer.querySelectorAll('.onboarding-swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.hex === hex);
    });
    // deselect custom plus if a preset is chosen
    const plus = swatchContainer.querySelector('.onboarding-swatch-plus');
    if (plus) plus.classList.remove('active');
  }

  // Render preset swatches
  PRESETS.forEach(p => {
    const swatch = document.createElement('button');
    swatch.className = 'onboarding-swatch' + (p.hex === selected ? ' active' : '');
    swatch.dataset.hex = p.hex;
    swatch.style.background = p.hex;
    swatch.title = p.label;
    swatch.setAttribute('aria-label', p.label);
    swatch.addEventListener('click', () => {
      customRow.style.display = 'none';
      selectSwatch(p.hex);
    });
    swatchContainer.appendChild(swatch);
  });

  // Custom "+" swatch
  const plus = document.createElement('button');
  plus.className = 'onboarding-swatch onboarding-swatch-plus';
  plus.title = 'Custom color';
  plus.setAttribute('aria-label', 'Custom color');
  plus.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  plus.addEventListener('click', () => {
    colorInput.value = selected;
    customRow.style.display = 'flex';
    // Deselect presets
    swatchContainer.querySelectorAll('.onboarding-swatch').forEach(s => s.classList.remove('active'));
    plus.classList.add('active');
  });
  swatchContainer.appendChild(plus);

  // Custom color actions
  dialog.querySelector('.onboarding-custom-cancel').addEventListener('click', () => {
    customRow.style.display = 'none';
    selectSwatch(selected); // revert visual selection
  });
  dialog.querySelector('.onboarding-custom-save').addEventListener('click', () => {
    const hex = colorInput.value;
    customRow.style.display = 'none';
    plus.style.background = hex;
    plus.innerHTML = '';
    plus.dataset.hex = hex;
    selectSwatch(hex);
    plus.classList.add('active');
    // deselect presets
    swatchContainer.querySelectorAll('.onboarding-swatch:not(.onboarding-swatch-plus)').forEach(s => s.classList.remove('active'));
  });

  // Live preview while picking custom color
  colorInput.addEventListener('input', () => {
    colors.primary1 = colorInput.value;
    applyCustomColors(colors);
  });

  // Done / Skip
  function finish() {
    saveCustomColors(colors);
    applyCustomColors(colors);
    markVisited();
    overlay.remove();
  }
  dialog.querySelector('.onboarding-skip').addEventListener('click', () => {
    colors.primary1 = '#00E3FF';
    finish();
  });
  dialog.querySelector('.onboarding-done').addEventListener('click', finish);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}
