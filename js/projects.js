import { normaliseRows } from './data.js';

const REQUIRED_COLS = ['Room', 'Task', 'Status', 'Category', 'Start date', 'End date', 'Assigned', 'Dependencies'];
const EXPORT_COLS = ['Room', 'Task', 'Status', 'Category', 'Start date', 'End date', 'Assigned', 'Dependencies'];

/**
 * Parse and validate CSV text. Returns normalised task array.
 * Throws with a user-friendly message on bad input.
 */
export function importCSV(text) {
  const { data, errors } = Papa.parse(text, { header: true, skipEmptyLines: true });

  if (errors.length && data.length === 0) {
    throw new Error('Could not parse the file. Make sure it\'s a valid CSV.');
  }
  if (data.length === 0) {
    throw new Error('The file appears to be empty.');
  }

  const headers = Object.keys(data[0]);
  const missing = REQUIRED_COLS.filter(col => !headers.includes(col));
  if (missing.length > 0) {
    throw new Error(`Missing columns: ${missing.join(', ')}.\nIn Google Sheets: File → Download → Comma-separated values (.csv)`);
  }

  return normaliseRows(data);
}

/**
 * Fetch a Google Sheets CSV export URL from a pasted sheet URL.
 * Returns the CSV export URL string or throws if the input isn't recognisable.
 */
export function sheetsUrlToCsvUrl(url) {
  const idMatch = url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) {
    if (url.includes('export?format=csv') || /\.csv(\?|$)/i.test(url)) return url;
    throw new Error('Paste a Google Sheets URL or direct CSV link.');
  }
  const sheetId = idMatch[1];
  const gidMatch = url.match(/[#?&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

function formatDate(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return '';
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

/**
 * Serialise a task array back to CSV and trigger a browser download.
 * Room column is blank after the first row of each room group.
 */
export function exportToCSV(tasks, filename = 'project') {
  let lastRoom = null;

  const rows = tasks.map(t => {
    const roomCell = t.room !== lastRoom ? t.room : '';
    lastRoom = t.room;
    return {
      'Room': roomCell,
      'Task': t.task,
      'Status': t.status,
      'Category': t.category,
      'Start date': formatDate(t.startDate),
      'End date': formatDate(t.endDate),
      'Assigned': t.assigned,
      'Dependencies': t.dependencies,
    };
  });

  const csv = Papa.unparse({ fields: EXPORT_COLS, data: rows });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename.replace(/[^a-z0-9_\- ]/gi, '_')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
