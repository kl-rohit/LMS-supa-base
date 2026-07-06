// Admin Assignments — create/manage assignments and see completion at a glance.
//
// Two kinds:
//   • task — broadcast + mark-done. Instructions + optional link + due date.
//   • quiz — auto-graded MCQ. Links an EXISTING quiz lesson (authored in Lessons
//            with the quiz editor); students take it through the normal quiz
//            flow and the QuizAttempts row is the grade/completion.
//
// Targeting: everyone, a group, or one student.

import { useState, useEffect } from 'react';
import {
  Plus, Edit2, Trash2, ClipboardList, ListChecks, CalendarClock,
  Users, UserRound, UsersRound, ExternalLink, CheckCircle2, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import Pagination, { usePagination } from '../components/Pagination';
import TargetPicker from '../components/TargetPicker';
import QuizEditor from '../components/QuizEditor';

const BLANK = {
  title: '', kind: 'task', instructions: '', link: '', due_date: '',
  target_type: 'all', target_id: '', target_ids: [], quiz_lesson_id: '',
};

export default function Assignments() {
  const [assignments, setAssignments] = useState([]);
  const [groups, setGroups] = useState([]);
  const [students, setStudents] = useState([]);
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  // Inline "create quiz" from the assignment modal (standalone, course-less quiz).
  const [quizEditorLesson, setQuizEditorLesson] = useState(null);
  const [showNewQuiz, setShowNewQuiz] = useState(false);
  const [newQuizTitle, setNewQuizTitle] = useState('');
  const [creatingQuiz, setCreatingQuiz] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState({ open: false, assignment: null });

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [aData, gData, sData, qData] = await Promise.all([
        api.get('/assignments'),
        api.get('/groups'),
        api.get('/students'),
        api.get('/lessons/quiz-list'),
      ]);
      setAssignments(aData.assignments || []);
      setGroups((gData.groups || []).filter((g) => (g.status || 'active') === 'active'));
      setStudents((sData.students || []).filter((s) => s.status === 'active'));
      setQuizzes(qData.quizzes || []);
    } catch (err) {
      toast.error('Failed to load: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const openAdd = () => { setEditing(null); setForm(BLANK); setModalOpen(true); };
  const openEdit = (a) => {
    setEditing(a);
    setForm({
      title: a.title || '',
      kind: a.kind || 'task',
      instructions: a.instructions || '',
      link: a.link || '',
      due_date: a.due_date || '',
      target_type: a.target_type || 'all',
      target_id: a.target_id || '',
      target_ids: Array.isArray(a.target_ids) ? a.target_ids : [],
      quiz_lesson_id: a.quiz_lesson_id || '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (form.kind === 'quiz' && !form.quiz_lesson_id) { toast.error('Pick a quiz to assign'); return; }
    if (form.target_type === 'group' && !form.target_id) { toast.error('Choose a group'); return; }
    if (form.target_type === 'students' && (form.target_ids || []).length === 0) {
      toast.error('Pick at least one student'); return;
    }
    const payload = {
      title: form.title.trim(),
      kind: form.kind,
      instructions: form.instructions,
      link: form.link,
      due_date: form.due_date,
      target_type: form.target_type,
      target_id: (form.target_type === 'group' || form.target_type === 'student') ? form.target_id : '',
      target_ids: form.target_type === 'students' ? form.target_ids : [],
      quiz_lesson_id: form.kind === 'quiz' ? form.quiz_lesson_id : '',
    };
    try {
      setSaving(true);
      if (editing) {
        await api.put(`/assignments/${editing.id}`, payload);
        toast.success('Assignment updated');
      } else {
        await api.post('/assignments', payload);
        toast.success('Assignment created');
      }
      setModalOpen(false);
      setEditing(null);
      setForm(BLANK);
      fetchData();
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const a = deleteDialog.assignment;
    if (!a) return;
    try {
      await api.delete(`/assignments/${a.id}`);
      toast.success('Assignment deleted');
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const refetchQuizzes = async () => {
    try { const d = await api.getFresh('/lessons/quiz-list'); setQuizzes(d.quizzes || []); } catch { /* keep old list */ }
  };

  // Create a standalone (course-less) quiz, then open the editor for it.
  const createNewQuiz = async () => {
    const title = newQuizTitle.trim();
    if (!title) { toast.error('Give the quiz a title'); return; }
    setCreatingQuiz(true);
    try {
      const { quiz } = await api.post('/quizzes/standalone', { title });
      setShowNewQuiz(false);
      setNewQuizTitle('');
      setQuizEditorLesson({ id: quiz.id, title: quiz.title });
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message || 'Failed to create quiz');
    } finally {
      setCreatingQuiz(false);
    }
  };

  // On closing the editor, refresh the quiz list and auto-select the new one.
  const closeQuizEditor = async () => {
    const created = quizEditorLesson;
    setQuizEditorLesson(null);
    await refetchQuizzes();
    if (created) setForm((f) => ({ ...f, quiz_lesson_id: String(created.id) }));
  };

  const targetLabel = (a) => {
    if (a.target_type === 'all') return 'All students';
    if (a.target_type === 'group') {
      const g = groups.find((x) => String(x.id) === String(a.target_id));
      return g ? `Group: ${g.name}` : 'Group';
    }
    if (a.target_type === 'students') {
      const n = Array.isArray(a.target_ids) ? a.target_ids.length : 0;
      return `${n} student${n === 1 ? '' : 's'}`;
    }
    if (a.target_type === 'student') {
      const s = students.find((x) => String(x.id) === String(a.target_id));
      return s ? s.name : 'Student';
    }
    return '';
  };

  const { page, setPage, pageCount, pageItems: pageAssignments, total, from, to } = usePagination(assignments, 25);

  if (loading) return <Loader text="Loading assignments..." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="page-header mb-0">Assignments</h2>
        <button onClick={openAdd} data-tour="assignments-add" className="btn-primary btn-sm">
          <Plus className="w-4 h-4" /> New Assignment
        </button>
      </div>

      {assignments.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No assignments yet"
          message="Set homework or attach a quiz, give it a due date, and assign it to everyone, a group, or one student."
          action={<button onClick={openAdd} className="btn-primary btn-sm"><Plus className="w-4 h-4" /> New Assignment</button>}
        />
      ) : (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {pageAssignments.map((a) => {
            const isQuiz = a.kind === 'quiz';
            return (
              <div key={a.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isQuiz ? 'bg-violet-100' : 'bg-indigo-100'}`}>
                      {isQuiz ? <ListChecks className="w-5 h-5 text-violet-600" /> : <ClipboardList className="w-5 h-5 text-indigo-600" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-gray-900 truncate">{a.title}</h3>
                        <span className={`badge text-[10px] font-semibold ${isQuiz ? 'bg-violet-100 text-violet-700' : 'bg-indigo-100 text-indigo-700'}`}>
                          {isQuiz ? 'Quiz' : 'Task'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5 flex-wrap">
                        <span className="inline-flex items-center gap-1">
                          {a.target_type === 'all' ? <Users className="w-3.5 h-3.5" />
                            : a.target_type === 'group' ? <UsersRound className="w-3.5 h-3.5" />
                            : <UserRound className="w-3.5 h-3.5" />}
                          {targetLabel(a)}
                        </span>
                        {a.due_date && (
                          <span className="inline-flex items-center gap-1 text-amber-600">
                            <CalendarClock className="w-3.5 h-3.5" /> Due {a.due_date}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => openEdit(a)} className="p-1.5 rounded-md hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => setDeleteDialog({ open: true, assignment: a })} className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {a.instructions && <p className="text-sm text-gray-600 mt-3 whitespace-pre-wrap">{a.instructions}</p>}
                {a.link && (
                  <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline mt-2 inline-flex items-center gap-1">
                    <ExternalLink className="w-3.5 h-3.5" /> Attached file
                  </a>
                )}

                <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-500">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="font-medium text-gray-700">{a.completed_count || 0}</span>
                  / {a.recipient_count || 0} {isQuiz ? 'passed' : 'completed'}
                </div>
              </div>
            );
          })}
        </div>
        <Pagination
          page={page}
          pageCount={pageCount}
          setPage={setPage}
          from={from}
          to={to}
          total={total}
          label="assignments"
          className="rounded-xl border border-gray-200"
        />
        </>
      )}

      {/* Create / Edit modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); setForm(BLANK); }}
        title={editing ? 'Edit Assignment' : 'New Assignment'}
        size="md"
        onSave={handleSubmit}
        saving={saving}
        saveLabel={editing ? 'Update' : 'Create'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Kind */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setForm((f) => ({ ...f, kind: 'task' }))}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 text-sm transition-colors ${form.kind === 'task' ? 'border-indigo-500 bg-indigo-50 text-indigo-900' : 'border-gray-200 text-gray-600 hover:border-indigo-300'}`}>
                <ClipboardList className="w-4 h-4" /> Task (mark done)
              </button>
              <button type="button" onClick={() => setForm((f) => ({ ...f, kind: 'quiz' }))}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 text-sm transition-colors ${form.kind === 'quiz' ? 'border-violet-500 bg-violet-50 text-violet-900' : 'border-gray-200 text-gray-600 hover:border-violet-300'}`}>
                <ListChecks className="w-4 h-4" /> Quiz (auto-graded)
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input type="text" value={form.title} onChange={set('title')} className="input-field" placeholder="e.g., Practice Raga Yaman — 10 bars" required />
          </div>

          {form.kind === 'quiz' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quiz *</label>
              {quizzes.length === 0 ? (
                <p className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">No quizzes yet — create one below.</p>
              ) : (
                <select value={form.quiz_lesson_id} onChange={set('quiz_lesson_id')} className="input-field" required>
                  <option value="">Select a quiz…</option>
                  {quizzes.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.title}{q.course_title ? ` — ${q.course_title}` : ''} ({q.question_count} Q)
                    </option>
                  ))}
                </select>
              )}

              {showNewQuiz ? (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={newQuizTitle}
                    onChange={(e) => setNewQuizTitle(e.target.value)}
                    placeholder="New quiz title…"
                    className="input-field flex-1"
                    autoFocus
                  />
                  <button type="button" onClick={createNewQuiz} disabled={creatingQuiz} className="btn-primary btn-sm disabled:opacity-50">
                    {creatingQuiz ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create & add questions'}
                  </button>
                  <button type="button" onClick={() => { setShowNewQuiz(false); setNewQuizTitle(''); }} className="btn-secondary btn-sm">Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => setShowNewQuiz(true)} className="mt-2 text-xs text-indigo-600 hover:text-indigo-700 font-medium inline-flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> New quiz
                </button>
              )}

              <p className="text-xs text-gray-400 mt-1">Students take it through the normal quiz flow; scoring is automatic.</p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Instructions</label>
                <textarea value={form.instructions} onChange={set('instructions')} className="input-field" rows={3} placeholder="What should the student do?" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Attachment link</label>
                <input type="url" value={form.link} onChange={set('link')} className="input-field" placeholder="https://drive.google.com/… (optional)" />
                <p className="text-xs text-gray-400 mt-1">Paste a Google Drive / PDF link if there's a worksheet.</p>
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Due date</label>
            <input type="date" value={form.due_date} onChange={set('due_date')} className="input-field" />
          </div>

          {/* Targeting — shared picker (Everyone / group / specific students) */}
          <TargetPicker
            value={{ target_type: form.target_type, target_id: form.target_id, target_ids: form.target_ids }}
            groups={groups}
            students={students}
            onChange={(v) => setForm((f) => ({ ...f, ...v }))}
          />

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => { setModalOpen(false); setEditing(null); setForm(BLANK); }} className="btn-secondary">Cancel</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteDialog.open}
        onClose={() => setDeleteDialog({ open: false, assignment: null })}
        onConfirm={handleDelete}
        title="Delete assignment"
        message={`Delete "${deleteDialog.assignment?.title}"? This removes it for all students. Quiz scores are kept. This cannot be undone.`}
        confirmText="Delete"
      />

      {/* Inline quiz editor — opened by "+ New quiz" in the assignment modal */}
      {quizEditorLesson && (
        <QuizEditor lesson={quizEditorLesson} onClose={closeQuizEditor} />
      )}
    </div>
  );
}
