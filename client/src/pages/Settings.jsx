// Tabbed Settings page.
// Today: School (Phase 1) + Billing (Phase 2) + Templates (link to Messages).
// Future tabs: Notifications, Branding, Privacy, Integrations.

import { useEffect, useRef, useState } from 'react';
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
  ToggleLeft,
  Eye,
  Users as UsersIcon,
  UserPlus,
  Crown,
  Trash2,
  ShieldCheck,
  Camera,
  Image as ImageIcon,
  Palette,
  Sun,
  Moon,
  Check,
  Clock,
  Lock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Loader from '../components/Loader';
import TemplatesEditor from '../components/TemplatesEditor';
import { useConfirm } from '../contexts/ConfirmContext';
import { invalidateOrgBranding } from '../hooks/useOrgBranding';
import { PRESETS, presetSwatch, applyTheme, saveTheme } from '../utils/theme';
import { DAY_NAMES, parseWorkingHours, serializeWorkingHours } from '../utils/workingHours';

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
  // Modules — string-encoded booleans ('true' / 'false').
  'modules.lessons':        'true',
  'modules.fees':           'true',
  'modules.messages':       'true',
  'modules.reports':        'true',
  'modules.camps':          'false',
  'modules.groups':         'true',
  'modules.student_photos': 'true',
  'modules.assignments':    'false',
  'modules.question_papers':'false',
  'portal.show_lessons':       'true',
  'portal.show_fees':          'true',
  'portal.allow_profile_edit': 'true',
  // Appearance — accent theme ('default' | preset id | '#hex') + light/dark.
  'appearance.accent': 'default',
  'appearance.mode':   'light',
  // Working hours — JSON array (see utils/workingHours.js). Empty → defaults.
  'schedule.working_hours': '',
};

