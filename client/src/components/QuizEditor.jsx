// Admin quiz authoring for a single lesson (Google-Forms style). Each card is
// one question of a chosen type; cards persist independently via /api/quizzes
// (POST new / PUT existing), deletes fire immediately.
//
// Types:
//   single    — one correct option (radio)
//   truefalse — fixed True/False (radio)
//   multi     — several correct options (checkboxes) — all-or-nothing grading
//   short     — typed answer, matched case-insensitively vs accepted answers
// Per-question marks (points), reorder (up/down), and duplicate are supported.

import { useEffect, useState } from 'react';
import { Plus, Trash2, Check, Loader2, X, ListChecks, Copy, ArrowUp, ArrowDown } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';

const MAX_OPTIONS = 6;
const MIN_OPTIONS = 2;

const TYPES = [
  { key: 'single', label: 'Single choice' },
  { key: 'truefalse', label: 'True / False' },
  { key: 'multi', label: 'Multiple answers' },
  { key: 'short', label: 'Short answer' },
];

function blankDraft(type = 'single') {
  const base = { id: null, question: '', question_type: type, points: 1, explanation: '', _dirty: true, _saving: false };
  if (type === 'truefalse') return { ...base, options: ['True', 'False'], correct_index: 0, correct_answers: [] };
  if (type === 'short') return { ...base, options: [], correct_index: 0, correct_answers: [''] };
  return { ...base, options: ['', ''], correct_index: 0, correct_answers: [] }; // single / multi
}

