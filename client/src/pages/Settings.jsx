// Tabbed Settings page.
// Today: School (Phase 1) + Billing (Phase 2) + Templates (link to Messages).
// Future tabs: Notifications, Branding, Privacy, Integrations.

import { useEffect, useState } from 'react';
import {
  School,
  IndianRupee,
  MessageSquare,
  Save,
  Loader2,
  Phone,
  Mail,
  MapPin,
  Type,
  PenLine,
  CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Loader from '../components/Loader';
import TemplatesEditor from '../components/TemplatesEditor';

// Shape of the settings object we round-trip with the backend. Keys must
// match the whitelist in functions/api/routes/settings.js.
const EMPTY_SETTINGS = {
  'school.name': '',
  'school.signature': '',
  'school.contact_phone': '',
  'school.contact_email': '',
  'school.address': '',
  'billing.default_online_fee': '',
  'billing.default_offline_fee': '',
  'billing.default_group_fee': '',
  'billing.default_min_classes': '',
};

const TABS = [
  { id: 'school',    label: 'School',    icon: School },
  { id: 'billing',   label: 'Billing',   icon: IndianRupee },
  { id: 'templates', label: 'Templates', icon: MessageSquare },
];

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_SETTINGS);
  const [savedNotice, setSavedNotice] = useState(false);
  const [activeTab, setActiveTab] = useState('school');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { settings } = await api.get('/settings/app');
        if (cancelled) return;
        setForm({ ...EMPTY_SETTINGS, ...(settings || {}) });
      } catch (e) {
        toast.error('Failed to load settings: ' + e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const set = (key) => (e) => {
    const v = e?.target?.value ?? e;
    setForm((f) => ({ ...f, [key]: v }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      // Only send the keys that belong to the active concern, but easier
      // to just send them all — backend ignores anything outside its whitelist.
      const { settings } = await api.put('/settings/app', { settings: form });
      setForm({ ...EMPTY_SETTINGS, ...(settings || {}) });
      setSavedNotice(true);
      toast.success('Settings saved');
      setTimeout(() => setSavedNotice(false), 2500);
    } catch (e) {
      toast.error('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader text="Loading settings..." />;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <h2 className="page-header mb-0">Settings</h2>
        <p className="text-sm text-gray-500 mt-1">
          Configure your academy identity, billing defaults, and message wording.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'school'    && <SchoolTab form={form} set={set} />}
      {activeTab === 'billing'   && <BillingTab form={form} set={set} />}
      {activeTab === 'templates' && <TemplatesTab />}

      {/* Save bar (sticky bottom) — visible for School + Billing tabs only */}
      {activeTab !== 'templates' && (
        <div className="sticky bottom-0 -mx-4 lg:-mx-6 px-4 lg:px-6 py-3 bg-white border-t border-gray-200 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {savedNotice && (
              <span className="inline-flex items-center gap-1 text-green-700">
                <CheckCircle2 className="w-3.5 h-3.5" /> Saved
              </span>
            )}
          </span>
          <button
            onClick={handleSave}
            className="btn-primary"
            disabled={saving}
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save changes</>}
          </button>
        </div>
      )}
    </div>
  );
}

// ----- Tabs ------------------------------------------------------------------

function SchoolTab({ form, set }) {
  return (
    <div className="card space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900">School identity</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          These flow into every auto-generated message via the <code>{'{school}'}</code> and
          <code> {'{signature}'}</code> placeholders. Custom templates with hardcoded names
          will keep working unchanged.
        </p>
      </div>
      <Field label="Academy name" icon={Type} hint="Used by templates that include {school}.">
        <input
          type="text"
          value={form['school.name']}
          onChange={set('school.name')}
          className="input-field"
          placeholder="e.g. Veena Dhwani Academy"
        />
      </Field>
      <Field
        label="Signature"
        icon={PenLine}
        hint="Multi-line closing for messages — gets substituted into {signature}. Often the academy name + teacher name."
      >
        <textarea
          value={form['school.signature']}
          onChange={set('school.signature')}
          rows={3}
          className="input-field"
          placeholder="Veena Dhwani Academy"
        />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Contact phone" icon={Phone}>
          <input
            type="tel"
            value={form['school.contact_phone']}
            onChange={set('school.contact_phone')}
            className="input-field"
            placeholder="+91 98765 43210"
          />
        </Field>
        <Field label="Contact email" icon={Mail}>
          <input
            type="email"
            value={form['school.contact_email']}
            onChange={set('school.contact_email')}
            className="input-field"
            placeholder="info@veena.com"
          />
        </Field>
      </div>
      <Field label="Address" icon={MapPin} hint="Used in future receipts + certificates.">
        <textarea
          value={form['school.address']}
          onChange={set('school.address')}
          rows={3}
          className="input-field"
          placeholder="Street, City, State, PIN"
        />
      </Field>
    </div>
  );
}

function BillingTab({ form, set }) {
  return (
    <div className="card space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Billing defaults</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Pre-fills the Add Student form. Leave blank to skip the pre-fill.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Online ₹/hr" icon={IndianRupee}>
          <input
            type="number"
            min="0"
            value={form['billing.default_online_fee']}
            onChange={set('billing.default_online_fee')}
            className="input-field"
            placeholder="500"
          />
        </Field>
        <Field label="Offline ₹/hr" icon={IndianRupee}>
          <input
            type="number"
            min="0"
            value={form['billing.default_offline_fee']}
            onChange={set('billing.default_offline_fee')}
            className="input-field"
            placeholder="700"
          />
        </Field>
        <Field label="Group ₹/hr" icon={IndianRupee}>
          <input
            type="number"
            min="0"
            value={form['billing.default_group_fee']}
            onChange={set('billing.default_group_fee')}
            className="input-field"
            placeholder="350"
          />
        </Field>
        <Field label="Min classes / month" icon={IndianRupee} hint="Fees page flags students below this.">
          <input
            type="number"
            min="0"
            max="31"
            value={form['billing.default_min_classes']}
            onChange={set('billing.default_min_classes')}
            className="input-field"
            placeholder="0 = no minimum"
          />
        </Field>
      </div>
    </div>
  );
}

function TemplatesTab() {
  return <TemplatesEditor />;
}

// ----- Field row ------------------------------------------------------------

function Field({ label, icon: Icon, hint, children }) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">
        {Icon && <Icon className="w-4 h-4 text-gray-400" />}
        {label}
      </span>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </label>
  );
}
