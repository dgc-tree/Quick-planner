/**
 * Color picker modal — HSL sliders + hex input.
 * Shared by Settings custom colour and kanban column colour.
 */

export function openColorPickerModal({ title = 'Pick a colour', initialHex = '#00E3FF', onSave }) {
  const existing = document.getElementById('cp-overlay');
  if (existing) existing.remove();

  const { h, s, l } = hexToHsl(initialHex);
  let _h = h, _s = s, _l = l;

  const overlay = document.createElement('div');
  overlay.id = 'cp-overlay';
  overlay.className = 'modal-overlay open';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog cp-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', title);

  dialog.innerHTML = `
    <div class="modal-header">
      <h2 class="modal-title">${title}</h2>
    </div>
    <div class="cp-body">
      <div class="cp-top-row">
        <div class="cp-preview" id="cp-preview" style="background:${initialHex}"></div>
        <div class="cp-hex-wrap">
          <span class="cp-hex-label">Hex</span>
          <input type="text" id="cp-hex" class="cp-hex-input" maxlength="7" spellcheck="false" autocomplete="off" value="${initialHex}">
        </div>
      </div>
      <div class="cp-sliders">
        <div class="cp-row">
          <span class="cp-lbl">H</span>
          <div class="cp-track hue-track"><input type="range" id="cp-hue" class="cp-range" min="0" max="360" value="${Math.round(_h)}"></div>
          <span class="cp-val" id="cp-hue-val">${Math.round(_h)}°</span>
        </div>
        <div class="cp-row">
          <span class="cp-lbl">S</span>
          <div class="cp-track" id="cp-sat-track"><input type="range" id="cp-sat" class="cp-range" min="0" max="100" value="${Math.round(_s)}"></div>
          <span class="cp-val" id="cp-sat-val">${Math.round(_s)}%</span>
        </div>
        <div class="cp-row">
          <span class="cp-lbl">L</span>
          <div class="cp-track" id="cp-lit-track"><input type="range" id="cp-lit" class="cp-range" min="0" max="100" value="${Math.round(_l)}"></div>
          <span class="cp-val" id="cp-lit-val">${Math.round(_l)}%</span>
        </div>
      </div>
    </div>
    <div class="cp-footer">
      <button id="cp-cancel" class="modal-btn modal-cancel">Cancel</button>
      <button id="cp-save" class="modal-btn modal-save">Save</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const preview   = dialog.querySelector('#cp-preview');
  const hexInput  = dialog.querySelector('#cp-hex');
  const hueRange  = dialog.querySelector('#cp-hue');
  const satRange  = dialog.querySelector('#cp-sat');
  const litRange  = dialog.querySelector('#cp-lit');
  const satTrack  = dialog.querySelector('#cp-sat-track');
  const litTrack  = dialog.querySelector('#cp-lit-track');
  const hueVal    = dialog.querySelector('#cp-hue-val');
  const satVal    = dialog.querySelector('#cp-sat-val');
  const litVal    = dialog.querySelector('#cp-lit-val');

  function currentHex() { return hslToHex(_h, _s, _l); }

  function updateTracks() {
    satTrack.style.background = `linear-gradient(to right, hsl(${_h},0%,${_l}%), hsl(${_h},100%,${_l}%))`;
    litTrack.style.background = `linear-gradient(to right, #111, hsl(${_h},${_s}%,50%), #fff)`;
  }

  function syncUI() {
    const hex = currentHex();
    preview.style.background = hex;
    hexInput.value = hex;
    hueVal.textContent = Math.round(_h) + '°';
    satVal.textContent = Math.round(_s) + '%';
    litVal.textContent = Math.round(_l) + '%';
    updateTracks();
  }

  updateTracks();

  hueRange.addEventListener('input', () => { _h = +hueRange.value; syncUI(); });
  satRange.addEventListener('input', () => { _s = +satRange.value; syncUI(); });
  litRange.addEventListener('input', () => { _l = +litRange.value; syncUI(); });

  hexInput.addEventListener('input', () => {
    const v = hexInput.value.trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      const { h, s, l } = hexToHsl(v);
      _h = h; _s = s; _l = l;
      hueRange.value = Math.round(_h);
      satRange.value = Math.round(_s);
      litRange.value = Math.round(_l);
      hueVal.textContent = Math.round(_h) + '°';
      satVal.textContent = Math.round(_s) + '%';
      litVal.textContent = Math.round(_l) + '%';
      preview.style.background = v;
      updateTracks();
    }
  });

  const close = () => overlay.remove();
  dialog.querySelector('#cp-cancel').addEventListener('click', close);
  dialog.querySelector('#cp-save').addEventListener('click', () => {
    close();
    onSave(currentHex());
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
