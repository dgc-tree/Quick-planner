/**
 * 3-step onboarding: colour picker → template → import.
 */
import { hasVisited, markVisited, saveCustomColors, loadProjects, saveProjects, saveActiveProjectId } from './storage.js';
import { applyCustomColors } from './theme-customizer.js';
import { openColorPickerModal } from './color-picker.js';
import { importCSV } from './projects.js';

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

function today(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(0, 0, 0, 0);
  return d;
}

export const TEMPLATES = [
  {
    id: 'project',
    label: 'Project',
    icon: '🏗️',
    tasks: [
      // Kitchen
      { task: 'Measure and quote kitchen', room: 'Kitchen', category: 'Planning', status: 'Done', assigned: ['AJ'], startDate: today(-14), endDate: today(-7), dependencies: '' },
      { task: 'Strip old cabinetry', room: 'Kitchen', category: 'Trade', status: 'Done', assigned: ['AJ', 'MK'], startDate: today(-7), endDate: today(-3), dependencies: '' },
      { task: 'Install kitchen cabinetry', room: 'Kitchen', category: 'Trade', status: 'In Progress', assigned: ['AJ'], startDate: today(-3), endDate: today(10), dependencies: '' },
      { task: 'Benchtop templating and install', room: 'Kitchen', category: 'Trade', status: 'To Do', assigned: ['RL'], startDate: today(10), endDate: today(18), dependencies: '' },
      { task: 'Splashback tiling', room: 'Kitchen', category: 'Trade', status: 'To Do', assigned: ['MK'], startDate: today(18), endDate: today(24), dependencies: '' },
      // Bathroom
      { task: 'Demolish old bathroom', room: 'Bathroom', category: 'Trade', status: 'Done', assigned: ['AJ', 'MK'], startDate: today(-21), endDate: today(-14), dependencies: '' },
      { task: 'Waterproofing', room: 'Bathroom', category: 'Trade', status: 'Done', assigned: ['RL'], startDate: today(-14), endDate: today(-10), dependencies: '' },
      { task: 'Tile bathroom floor and walls', room: 'Bathroom', category: 'Trade', status: 'In Progress', assigned: ['MK'], startDate: today(-10), endDate: today(3), dependencies: '' },
      { task: 'Install vanity and fixtures', room: 'Bathroom', category: 'Trade', status: 'To Do', assigned: ['RL'], startDate: today(3), endDate: today(8), dependencies: '' },
      { task: 'Paint bathroom ceiling', room: 'Bathroom', category: 'Finishing', status: 'To Do', assigned: ['AJ'], startDate: today(8), endDate: today(10), dependencies: '' },
      // Master Bedroom
      { task: 'Patch walls and sand', room: 'Master Bedroom', category: 'Finishing', status: 'In Progress', assigned: ['AJ'], startDate: today(-5), endDate: today(2), dependencies: '' },
      { task: 'Paint walls two coats', room: 'Master Bedroom', category: 'Finishing', status: 'To Do', assigned: ['AJ', 'MK'], startDate: today(2), endDate: today(6), dependencies: '' },
      { task: 'Install new skirting', room: 'Master Bedroom', category: 'Finishing', status: 'To Do', assigned: ['RL'], startDate: today(6), endDate: today(9), dependencies: '' },
      { task: 'Carpet measure and lay', room: 'Master Bedroom', category: 'Trade', status: 'To Do', assigned: ['RL'], startDate: today(12), endDate: today(14), dependencies: '' },
      // Living
      { task: 'Sand and polish floorboards', room: 'Living', category: 'Trade', status: 'To Do', assigned: ['MK'], startDate: today(14), endDate: today(20), dependencies: '' },
      { task: 'Replace light fixtures', room: 'Living', category: 'Trade', status: 'To Do', assigned: ['RL'], startDate: today(5), endDate: today(6), dependencies: '' },
      { task: 'Paint feature wall', room: 'Living', category: 'Finishing', status: 'To Do', assigned: ['AJ'], startDate: today(20), endDate: today(23), dependencies: '' },
      // Exterior
      { task: 'Pressure wash driveway', room: 'Exterior', category: 'Finishing', status: 'To Do', assigned: ['MK'], startDate: today(25), endDate: today(26), dependencies: '' },
      { task: 'Repaint front door and trim', room: 'Exterior', category: 'Finishing', status: 'To Do', assigned: ['AJ'], startDate: today(26), endDate: today(28), dependencies: '' },
      // General
      { task: 'Council permit application', room: 'General', category: 'Planning', status: 'Done', assigned: ['AJ'], startDate: today(-30), endDate: today(-20), dependencies: '' },
      { task: 'Skip bin and waste removal', room: 'General', category: 'Planning', status: 'In Progress', assigned: ['MK'], startDate: today(-21), endDate: today(28), dependencies: '' },
      { task: 'Final clean and inspection', room: 'General', category: 'Planning', status: 'To Do', assigned: ['AJ', 'MK', 'RL'], startDate: today(30), endDate: today(32), dependencies: '' },
    ],
  },
  {
    id: 'budget',
    label: 'Budget',
    icon: '💰',
    tasks: [
      { task: 'Flooring materials', room: 'Materials', category: 'Planning', status: 'To Do', assigned: [], startDate: today(0), endDate: today(7), dependencies: '' },
      { task: 'Plumbing fixtures', room: 'Materials', category: 'Planning', status: 'To Do', assigned: [], startDate: today(0), endDate: today(7), dependencies: '' },
      { task: 'Electrician', room: 'Labour', category: 'Trade', status: 'To Do', assigned: [], startDate: today(7), endDate: today(14), dependencies: '' },
      { task: 'Plumber', room: 'Labour', category: 'Trade', status: 'To Do', assigned: [], startDate: today(7), endDate: today(14), dependencies: '' },
      { task: 'Unexpected repairs', room: 'Contingency', category: 'Planning', status: 'To Do', assigned: [], startDate: today(0), endDate: today(60), dependencies: '' },
      { task: 'Council permits', room: 'Contingency', category: 'Planning', status: 'To Do', assigned: [], startDate: today(0), endDate: today(30), dependencies: '' },
    ],
  },
  {
    id: 'todo',
    label: 'To Do list',
    icon: '✅',
    tasks: [
      { task: 'Fix leaking tap', room: 'Bathroom', category: 'Trade', status: 'To Do', assigned: [], startDate: today(0), endDate: today(3), dependencies: '' },
      { task: 'Repaint front door', room: 'Exterior', category: 'Finishing', status: 'To Do', assigned: [], startDate: today(3), endDate: today(5), dependencies: '' },
      { task: 'Service air conditioner', room: 'Living', category: 'Trade', status: 'To Do', assigned: [], startDate: today(7), endDate: today(7), dependencies: '' },
      { task: 'Clean gutters', room: 'Exterior', category: 'Finishing', status: 'To Do', assigned: [], startDate: today(14), endDate: today(14), dependencies: '' },
      { task: 'Replace smoke alarms', room: 'Living', category: 'Planning', status: 'To Do', assigned: [], startDate: today(5), endDate: today(5), dependencies: '' },
      { task: 'Garden tidy', room: 'Exterior', category: 'Finishing', status: 'To Do', assigned: [], startDate: today(21), endDate: today(28), dependencies: '' },
    ],
  },
];