function QuestionCard({ index, count, draft, onChange, onSave, onDelete, onDuplicate, onMove }) {
  const set = (patch) => onChange({ ...draft, ...patch, _dirty: true });
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

  // Short-answer accepted values
  const setAccepted = (i, val) => { const a = (draft.correct_answers || []).slice(); a[i] = val; set({ correct_answers: a }); };
  const addAccepted = () => set({ correct_answers: [...(draft.correct_answers || []), ''] });
  const removeAccepted = (i) => set({ correct_answers: (draft.correct_answers || []).filter((_, idx) => idx !== i) });

  const changeType = (nt) => {
    // Reset the type-specific bits to sensible defaults for the new type.
    const b = blankDraft(nt);
    set({ question_type: nt, options: b.options, correct_index: 0, correct_answers: b.correct_answers });
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-400">Q{index + 1}</span>
        <select value={type} onChange={(e) => changeType(e.target.value)} className="input-field !py-1 text-sm w-auto">
          {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <div className="flex items-center gap-1 ml-auto">
          <input
            type="number" min="1" value={draft.points}
            onChange={(e) => set({ points: Math.max(1, Number(e.target.value) || 1) })}
            className="input-field !py-1 w-16 text-sm" title="Marks for this question"
          />
          <span className="text-xs text-gray-400 mr-1">marks</span>
          <button type="button" onClick={() => onMove(index, -1)} disabled={index === 0} className="p-1.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move up"><ArrowUp className="w-4 h-4" /></button>
          <button type="button" onClick={() => onMove(index, 1)} disabled={index === count - 1} className="p-1.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move down"><ArrowDown className="w-4 h-4" /></button>
          <button type="button" onClick={() => onDuplicate(draft)} className="p-1.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50" title="Duplicate"><Copy className="w-4 h-4" /></button>
          <button type="button" onClick={() => onDelete(draft)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50" title="Delete question"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>

      <textarea rows={2} value={draft.question} onChange={(e) => set({ question: e.target.value })} placeholder="Question text…" className="input-field w-full resize-y" />

      {/* Type-specific answer editor */}
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

      <input value={draft.explanation} onChange={(e) => set({ explanation: e.target.value })} placeholder="Explanation (optional — shown after answering)" className="input-field w-full text-sm" />

      <div className="flex items-center justify-end">
        <button type="button" onClick={() => onSave(draft)} disabled={draft._saving || !draft._dirty} className="btn-primary btn-sm disabled:opacity-40">
          {draft._saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {draft.id ? 'Save changes' : 'Add question'}
        </button>
      </div>
    </div>
  );
}

export default function QuizEditor({ lesson, onClose, onCountChange }) {
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState([]);
  // Quiz-level settings (stored on the lesson). Edited here so a standalone
  // quiz — which has no Lessons-page form — can still be configured.
  const [settings, setSettings] = useState({ quiz_required: false, quiz_shuffle: false, quiz_shuffle_options: false, quiz_pass_mark: '' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get(`/quizzes?lesson_id=${lesson.id}`);
        if (cancelled) return;
        setDrafts((data.questions || []).map((q) => ({
          id: q.id,
          question: q.question,
          question_type: q.question_type || 'single',
          options: q.options || [],
          correct_index: q.correct_index || 0,
          correct_answers: q.correct_answers || [],
          points: q.points || 1,
          explanation: q.explanation || '',
          order_index: q.order_index || 0,
          _dirty: false,
          _saving: false,
        })));
        const s = data.settings || {};
        setSettings({
          quiz_required: !!s.quiz_required,
          quiz_shuffle: !!s.quiz_shuffle,
          quiz_shuffle_options: !!s.quiz_shuffle_options,
          quiz_pass_mark: s.quiz_pass_mark || '',
        });
      } catch {
        toast.error('Failed to load quiz');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [lesson.id]);

  useEffect(() => { onCountChange?.(drafts.filter((d) => d.id).length); }, [drafts]);

  const updateDraft = (idx, next) => setDrafts((prev) => prev.map((d, i) => (i === idx ? next : d)));

  // Trim + drop blanks, remapping the correct answer(s) to the cleaned list so
  // indices never drift. Returns null (after a toast) if something's missing.
  const buildCleanPayload = (draft) => {
    const question = draft.question.trim();
    if (!question) { toast.error('Please add the question text.'); return null; }
    const type = draft.question_type || 'single';
    const base = { question, question_type: type, points: Math.max(1, Number(draft.points) || 1), explanation: draft.explanation.trim() };

    if (type === 'short') {
      const accepted = (draft.correct_answers || []).map((s) => String(s).trim()).filter(Boolean);
      if (accepted.length === 0) { toast.error('Add at least one accepted answer.'); return null; }
      return { ...base, correct_answers: accepted };
    }
    if (type === 'truefalse') {
      return { ...base, options: ['True', 'False'], correct_index: draft.correct_index === 1 ? 1 : 0 };
    }
    // single / multi — clean options, remap correct indices to the cleaned list
    const entries = draft.options.map((o, i) => ({ value: String(o).trim(), i })).filter((e) => e.value.length > 0);
    if (entries.length < MIN_OPTIONS) { toast.error('Please add at least two answer options.'); return null; }
    const options = entries.map((e) => e.value);
    if (type === 'multi') {
      const correct = (draft.correct_answers || [])
        .map((oldI) => entries.findIndex((e) => e.i === oldI))
        .filter((p) => p >= 0);
      if (correct.length === 0) { toast.error('Mark at least one correct option.'); return null; }
      return { ...base, options, correct_answers: [...new Set(correct)] };
    }
    const correctPos = entries.findIndex((e) => e.i === draft.correct_index);
    if (correctPos === -1) { toast.error('Please mark the correct answer.'); return null; }
    return { ...base, options, correct_index: correctPos };
  };

  const saveDraft = async (idx, draft) => {
    const clean = buildCleanPayload(draft);
    if (!clean) return;
    updateDraft(idx, { ...draft, _saving: true });
    try {
      const payload = { lesson_id: String(lesson.id), order_index: idx, ...clean };
      const resp = draft.id
        ? await api.put(`/quizzes/${draft.id}`, payload)
        : await api.post('/quizzes', payload);
      const s = resp.question;
      updateDraft(idx, {
        id: s.id, question: s.question, question_type: s.question_type || 'single',
        options: s.options || [], correct_index: s.correct_index || 0,
        correct_answers: s.correct_answers || [], points: s.points || 1,
        explanation: s.explanation || '', order_index: s.order_index || idx,
        _dirty: false, _saving: false,
      });
      toast.success(draft.id ? 'Question updated' : 'Question added');
    } catch (err) {
      updateDraft(idx, { ...draft, _saving: false });
      toast.error(err?.response?.data?.error || err.message || 'Failed to save');
    }
  };

  const deleteDraft = async (idx, draft) => {
    if (!draft.id) { setDrafts((prev) => prev.filter((_, i) => i !== idx)); return; }
    try {
      await api.delete(`/quizzes/${draft.id}`);
      setDrafts((prev) => prev.filter((_, i) => i !== idx));
      toast.success('Question deleted');
    } catch {
      toast.error('Failed to delete');
    }
  };

  const duplicateDraft = (draft) => {
    const copy = { ...draft, id: null, options: [...(draft.options || [])], correct_answers: [...(draft.correct_answers || [])], _dirty: true, _saving: false };
    setDrafts((prev) => [...prev, copy]);
  };

  // Persist quiz-level settings to the lesson (fire-and-forget per change).
  const saveSettings = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      await api.put(`/lessons/${lesson.id}`, {
        quiz_required: next.quiz_required,
        quiz_shuffle: next.quiz_shuffle,
        quiz_shuffle_options: next.quiz_shuffle_options,
        quiz_pass_mark: next.quiz_pass_mark === '' ? null : Number(next.quiz_pass_mark),
      });
    } catch { toast.error('Could not save quiz settings'); }
  };

  const addQuestion = () => setDrafts((prev) => [...prev, blankDraft()]);

  // Move a card up/down; persist the new order_index of every saved question.
  const moveDraft = async (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= drafts.length) return;
    const next = drafts.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    setDrafts(next);
    // Persist ordering for saved questions whose position changed.
    for (let i = 0; i < next.length; i++) {
      const d = next[i];
      if (d.id && d.order_index !== i) {
        d.order_index = i;
        api.put(`/quizzes/${d.id}`, { order_index: i }).catch(() => {});
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      {/* Full-screen editor — spacious, sticky header with a single Done action. */}
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <ListChecks className="w-5 h-5 text-indigo-500 shrink-0" />
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 truncate">Quiz — {lesson.title}</h2>
        </div>
        <button type="button" onClick={onClose} className="btn-primary btn-sm">
          <Check className="w-4 h-4" /> Done
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
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
                No questions yet. Add one below — students see them in order.
              </p>
            )}
            {drafts.map((d, idx) => (
              <QuestionCard
                key={d.id || `new-${idx}`}
                index={idx}
                count={drafts.length}
                draft={d}
                onChange={(next) => updateDraft(idx, next)}
                onSave={() => saveDraft(idx, d)}
                onDelete={() => deleteDraft(idx, d)}
                onDuplicate={duplicateDraft}
                onMove={moveDraft}
              />
            ))}
            <button
              type="button"
              onClick={addQuestion}
              className="w-full border border-dashed border-gray-300 rounded-lg py-3 text-sm font-medium text-indigo-600 hover:bg-indigo-50 inline-flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add question
            </button>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
