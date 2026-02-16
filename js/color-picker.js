/**
 * Simple color picker component — hue/saturation strip + hex input.
 * Returns a hex string on change.
 */

/**
 * Create a color picker element.
 * @param {object} opts
 * @param {string} opts.label - Display label
 * @param {string|null} opts.value - Initial hex value (null = no color)
 * @param {(hex: string|null) => void} opts.onChange - Called on color change
 * @returns {HTMLElement}
 */
export function createColorPicker({ label, value, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'color-picker';

  const labelEl = document.createElement('label');
  labelEl.className = 'color-picker-label';
  labelEl.textContent = label;

  const controls = document.createElement('div');
  controls.className = 'color-picker-controls';

  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.className = 'color-picker-swatch';
  swatch.value = value || '#00E3FF';
  swatch.title = 'Pick a color';

  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.className = 'color-picker-hex';
  hexInput.value = value || '';
  hexInput.placeholder = '#00E3FF';
  hexInput.maxLength = 7;

  const clearBtn = document.createElement('button');
  clearBtn.className = 'color-picker-clear';
  clearBtn.textContent = 'Clear';
  clearBtn.type = 'button';

  swatch.addEventListener('input', () => {
    hexInput.value = swatch.value;
    onChange(swatch.value);
  });

  hexInput.addEventListener('change', () => {
    const v = hexInput.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      swatch.value = v;
      onChange(v);
    }
  });

  clearBtn.addEventListener('click', () => {
    hexInput.value = '';
    onChange(null);
  });

  controls.appendChild(swatch);
  controls.appendChild(hexInput);
  controls.appendChild(clearBtn);
  wrap.appendChild(labelEl);
  wrap.appendChild(controls);

  return wrap;
}
