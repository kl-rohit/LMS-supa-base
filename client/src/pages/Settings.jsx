import { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Copy,
  Eye,
  EyeOff,
  Database,
  Cloud,
  Zap,
  HelpCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Loader from '../components/Loader';

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [syncResults, setSyncResults] = useState(null);
  const [status, setStatus] = useState(null);

  const [form, setForm] = useState({
    zoho_client_id: '',
    zoho_client_secret: '',
    zoho_refresh_token: '',
    zoho_domain: 'sheet.zoho.in',
    zoho_accounts_domain: 'accounts.zoho.in',
    zoho_sync_enabled: 'false',
    zoho_spreadsheet_id: '',
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const [settingsData, statusData] = await Promise.all([
        api.get('/settings/zoho'),
        api.get('/settings/zoho/status'),
      ]);
      const s = settingsData.settings || {};
      setForm({
        zoho_client_id: s.zoho_client_id || '',
        zoho_client_secret: s.zoho_client_secret || '',
        zoho_refresh_token: s.zoho_refresh_token || '',
        zoho_domain: s.zoho_domain || 'sheet.zoho.in',
        zoho_accounts_domain: s.zoho_accounts_domain || 'accounts.zoho.in',
        zoho_sync_enabled: s.zoho_sync_enabled || 'false',
        zoho_spreadsheet_id: s.zoho_spreadsheet_id || '',
      });
      setStatus(statusData);
    } catch (err) {
      toast.error('Failed to load settings: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.put('/settings/zoho', form);
      toast.success('Settings saved');
      fetchSettings();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    try {
      setTesting(true);
      const result = await api.post('/settings/zoho/test');
      toast.success(result.message || 'Connection successful!');
      fetchSettings();
    } catch (err) {
      toast.error(err.message || 'Connection failed');
    } finally {
      setTesting(false);
    }
  };

  const handleCreateSpreadsheet = async () => {
    try {
      setCreating(true);
      const result = await api.post('/settings/zoho/create-spreadsheet', {
        name: 'Veena Student Tracker',
      });
      toast.success(`Spreadsheet created with ${result.sheets_created?.length || 0} tabs`);
      fetchSettings();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleSyncAll = async () => {
    try {
      setSyncing(true);
      setSyncResults(null);
      const result = await api.post('/settings/zoho/sync-all');
      setSyncResults(result.results);
      toast.success('Full sync completed!');
      fetchSettings();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const domainOptions = [
    { value: 'sheet.zoho.in', accountsDomain: 'accounts.zoho.in', label: 'India (.in)' },
    { value: 'sheet.zoho.com', accountsDomain: 'accounts.zoho.com', label: 'US (.com)' },
    { value: 'sheet.zoho.eu', accountsDomain: 'accounts.zoho.eu', label: 'Europe (.eu)' },
    { value: 'sheet.zoho.com.au', accountsDomain: 'accounts.zoho.com.au', label: 'Australia (.com.au)' },
  ];

  const handleDomainChange = (domain) => {
    const selected = domainOptions.find((d) => d.value === domain);
    setForm({
      ...form,
      zoho_domain: domain,
      zoho_accounts_domain: selected?.accountsDomain || 'accounts.zoho.in',
    });
  };

  const isConfigured = form.zoho_client_id && form.zoho_client_secret && form.zoho_refresh_token;
  const hasSpreadsheet = !!form.zoho_spreadsheet_id && form.zoho_spreadsheet_id !== '';
  const isEnabled = form.zoho_sync_enabled === 'true';

  if (loading) return <Loader text="Loading settings..." />;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
          <Cloud className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">Zoho Sheets Sync</h2>
          <p className="text-sm text-gray-500">Auto-sync your data to Zoho Spreadsheets</p>
        </div>
        <div className="ml-auto">
          {isEnabled && hasSpreadsheet ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
              <CheckCircle className="w-4 h-4" /> Active
            </span>
          ) : isConfigured ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm font-medium">
              <AlertCircle className="w-4 h-4" /> Configured
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-100 text-gray-500 rounded-full text-sm font-medium">
              <AlertCircle className="w-4 h-4" /> Not Set Up
            </span>
          )}
        </div>
      </div>

      {/* Setup Guide */}
      <div className="card">
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-indigo-500" />
            <span className="font-semibold text-gray-900">Setup Guide</span>
            <span className="text-xs text-gray-400">(click to {showGuide ? 'hide' : 'expand'})</span>
          </div>
          {showGuide ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </button>

        {showGuide && (
          <div className="mt-4 space-y-4 text-sm text-gray-700">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-semibold text-blue-800 mb-2">Step 1: Create Zoho API Application</h4>
              <ol className="list-decimal ml-4 space-y-1">
                <li>
                  Go to{' '}
                  <a
                    href="https://api-console.zoho.in/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline"
                  >
                    Zoho API Console <ExternalLink className="w-3 h-3 inline" />
                  </a>
                </li>
                <li>Click <strong>"Add Client"</strong> → select <strong>"Server-based Applications"</strong></li>
                <li>Enter App Name: <code className="bg-blue-100 px-1 rounded">Veena Student Tracker</code></li>
                <li>Homepage URL: Your app URL (or <code className="bg-blue-100 px-1 rounded">http://localhost:3001</code>)</li>
                <li>Redirect URI: <code className="bg-blue-100 px-1 rounded">https://api-console.zoho.in</code></li>
                <li>Note down the <strong>Client ID</strong> and <strong>Client Secret</strong></li>
              </ol>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h4 className="font-semibold text-amber-800 mb-2">Step 2: Generate Refresh Token</h4>
              <ol className="list-decimal ml-4 space-y-1">
                <li>In API Console, go to your app → click <strong>"Self Client"</strong> tab</li>
                <li>
                  Enter Scope:{' '}
                  <code className="bg-amber-100 px-1 rounded text-xs">
                    ZohoSheet.dataAPI.UPDATE,ZohoSheet.dataAPI.READ
                  </code>
                  <button
                    type="button"
                    onClick={() => copyToClipboard('ZohoSheet.dataAPI.UPDATE,ZohoSheet.dataAPI.READ')}
                    className="ml-1 text-amber-600 hover:text-amber-700"
                  >
                    <Copy className="w-3 h-3 inline" />
                  </button>
                </li>
                <li>Set Duration to <strong>10 minutes</strong>, click <strong>"Create"</strong></li>
                <li>Copy the <strong>Authorization Code</strong></li>
                <li>
                  Make a POST request (use curl or Postman):
                  <pre className="bg-gray-800 text-green-400 p-2 rounded mt-1 text-xs overflow-x-auto">
{`POST https://accounts.zoho.in/oauth/v2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET
&code=YOUR_AUTHORIZATION_CODE`}
                  </pre>
                </li>
                <li>
                  Copy the <strong>refresh_token</strong> from the response (it does not expire)
                </li>
              </ol>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h4 className="font-semibold text-green-800 mb-2">Step 3: Configure Below</h4>
              <ol className="list-decimal ml-4 space-y-1">
                <li>Paste Client ID, Client Secret, and Refresh Token below</li>
                <li>Click <strong>"Save & Test Connection"</strong></li>
                <li>Click <strong>"Create Spreadsheet"</strong> to auto-create the Zoho Sheet</li>
                <li>Enable sync and click <strong>"Sync All Data"</strong></li>
              </ol>
            </div>
          </div>
        )}
      </div>

      {/* Credentials Form */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <SettingsIcon className="w-5 h-5 text-gray-600" />
          <h3 className="font-semibold text-gray-900">API Credentials</h3>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Region</label>
            <select
              value={form.zoho_domain}
              onChange={(e) => handleDomainChange(e.target.value)}
              className="select-field"
            >
              {domainOptions.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label} — {d.value}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
            <input
              type="text"
              value={form.zoho_client_id}
              onChange={(e) => setForm({ ...form, zoho_client_id: e.target.value })}
              className="input-field"
              placeholder="1000.XXXXXXXXXXXXXXXX..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={form.zoho_client_secret}
                onChange={(e) => setForm({ ...form, zoho_client_secret: e.target.value })}
                className="input-field pr-10"
                placeholder="Enter client secret..."
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Refresh Token</label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={form.zoho_refresh_token}
                onChange={(e) => setForm({ ...form, zoho_refresh_token: e.target.value })}
                className="input-field pr-10"
                placeholder="1000.XXXXXXXXXXXXXXXX..."
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-2">
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : 'Save Credentials'}
            </button>
            <button
              onClick={handleTest}
              disabled={testing || !isConfigured}
              className="btn-secondary"
            >
              <Zap className="w-4 h-4" />
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
          </div>
        </div>
      </div>

      {/* Spreadsheet Management */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Database className="w-5 h-5 text-gray-600" />
          <h3 className="font-semibold text-gray-900">Spreadsheet</h3>
        </div>

        {hasSpreadsheet ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Spreadsheet ID:</span>
              <code className="text-sm bg-gray-100 px-2 py-1 rounded font-mono">
                {form.zoho_spreadsheet_id}
              </code>
              <button
                onClick={() => copyToClipboard(form.zoho_spreadsheet_id)}
                className="text-gray-400 hover:text-gray-600"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`https://${form.zoho_domain?.replace('sheet.', '')}/sheet/open/${form.zoho_spreadsheet_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary btn-sm"
              >
                <ExternalLink className="w-4 h-4" /> Open in Zoho
              </a>
              <button
                onClick={handleCreateSpreadsheet}
                disabled={creating}
                className="btn-secondary btn-sm text-amber-600 border-amber-200 hover:bg-amber-50"
              >
                {creating ? 'Creating...' : 'Create New Spreadsheet'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              No spreadsheet linked yet. Create one to start syncing.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleCreateSpreadsheet}
                disabled={creating || !isConfigured}
                className="btn-primary"
              >
                {creating ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Database className="w-4 h-4" />
                )}
                {creating ? 'Creating...' : 'Create Spreadsheet'}
              </button>
              <span className="text-gray-400 text-sm">or</span>
              <input
                type="text"
                value={form.zoho_spreadsheet_id}
                onChange={(e) => setForm({ ...form, zoho_spreadsheet_id: e.target.value })}
                className="input-field flex-1"
                placeholder="Paste existing spreadsheet ID..."
              />
            </div>
          </div>
        )}
      </div>

      {/* Sync Controls */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <RefreshCw className="w-5 h-5 text-gray-600" />
          <h3 className="font-semibold text-gray-900">Sync Controls</h3>
        </div>

        <div className="space-y-4">
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900">Auto-Sync</p>
              <p className="text-sm text-gray-500">
                Automatically push changes to Zoho Sheets
              </p>
            </div>
            <button
              onClick={() => {
                const newVal = form.zoho_sync_enabled === 'true' ? 'false' : 'true';
                setForm({ ...form, zoho_sync_enabled: newVal });
                api.put('/settings/zoho', { zoho_sync_enabled: newVal })
                  .then(() => toast.success(`Sync ${newVal === 'true' ? 'enabled' : 'disabled'}`))
                  .catch((e) => toast.error(e.message));
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                isEnabled ? 'bg-indigo-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Last sync info */}
          {status?.last_full_sync && (
            <div className="text-sm text-gray-500">
              Last full sync:{' '}
              <span className="font-medium text-gray-700">
                {new Date(status.last_full_sync).toLocaleString('en-IN')}
              </span>
            </div>
          )}

          {/* Sync All button */}
          <button
            onClick={handleSyncAll}
            disabled={syncing || !hasSpreadsheet}
            className="btn-primary"
          >
            {syncing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {syncing ? 'Syncing All Data...' : 'Sync All Data Now'}
          </button>

          {/* Sync Results */}
          {syncResults && (
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="font-medium text-gray-900 mb-2">Sync Results</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Object.entries(syncResults).map(([sheet, result]) => (
                  <div
                    key={sheet}
                    className={`px-3 py-2 rounded-lg text-sm ${
                      result.includes('ERROR')
                        ? 'bg-red-100 text-red-700'
                        : 'bg-green-100 text-green-700'
                    }`}
                  >
                    <span className="font-medium">{sheet}:</span> {result}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sheet Info */}
      <div className="card bg-indigo-50 border-indigo-200">
        <h4 className="font-semibold text-indigo-900 mb-2">Sheets Created in Zoho</h4>
        <div className="flex flex-wrap gap-2">
          {['Students', 'Groups', 'Classes', 'Attendance', 'Fees', 'Messages'].map((name) => (
            <span
              key={name}
              className="inline-flex items-center px-3 py-1 bg-white border border-indigo-200 rounded-full text-sm text-indigo-700 font-medium"
            >
              {name}
            </span>
          ))}
        </div>
        <p className="text-xs text-indigo-500 mt-2">
          These 6 tabs are auto-created in your Zoho Spreadsheet. Data syncs in real-time on every change.
        </p>
      </div>
    </div>
  );
}
