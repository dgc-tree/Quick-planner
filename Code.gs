/**
 * Google Apps Script for Quick Planner write-back.
 *
 * Deploy as: Web app → Execute as: Me → Access: Anyone
 * Copy the deployment URL into js/sheet-writer.js
 */

function doGet(e) {
  // GET handler — used for both testing and actual updates
  // Test: visit the URL in browser with ?test=1
  // Update: called by sheet-writer.js with ?data=<encoded JSON>
  try {
    var params = e.parameter || {};

    if (params.test) {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheets()[0];
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      return respond({
        success: true,
        message: 'Script is working',
        sheetName: sheet.getName(),
        headers: headers,
        rows: sheet.getLastRow() - 1
      });
    }

    if (params.data) {
      var body = JSON.parse(decodeURIComponent(params.data));
      return processUpdate(body);
    }

    return respond({ success: false, error: 'No data parameter provided' });
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    return processUpdate(body);
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

function processUpdate(body) {
  var taskName = body.task;
  if (!taskName) {
    return respond({ success: false, error: 'Missing task identifier' });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var taskCol = headers.indexOf('Task');
  if (taskCol === -1) {
    return respond({ success: false, error: 'Task column not found in headers: ' + headers.join(', ') });
  }

  // Find the row matching the task name
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][taskCol]).trim() === taskName) {
      rowIndex = i + 1; // 1-based for sheet API
      break;
    }
  }

  if (rowIndex === -1) {
    return respond({ success: false, error: 'Task not found: ' + taskName });
  }

  // Map of field names to sheet column headers
  var fieldMap = {
    'task':         'Task',
    'category':     'Category',
    'assigned':     'Assigned',
    'status':       'Status',
    'startDate':    'Start date',
    'endDate':      'End date',
    'dependencies': 'Dependencies'
  };

  var updates = body.updates || {};
  var updated = [];
  for (var field in updates) {
    if (!updates.hasOwnProperty(field)) continue;
    var colHeader = fieldMap[field];
    if (!colHeader) continue;
    var colIndex = headers.indexOf(colHeader);
    if (colIndex === -1) continue;
    sheet.getRange(rowIndex, colIndex + 1).setValue(updates[field]);
    updated.push(colHeader + ' = ' + updates[field]);
  }

  return respond({ success: true, row: rowIndex, updated: updated });
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
