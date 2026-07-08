// Slide-in detail panel for a quiz (opened from the Quizzes list). Mirrors the
// StudentDetailPanel layout: sticky toolbar with the identity + primary action,
// then a scrollable body of sections. Shows what the quiz is attached to
// (course / assignment / standalone), its questions with the answer key, and
// every student who has attempted it. Read-only; "Edit questions" hands off to
// the full-screen QuizEditor. Base classes auto-theme (light + dark).

import { useEffect, useRef, useState } from 'react';
import {
  X, Edit2, ListChecks, BookOpen, ClipboardList, FileQuestion,
  CheckCircle2, Circle, XCircle, Loader2, Users, ChevronDown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { quizGrade } from '../utils/quizGrade';

const TYPE_LABEL = { single: 'Single choice', truefalse: 'True / False', multi: 'Multiple answers', short: 'Short answer' };

export default function QuizDetailPanel({ lessonId, onClose, onEdit }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Swipe-down-to-dismiss on the toolbar (mobile), same pattern as the student panel.
  const touchStart = useRef(null);
  const onTouchStart = (e) => { const t = e.touches[0]; touchStart.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e) => {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dy = t.clientY - touchStart.current.y;
    const dx = t.clientX - touchStart.current.x;
    touchStart.current = null;
    if (dy > 70 && Math.abs(dy) > Math.abs(dx)) onClose();
  };

  useEffect(() => {
    if (!lessonId) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lessonId, onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const d = await api.getFresh(`/quizzes/${lessonId}/detail`);
        if (!cancelled) setData(d);
      } catch {
        if (!cancelled) toast.error('Could not load quiz');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [lessonId]);

  if (!lessonId) return null;

  const quiz = data?.quiz;
  const questions = data?.questions || [];
  const attempts = data?.attempts || [];
  const assoc = quiz?.association || { kind: 'standalone', name: '' };
  const passMark = quiz?.settings?.quiz_pass_mark || 70;

  const AssocIcon = assoc.kind === 'course' ? BookOpen : assoc.kind === 'assignment' ? ClipboardList : FileQuestion;
  const assocText = assoc.kind === 'standalone' ? 'Standalone' : `${assoc.kind === 'course' ? 'Course' : 'Assignment'}: ${assoc.name}`;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40 lg:bg-transparent lg:pointer-events-none" onClick={onClose} />
      <aside
        className="fixed top-0 right-0 h-full w-full sm:w-[28rem] lg:w-[32rem] bg-white border-l border-gray-200 shadow-xl z-50 flex flex-col"
        role="dialog"
        aria-label="Quiz details"
      >
        {/* Sticky toolbar */}
        <div
          className="border-b border-gray-200 bg-gradient-to-b from-indigo-50/60 to-white dark:from-[#2b2f36] dark:to-[#2b2f36]"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div className="flex justify-center pt-2 lg:hidden">
            <div className="h-1 w-10 rounded-full bg-gray-300" />
          </div>
          <div className="flex items-center justify-between px-4 pt-3">
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-200/60 transition-colors text-gray-500" title="Close (Esc)">
              <X className="w-5 h-5" />
            </button>
            <button onClick={() => onEdit(quiz || { id: lessonId })} className="btn-primary btn-sm">
              <Edit2 className="w-3.5 h-3.5" /> Edit questions
            </button>
          </div>
          <div className="flex items-start gap-3 px-4 pt-3 pb-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center flex-shrink-0">
              <ListChecks className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold text-gray-900 truncate">{quiz?.title || 'Quiz'}</h2>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  <AssocIcon className="w-3 h-3" /> {assocText}
                </span>
                <span className="text-xs text-gray-500">{questions.length} question{questions.length === 1 ? '' : 's'}</span>
                <span className="text-xs text-gray-500">Pass {passMark}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {loading ? (
            <div className="py-12 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
          ) : (
            <>
              {/* Responses */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> Responses
                  <span className="ml-1 text-gray-300 normal-case font-normal">{attempts.length}</span>
                </h3>
                {attempts.length === 0 ? (
                  <p className="text-sm text-gray-400 py-3 px-3 border border-dashed border-gray-200 rounded-lg">
                    No students have attempted this quiz yet.
                  </p>
                ) : (
                  <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                    {attempts.map((a) => (
                      <StudentAttemptRow key={a.student_id} lessonId={lessonId} attempt={a} bands={quiz?.settings?.quiz_grade_bands} />
                    ))}
                  </div>
                )}
              </div>

              {/* Questions with the answer key */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Questions</h3>
                {questions.length === 0 ? (
                  <p className="text-sm text-gray-400 py-3 px-3 border border-dashed border-gray-200 rounded-lg">
                    No questions yet. Use "Edit questions" to add some.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {questions.map((q, i) => (
                      <QuestionView key={q.id || i} q={q} index={i} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

// One student's response row, expandable to a per-question breakdown fetched on
// demand (so opening the panel stays a single read; details load per student).
function StudentAttemptRow({ lessonId, attempt, bands }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const grade = quizGrade(attempt.score, attempt.passed, bands);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail && !loading) {
      setLoading(true);
      try {
        const d = await api.getFresh(`/quizzes/${lessonId}/attempt/${attempt.student_id}`);
        setDetail(d);
      } catch {
        toast.error('Could not load this response');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div>
      <button onClick={toggle} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors">
        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
          {(attempt.student_name || '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{attempt.student_name}</p>
          <p className="text-xs text-gray-500">
            {attempt.correct_count}/{attempt.total_questions} correct
            {attempt.attempts > 1 ? ` · ${attempt.attempts} attempts` : ''}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-semibold text-gray-900">{attempt.score}%</p>
          <span className={`inline-block text-[11px] font-medium px-1.5 py-0.5 rounded ${grade.badgeClass}`}>{grade.label}</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-3 pb-3 bg-gray-50/60">
          {loading ? (
            <div className="py-3 text-center text-gray-400"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>
          ) : !detail ? null : !detail.has_answers ? (
            <p className="text-xs text-gray-500 py-2">Detailed answers were not recorded for this attempt (it predates answer capture).</p>
          ) : (
            <div className="space-y-2 pt-1">
              {detail.breakdown.map((r, i) => (
                <div key={r.id || i} className="text-sm border-t border-gray-100 pt-2 first:border-t-0">
                  <p className="text-gray-800"><span className="text-gray-400 mr-1">{i + 1}.</span>{r.question}</p>
                  <p className={`mt-0.5 flex items-start gap-1.5 ${r.is_correct ? 'text-green-700' : 'text-red-600'}`}>
                    {r.is_correct ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                    <span>{answerText(r, r.selected)}</span>
                  </p>
                  {!r.is_correct && (
                    <p className="text-xs text-gray-500 ml-5">Correct: {correctText(r)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Render the student's submitted answer as text, by question type.
function answerText(q, value) {
  if (value === null || value === undefined || value === '') return 'No answer';
  const type = q.question_type || 'single';
  if (type === 'short') return String(value);
  if (type === 'multi') {
    const idxs = Array.isArray(value) ? value : [];
    const picked = idxs.map((i) => (q.options || [])[i]).filter(Boolean);
    return picked.length ? picked.join(', ') : 'No answer';
  }
  return (q.options || [])[Number(value)] || 'No answer';
}

// Render the correct answer(s) as text, by question type.
function correctText(q) {
  const type = q.question_type || 'single';
  if (type === 'short') return (q.correct_answers || []).join(' / ');
  if (type === 'multi') return (q.correct_answers || []).map((i) => (q.options || [])[i]).filter(Boolean).join(', ');
  return (q.options || [])[q.correct_index] || '';
}

// Read-only render of one question with the correct answer(s) highlighted.
function QuestionView({ q, index }) {
  const type = q.question_type || 'single';
  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-gray-900 flex-1">
          <span className="text-gray-400 mr-1.5">Q{index + 1}.</span>{q.question}
        </p>
        <span className="text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0">{q.points} mark{q.points === 1 ? '' : 's'}</span>
      </div>
      <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">{TYPE_LABEL[type] || 'Single choice'}</p>

      {type === 'short' ? (
        <div className="space-y-1">
          {(q.correct_answers || []).map((a, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> {a}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {(q.options || []).map((opt, i) => {
            const correct = type === 'multi' ? (q.correct_answers || []).includes(i) : q.correct_index === i;
            return (
              <div key={i} className={`flex items-center gap-2 text-sm ${correct ? 'text-green-700 font-medium' : 'text-gray-600'}`}>
                {correct ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <Circle className="w-4 h-4 flex-shrink-0 text-gray-300" />}
                {opt}
              </div>
            );
          })}
        </div>
      )}

      {q.explanation && <p className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-100">{q.explanation}</p>}
    </div>
  );
}
