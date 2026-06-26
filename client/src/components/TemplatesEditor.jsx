// Inline editor for the 5 message templates. Self-contained: fetches its
// own data, saves on its own. Used from Settings → Templates tab.
//
// Surface area:
//   - 5 textareas (one per template type)
//   - Per-template placeholder chips that insert at the cursor
//   - Per-template "Reset to default" link
//   - Sticky save bar at the bottom

import { useEffect, useRef, useState } from 'react';
import { Save, Loader2, RotateCcw, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';

// Defaults mirror server-side DEFAULT_TEMPLATES (settings.js). Kept here as
// the bootstrap value so the editor works even before /api/settings/templates
// returns and as the "Reset to default" target.
export const DEFAULT_TEMPLATES = {
  absence_alert:
    `Dear {parent},\n\nThis is to inform you that {name} has been absent for the last {count} consecutive classes. Kindly ensure regular attendance for better progress.\n\nPlease reach out if there are any concerns.\n\nRegards,\n{signature}`,
  fee_reminder:
    `Dear {parent},\n\nThis is a gentle reminder regarding the {month} {year} fee payment for {name}.\n\nFees for {name} — {month} {year}: ₹{amount}\n  • Class fees: ₹{class_fees}\n  • Additional: ₹{additional_fees}\n\nKindly do the needful. Thank you.\n\n{signature}`,
  class_update:
    `Dear {parent},\n\nThis is to inform you about an update regarding {name}'s music class schedule. Please check with us for the revised timings.\n\nRegards,\n{signature}`,
  thank_you:
    `Dear {parent},\n\nThank you for your continued support and for ensuring {name}'s regular attendance at {school}. We truly appreciate it.\n\nRegards,\n{signature}`,
  holiday_notice:
    `Dear {parent},\n\nThis is to inform you that {school} will remain closed on account of the upcoming holiday. {name}'s classes will resume as per the regular schedule after the break.\n\nRegards,\n{signature}`,
  online_meeting:
    `Dear {parent},\n\nThe online class "{class_name}" for {name} is ready to join {time}.\n\nJoin link: {link}\n\nRegards,\n{signature}`,
};

// Which placeholders are meaningful for each template — drives the chips.
const TEMPLATE_PLACEHOLDERS = {
  absence_alert:  ['{parent}', '{name}', '{count}', '{school}', '{signature}'],
  fee_reminder:   ['{parent}', '{name}', '{month}', '{year}', '{amount}', '{class_fees}', '{additional_fees}', '{school}', '{signature}'],
  class_update:   ['{parent}', '{name}', '{school}', '{signature}'],
  thank_you:      ['{parent}', '{name}', '{school}', '{signature}'],
  holiday_notice: ['{parent}', '{name}', '{school}', '{signature}'],
  online_meeting: ['{parent}', '{name}', '{class_name}', '{time}', '{link}', '{signature}'],
};

const TEMPLATE_LABELS = {
  absence_alert:  'Absence Alert',
  fee_reminder:   'Fee Reminder',
  class_update:   'Class Update',
  thank_you:      'Thank You',
  holiday_notice: 'Holiday Notice',
  online_meeting: 'Online Meeting Link',
};

export default function TemplatesEditor() {
  const [draft, setDraft] = useState(DEFAULT_TEMPLATES);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const textareaRefs = useRef({});

  // Fetch on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { templates } = await api.get('/settings/templates');
        if (cancelled) return;
        setDraft({ ...DEFAULT_TEMPLATES, ...(templates || {}) });
      } catch (e) {
        toast.error('Failed to load templates: ' + e.message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const insertPlaceholder = (type, placeholder) => {
    const ta = textareaRefs.current[type];
    if (!ta) return;
    const start = ta.selectionStart ?? ta.value.length;
    const end   = ta.selectionEnd   ?? ta.value.length;
    const next  = ta.value.slice(0, start) + placeholder + ta.value.slice(end);
    setDraft((prev) => ({ ...prev, [type]: next }));
    requestAnimationFrame(() => {
      ta.focus();
      const caret = start + placeholder.length;
      try { ta.setSelectionRange(caret, caret); } catch {}
    });
  };

  const resetToDefault = (type) => {
    setDraft((prev) => ({ ...prev, [type]: DEFAULT_TEMPLATES[type] }));
  };

  const save = async () => {
    try {
      setSaving(true);
      const { templates } = await api.put('/settings/templates', { templates: draft });
      setDraft({ ...DEFAULT_TEMPLATES, ...(templates || draft) });
      setSavedNotice(true);
      toast.success('Templates saved');
      setTimeout(() => setSavedNotice(false), 2500);
    } catch (e) {
      toast.error('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-600">
        These templates power both the auto-generated reminders and the quick-template chips on the Messages page.
        Use the placeholder chips below each field to insert tokens — they get replaced with real student / school
        details at send time.
      </div>

      {!loaded ? (
        <div className="card text-sm text-gray-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading templates...
        </div>
      ) : (
        <>
          {Object.keys(DEFAULT_TEMPLATES).map((type) => {
            const placeholders = TEMPLATE_PLACEHOLDERS[type] || [];
            return (
              <div key={type} className="card space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-semibold text-gray-800">
                    {TEMPLATE_LABELS[type]}
                  </label>
                  <button
                    type="button"
                    onClick={() => resetToDefault(type)}
                    className="text-xs text-gray-500 hover:text-indigo-600 flex items-center gap-1"
                    title="Restore the original wording"
                  >
                    <RotateCcw className="w-3 h-3" /> Reset to default
                  </button>
                </div>
                <textarea
                  ref={(el) => { textareaRefs.current[type] = el; }}
                  value={draft[type] ?? ''}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, [type]: e.target.value }))
                  }
                  rows={6}
                  className="input-field font-mono text-sm"
                  spellCheck={false}
                />
                {placeholders.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-gray-500">Insert:</span>
                    {placeholders.map((ph) => (
                      <button
                        key={ph}
                        type="button"
                        onClick={() => insertPlaceholder(type, ph)}
                        className="px-2 py-0.5 rounded-full text-xs font-mono bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors"
                        title={`Insert ${ph} at cursor`}
                      >
                        {ph}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Save bar */}
          <div className="sticky bottom-0 -mx-4 lg:-mx-6 px-4 lg:px-6 py-3 bg-white border-t border-gray-200 flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {savedNotice && (
                <span className="inline-flex items-center gap-1 text-green-700">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                </span>
              )}
            </span>
            <button
              onClick={save}
              className="btn-primary"
              disabled={saving}
            >
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save templates</>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
