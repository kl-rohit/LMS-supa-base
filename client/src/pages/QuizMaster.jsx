// Quiz Master — full-page analysis of a quiz's responses. Score summary,
// grade distribution, per-question difficulty + option/distractor breakdown,
// and an expandable responses table with CSV export. Reached at
// /quizzes/:lessonId. Base classes auto-theme (light + dark).
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Edit2, Download, Users, CheckCircle2, XCircle, Circle,
  ChevronDown, Loader2, BookOpen, ClipboardList, FileQuestion, Share2, Trash2, Trophy,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Loader from '../components/Loader';
import Modal from '../components/Modal';
import TargetPicker from '../components/TargetPicker';
import { MetricCard, Panel, SectionLabel } from '../components/ConsoleUI';
import { quizGrade } from '../utils/quizGrade';

const TYPE_LABEL = { single: 'Single choice', truefalse: 'True / False', multi: 'Multiple answers', short: 'Short answer' };

// Difficulty from the % who got it right (lower % = harder).
function difficulty(pct) {
  if (pct == null) return { label: 'No data', cls: 'bg-gray-100 text-gray-500' };
  if (pct >= 80) return { label: 'Easy', cls: 'bg-green-50 text-green-700' };
  if (pct >= 40) return { label: 'Medium', cls: 'bg-amber-50 text-amber-700' };
  return { label: 'Hard', cls: 'bg-rose-50 text-rose-700' };
}

