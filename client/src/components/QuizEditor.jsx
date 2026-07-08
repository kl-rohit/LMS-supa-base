// Admin quiz authoring for a single lesson (Google-Forms style).
//
// Interaction model:
//   - ONE "Save quiz" action in the header persists every new/edited/reordered
//     question in a batch (per-card save buttons are gone).
//   - A floating "+ Add question" button opens a type menu; picking a type
//     appends a fresh card of that type.
//   - Per-question actions (move, duplicate, delete) live in a hover-revealed
//     cluster so the card headers stay uncluttered (always shown on mobile).
//
// Question types:
//   single    — one correct option (radio)
//   truefalse — fixed True/False (radio)
//   multi     — several correct options (checkboxes) — all-or-nothing grading
//   short     — typed answer, matched case-insensitively vs accepted answers
// Deletes of already-saved questions commit immediately; new unsaved cards are
// just dropped locally. Base Tailwind classes auto-theme (light + dark).

import { useEffect, useRef, useState } from 'react';
import {
  Plus, Trash2, Check, Loader2, X, ListChecks, Copy, ArrowUp, ArrowDown,
  CircleDot, ToggleLeft, CheckSquare, Type, Upload,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';

const MAX_OPTIONS = 6;
const MIN_OPTIONS = 2;

const TYPES = [
  { key: 'single', label: 'Single choice', hint: 'One correct option', icon: CircleDot },
  { key: 'truefalse', label: 'True / False', hint: 'Pick which is true', icon: ToggleLeft },
  { key: 'multi', label: 'Multiple answers', hint: 'Several correct options', icon: CheckSquare },
  { key: 'short', label: 'Short answer', hint: 'Typed response', icon: Type },
];

function blankDraft(type = 'single') {
  const base = { id: null, question: '', question_type: type, points: 1, explanation: '', _dirty: true, _saving: false, _invalid: false };
  if (type === 'truefalse') return { ...base, options: ['True', 'False'], correct_index: 0, correct_answers: [] };
  if (type === 'short') return { ...base, options: [], correct_index: 0, correct_answers: [''] };
  return { ...base, options: ['', ''], correct_index: 0, correct_answers: [] }; // single / multi
}

function QuestionCard({ index, count, draft, onChange, onDelete, onDuplicate, onMove }) {
  const set = (patch) => onChange({ ...draft, ...patch, _dirty: true, _invalid: false });
  const type = draft.question_type || 'single';

  const setOption = (i, val) => { const options = draft.options.slice(); options[i] = val; set({ options }); };
  const addOption = () => { if (draft.options.length < MAX_OPTIONS) set({ options: [...draft.options, ''] }); };
  const removeOption = (i) => {
    if (draft.options.length <= MIN_OPTIONS) return;
    const options = draft.options.filter((_, idx) => idx !== i);
    let correct = draft.correct_index;
    if (correct === i) correct = 0; else if (correct > i) correct -= 1;
    const correct_answers = (draft.correct_answers || []).filter((x) => x !== i).map((x) => (x > i ? x - 1 : x));
    set({ options, correct_index: correct, correct_answers });
  };

  const toggleMulti = (i) => {
    const s = new Set(draft.correct_answers || []);
    if (s.has(i)) s.delete(i); else s.add(i);
    set({ correct_answers: [...s] });
  };

  const setAccepted = (i, val) => { const a = (draft.correct_answers || []).slice(); a[i] = val; set({ correct_answers: a }); };
  const addAccepted = () => set({ correct_answers: [...(draft.correct_answers || []), ''] });
  const removeAccepted = (i) => set({ correct_answers: (draft.correct_answers || []).filter((_, idx) => idx !== i) });

  const changeType = (nt) => {
    const b = blankDraft(nt);
    set({ question_type: nt, options: b.options, correct_index: 0, correct_answers: b.correct_answers });
  };

  return (
    <div className={`group relative border rounded-lg p-4 space-y-3 bg-white transition-colors ${draft._invalid ? 'border-red-400 ring-1 ring-red-300' : 'border-gray-200'}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-400">Q{index + 1}</span>
        <select value={type} onChange={(e) => changeType(e.target.value)} className="input-field !py-1 text-sm w-auto">
          {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <div className="flex items-center gap-1 ml-auto">
          <input
            type="number" min="1" value={draft.points}
            onChange={(e) => set({ points: Math.max(1, Number(e.target.value) || 1) })}
            className="input-field !py-1 w-14 text-sm" title="Marks for this question"
          />
          <span className="text-xs text-gray-400 mr-1">marks</span>
          {/* Actions: hidden until hover on desktop, always shown on touch. */}
          <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button type="button" onClick={() => onMove(index, -1)} disabled={index === 0} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30" title="Move up"><ArrowUp className="w-4 h-4" /></button>
            <button type="button" onClick={() => onMove(index, 1)} disabled={index === count - 1} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30" title="Move down"><ArrowDown className="w-4 h-4" /></button>
            <button type="button" onClick={() => onDuplicate(draft)} className="p-1.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50" title="Duplicate"><Copy className="w-4 h-4" /></button>
            <button type="button" onClick={() => onDelete(draft)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50" title="Delete question"><Trash2 className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      <textarea rows={2} value={draft.question} onChange={(e) => set({ question: e.target.value })} placeholder="Question text…" className="input-field w-full resize-y" />

      {(type === 'single' || type === 'truefalse' || type === 'multi') && (
        <div className="space-y-2 pl-1">
          {draft.options.map((opt, i) => {
            const isCorrect = type === 'multi' ? (draft.correct_answers || []).includes(i) : draft.correct_index === i;
            return (
              <div key={i} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => (type === 'multi' ? toggleMulti(i) : set({ correct_index: i }))}
                  className={`w-5 h-5 ${type === 'multi' ? 'rounded' : 'rounded-full'} border flex items-center justify-center flex-shrink-0 transition-colors ${isCorrect ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 text-transparent hover:border-green-400'}`}
                  title="Mark as correct"
                >
                  <Check className="w-3 h-3" />
                </button>
                {type === 'truefalse' ? (
                  <span className="input-field flex-1 bg-gray-100 text-gray-600">{opt}</span>
                ) : (
                  <input value={opt} onChange={(e) => setOption(i, e.target.value)} placeholder={`Option ${i + 1}`} className="input-field flex-1" />
                )}
                {type !== 'truefalse' && draft.options.length > MIN_OPTIONS && (
                  <button type="button" onClick={() => removeOption(i)} className="p-1 text-gray-300 hover:text-red-500" title="Remove option"><X className="w-4 h-4" /></button>
                )}
              </div>
            );
          })}
          {type !== 'truefalse' && draft.options.length < MAX_OPTIONS && (
            <button type="button" onClick={addOption} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Add option</button>
          )}
          {type === 'multi' && <p className="text-xs text-gray-400">Tick every correct option. Students must select all of them.</p>}
        </div>
      )}

      {type === 'short' && (
        <div className="space-y-2 pl-1">
          {(draft.correct_answers || []).map((ans, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={ans} onChange={(e) => setAccepted(i, e.target.value)} placeholder={`Accepted answer ${i + 1}`} className="input-field flex-1" />
              {(draft.correct_answers || []).length > 1 && (
                <button type="button" onClick={() => removeAccepted(i)} className="p-1 text-gray-300 hover:text-red-500" title="Remove"><X className="w-4 h-4" /></button>
              )}
            </div>
          ))}
          <button type="button" onClick={addAccepted} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Add accepted answer</button>
          <p className="text-xs text-gray-400">Matched case-insensitively. Add every spelling you'll accept.</p>
        </div>
      )}

      <input value={draft.explanation} onChange={(e) => set({ explanation: e.target.value })} placeholder="Explanation (optional, shown after answering)" className="input-field w-full text-sm" />
    </div>
  );
}

