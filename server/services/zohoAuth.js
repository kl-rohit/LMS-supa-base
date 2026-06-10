const { getDb } = require('../db/schema');

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  const db = getDb();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
  `).run(key, value, value);
}

function getAllZohoSettings() {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'zoho_%'").all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

function isZohoEnabled() {
  return getSetting('zoho_sync_enabled') === 'true';
}

function getSpreadsheetId() {
  return getSetting('zoho_spreadsheet_id');
}

async function getAccessToken() {
  if (!isZohoEnabled()) return null;

  const expiry = getSetting('zoho_token_expiry');
  const cachedToken = getSetting('zoho_access_token');

  // If token exists and not expired (with 5 min buffer), return it
  if (cachedToken && expiry && Date.now() < parseInt(expiry) - 300000) {
    return cachedToken;
  }

  // Refresh the token
  const clientId = getSetting('zoho_client_id');
  const clientSecret = getSetting('zoho_client_secret');
  const refreshToken = getSetting('zoho_refresh_token');
  const accountsDomain = getSetting('zoho_accounts_domain') || 'accounts.zoho.in';

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Zoho credentials not configured');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const response = await fetch(`https://${accountsDomain}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(`Zoho auth error: ${data.error}`);
  }

  setSetting('zoho_access_token', data.access_token);
  setSetting('zoho_token_expiry', String(Date.now() + (data.expires_in || 3600) * 1000));

  return data.access_token;
}

// Test the connection by attempting a token refresh
async function testConnection() {
  const clientId = getSetting('zoho_client_id');
  const clientSecret = getSetting('zoho_client_secret');
  const refreshToken = getSetting('zoho_refresh_token');
  const accountsDomain = getSetting('zoho_accounts_domain') || 'accounts.zoho.in';

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing credentials: Client ID, Client Secret, and Refresh Token are required');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const response = await fetch(`https://${accountsDomain}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(`Connection failed: ${data.error}`);
  }

  // Cache the token
  setSetting('zoho_access_token', data.access_token);
  setSetting('zoho_token_expiry', String(Date.now() + (data.expires_in || 3600) * 1000));

  return { success: true, message: 'Connected to Zoho successfully!' };
}

module.exports = {
  getSetting,
  setSetting,
  getAllZohoSettings,
  isZohoEnabled,
  getSpreadsheetId,
  getAccessToken,
  testConnection,
};
