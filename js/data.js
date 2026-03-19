const ASSIGNED_ALIAS = { 'Dave': 'DG', 'Simone': 'SG', 'Simona': 'SG' };

export function normaliseRows(rows) {
  let currentRoom = '';
  return rows.map((row, i) => {
    const room = (row['Room'] || '').trim();
    if (room) currentRoom = room;
    const rawAssigned = (row['Assigned'] || '').trim();
    const assignedArr = rawAssigned
      ? rawAssigned.split(',').map(s => s.trim()).filter(Boolean).map(s => ASSIGNED_ALIAS[s] || s)
      : [];

    const rawCost = (row['Cost'] || '').trim().replace(/[$,]/g, '');
    return {
      id: crypto.randomUUID(),
      room: currentRoom,
      status: (row['Status'] || '').trim() === 'Backlog' ? 'To Do' : (row['Status'] || '').trim(),
      task: (row['Task'] || '').trim(),
      dependencies: (row['Dependencies'] || '').trim(),
      category: (row['Category'] || '').trim(),
      startDate: parseDate(row['Start date']),
      endDate: parseDate(row['End date']),
      assigned: assignedArr,
      notes: (row['Notes'] || '').trim(),
      cost: rawCost ? parseFloat(rawCost) || null : null,
      contact: (row['Contact'] || '').trim(),
      updatedAt: Date.now(),
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