const TABS = [
  { id: 'school',       label: 'School',       icon: School },
  { id: 'schedule',     label: 'Working hours',icon: Clock },
  { id: 'appearance',   label: 'Appearance',   icon: Palette },
  { id: 'billing',      label: 'Billing',      icon: IndianRupee },
  { id: 'modules',      label: 'Modules',      icon: ToggleLeft },
  { id: 'templates',    label: 'Templates',    icon: MessageSquare },
  { id: 'organization', label: 'Organization', icon: ShieldCheck },
];

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_SETTINGS);
  const [savedNotice, setSavedNotice] = useState(false);
  const [activeTab, setActiveTab] = useState('school');
  const [plan, setPlan] = useState('complete');         // grandfather default
  const [entitlements, setEntitlements] = useState({}); // { lessons: bool, ... }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/settings/app');
        const settings = res?.settings;
        if (cancelled) return;
        if (res?.plan) setPlan(res.plan);
        if (res?.entitlements) setEntitlements(res.entitlements);
        const merged = { ...EMPTY_SETTINGS, ...(settings || {}) };
        setForm(merged);
        // Reconcile the server's saved appearance with this device: apply it
        // and cache it so the theme follows the academy across devices.
        const theme = { accent: merged['appearance.accent'], mode: merged['appearance.mode'] };
        applyTheme(theme);
        saveTheme(theme);
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
      const res = await api.put('/settings/app', { settings: form });
      const settings = res?.settings;
      if (res?.entitlements) setEntitlements(res.entitlements);
      if (res?.plan) setPlan(res.plan);
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
        <nav className="-mb-px flex flex-wrap gap-x-1 gap-y-0">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-indigo-600 text-indigo-700 dark:text-white'
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
      {activeTab === 'school'       && <SchoolTab form={form} set={set} />}
      {activeTab === 'schedule'     && <ScheduleTab form={form} setForm={setForm} />}
      {activeTab === 'appearance'   && <AppearanceTab form={form} setForm={setForm} />}
      {activeTab === 'billing'      && <BillingTab form={form} set={set} />}
      {activeTab === 'modules'      && <ModulesTab form={form} set={set} plan={plan} entitlements={entitlements} />}
      {activeTab === 'templates'    && <TemplatesTab />}
      {activeTab === 'organization' && <OrganizationTab />}

      {/* Save bar (sticky bottom) — hidden for tabs that own their own UI */}
      {activeTab !== 'templates' && activeTab !== 'organization' && (
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
          placeholder="e.g. Saraswati Music Academy"
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
          placeholder="Saraswati Music Academy"
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
            placeholder="info@academy.com"
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

function ScheduleTab({ form, setForm }) {
  // The 7-day array is derived from the JSON string in `form`. Every edit
  // writes the serialized JSON straight back so the shared bottom Save bar
  // persists it with the rest of the settings.
  const days = parseWorkingHours(form['schedule.working_hours']);

  const writeBack = (next) => {
    setForm((f) => ({ ...f, 'schedule.working_hours': serializeWorkingHours(next) }));
  };
  const updateDay = (idx, patch) => {
    const next = days.map((d, i) => (i === idx ? { ...d, ...patch } : d));
    writeBack(next);
  };
  // Copy one day's open-window to every other OPEN day — quick way to set all
  // weekdays/weekends at once after configuring a representative day.
  const applyToAll = (idx) => {
    const src = days[idx];
    writeBack(days.map((d) => ({ ...d, start: src.start, end: src.end })));
  };

  return (
    <div className="card space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Working hours</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Set the hours you teach on each day. The Classes timetable only shows
          this range — hours outside it are greyed out, and days marked closed
          are shaded entirely. This is a visual guide; you can still add a class
          at any time.
        </p>
      </div>

      <div className="space-y-1.5">
        {days.map((d, idx) => (
          <div
            key={idx}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 px-3 -mx-3 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {/* Open / closed toggle */}
            <button
              type="button"
              onClick={() => updateDay(idx, { open: !d.open })}
              className="flex items-center gap-2.5 w-36 flex-shrink-0 text-left"
              title={d.open ? 'Open — click to close' : 'Closed — click to open'}
            >
              <span className={`flex-shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors ${d.open ? 'bg-indigo-600' : 'bg-gray-300'}`}>
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${d.open ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </span>
              <span className="text-sm font-medium text-gray-900">{DAY_NAMES[idx]}</span>
            </button>

            {d.open ? (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <input
                  type="time"
                  value={d.start}
                  onChange={(e) => updateDay(idx, { start: e.target.value })}
                  className="input-field w-auto py-1.5"
                />
                <span className="text-gray-400 text-sm">to</span>
                <input
                  type="time"
                  value={d.end}
                  onChange={(e) => updateDay(idx, { end: e.target.value })}
                  className="input-field w-auto py-1.5"
                />
                <button
                  type="button"
                  onClick={() => applyToAll(idx)}
                  className="ml-auto text-xs text-indigo-600 hover:text-indigo-700 font-medium whitespace-nowrap"
                  title="Copy these hours to every day"
                >
                  Apply to all
                </button>
              </div>
            ) : (
              <span className="text-sm text-gray-400">Closed</span>
            )}
          </div>
        ))}
      </div>
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

function AppearanceTab({ form, setForm }) {
  const accent = form['appearance.accent'] || 'default';
  const mode = form['appearance.mode'] || 'light';

  // Apply changes live (instant preview) AND cache to localStorage so the look
  // survives a reload even before the user hits Save (which persists to the
  // backend for cross-device sync). The bottom Save bar sends `form`, which
  // already carries these keys.
  const update = (patch) => {
    const next = {
      accent: patch.accent !== undefined ? patch.accent : accent,
      mode: patch.mode !== undefined ? patch.mode : mode,
    };
    setForm((f) => ({ ...f, 'appearance.accent': next.accent, 'appearance.mode': next.mode }));
    applyTheme(next);
    saveTheme(next);
  };

  const isCustom = accent !== 'default' && !PRESETS.some((p) => p.id === accent);
  const customValue = isCustom ? accent : '#4f46e5';

  return (
    <div className="space-y-5">
      {/* Theme */}
      <div className="card space-y-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Theme</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Each theme recolours buttons, links, the active sidebar item, and the
            app/browser theme colour with its primary shade. Pick one made for your
            kind of academy — or choose a custom colour below.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {PRESETS.map((p) => {
            const selected = accent === p.id;
            const primary = presetSwatch(p);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => update({ accent: p.id })}
                title={p.desc || p.label}
                className={`relative text-left rounded-xl border p-3 transition-all hover:shadow-sm ${
                  selected
                    ? 'border-transparent ring-2 ring-offset-1 shadow-sm'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                style={selected ? { '--tw-ring-color': primary } : undefined}
              >
                {/* Colour strip: primary (large) + secondary + accent */}
                <span className="flex items-center gap-1.5 mb-2">
                  <span className="h-8 flex-1 rounded-md" style={{ backgroundColor: primary }} />
                  <span className="h-8 w-3 rounded-sm" style={{ backgroundColor: p.secondary }} />
                  <span className="h-8 w-3 rounded-sm" style={{ backgroundColor: p.accent }} />
                </span>
                <span className="flex items-center gap-1.5">
                  {p.emoji && <span aria-hidden className="text-sm leading-none">{p.emoji}</span>}
                  <span className={`text-sm ${selected ? 'text-gray-900 font-semibold' : 'text-gray-700 font-medium'}`}>{p.label}</span>
                  {selected && <Check className="w-4 h-4 ml-auto" style={{ color: primary }} />}
                </span>
              </button>
            );
          })}
        </div>

        <div className="border-t border-gray-100 pt-4">
          <label className="flex items-center gap-3">
            <span
              className={`w-10 h-10 rounded-full flex items-center justify-center ${isCustom ? 'ring-2 ring-offset-2 ring-gray-400' : 'border border-gray-200'}`}
              style={{ backgroundColor: customValue }}
            >
              {isCustom && <Check className="w-5 h-5 text-white" />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-700">Custom colour</span>
              <span className="block text-xs text-gray-500">Pick any colour — the full shade range is generated for you.</span>
            </span>
            <input
              type="color"
              value={customValue}
              onChange={(e) => update({ accent: e.target.value })}
              className="ml-auto w-12 h-9 rounded-md border border-gray-300 bg-white cursor-pointer p-0.5"
            />
          </label>
        </div>
      </div>

      {/* Light / dark mode */}
      <div className="card space-y-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Theme mode</h3>
          <p className="text-xs text-gray-500 mt-0.5">Switch the whole app between light and dark.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 max-w-sm">
          {[
            { id: 'light', label: 'Light', icon: Sun },
            { id: 'dark', label: 'Dark', icon: Moon },
          ].map((opt) => {
            const Icon = opt.icon;
            const selected = mode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => update({ mode: opt.id })}
                className={`flex items-center justify-center gap-2 py-3 rounded-lg border text-sm font-medium transition-colors ${
                  selected
                    ? 'border-indigo-600 bg-indigo-50 text-gray-900 dark:bg-indigo-600 dark:text-white'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4" /> {opt.label}
                {selected && <Check className="w-4 h-4" />}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-400">
          Saved per device immediately. Hit <span className="font-medium">Save changes</span> to sync it to your account so it applies on other devices too.
        </p>
      </div>
    </div>
  );
}

function TemplatesTab() {
  return <TemplatesEditor />;
}

function ModulesTab({ form, set, plan = 'complete', entitlements = {} }) {
  // Boolean-as-string helper — settings come back as 'true' / 'false'.
  const isOn = (k) => form[k] === 'true' || form[k] === true;
  const toggle = (k) => () => set(k)({ target: { value: isOn(k) ? 'false' : 'true' } });

  // A premium module is locked when the org's plan doesn't unlock it. The
  // backend (lib/plans.js) is the source of truth — `entitlements` mirrors it.
  // Default to entitled if the server didn't say, so we never falsely lock.
  const locked = (mod) => entitlements[mod] === false;
  const planLabel = plan === 'core' ? 'Core' : plan === 'complete' ? 'Complete' : plan;
  const anyLocked = locked('lessons') || locked('assignments') || locked('question_papers');

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <ToggleLeft className="w-5 h-5 text-indigo-600" />
            <h3 className="text-base font-semibold text-gray-900">Modules enabled for this academy</h3>
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
            {planLabel} plan
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Switch off the features you don't use. Disabled modules hide from the sidebar — students/parents won't see them either.
          {anyLocked && ' Modules marked “Complete” aren’t part of your current plan.'}
        </p>
        <div className="space-y-1">
          <ModuleToggle label="Groups"           hint="Group classes + bulk membership management" on={isOn('modules.groups')}         onClick={toggle('modules.groups')} />
          <ModuleToggle label="Fees"             hint="Monthly fee aggregation + payments + additional fees" on={isOn('modules.fees')}           onClick={toggle('modules.fees')} />
          <ModuleToggle label="Messages"         hint="WhatsApp message drafts + auto-reminders + templates" on={isOn('modules.messages')}       onClick={toggle('modules.messages')} />
          <ModuleToggle label="Reports"          hint="Attendance + fee summaries" on={isOn('modules.reports')}        onClick={toggle('modules.reports')} />
          <ModuleToggle label="Lessons"          hint="Udemy-style video courses for students" on={isOn('modules.lessons')}        onClick={toggle('modules.lessons')} locked={locked('lessons')} />
          <ModuleToggle label="Assignments"      hint="Set assignments with due dates; students submit & you grade them" on={isOn('modules.assignments')}    onClick={toggle('modules.assignments')} locked={locked('assignments')} />
          <ModuleToggle label="Question papers"  hint="Share past papers & practice sets (PDF/Drive links) for download" on={isOn('modules.question_papers')} onClick={toggle('modules.question_papers')} locked={locked('question_papers')} />
          <ModuleToggle label="Camps"            hint="Time-bounded special programs (workshops, intensives)" on={isOn('modules.camps')}          onClick={toggle('modules.camps')} />
          <ModuleToggle label="Student photos"   hint="Photo uploads in profile + avatar on Students list" on={isOn('modules.student_photos')} onClick={toggle('modules.student_photos')} />
        </div>
        {anyLocked && (
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2.5">
            <Lock className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-800">
              Online learning modules are part of the <span className="font-semibold">Complete</span> plan.
              To unlock Lessons, Assignments and Question papers, <a href="tel:+919360390883" className="font-semibold underline">contact us to upgrade</a>.
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Eye className="w-5 h-5 text-indigo-600" />
          <h3 className="text-base font-semibold text-gray-900">Parent portal visibility</h3>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Choose what parents see when they log in. Class History is always visible.
        </p>
        <div className="space-y-1">
          <ModuleToggle label="My Lessons"        hint="Parents see enrolled courses + watch lessons" on={isOn('portal.show_lessons')}       onClick={toggle('portal.show_lessons')} />
          <ModuleToggle label="Fees tab"          hint="Parents can see their fee breakdown by month" on={isOn('portal.show_fees')}          onClick={toggle('portal.show_fees')} />
          <ModuleToggle label="Profile editing"   hint="Parents can edit name, DOB, address, photo. Disable to lock the profile." on={isOn('portal.allow_profile_edit')} onClick={toggle('portal.allow_profile_edit')} />
        </div>
      </div>
    </div>
  );
}

function OrganizationTab() {
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState(null);
  const [role, setRole] = useState('');
  const [members, setMembers] = useState([]);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', first_name: '', last_name: '' });
  const [inviting, setInviting] = useState(false);
  // Logo state — picked file as a data URL, plus the currently-signed URL
  // for display.
  const [logoUrl, setLogoUrl] = useState('');
  const [logoPending, setLogoPending] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef(null);

  const isOwner = role === 'owner' || role === 'platform_admin';

  const fetchOrg = async () => {
    setLoading(true);
    try {
      const [data, logoRes] = await Promise.all([
        api.get('/organization'),
        api.get('/organization/logo-url').catch(() => ({ logo_url: '' })),
      ]);
      setOrg(data.org); setRole(data.role); setMembers(data.members || []);
      setName(data.org?.name || '');
      setLogoUrl(logoRes?.logo_url || '');
    } catch (e) {
      toast.error('Failed to load organization: ' + e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchOrg(); }, []);

  const saveName = async () => {
    try {
      setSaving(true);
      await api.put('/organization', { name: name.trim() });
      // Tell the layouts to refetch branding so the sidebar updates immediately.
      invalidateOrgBranding();
      toast.success('Academy name updated — refresh the page to see it in the sidebar');
      setEditingName(false);
      fetchOrg();
    } catch (e) {
      toast.error('Save failed: ' + e.message);
    } finally { setSaving(false); }
  };

  const handlePickLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please pick an image file'); return; }
    if (file.size > 8 * 1024 * 1024)   { toast.error('Logo must be 8MB or smaller'); return; }
    const reader = new FileReader();
    reader.onload  = () => setLogoPending(String(reader.result || ''));
    reader.onerror = () => toast.error('Could not read the file');
    reader.readAsDataURL(file);
  };

  const uploadLogo = async () => {
    if (!logoPending) return;
    try {
      setUploadingLogo(true);
      const { logo_url } = await api.post('/organization/logo', { data: logoPending });
      setLogoUrl(logo_url || '');
      setLogoPending('');
      if (logoInputRef.current) logoInputRef.current.value = '';
      invalidateOrgBranding();
      toast.success('Logo updated — refresh to see it in the sidebar');
    } catch (e) {
      toast.error('Logo upload failed: ' + e.message);
    } finally {
      setUploadingLogo(false);
    }
  };

  const sendInvite = async (e) => {
    e?.preventDefault?.();
    if (!inviteForm.email.trim()) return toast.error('Email required');
    try {
      setInviting(true);
      await api.post('/organization/invite', inviteForm);
      toast.success('Invite sent — they\'ll get an email to set their password');
      setInviteOpen(false);
      setInviteForm({ email: '', first_name: '', last_name: '' });
      fetchOrg();
    } catch (e) {
      toast.error('Invite failed: ' + (e.message || 'unknown'));
    } finally { setInviting(false); }
  };

  const removeMember = async (m) => {
    const ok = await confirm({
      title: `Remove ${m.display || m.email || 'this member'}?`,
      message: 'They will lose access to this academy immediately. Their Catalyst login isn\'t deleted — only the org membership is.',
      confirmText: 'Remove',
    });
    if (!ok) return;
    try {
      await api.delete(`/organization/members/${m.id}`);
      toast.success('Member removed');
      fetchOrg();
    } catch (e) {
      toast.error('Remove failed: ' + e.message);
    }
  };

  const transferOwnership = async (m) => {
    const ok = await confirm({
      title: `Make ${m.display || m.email || 'this teacher'} the new owner?`,
      message: 'You will become a teacher of this academy. They will have full owner rights including the ability to remove you. This cannot be easily undone.',
      confirmText: 'Transfer ownership',
    });
    if (!ok) return;
    try {
      await api.post('/organization/transfer-ownership', { membership_id: m.id });
      toast.success('Ownership transferred');
      fetchOrg();
    } catch (e) {
      toast.error('Transfer failed: ' + e.message);
    }
  };

  if (loading) return <div className="card text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading organization...</div>;
  if (!org) return <div className="card text-sm text-red-600">Could not load organization data.</div>;

  return (
    <div className="space-y-5">
      {/* Org identity + branding */}
      <div className="card space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Organization</h3>

        {/* Logo block — the same image is what shows in the sidebar */}
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            {logoPending || logoUrl ? (
              <img
                src={logoPending || logoUrl}
                alt=""
                className="w-20 h-20 rounded-xl object-cover border-2 border-indigo-100 shadow-sm"
              />
            ) : (
              <div className="w-20 h-20 rounded-xl bg-indigo-50 border-2 border-dashed border-indigo-200 flex items-center justify-center">
                <ImageIcon className="w-8 h-8 text-indigo-300" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-700">Logo</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Replaces the default music icon in the sidebar + browser tab. Square images render best.
            </p>
            {isOwner && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePickLogo}
                  className="hidden"
                  id="org-logo-input"
                />
                <label htmlFor="org-logo-input" className="btn-secondary btn-sm cursor-pointer">
                  <Camera className="w-3.5 h-3.5" /> Choose file
                </label>
                {logoPending && (
                  <>
                    <button onClick={uploadLogo} disabled={uploadingLogo} className="btn-primary btn-sm">
                      {uploadingLogo ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading...</>) : (<><Save className="w-3.5 h-3.5" /> Upload</>)}
                    </button>
                    <button onClick={() => { setLogoPending(''); if (logoInputRef.current) logoInputRef.current.value=''; }} className="text-xs text-gray-500 hover:text-gray-700 underline">
                      Cancel
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Academy name (inline edit) */}
        <div className="border-t border-gray-100 pt-4">
          <p className="text-sm font-medium text-gray-700 mb-1">Academy name</p>
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field"
                maxLength={200}
                autoFocus
              />
              <button onClick={saveName} disabled={saving} className="btn-primary btn-sm">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </button>
              <button onClick={() => { setEditingName(false); setName(org.name); }} className="btn-secondary btn-sm">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-lg font-semibold text-gray-900 truncate">{org.name}</p>
                <p className="text-xs text-gray-500">
                  Shown in the sidebar, browser tab, and as <code>{'{school}'}</code> in message templates.
                  · Slug: <code>{org.slug}</code> · Plan: <code>{org.plan || 'free'}</code>
                </p>
              </div>
              {isOwner && (
                <button onClick={() => setEditingName(true)} className="btn-secondary btn-sm flex-shrink-0">Rename</button>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-500">
          Your role: <span className="font-medium text-gray-700">{role}</span>
        </p>
      </div>

      {/* Members list */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <UsersIcon className="w-5 h-5 text-indigo-600" />
            <h3 className="text-base font-semibold text-gray-900">Members ({members.length})</h3>
          </div>
          {isOwner && (
            <button onClick={() => setInviteOpen(!inviteOpen)} className="btn-primary btn-sm">
              <UserPlus className="w-4 h-4" /> Invite teacher
            </button>
          )}
        </div>

        {inviteOpen && (
          <form onSubmit={sendInvite} className="border border-gray-200 rounded-lg p-3 mb-3 space-y-2 bg-gray-50">
            <p className="text-xs text-gray-600">
              They'll receive an email to set their password. After they sign in,
              they get a teacher role — full admin access to this academy except
              ownership transfer.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                className="input-field"
                placeholder="teacher@example.com"
                required
                autoFocus
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={inviteForm.first_name}
                  onChange={(e) => setInviteForm({ ...inviteForm, first_name: e.target.value })}
                  className="input-field"
                  placeholder="First name"
                />
                <input
                  type="text"
                  value={inviteForm.last_name}
                  onChange={(e) => setInviteForm({ ...inviteForm, last_name: e.target.value })}
                  className="input-field"
                  placeholder="Last (optional)"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setInviteOpen(false)} className="btn-secondary btn-sm">Cancel</button>
              <button type="submit" disabled={inviting} className="btn-primary btn-sm">
                {inviting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending...</> : <>Send invite</>}
              </button>
            </div>
          </form>
        )}

        <div className="divide-y divide-gray-100">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 py-3">
              <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                {(m.display || m.email || '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-medium text-gray-900 truncate">{m.display || m.email || m.user_id}</span>
                  {m.role === 'owner' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
                      <Crown className="w-3 h-3" /> owner
                    </span>
                  )}
                  {m.role === 'teacher' && (
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">teacher</span>
                  )}
                  {m.role === 'parent' && (
                    <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">parent</span>
                  )}
                  {m.status === 'invited' && (
                    <span className="px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 text-xs font-medium">invite pending</span>
                  )}
                </div>
                {m.email && <p className="text-xs text-gray-500 truncate">{m.email}</p>}
              </div>
              {isOwner && m.role !== 'owner' && m.status === 'active' && (
                <>
                  <button
                    onClick={() => transferOwnership(m)}
                    className="btn-sm bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 rounded-lg flex items-center gap-1 px-2 py-1 text-xs"
                    title="Make this user the new owner"
                  >
                    <Crown className="w-3.5 h-3.5" /> Transfer
                  </button>
                  <button
                    onClick={() => removeMember(m)}
                    className="btn-sm bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 rounded-lg flex items-center gap-1 px-2 py-1 text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ModuleToggle({ label, hint, on, onClick, locked = false }) {
  if (locked) {
    // Plan doesn't include this module — show it disabled with an upgrade chip
    // instead of a working toggle.
    return (
      <div className="w-full flex items-center justify-between gap-3 py-2.5 px-3 -mx-3 rounded-lg opacity-80">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-500">
            <Lock className="w-3.5 h-3.5 text-gray-400" /> {label}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">{hint}</div>
        </div>
        <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-gray-100 text-gray-500">
          Complete
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-between gap-3 py-2.5 px-3 -mx-3 rounded-lg hover:bg-gray-50 transition-colors text-left"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-900">{label}</div>
        <div className="text-xs text-gray-500 mt-0.5">{hint}</div>
      </div>
      <span className={`flex-shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? 'bg-indigo-600' : 'bg-gray-300'}`}>
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
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