export function shouldShowOnboarding() {
  return !hasVisited();
}

export function showOnboarding(onFinish) {
  const colors = { primary1: '#00E3FF', secondary1: null, secondary2: null };
  let selectedColor = '#00E3FF';
  let selectedTemplateId = null;
  let droppedFile = null;
  let step = 1;

  const overlay = document.createElement('div');
  overlay.className = 'onboarding-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'onboarding-dialog';
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  function dots(active) {
    return `<div class="ob-dots">
      <span class="ob-dot${active === 1 ? ' active' : ''}"></span>
      <span class="ob-dot${active === 2 ? ' active' : ''}"></span>
      <span class="ob-dot${active === 3 ? ' active' : ''}"></span>
    </div>`;
  }

  function buildSwatches(container) {
    PRESETS.forEach(p => {
      const swatch = document.createElement('button');
      swatch.className = 'onboarding-swatch' + (p.hex === selectedColor ? ' active' : '');
      swatch.dataset.hex = p.hex;
      swatch.style.background = p.hex;
      swatch.title = p.label;
      swatch.setAttribute('aria-label', p.label);
      swatch.addEventListener('click', () => selectSwatch(p.hex, container));
      container.appendChild(swatch);
    });

    const plus = document.createElement('button');
    plus.className = 'onboarding-swatch onboarding-swatch-plus';
    plus.title = 'Custom colour';
    plus.setAttribute('aria-label', 'Custom colour');
    plus.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
    plus.addEventListener('click', () => {
      container.querySelectorAll('.onboarding-swatch').forEach(s => s.classList.remove('active'));
      plus.classList.add('active');
      openColorPickerModal({
        title: 'Custom colour',
        initialHex: selectedColor,
        onSave: (hex) => {
          plus.style.background = hex;
          plus.innerHTML = '';
          selectSwatch(hex, container);
          plus.classList.add('active');
          container.querySelectorAll('.onboarding-swatch:not(.onboarding-swatch-plus)').forEach(s => s.classList.remove('active'));
        },
      });
    });
    container.appendChild(plus);
  }

  function selectSwatch(hex, container) {
    selectedColor = hex;
    colors.primary1 = hex;
    applyCustomColors(colors);
    container.querySelectorAll('.onboarding-swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.hex === hex);
    });
    const plus = container.querySelector('.onboarding-swatch-plus');
    if (plus) plus.classList.remove('active');
  }

  function buildDropZone(parent) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv';
    fileInput.style.display = 'none';
    parent.appendChild(fileInput);

    const dropZone = document.createElement('div');
    dropZone.className = 'ob-drop-zone';
    dropZone.innerHTML = `
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      <span>Drop CSV here or click to browse</span>
      <div class="ob-file-name" style="display:none;"></div>
    `;

    const errorEl = document.createElement('div');
    errorEl.className = 'ob-error';
    errorEl.style.display = 'none';

    const actions = document.createElement('div');
    actions.className = 'ob-import-actions';

    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'modal-btn modal-save';
    uploadBtn.textContent = 'Upload';
    uploadBtn.style.display = 'none';
    actions.appendChild(uploadBtn);

    function onFileChosen(file) {
      if (!file) return;
      droppedFile = file;
      dropZone.querySelector('.ob-file-name').textContent = file.name;
      dropZone.querySelector('.ob-file-name').style.display = '';
      uploadBtn.style.display = '';
      errorEl.style.display = 'none';
    }

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => onFileChosen(fileInput.files[0]));

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      onFileChosen(e.dataTransfer.files[0]);
    });

    uploadBtn.addEventListener('click', async () => {
      if (!droppedFile) return;
      try {
        const text = await droppedFile.text();
        importCSV(text); // validate — throws on bad CSV
        errorEl.style.display = 'none';
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = '';
        droppedFile = null;
        return;
      }
    });

    parent.appendChild(dropZone);
    parent.appendChild(errorEl);
    parent.appendChild(actions);
  }

  function buildTemplateList(container) {
    TEMPLATES.forEach(tpl => {
      const item = document.createElement('button');
      item.className = 'ob-template-item' + (selectedTemplateId === tpl.id ? ' selected' : '');
      item.innerHTML = `<span class="ob-template-icon">${tpl.icon}</span><span class="ob-template-label">${tpl.label}</span>`;
      item.addEventListener('click', () => {
        selectedTemplateId = selectedTemplateId === tpl.id ? null : tpl.id;
        container.querySelectorAll('.ob-template-item').forEach(el => el.classList.remove('selected'));
        if (selectedTemplateId) item.classList.add('selected');
      });
      container.appendChild(item);
    });
  }

  async function finish() {
    saveCustomColors(colors);
    applyCustomColors(colors);
    markVisited();

    let projectId = null;

    if (droppedFile) {
      try {
        const text = await droppedFile.text();
        const tasks = importCSV(text);
        projectId = crypto.randomUUID();
        const projects = loadProjects();
        projects.push({ id: projectId, name: droppedFile.name.replace(/\.csv$/i, ''), tasks });
        saveProjects(projects);
        saveActiveProjectId(projectId);
      } catch (err) {
        // Fall through to template or sheet
      }
    }

    if (!projectId && selectedTemplateId) {
      const tpl = TEMPLATES.find(t => t.id === selectedTemplateId);
      projectId = crypto.randomUUID();
      const tasks = tpl.tasks.map(t => ({ ...t, id: crypto.randomUUID(), updatedAt: Date.now() }));
      const projects = loadProjects();
      projects.push({ id: projectId, name: tpl.label, tasks });
      saveProjects(projects);
      saveActiveProjectId(projectId);
    }

    overlay.remove();
    if (onFinish) onFinish(projectId || 'sheet');
  }

  function renderStep(n) {
    step = n;
    dialog.innerHTML = '';

    if (n === 1) {
      dialog.innerHTML = `
        ${dots(1)}
        <div class="ob-mascot-wrap">
          <img src="images/mascot-trash.png" class="ob-mascot" alt="">
        </div>
        <h2 class="ob-title">Welcome to Qp!</h2>
        <p class="ob-intro">Let's get your planner set up in 3 quick steps.</p>
        <div class="onboarding-swatches ob-swatches"></div>
        <div class="ob-footer">
          <button class="modal-btn modal-save ob-next">Next →</button>
        </div>
      `;
      buildSwatches(dialog.querySelector('.ob-swatches'));
      dialog.querySelector('.ob-next').addEventListener('click', () => renderStep(2));

    } else if (n === 2) {
      dialog.innerHTML = `
        ${dots(2)}
        <h2 class="ob-title">Choose a template</h2>
        <div class="ob-template-list"></div>
        <div class="ob-footer">
          <button class="modal-btn modal-cancel ob-back">← Back</button>
          <button class="modal-btn modal-cancel ob-skip">Skip</button>
          <button class="modal-btn modal-save ob-next">Next →</button>
        </div>
      `;
      buildTemplateList(dialog.querySelector('.ob-template-list'));
      dialog.querySelector('.ob-back').addEventListener('click', () => renderStep(1));
      dialog.querySelector('.ob-skip').addEventListener('click', () => { selectedTemplateId = null; renderStep(3); });
      dialog.querySelector('.ob-next').addEventListener('click', () => renderStep(3));

    } else if (n === 3) {
      dialog.innerHTML = `
        ${dots(3)}
        <h2 class="ob-title">Import data</h2>
        <p class="ob-intro">Optionally import a CSV file to load your own data.</p>
        <div class="ob-drop-wrap"></div>
        <div class="ob-footer">
          <button class="modal-btn modal-cancel ob-back">← Back</button>
          <button class="modal-btn modal-save ob-finish">Finish</button>
        </div>
      `;
      buildDropZone(dialog.querySelector('.ob-drop-wrap'));
      dialog.querySelector('.ob-back').addEventListener('click', () => renderStep(2));
      dialog.querySelector('.ob-finish').addEventListener('click', finish);
    }
  }

  renderStep(1);
}