// Validate + normalise a draft into a clean payload. Returns { payload } on
// success or { error } with a human message (no toast — the caller decides).
function validateDraft(draft) {
  const question = draft.question.trim();
  if (!question) return { error: 'add the question text' };
  const type = draft.question_type || 'single';
  const base = { question, question_type: type, points: Math.max(1, Number(draft.points) || 1), explanation: draft.explanation.trim() };

  if (type === 'short') {
    const accepted = (draft.correct_answers || []).map((s) => String(s).trim()).filter(Boolean);
    if (accepted.length === 0) return { error: 'add at least one accepted answer' };
    return { payload: { ...base, correct_answers: accepted } };
  }
  if (type === 'truefalse') {
    return { payload: { ...base, options: ['True', 'False'], correct_index: draft.correct_index === 1 ? 1 : 0 } };
  }
  const entries = draft.options.map((o, i) => ({ value: String(o).trim(), i })).filter((e) => e.value.length > 0);
  if (entries.length < MIN_OPTIONS) return { error: 'add at least two answer options' };
  const options = entries.map((e) => e.value);
  if (type === 'multi') {
    const correct = (draft.correct_answers || []).map((oldI) => entries.findIndex((e) => e.i === oldI)).filter((p) => p >= 0);
    if (correct.length === 0) return { error: 'mark at least one correct option' };
    return { payload: { ...base, options, correct_answers: [...new Set(correct)] } };
  }
  const correctPos = entries.findIndex((e) => e.i === draft.correct_index);
  if (correctPos === -1) return { error: 'mark the correct answer' };
  return { payload: { ...base, options, correct_index: correctPos } };
}

