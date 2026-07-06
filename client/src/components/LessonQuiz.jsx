// Parent-portal quiz, now a FIRST-CLASS lesson (content_type === 'quiz') and
// the sole content of the CoursePlayer's main column when active. It loads
// questions WITHOUT answers, walks the student through them one at a time with
// big tap targets, submits for server-side scoring, then shows a pass/fail
// result with a per-question review (correct answer + explanation).
//
// Passing (score >= pass_threshold) gates the certificate for REQUIRED quizzes,
// so on a pass we call onPassed(lessonId) once to let the parent flip the
// lesson's quiz_passed flag locally (no refetch needed). Navigation is always
// soft: the student can move to the next lesson whether or not they passed.

import { useEffect, useRef, useState } from 'react';
import {
  ListChecks, CheckCircle2, XCircle, Check, RotateCcw, Loader2, Award,
  ChevronLeft, ChevronRight, SkipForward, PlayCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';

// Fisher–Yates — returns a new shuffled copy, leaving the input untouched.
function shuffleCopy(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function LessonQuiz({ lesson, lessonId, onPassed, nextLesson, onNext, endpointBase }) {
  const id = lessonId ?? lesson?.id;
  // Where to load/submit. Defaults to the course-lesson flow; an assignment
  // quiz passes endpointBase="/portal/assignments/<id>" to reuse this whole UI.
  const base = endpointBase || `/portal/lessons/${id}`;
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState([]);
  const [passThreshold, setPassThreshold] = useState(70);
  const [attempt, setAttempt] = useState(null);     // { score, attempts, passed }
  const [answers, setAnswers] = useState({});        // { [questionId]: optionIndex }
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);        // submit response
  // phase: 'intro' (start screen) | 'taking' (stepping) | 'review' (after submit)
  const [phase, setPhase] = useState('intro');
  const [step, setStep] = useState(0);               // current position while taking (index into `order`)
  // Shuffle state — `order` is the display order of question indices; `optOrders`
  // maps a question id to the display order of its ORIGINAL option indices. When
  // shuffle is off these are plain identity arrays, so the rest of the player is
  // agnostic. We always submit/store the ORIGINAL option index so server scoring
  // (which compares against the stored correct_index) stays correct, and the
  // review phase renders in original order untouched.
  const [order, setOrder] = useState([]);
  const [optOrders, setOptOrders] = useState({});
  const passedNotifiedRef = useRef(false);
  // Shuffle flag can come from the lesson prop (course flow) or the quiz
  // response (assignment flow, where there's no lesson object on the client).
  const [shuffleFlag, setShuffleFlag] = useState(lesson?.quiz_shuffle === true || lesson?.quiz_shuffle === 1);

  const required = lesson?.quiz_required === true || lesson?.quiz_required === 1;
  const shuffleOn = shuffleFlag;

  // Load (or reload on lesson change). Reset all interaction state.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setResult(null);
    setAnswers({});
    setPhase('intro');
    setStep(0);
    passedNotifiedRef.current = false;
    (async () => {
      try {
        const data = await api.get(`${base}/quiz`);
        if (cancelled) return;
        setQuestions(data.questions || []);
        setPassThreshold(data.pass_threshold || 70);
        setAttempt(data.attempt || null);
        // Prefer the server's shuffle flag when present (assignment flow);
        // otherwise keep the value derived from the lesson prop.
        if (data.quiz_shuffle !== undefined) {
          setShuffleFlag(data.quiz_shuffle === true || data.quiz_shuffle === 1);
        }
        if (data.attempt?.passed) passedNotifiedRef.current = true;
      } catch {
        if (!cancelled) toast.error('Failed to load quiz');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [base]);

  const total = questions.length;
  // "Answered" depends on the question type: an index for choice, a non-empty
  // array for multi, a non-empty string for short.
  const isAnswered = (q) => {
    const a = answers[String(q.id)];
    const t = q.question_type || 'single';
    if (t === 'multi') return Array.isArray(a) && a.length > 0;
    if (t === 'short') return typeof a === 'string' && a.trim().length > 0;
    return a !== undefined && a !== null;
  };
  const answeredCount = questions.filter(isAnswered).length;
  const allAnswered = total > 0 && answeredCount === total;

  const startQuiz = () => {
    setResult(null);
    setAnswers({});
    setStep(0);
    // Recompute display orders for this attempt. Identity when shuffle is off;
    // freshly shuffled on every (re)take when on.
    const qIdx = questions.map((_, i) => i);
    const optMap = {};
    questions.forEach((q) => {
      const base = (q.options || []).map((_, i) => i);
      optMap[String(q.id)] = shuffleOn ? shuffleCopy(base) : base;
    });
    setOrder(shuffleOn ? shuffleCopy(qIdx) : qIdx);
    setOptOrders(optMap);
    setPhase('taking');
  };

  const submit = async () => {
    if (!allAnswered) { toast.error('Answer every question first'); return; }
    setSubmitting(true);
    try {
      const resp = await api.post(`${base}/quiz/submit`, { answers });
      setResult(resp);
      setPhase('review');
      setAttempt({ score: resp.score, attempts: (attempt?.attempts || 0) + 1, passed: resp.passed || attempt?.passed });
      if (resp.passed && !passedNotifiedRef.current) {
        passedNotifiedRef.current = true;
        onPassed?.(id);
        toast.success(`Passed — ${resp.score}%`);
      } else if (!resp.passed) {
        toast.error(`Scored ${resp.score}% — need ${resp.pass_threshold}% to pass`);
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to submit quiz');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="card flex items-center justify-center" style={{ minHeight: '40vh' }}>
        <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
      </div>
    );
  }

  // A quiz lesson with no authored questions — nothing to do.
  if (total === 0) {
    return (
      <div className="card text-center py-12">
        <ListChecks className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <h3 className="font-semibold text-gray-900">{lesson?.title || 'Quiz'}</h3>
        <p className="text-sm text-gray-500 mt-1">No questions have been added to this quiz yet.</p>
        {nextLesson && (
          <button onClick={onNext} className="btn-primary btn-sm mt-5">
            <SkipForward className="w-4 h-4" /> Next lesson
          </button>
        )}
      </div>
    );
  }

  // ---------- INTRO ----------
  if (phase === 'intro') {
    const passedBefore = attempt?.passed;
    return (
      <div className="card text-center py-10 px-5">
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
          passedBefore ? 'bg-green-100' : 'bg-indigo-100'
        }`}>
          {passedBefore
            ? <Award className="w-8 h-8 text-green-600" />
            : <ListChecks className="w-8 h-8 text-indigo-600" />}
        </div>
        <h2 className="text-xl font-bold text-gray-900">{lesson?.title || 'Quiz'}</h2>
        <p className="text-sm text-gray-500 mt-1">
          {total} question{total === 1 ? '' : 's'} · pass mark {passThreshold}%
        </p>

        {/* Required / optional pill */}
        <div className="mt-3 flex justify-center">
          {required ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 px-3 py-1 rounded-full">
              Required to earn your certificate
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
              Optional — you can skip this
            </span>
          )}
        </div>

        {/* Prior attempt summary */}
        {attempt && (
          <div className={`mt-5 mx-auto max-w-sm rounded-lg p-3 text-sm font-medium flex items-center justify-center gap-2 ${
            passedBefore ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
          }`}>
            {passedBefore
              ? <><CheckCircle2 className="w-5 h-5" /> You passed with {attempt.score}%</>
              : <>Last attempt: {attempt.score}% — need {passThreshold}%</>}
          </div>
        )}

        <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
          <button onClick={startQuiz} className="btn-primary justify-center">
            {attempt ? <><RotateCcw className="w-4 h-4" /> Retake quiz</> : <><PlayCircle className="w-4 h-4" /> Start quiz</>}
          </button>
          {passedBefore && nextLesson && (
            <button onClick={onNext} className="btn-secondary justify-center">
              <SkipForward className="w-4 h-4" /> Next lesson
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---------- TAKING (one question at a time) ----------
  if (phase === 'taking') {
    const q = questions[order[step] ?? step];
    const qid = String(q.id);
    const selected = answers[qid];
    const qtype = q.question_type || 'single';
    const isLast = step === total - 1;
    const progressPct = Math.round((answeredCount / total) * 100);
    // Display order of this question's options (original indices). Falls back to
    // natural order if not yet computed.
    const optOrder = optOrders[qid] || q.options.map((_, i) => i);
    return (
      <div className="card">
        {/* Progress header */}
        <div className="flex items-center justify-between gap-3 mb-1">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Question {step + 1} of {total}
          </span>
          <span className="text-xs text-gray-400">{answeredCount}/{total} answered</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-5">
          <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
        </div>

        {/* Question */}
        <p className="text-base sm:text-lg font-semibold text-gray-900 mb-4">{q.question}</p>

        {/* Answer input by type. Choice types render in display order but store
            the ORIGINAL option index so server scoring stays correct. */}
        {qtype === 'short' ? (
          <input
            type="text"
            value={typeof selected === 'string' ? selected : ''}
            onChange={(e) => setAnswers((prev) => ({ ...prev, [qid]: e.target.value }))}
            placeholder="Type your answer…"
            className="input-field w-full text-base"
          />
        ) : (
          <div className="space-y-2.5">
            {optOrder.map((oi) => {
              const opt = q.options[oi];
              const isMulti = qtype === 'multi';
              const active = isMulti ? (Array.isArray(selected) && selected.includes(oi)) : selected === oi;
              return (
                <button
                  key={oi}
                  type="button"
                  onClick={() => setAnswers((prev) => {
                    if (!isMulti) return { ...prev, [qid]: oi };
                    const cur = Array.isArray(prev[qid]) ? prev[qid] : [];
                    return { ...prev, [qid]: cur.includes(oi) ? cur.filter((x) => x !== oi) : [...cur, oi] };
                  })}
                  className={`w-full text-left flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 text-sm sm:text-base transition-colors ${
                    active ? 'border-indigo-500 bg-indigo-50 text-indigo-900' : 'border-gray-200 hover:border-indigo-300 text-gray-800'
                  }`}
                >
                  <span className={`w-5 h-5 ${isMulti ? 'rounded' : 'rounded-full'} border-2 flex items-center justify-center flex-shrink-0 ${
                    active ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-gray-300 text-transparent'
                  }`}>
                    <Check className="w-3 h-3" />
                  </span>
                  <span className="flex-1">{opt}</span>
                </button>
              );
            })}
            {qtype === 'multi' && <p className="text-xs text-gray-400 pt-1">Select all that apply.</p>}
          </div>
        )}

        {/* Nav */}
        <div className="mt-6 flex items-center justify-between gap-2">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="btn-secondary btn-sm disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          {isLast ? (
            <button
              onClick={submit}
              disabled={submitting || !allAnswered}
              className="btn-primary disabled:opacity-40"
              title={!allAnswered ? 'Answer every question first' : 'Submit your answers'}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Submit answers
            </button>
          ) : (
            <button
              onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
              disabled={!isAnswered(q)}
              className="btn-primary disabled:opacity-40"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Dots — jump between questions (in display order) */}
        <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
          {order.map((qIdx, i) => {
            const qq = questions[qIdx];
            if (!qq) return null;
            const ans = isAnswered(qq);
            return (
              <button
                key={qq.id}
                onClick={() => setStep(i)}
                aria-label={`Go to question ${i + 1}`}
                className={`w-2.5 h-2.5 rounded-full transition-colors ${
                  i === step ? 'bg-indigo-600 ring-2 ring-indigo-200' : ans ? 'bg-indigo-300' : 'bg-gray-200'
                }`}
              />
            );
          })}
        </div>
      </div>
    );
  }

  // ---------- REVIEW (after submit) ----------
  const resultById = result ? new Map(result.results.map((r) => [String(r.id), r])) : null;
  return (
    <div className="card">
      {/* Result banner */}
      {result && (
        <div className={`rounded-xl p-4 mb-5 text-center ${result.passed ? 'bg-green-50' : 'bg-red-50'}`}>
          <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-2 ${
            result.passed ? 'bg-green-100' : 'bg-red-100'
          }`}>
            {result.passed
              ? <Award className="w-7 h-7 text-green-600" />
              : <XCircle className="w-7 h-7 text-red-600" />}
          </div>
          <h3 className={`text-lg font-bold ${result.passed ? 'text-green-700' : 'text-red-700'}`}>
            {result.passed ? 'You passed!' : 'Not quite yet'}
          </h3>
          <p className={`text-sm mt-0.5 ${result.passed ? 'text-green-600' : 'text-red-600'}`}>
            {result.correct_count}/{result.total} correct · {result.score}%
            {!result.passed && ` · need ${result.pass_threshold}%`}
          </p>
        </div>
      )}

      <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Review</h4>
      <div className="space-y-5">
        {questions.map((q, qi) => {
          const qid = String(q.id);
          const r = resultById?.get(qid);
          return (
            <div key={qid}>
              <p className="text-sm font-medium text-gray-900 mb-2">
                <span className="text-gray-400 mr-1">Q{qi + 1}.</span>{q.question}
              </p>
              {q.question_type === 'short' ? (
                <div className="space-y-1.5">
                  <div className={`px-3 py-2 rounded-lg border text-sm flex items-center gap-2 ${r?.is_correct ? 'border-green-400 bg-green-50' : 'border-red-400 bg-red-50'}`}>
                    <span className="flex-1 text-gray-800">
                      <span className="text-gray-500">Your answer: </span>
                      {typeof r?.selected === 'string' && r.selected ? r.selected : <em className="text-gray-400">blank</em>}
                    </span>
                    {r?.is_correct
                      ? <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                      : <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />}
                  </div>
                  {!r?.is_correct && (r?.correct_answers?.length > 0) && (
                    <p className="text-xs text-green-700">Accepted: {r.correct_answers.join(', ')}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {q.options.map((opt, oi) => {
                    const correctSet = q.question_type === 'multi'
                      ? new Set((r?.correct_answers || []).map(Number))
                      : new Set([Number(r?.correct_index)]);
                    const selSet = q.question_type === 'multi'
                      ? new Set((Array.isArray(r?.selected) ? r.selected : []).map(Number))
                      : new Set([Number(r?.selected_index)]);
                    let optClass = 'border-gray-200';
                    let icon = null;
                    if (r) {
                      if (correctSet.has(oi)) { optClass = 'border-green-400 bg-green-50'; icon = <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />; }
                      else if (selSet.has(oi)) { optClass = 'border-red-400 bg-red-50'; icon = <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />; }
                    }
                    return (
                      <div
                        key={oi}
                        className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm ${optClass}`}
                      >
                        <span className="flex-1 text-gray-800">{opt}</span>
                        {icon}
                      </div>
                    );
                  })}
                </div>
              )}
              {r?.explanation && (
                <p className="text-xs text-gray-500 mt-2 border-l-2 border-indigo-200 pl-3">
                  {r.explanation}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer actions */}
      <div className="mt-6 pt-4 border-t border-gray-100 flex flex-col sm:flex-row gap-2 sm:justify-end">
        {result && !result.passed && (
          <button onClick={startQuiz} className="btn-primary justify-center">
            <RotateCcw className="w-4 h-4" /> Try again
          </button>
        )}
        {result && result.passed && (
          <button onClick={startQuiz} className="btn-secondary justify-center">
            <RotateCcw className="w-4 h-4" /> Retake
          </button>
        )}
        {nextLesson && (
          <button onClick={onNext} className="btn-primary justify-center">
            <SkipForward className="w-4 h-4" /> Next lesson
          </button>
        )}
      </div>
    </div>
  );
}
