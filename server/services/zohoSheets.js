const { getAccessToken, getSetting } = require('./zohoAuth');

async function apiRequest(method, path, body = null) {
  const token = await getAccessToken();
  if (!token) return null;

  const domain = getSetting('zoho_domain') || 'sheet.zoho.in';
  const url = `https://${domain}/api/v2${path}`;

  const options = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, status: response.status };
  }
}

// Create a new spreadsheet with given name
async function createSpreadsheet(name) {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated');

  const domain = getSetting('zoho_domain') || 'sheet.zoho.in';
  const response = await fetch(`https://${domain}/api/v2/spreadsheets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ spreadsheet_name: name }),
  });

  const data = await response.json();
  if (data.error) throw new Error(`Failed to create spreadsheet: ${JSON.stringify(data.error)}`);
  return data;
}

// Add a new sheet (tab) to an existing spreadsheet
async function addSheet(spreadsheetId, sheetName) {
  return apiRequest('POST', `/${spreadsheetId}/sheets`, { name: sheetName });
}

// Delete the default "Sheet1" tab
async function deleteSheet(spreadsheetId, sheetName) {
  return apiRequest('DELETE', `/${spreadsheetId}/sheets/${encodeURIComponent(sheetName)}`);
}

// Add header row to a sheet
async function addHeaderRow(spreadsheetId, sheetName, columns) {
  const headerRow = {};
  columns.forEach((col, idx) => {
    headerRow[col] = col;
  });
  return apiRequest('POST', `/${spreadsheetId}/sheets/${encodeURIComponent(sheetName)}/headerrow`, {
    data: [headerRow],
  });
}

// Add data rows to a sheet
async function addRows(spreadsheetId, sheetName, rows) {
  if (!rows || rows.length === 0) return null;
  return apiRequest('POST', `/${spreadsheetId}/sheets/${encodeURIComponent(sheetName)}/records`, {
    data: rows,
  });
}

// Update a row by criteria (typically "id = <value>")
async function updateRow(spreadsheetId, sheetName, criteria, data) {
  return apiRequest('PUT', `/${spreadsheetId}/sheets/${encodeURIComponent(sheetName)}/records`, {
    criteria,
    data,
  });
}

// Delete rows by criteria
async function deleteRow(spreadsheetId, sheetName, criteria) {
  const token = await getAccessToken();
  if (!token) return null;

  const domain = getSetting('zoho_domain') || 'sheet.zoho.in';
  const url = `https://${domain}/api/v2/${spreadsheetId}/sheets/${encodeURIComponent(sheetName)}/records?criteria=${encodeURIComponent(criteria)}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, status: response.status };
  }
}

// Clear all data rows in a sheet (keep headers)
async function clearSheet(spreadsheetId, sheetName) {
  return apiRequest('DELETE', `/${spreadsheetId}/sheets/${encodeURIComponent(sheetName)}/records?criteria=id>0`);
}

// Get all rows from a sheet
async function getRows(spreadsheetId, sheetName) {
  return apiRequest('GET', `/${spreadsheetId}/sheets/${encodeURIComponent(sheetName)}/records`);
}

module.exports = {
  createSpreadsheet,
  addSheet,
  deleteSheet,
  addHeaderRow,
  addRows,
  updateRow,
  deleteRow,
  clearSheet,
  getRows,
};
