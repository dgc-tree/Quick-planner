const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1MCVKPY56Ynqb7O3cMmm3vfSZ7zI9QJhhKnI29H3pk8U/export?format=csv&gid=0';

export async function fetchSheetData() {
  const res = await fetch(SHEET_CSV_URL);
  if (!res.ok) throw new Error(`Failed to fetch sheet: ${res.status}`);
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  return normaliseRows(parsed.data);
}

function normaliseRows(rows) {
  let currentRoom = '';
  return rows.map((row, i) => {
    const room = (row['Room'] || '').trim();
    if (room) currentRoom = room;

    return {
      id: i,
      room: currentRoom,
      status: (row['Status'] || '').trim(),
      task: (row['Task'] || '').trim(),
      dependencies: (row['Dependencies'] || '').trim(),
      category: (row['Category'] || '').trim(),
      startDate: parseDate(row['Start date']),
      endDate: parseDate(row['End date']),
      assigned: (row['Assigned'] || '').trim(),
    };
  }).filter(t => t.task);
}

function parseDate(str) {
  if (!str || !str.trim()) return null;
  const parts = str.trim().split('/');
  if (parts.length !== 2) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  if (isNaN(day) || isNaN(month)) return null;
  return new Date(new Date().getFullYear(), month - 1, day);
}