export default function QuizMaster() {
  const { lessonId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Filter analytics to one group's members (client-side, on the response set).
  const [groupFilter, setGroupFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try { const d = await api.getFresh(`/quizzes/${lessonId}/analytics`); if (!cancelled) setData(d); }
      catch { if (!cancelled) toast.error('Could not load quiz analytics'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [lessonId]);

  // Assign-from-quiz state. A quiz reaches students through a quiz-assignment
  // (kind='quiz', quiz_lesson_id=this quiz); we create/edit it right here so you
  // never open the Assignments module for quizzes.
  const [assignOpen, setAssignOpen] = useState(false);
  const [existingAsg, setExistingAsg] = useState(null);
  const [target, setTarget] = useState({ target_type: 'all', target_id: '', target_ids: [] });
  const [groups, setGroups] = useState([]);
  const [students, setStudents] = useState([]);
  const [assigning, setAssigning] = useState(false);

  const loadAssignment = () => api.get('/assignments').then((r) => {
    const a = (r.assignments || []).find((x) => String(x.quiz_lesson_id) === String(lessonId) && x.kind === 'quiz');
    setExistingAsg(a || null);
    if (a) setTarget({ target_type: a.target_type || 'all', target_id: a.target_id ? String(a.target_id) : '', target_ids: Array.isArray(a.target_ids) ? a.target_ids.map(String) : [] });
    return a || null;
  }).catch(() => null);
  useEffect(() => { loadAssignment(); }, [lessonId]);

  // Load groups (with members) up-front so the analytics group filter works
  // without opening the assign modal first.
  useEffect(() => { api.get('/groups').then((r) => setGroups(r.groups || [])).catch(() => {}); }, []);

  if (loading) return <Loader text="Loading analysis..." />;
  if (!data) return <div className="text-center py-12 text-gray-500">Could not load this quiz.</div>;

  const { quiz, summary, per_question: perQ, responses } = data;
  const bands = quiz.grade_bands;
  const assoc = quiz.association || { kind: 'standalone', name: '' };
  const AssocIcon = assoc.kind === 'course' ? BookOpen : assoc.kind === 'assignment' ? ClipboardList : FileQuestion;
  const assocText = assoc.kind === 'standalone' ? 'Standalone' : `${assoc.kind === 'course' ? 'Course' : 'Assignment'}: ${assoc.name}`;

  // A course quiz is delivered by course enrolment; only standalone quizzes are
  // assigned here.
  const canAssign = assoc.kind !== 'course';
  const asgLabel = !existingAsg ? 'Not assigned yet'
    : existingAsg.target_type === 'all' ? 'Assigned to everyone'
    : existingAsg.target_type === 'group' ? 'Assigned to a group'
    : existingAsg.target_type === 'students' ? `Assigned to ${(existingAsg.target_ids || []).length} student${(existingAsg.target_ids || []).length === 1 ? '' : 's'}`
    : 'Assigned';

  const openAssign = () => {
    setAssignOpen(true);
    if (groups.length === 0) api.get('/groups').then((r) => setGroups(r.groups || [])).catch(() => {});
    if (students.length === 0) api.get('/students?limit=500').then((r) => setStudents(r.students || [])).catch(() => {});
  };
  const saveAssign = async () => {
    if (target.target_type === 'group' && !target.target_id) { toast.error('Pick a group'); return; }
    if (target.target_type === 'students' && (target.target_ids || []).length === 0) { toast.error('Pick at least one student'); return; }
    setAssigning(true);
    try {
      const body = { target_type: target.target_type, target_id: target.target_id || null, target_ids: target.target_ids || [] };
      if (existingAsg) await api.put(`/assignments/${existingAsg.id}`, body);
      else await api.post('/assignments', { title: quiz.title, kind: 'quiz', quiz_lesson_id: String(lessonId), ...body });
      await loadAssignment();
      setAssignOpen(false);
      toast.success('Quiz assigned');
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message || 'Could not assign');
    } finally {
      setAssigning(false);
    }
  };
  const unassign = async () => {
    if (!existingAsg) return;
    try { await api.delete(`/assignments/${existingAsg.id}`); setExistingAsg(null); setAssignOpen(false); toast.success('Quiz unassigned'); }
    catch { toast.error('Could not unassign'); }
  };

  // Group filter: narrow the response set to one group's members (client-side).
  // Per-question analysis stays global (it is computed server-side); the filter
  // drives the leaderboard, grade distribution, and responses list.
  const filterGroup = groupFilter === 'all' ? null : groups.find((g) => String(g.id) === String(groupFilter));
  const memberSet = filterGroup ? new Set((filterGroup.members || []).map(String)) : null;
  const shownResponses = memberSet ? responses.filter((r) => memberSet.has(String(r.student_id))) : responses;

  // Leaderboard: highest score first, tie-break by fewer attempts then earlier
  // submission (rewards getting it right first, in fewer tries).
  const leaderboard = [...shownResponses].sort((a, b) =>
    (b.score - a.score)
    || ((a.attempts || 1) - (b.attempts || 1))
    || (new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0))
  );

  // Grade distribution across the shown responses.
  const gradeTally = {};
  shownResponses.forEach((r) => { const g = quizGrade(r.score, r.passed, bands).label; gradeTally[g] = (gradeTally[g] || 0) + 1; });
  const gradeRows = Object.entries(gradeTally).sort((a, b) => b[1] - a[1]);

  const exportCsv = () => {
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [];
    lines.push(['Student', 'Score %', 'Correct', 'Total', 'Passed', 'Attempts', 'Submitted'].map(esc).join(','));
    responses.forEach((r) => lines.push([r.student_name, r.score, r.correct_count, r.total_questions, r.passed ? 'Yes' : 'No', r.attempts, r.submitted_at ? new Date(r.submitted_at).toLocaleString() : ''].map(esc).join(',')));
    lines.push('');
    lines.push(['Question', 'Answered', 'Correct', 'Correct %'].map(esc).join(','));
    perQ.forEach((q, i) => lines.push([`Q${i + 1}. ${q.question}`, q.answered, q.correct, q.correct_pct == null ? '' : q.correct_pct].map(esc).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${(quiz.title || 'quiz').replace(/[^a-z0-9]+/gi, '-')}-responses.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <button onClick={() => navigate('/quizzes')} className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1 mb-1">
            <ArrowLeft className="w-4 h-4" /> All quizzes
          </button>
          <h1 className="text-2xl font-bold text-gray-900 leading-tight truncate">{quiz.title}</h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600"><AssocIcon className="w-3 h-3" /> {assocText}</span>
            <span className="text-xs text-gray-500">{quiz.question_count} question{quiz.question_count === 1 ? '' : 's'}</span>
            <span className="text-xs text-gray-500">Pass {quiz.pass_mark}%</span>
            {canAssign && (
              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${existingAsg ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                <Share2 className="w-3 h-3" /> {asgLabel}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {canAssign && (
            <button onClick={openAssign} className="btn-secondary btn-sm"><Share2 className="w-4 h-4" /> <span className="hidden sm:inline">{existingAsg ? 'Manage assignment' : 'Assign'}</span></button>
          )}
          <button onClick={exportCsv} disabled={!responses.length} className="btn-secondary btn-sm disabled:opacity-40"><Download className="w-4 h-4" /> <span className="hidden sm:inline">Export CSV</span></button>
          <button onClick={() => navigate(`/quizzes/${lessonId}/edit`)} className="btn-primary btn-sm"><Edit2 className="w-4 h-4" /> Edit questions</button>
        </div>
      </div>

      {/* Assign-to-students modal (standalone from the quiz; no need to open Assignments) */}
      <Modal
        isOpen={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="Assign this quiz"
        size="md"
        onSave={saveAssign}
        saveLabel={assigning ? 'Saving…' : existingAsg ? 'Update' : 'Assign'}
        saveDisabled={assigning}
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-500">Choose who takes this quiz. Students see it in their portal under Assignments, and their scores flow back here.</p>
          <TargetPicker
            value={target}
            groups={groups}
            students={students}
            onChange={setTarget}
            label="Assign to"
            onCreateStudent={() => api.get('/students?limit=500').then((r) => setStudents(r.students || [])).catch(() => {})}
            onCreateGroup={() => api.get('/groups').then((r) => setGroups(r.groups || [])).catch(() => {})}
          />
          {existingAsg && (
            <button type="button" onClick={unassign} className="text-sm text-red-600 hover:text-red-700 font-medium inline-flex items-center gap-1.5">
              <Trash2 className="w-4 h-4" /> Unassign (remove from students)
            </button>
          )}
        </div>
      </Modal>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <MetricCard label="Responses" value={summary.attempts} accent="indigo" icon={Users} />
        <MetricCard label="Average score" value={`${summary.avg_score}%`} accent="blue" />
        <MetricCard label="Pass rate" value={`${summary.pass_rate}%`} sub={`${summary.pass_count} of ${summary.attempts} passed`} tone={summary.pass_rate >= 70 ? 'good' : summary.pass_rate >= 40 ? 'warn' : 'bad'} accent="emerald" />
        <MetricCard label="Median / range" value={`${summary.median}%`} sub={summary.attempts ? `${summary.low}% to ${summary.high}%` : ''} accent="violet" />
      </div>

      {summary.attempts === 0 ? (
        <Panel><p className="text-sm text-gray-400 text-center py-6">No one has attempted this quiz yet. Analysis appears once students submit.</p></Panel>
      ) : (
        <>
          {/* Group filter — scopes the leaderboard, grade distribution, and
              responses to one group's members. */}
          {groups.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Filter by group</span>
              <select
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                className="input-field text-sm w-auto py-1.5"
              >
                <option value="all">All students</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.member_count ?? (g.members ? g.members.length : 0)})</option>)}
              </select>
              {filterGroup && (
                <span className="text-xs text-gray-500">{shownResponses.length} of {responses.length} responses</span>
              )}
            </div>
          )}

          {shownResponses.length === 0 ? (
            <Panel><p className="text-sm text-gray-400 text-center py-6">No one in this group has attempted the quiz yet.</p></Panel>
          ) : (
          <>
          {/* Leaderboard — top scorers first. */}
          <Panel title={<span className="flex items-center gap-1.5"><Trophy className="w-3.5 h-3.5" /> Leaderboard</span>}>
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {leaderboard.slice(0, 10).map((r, i) => {
                const grade = quizGrade(r.score, r.passed, bands);
                const medal = i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-gray-200 text-gray-700' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500';
                return (
                  <div key={r.student_id} className="flex items-center gap-3 px-3 py-2">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${medal}`}>{i + 1}</span>
                    <span className="text-sm font-medium text-gray-900 truncate flex-1">{r.student_name}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">{r.correct_count}/{r.total_questions}{r.attempts > 1 ? ` · ${r.attempts} tries` : ''}</span>
                    <span className="text-sm font-semibold text-gray-900 w-12 text-right flex-shrink-0">{r.score}%</span>
                    <span className={`inline-block text-[11px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${grade.badgeClass}`}>{grade.label}</span>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* Grade distribution */}
          {gradeRows.length > 0 && (
            <Panel title="Grade distribution">
              <div className="space-y-2">
                {gradeRows.map(([label, count]) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-sm text-gray-700 w-28 flex-shrink-0 truncate">{label}</span>
                    <div className="flex-1 h-2.5 rounded bg-gray-100 overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded" style={{ width: `${Math.round((count / shownResponses.length) * 100)}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-10 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* Per-question analysis (always across all responses) */}
          <Panel title={<span>Question analysis{filterGroup ? <span className="text-gray-300 normal-case font-normal"> · all responses</span> : ''}</span>}>
            {summary.with_answers === 0 ? (
              <p className="text-sm text-gray-400 py-2">Per-question detail is available for attempts made after answer capture was enabled. New attempts will populate this.</p>
            ) : (
              <div className="space-y-4">
                {perQ.map((q, i) => <QuestionStat key={q.id || i} q={q} index={i} />)}
              </div>
            )}
          </Panel>

          {/* Responses */}
          <Panel title={<span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Responses <span className="text-gray-300 normal-case font-normal">{shownResponses.length}</span></span>}>
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {shownResponses.map((r) => <ResponseRow key={r.student_id} lessonId={lessonId} r={r} bands={bands} />)}
            </div>
          </Panel>
          </>
          )}
        </>
      )}
    </div>
  );
}

// One question's stats: difficulty + how the options were chosen (distractors).
function QuestionStat({ q, index }) {
  const type = q.question_type || 'single';
  const diff = difficulty(q.correct_pct);
  const total = q.answered || 0;
  // The most-picked wrong option is the "top distractor".
  let topDistractor = -1, topDistractorCount = -1;
  if (type !== 'short') {
    (q.option_counts || []).forEach((c, i) => {
      const isCorrect = type === 'multi' ? (q.correct_answers || []).includes(i) : q.correct_index === i;
      if (!isCorrect && c > topDistractorCount) { topDistractorCount = c; topDistractor = i; }
    });
  }
  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-sm font-medium text-gray-900"><span className="text-gray-400 mr-1.5">Q{index + 1}.</span>{q.question}</p>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${diff.cls}`}>
          {q.correct_pct == null ? 'No data' : `${q.correct_pct}% correct · ${diff.label}`}
        </span>
      </div>
      <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">{TYPE_LABEL[type] || 'Single choice'} · {total} answered</p>

      {type === 'short' ? (
        <p className="text-sm text-green-700 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> {(q.correct_answers || []).join(' / ')}</p>
      ) : (
        <div className="space-y-1.5">
          {(q.options || []).map((opt, i) => {
            const isCorrect = type === 'multi' ? (q.correct_answers || []).includes(i) : q.correct_index === i;
            const count = (q.option_counts || [])[i] || 0;
            const pct = total ? Math.round((count / total) * 100) : 0;
            const isDistractor = i === topDistractor && topDistractorCount > 0;
            return (
              <div key={i} className="flex items-center gap-2 text-sm">
                {isCorrect ? <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" /> : <Circle className="w-4 h-4 text-gray-300 flex-shrink-0" />}
                <span className={`w-40 sm:w-56 truncate ${isCorrect ? 'text-green-700 font-medium' : 'text-gray-700'}`}>{opt}</span>
                <div className="flex-1 h-2 rounded bg-gray-100 overflow-hidden">
                  <div className={`h-full rounded ${isCorrect ? 'bg-green-500' : 'bg-gray-300'}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-gray-500 w-16 text-right">{count} ({pct}%)</span>
                {isDistractor && <span className="text-[10px] font-medium text-rose-600 whitespace-nowrap">top miss</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// A response row, expandable to the student's per-question answers (loaded on demand).
function ResponseRow({ lessonId, r, bands }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const grade = quizGrade(r.score, r.passed, bands);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail && !loading) {
      setLoading(true);
      try { setDetail(await api.getFresh(`/quizzes/${lessonId}/attempt/${r.student_id}`)); }
      catch { toast.error('Could not load this response'); }
      finally { setLoading(false); }
    }
  };

  return (
    <div>
      <button onClick={toggle} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors">
        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">{(r.student_name || '?').slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{r.student_name}</p>
          <p className="text-xs text-gray-500">{r.correct_count}/{r.total_questions} correct{r.attempts > 1 ? ` · ${r.attempts} attempts` : ''}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-semibold text-gray-900">{r.score}%</p>
          <span className={`inline-block text-[11px] font-medium px-1.5 py-0.5 rounded ${grade.badgeClass}`}>{grade.label}</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 bg-gray-50/60">
          {loading ? (
            <div className="py-3 text-center text-gray-400"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>
          ) : !detail ? null : !detail.has_answers ? (
            <p className="text-xs text-gray-500 py-2">Detailed answers were not recorded for this attempt.</p>
          ) : (
            <div className="space-y-2 pt-1">
              {detail.breakdown.map((b, i) => (
                <div key={b.id || i} className="text-sm border-t border-gray-100 pt-2 first:border-t-0">
                  <p className="text-gray-800"><span className="text-gray-400 mr-1">{i + 1}.</span>{b.question}</p>
                  <p className={`mt-0.5 flex items-start gap-1.5 ${b.is_correct ? 'text-green-700' : 'text-red-600'}`}>
                    {b.is_correct ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                    <span>{answerText(b, b.selected)}</span>
                  </p>
                  {!b.is_correct && <p className="text-xs text-gray-500 ml-5">Correct: {correctText(b)}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function answerText(q, value) {
  if (value === null || value === undefined || value === '') return 'No answer';
  const type = q.question_type || 'single';
  if (type === 'short') return String(value);
  if (type === 'multi') { const picked = (Array.isArray(value) ? value : []).map((i) => (q.options || [])[i]).filter(Boolean); return picked.length ? picked.join(', ') : 'No answer'; }
  return (q.options || [])[Number(value)] || 'No answer';
}
function correctText(q) {
  const type = q.question_type || 'single';
  if (type === 'short') return (q.correct_answers || []).join(' / ');
  if (type === 'multi') return (q.correct_answers || []).map((i) => (q.options || [])[i]).filter(Boolean).join(', ');
  return (q.options || [])[q.correct_index] || '';
}
