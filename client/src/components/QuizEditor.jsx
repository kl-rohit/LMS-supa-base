// Admin quiz authoring for a single lesson. Opened from the Lessons page.
//
// One MCQ question per card: question text, 2–6 options (radio marks the
// correct one), optional explanation shown to students after they submit.
// Each card persists independently via /api/quizzes (POST new / PUT existing);
// deletes fire immediately. Keeps the surface small and avoids a fragile
// "save everything" diff.

import { useEffect, useState } from 'react';
import { Plus, Trash2, Check, Loader2, X, ListChecks } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Modal from './Modal';

const MAX_OPTIONS = 6;
const MIN_OPTIONS = 2;

function blankDraft() {
  return { id: null, question: '', options: ['', ''], correct_index: 0, explanation: '', _dirty: true, _saving: false };
}

function QuestionCard({ index, draft, onChange, onSave, onDelete }) {
  const set = (patch) => onChange({ ...draft, ...patch, _dirty: true });

  const setOption = (i, val) => {
    const options = draft.options.slice();
    options[i] = val;
    set({ options });
  };
  const addOption = () => {
    if (draft.options.length >= MAX_OPTIONS) return;
    set({ options: [...draft.options, ''] });
  };
  const removeOption = (i) => {
    if (draft.options.length <= MIN_OPTIONS) return;
    const options = draft.options.filter((_, idx) => idx !== i);
    let correct = draft.correct_index;
    if (correct === i) correct = 0;
    else if (correct > i) correct -= 1;
    set({ options, correct_index: correct });
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold text-gray-400 mt-2">Q{index + 1}</span>
        <textarea
          rows={2}
          value={draft.question}
          onChange={(e) => set({ question: e.target.value })}
          placeholder="Question text…"
          className="input-field flex-1 resize-y"
        />
        <button
          onClick={() => onDelete(draft)}
          className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0"
          title="Delete question"
          type="button"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2 pl-7">
        {draft.options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => set({ correct_index: i })}
              className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors ${
                draft.correct_index === i
                  ? 'bg-green-500 border-green-500 text-white'
                  : 'border-gray-300 text-transparent hover:border-green-400'
              }`}
              title="Mark as correct answer"
            >
              <Check className="w-3 h-3" />
            </button>
            <input
              value={opt}
              onChange={(e) => setOption(i, e.target.value)}
              placeholder={`Option ${i + 1}`}
              className="input-field flex-1"
            />
            {draft.options.length > MIN_OPTIONS && (
              <button
                type="button"
                onClick={() => removeOption(i)}
                className="p-1 text-gray-300 hover:text-red-500"
                title="Remove option"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
        {draft.options.length < MAX_OPTIONS && (
          <button
            type="button"
            onClick={addOption}
            className="text-xs text-indigo-600 hover:text-indigo-700 font-medium inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add option
          </button>
        )}
      </div>

      <div className="pl-7">
        <input
          value={draft.explanation}
          onChange={(e) => set({ explanation: e.target.value })}
          placeholder="Explanation (optional — shown after answering)"
          className="input-field w-full text-sm"
        />
      </div>

      <div className="flex items-center justify-between pl-7">
        <span className="text-xs text-green-600 font-medium">
          Correct: Option {draft.correct_index + 1}
        </span>
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={draft._saving || !draft._dirty}
          className="btn-primary btn-sm disabled:opacity-40"
        >
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get(`/quizzes?lesson_id=${lesson.id}`);
        if (cancelled) return;
        const qs = (data.questions || []).map((q) => ({
          id: q.id,
          question: q.question,
          options: q.options.length >= MIN_OPTIONS ? q.options : [...q.options, '', ''].slice(0, MIN_OPTIONS),
          correct_index: q.correct_index,
          explanation: q.explanation || '',
          _dirty: false,
          _saving: false,
        }));
        setDrafts(qs);
      } catch (err) {
        toast.error('Failed to load quiz');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [lesson.id]);

  const persistedCount = () => drafts.filter((d) => d.id).length;
  useEffect(() => { onCountChange?.(persistedCount()); }, [drafts]);

  const updateDraft = (idx, next) => {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? next : d)));
  };

  const validate = (draft) => {
    if (!draft.question.trim()) { toast.error('Question text is required'); return false; }
    const clean = draft.options.map((o) => o.trim()).filter(Boolean);
    if (clean.length < MIN_OPTIONS) { toast.error('At least 2 non-empty options'); return false; }
    if (!draft.options[draft.correct_index]?.trim()) { toast.error('The correct option can\'t be empty'); return false; }
    return true;
  };

  const saveDraft = async (idx, draft) => {
    if (!validate(draft)) return;
    updateDraft(idx, { ...draft, _saving: true });
    const payload = {
      lesson_id: String(lesson.id),
      question: draft.question.trim(),
      options: draft.options.map((o) => o.trim()).filter(Boolean),
      correct_index: draft.correct_index,
      explanation: draft.explanation.trim(),
    };
    try {
      let saved;
      if (draft.id) {
        const resp = await api.put(`/quizzes/${draft.id}`, payload);
        saved = resp.question;
      } else {
        const resp = await api.post('/quizzes', payload);
        saved = resp.question;
      }
      updateDraft(idx, {
        id: saved.id,
        question: saved.question,
        options: saved.options,
        correct_index: saved.correct_index,
        explanation: saved.explanation || '',
        _dirty: false,
        _saving: false,
      });
      toast.success(draft.id ? 'Question updated' : 'Question added');
    } catch (err) {
      updateDraft(idx, { ...draft, _saving: false });
      toast.error(err?.response?.data?.error || 'Failed to save');
    }
  };

  const deleteDraft = async (idx, draft) => {
    if (!draft.id) {
      // Unsaved draft — just drop it locally.
      setDrafts((prev) => prev.filter((_, i) => i !== idx));
      return;
    }
    try {
      await api.delete(`/quizzes/${draft.id}`);
      setDrafts((prev) => prev.filter((_, i) => i !== idx));
      toast.success('Question deleted');
    } catch (err) {
      toast.error('Failed to delete');
    }
  };

  const addQuestion = () => setDrafts((prev) => [...prev, blankDraft()]);

  return (
    <Modal isOpen onClose={onClose} title={`Quiz — ${lesson.title}`} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-indigo-500" />
          Students need 70% to pass. Mark the lesson "required" to gate the certificate on it.
        </p>

        {loading ? (
          <div className="py-10 text-center text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mx-auto" />
          </div>
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
                draft={d}
                onChange={(next) => updateDraft(idx, next)}
                onSave={() => saveDraft(idx, d)}
                onDelete={() => deleteDraft(idx, d)}
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
    </Modal>
  );
}