function fromServer(q) {
  return {
    id: q.id, question: q.question, question_type: q.question_type || 'single',
    options: q.options || [], correct_index: q.correct_index || 0,
    correct_answers: q.correct_answers || [], points: q.points || 1,
    explanation: q.explanation || '', order_index: q.order_index || 0,
    _dirty: false, _saving: false, _invalid: false,
  };
}

export default function QuizEditor({ lesson, onClose, onCountChange }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settings, setSettings] = useState({ quiz_required: false, quiz_shuffle: false, quiz_shuffle_options: false, quiz_pass_mark: '' });
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMode, setImportMode] = useState('append');
  const [importing, setImporting] = useState(false);
  const bottomRef = useRef(null);

  // Load (or reload) this quiz's questions + settings from the server.
  const loadQuestions = async () => {
    const data = await api.getFresh(`/quizzes?lesson_id=${lesson.id}`);
    setDrafts((data.questions || []).map(fromServer));
    const s = data.settings || {};
    setSettings({
      quiz_required: !!s.quiz_required,
      quiz_shuffle: !!s.quiz_shuffle,
      quiz_shuffle_options: !!s.quiz_shuffle_options,
      quiz_pass_mark: s.quiz_pass_mark || '',
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { await loadQuestions(); }
      catch { if (!cancelled) toast.error('Could not load quiz'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [lesson.id]);

  useEffect(() => { onCountChange?.(drafts.filter((d) => d.id).length); }, [drafts]);

  const hasChanges = drafts.some((d) => d._dirty || !d.id);

  const updateDraft = (idx, next) => setDrafts((prev) => prev.map((d, i) => (i === idx ? next : d)));

  // Persist every new/edited/reordered question in one batch.
  const saveAll = async () => {
    // Validate first so nothing partial is written; flag the first bad card.
    for (let i = 0; i < drafts.length; i++) {
      const v = validateDraft(drafts[i]);
      if (v.error) {
        setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, _invalid: true } : d)));
        toast.error(`Question ${i + 1}: ${v.error}.`);
        return;
      }
    }
    setSaving(true);
    try {
      // Flush quiz-level settings too (covers a pass-mark edit not yet blurred).
      await saveSettings({}, true);
      const results = await Promise.all(drafts.map(async (d, idx) => {
        const needsWrite = !d.id || d._dirty || d.order_index !== idx;
        if (!needsWrite) return d;
        const { payload } = validateDraft(d);
        const body = { lesson_id: String(lesson.id), order_index: idx, ...payload };
        const resp = d.id ? await api.put(`/quizzes/${d.id}`, body) : await api.post('/quizzes', body);
        return fromServer(resp.question);
      }));
      setDrafts(results);
      toast.success('Quiz saved');
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message || 'Could not save the quiz');
    } finally {
      setSaving(false);
    }
  };

  // Existing questions delete immediately; unsaved cards drop locally.
  const deleteDraft = async (idx, draft) => {
    if (!draft.id) { setDrafts((prev) => prev.filter((_, i) => i !== idx)); return; }
    try {
      await api.delete(`/quizzes/${draft.id}`);
      setDrafts((prev) => prev.filter((_, i) => i !== idx));
      toast.success('Question deleted');
    } catch {
      toast.error('Could not delete question');
    }
  };

  const duplicateDraft = (draft) => {
    const copy = { ...draft, id: null, options: [...(draft.options || [])], correct_answers: [...(draft.correct_answers || [])], _dirty: true, _saving: false, _invalid: false };
    setDrafts((prev) => [...prev, copy]);
  };

  // Local reorder only; the new order_index is persisted on Save.
  const moveDraft = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= drafts.length) return;
    setDrafts((prev) => {
      const next = prev.slice();
      [next[idx], next[j]] = [next[j], next[idx]];
      // Mark the two swapped cards dirty so Save re-syncs their order_index.
      next[idx] = { ...next[idx], _dirty: true };
      next[j] = { ...next[j], _dirty: true };
      return next;
    });
  };

  // Quiz-level settings persist as you toggle them. When flushOnly is true it
  // just writes the current (merged) settings without changing local state.
  const saveSettings = async (patch, flushOnly = false) => {
    const next = { ...settings, ...patch };
    if (!flushOnly) setSettings(next);
    try {
      await api.put(`/lessons/${lesson.id}`, {
        quiz_required: next.quiz_required,
        quiz_shuffle: next.quiz_shuffle,
        quiz_shuffle_options: next.quiz_shuffle_options,
        quiz_pass_mark: next.quiz_pass_mark === '' ? null : Number(next.quiz_pass_mark),
      });
    } catch { if (!flushOnly) toast.error('Could not save quiz settings'); }
  };

  const addQuestion = (type) => {
    setMenuOpen(false);
    setDrafts((prev) => [...prev, blankDraft(type)]);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 60);
  };

  const handleClose = () => {
    if (hasChanges && !window.confirm('You have unsaved changes. Close without saving?')) return;
    onClose();
  };

  // Read an uploaded .json file into the paste box.
  const onImportFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setImportText(String(r.result || ''));
    r.readAsText(f);
    e.target.value = '';
  };

  // Parse the JSON and bulk-import via the server (append or replace).
  const doImport = async () => {
    let parsed;
    try { parsed = JSON.parse(importText); }
    catch { toast.error('That does not look like valid JSON.'); return; }
    if (!Array.isArray(parsed)) { toast.error('Expected a JSON array of questions.'); return; }
    if (parsed.length === 0) { toast.error('No questions found in the JSON.'); return; }
    setImporting(true);
    try {
      const resp = await api.post('/quizzes/import', { lesson_id: String(lesson.id), questions: parsed, mode: importMode });
      await loadQuestions();
      setImportOpen(false); setImportText('');
      const skipped = (resp.errors || []).length;
      if (skipped) toast(`Imported ${resp.created} of ${resp.total}. ${skipped} skipped (check their format).`, { icon: '⚠️' });
      else toast.success(`Imported ${resp.created} question${resp.created === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const SAMPLE_JSON = `[
  { "type": "single", "question": "2 + 2 = ?", "points": 1,
    "options": ["3", "4", "5"], "correct_index": 1, "explanation": "" },
  { "type": "multi", "question": "Pick the even numbers",
    "options": ["2", "3", "4"], "correct_answers": [0, 2] },
  { "type": "truefalse", "question": "The sky is blue", "correct_index": 0 },
  { "type": "short", "question": "Capital of France?",
    "correct_answers": ["Paris", "paris"] }
]`;

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      {/* Sticky header: single Save action + close. */}
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <ListChecks className="w-5 h-5 text-indigo-500 shrink-0" />
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 truncate">Quiz: {lesson.title}</h2>
          {hasChanges && <span className="text-xs text-amber-600 font-medium flex-shrink-0 hidden sm:inline">Unsaved changes</span>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button type="button" onClick={() => setImportOpen(true)} className="btn-secondary btn-sm" title="Import questions from JSON">
            <Upload className="w-4 h-4" /> <span className="hidden sm:inline">Import</span>
          </button>
          <button type="button" onClick={saveAll} disabled={saving || !hasChanges} className="btn-primary btn-sm disabled:opacity-40">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save quiz
          </button>
          <button type="button" onClick={handleClose} className="btn-secondary btn-sm" title="Close">
            <X className="w-4 h-4" /> <span className="hidden sm:inline">Close</span>
          </button>
        </div>
      </div>

      {/* Import-from-JSON overlay */}
      {importOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => !importing && setImportOpen(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-xl border border-gray-200 shadow-xl p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Upload className="w-4 h-4 text-indigo-500" /> Import questions</h3>
              <button type="button" onClick={() => setImportOpen(false)} className="p-1.5 rounded text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-gray-500 mb-3">Paste a JSON array of questions, or upload a .json file. Types: single, truefalse, multi, short.</p>

            <div className="flex items-center gap-2 mb-3 text-sm">
              <label className="inline-flex items-center gap-1.5 cursor-pointer"><input type="radio" name="impMode" checked={importMode === 'append'} onChange={() => setImportMode('append')} /> Add to existing</label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer"><input type="radio" name="impMode" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} /> Replace all</label>
              <label className="ml-auto btn-secondary btn-sm cursor-pointer">
                <Upload className="w-3.5 h-3.5" /> Upload .json
                <input type="file" accept=".json,application/json" onChange={onImportFile} className="hidden" />
              </label>
            </div>

            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={SAMPLE_JSON}
              rows={10}
              className="input-field w-full font-mono text-xs resize-y"
            />
            <div className="flex items-center justify-between mt-3">
              <button type="button" onClick={() => setImportText(SAMPLE_JSON)} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">Paste a sample</button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setImportOpen(false)} className="btn-secondary btn-sm" disabled={importing}>Cancel</button>
                <button type="button" onClick={doImport} disabled={importing || !importText.trim()} className="btn-primary btn-sm disabled:opacity-40">
                  {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Import
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 sm:p-6 pb-28 space-y-4">
          {/* Quiz-level settings */}
          <div className="border border-gray-200 rounded-lg p-3 bg-white space-y-2.5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-700">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={settings.quiz_shuffle} onChange={(e) => saveSettings({ quiz_shuffle: e.target.checked })} />
                Shuffle question order
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={settings.quiz_shuffle_options} onChange={(e) => saveSettings({ quiz_shuffle_options: e.target.checked })} />
                Shuffle answer options
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={settings.quiz_required} onChange={(e) => saveSettings({ quiz_required: e.target.checked })} />
                Required for certificate
              </label>
              <span className="inline-flex items-center gap-2">
                Pass mark
                <input
                  type="number" min="1" max="100"
                  value={settings.quiz_pass_mark}
                  onChange={(e) => setSettings((s) => ({ ...s, quiz_pass_mark: e.target.value }))}
                  onBlur={(e) => saveSettings({ quiz_pass_mark: e.target.value })}
                  placeholder="70"
                  className="input-field !py-1 w-16"
                />%
              </span>
            </div>
            <p className="text-xs text-gray-400">Score is weighted by each question's marks. Leave pass mark blank for the default 70%.</p>
          </div>

          {loading ? (
            <div className="py-10 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
          ) : (
            <>
              {drafts.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded-lg">
                  No questions yet. Use "+ Add question" below — students see them in order.
                </p>
              )}
              {drafts.map((d, idx) => (
                <QuestionCard
                  key={d.id || `new-${idx}`}
                  index={idx}
                  count={drafts.length}
                  draft={d}
                  onChange={(next) => updateDraft(idx, next)}
                  onDelete={() => deleteDraft(idx, d)}
                  onDuplicate={duplicateDraft}
                  onMove={moveDraft}
                />
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>
      </div>

      {/* Floating "+ Add question" with a type menu (Google-Forms style). */}
      {!loading && (
        <div className="fixed bottom-6 right-6 z-10">
          {menuOpen && (
            <>
              <div className="fixed inset-0" onClick={() => setMenuOpen(false)} />
              <div className="absolute bottom-full mb-2 right-0 w-60 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                {TYPES.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => addQuestion(t.key)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-indigo-50 transition-colors"
                    >
                      <Icon className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                      <span>
                        <span className="block text-sm font-medium text-gray-900">{t.label}</span>
                        <span className="block text-xs text-gray-400">{t.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="btn-primary shadow-lg rounded-full pl-4 pr-5 py-3"
          >
            <Plus className={`w-5 h-5 transition-transform ${menuOpen ? 'rotate-45' : ''}`} /> Add question
          </button>
        </div>
      )}
    </div>
  );
}
