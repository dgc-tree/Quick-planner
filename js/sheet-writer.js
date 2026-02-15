const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxX0jgm7L7d4ekAPnA9Zi82WEiF4YlXiyDMVhBphdHRdIK-7YXqFPybR_QXGe_SMrW0BQ/exec';

/**
 * Push field updates for a task back to the Google Sheet.
 * Uses GET with encoded JSON to avoid CORS issues with Apps Script.
 * @param {string} taskName — the Task column value (used to find the row)
 * @param {object} updates  — e.g. { status: 'Done', assigned: 'Sim' }
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateTask(taskName, updates) {
  if (!SCRIPT_URL) {
    console.warn('Sheet write-back disabled — set SCRIPT_URL in js/sheet-writer.js');
    return { success: false, error: 'SCRIPT_URL not configured' };
  }

  const payload = encodeURIComponent(JSON.stringify({ task: taskName, updates }));
  const url = `${SCRIPT_URL}?data=${payload}`;

  const res = await fetch(url, { redirect: 'follow' });

  if (!res.ok) {
    throw new Error(`Sheet update failed: ${res.status}`);
  }

  return res.json();
}
