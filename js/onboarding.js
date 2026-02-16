/**
 * First-visit onboarding flow — guides user through picking primary color.
 */
import { hasVisited, markVisited, saveCustomColors } from './storage.js';
import { createColorPicker } from './color-picker.js';
import { applyCustomColors } from './theme-customizer.js';

const STEPS = [
  {
    title: 'Welcome to Quick Planner',
    body: 'Customise your theme colors, or skip to use the defaults.',
    isIntro: true,
  },
  {
    title: 'Pick your primary color',
    body: 'This color will be used for accents, buttons, and highlights.',
    colorKey: 'primary1',
    defaultColor: '#00E3FF',
  },
  {
    title: 'Secondary color (optional)',
    body: 'Add a secondary accent, or leave blank to match neutral.',
    colorKey: 'secondary1',
    defaultColor: null,
  },
  {
    title: 'Second secondary (optional)',
    body: 'One more accent color, or leave blank.',
    colorKey: 'secondary2',
    defaultColor: null,
  },
];

export function shouldShowOnboarding() {
  return !hasVisited();
}

export function showOnboarding() {
  const colors = { primary1: '#00E3FF', secondary1: null, secondary2: null };
  let currentStep = 0;

  const overlay = document.createElement('div');
  overlay.className = 'onboarding-overlay';

  function renderStep() {
    const step = STEPS[currentStep];
    overlay.innerHTML = '';

    const dialog = document.createElement('div');
    dialog.className = 'onboarding-dialog';

    const title = document.createElement('h2');
    title.className = 'onboarding-title';
    title.textContent = step.title;

    const body = document.createElement('p');
    body.className = 'onboarding-body';
    body.textContent = step.body;

    dialog.appendChild(title);
    dialog.appendChild(body);

    if (step.colorKey) {
      const picker = createColorPicker({
        label: '',
        value: colors[step.colorKey],
        onChange: (hex) => {
          colors[step.colorKey] = hex;
          applyCustomColors(colors);
        },
      });
      dialog.appendChild(picker);
    }

    const actions = document.createElement('div');
    actions.className = 'onboarding-actions';

    if (currentStep > 0) {
      const backBtn = document.createElement('button');
      backBtn.className = 'modal-btn modal-cancel';
      backBtn.textContent = 'Back';
      backBtn.addEventListener('click', () => { currentStep--; renderStep(); });
      actions.appendChild(backBtn);
    }

    const skipBtn = document.createElement('button');
    skipBtn.className = 'modal-btn modal-cancel';
    skipBtn.textContent = 'Skip';
    skipBtn.addEventListener('click', finish);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'modal-btn modal-save';
    nextBtn.textContent = currentStep === STEPS.length - 1 ? 'Done' : 'Next';
    nextBtn.addEventListener('click', () => {
      if (currentStep === STEPS.length - 1) {
        finish();
      } else {
        currentStep++;
        renderStep();
      }
    });

    actions.appendChild(skipBtn);
    actions.appendChild(nextBtn);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
  }

  function finish() {
    saveCustomColors(colors);
    applyCustomColors(colors);
    markVisited();
    overlay.remove();
  }

  renderStep();
  document.body.appendChild(overlay);
}
