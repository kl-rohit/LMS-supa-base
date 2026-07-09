// Admin Quizzes — a first-class module (peer of Question Papers) that lists
// every quiz in the academy (course lessons + standalone). Clicking a quiz opens
// its full-page analysis (/quizzes/:id); "Edit questions" opens the editor
// (/quizzes/:id/edit). Base Tailwind classes auto-theme (light + dark).
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit2, Trash2, ListChecks, Loader2, BookOpen, ClipboardList, FileQuestion } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageTitle } from '../components/ConsoleUI';
import api from '../utils/api';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';

export default function Quizzes() {
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState({ open: false, quiz: null });

  const load = async () => {
    try {
      setLoading(true);
      const d = await api.getFresh('/lessons/quiz-list');
      setQuizzes(d.quizzes || []);
    } catch {
      toast.error('Could not load quizzes');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const createQuiz = async () => {
    const title = newTitle.trim();
    if (!title) { toast.error('Give the quiz a title'); return; }
    setCreating(true);
    try {
      const { quiz } = await api.post('/quizzes/standalone', { title });
      navigate(`/quizzes/${quiz.id}/edit`, { state: { title: quiz.title } });
    } catch (e) {
      toast.error(e.message || 'Could not create quiz');
    } finally {
      setCreating(false);
    }
  };

  const doDelete = async () => {
    const q = del.quiz;
    if (!q) return;
    try {
      await api.delete(`/lessons/${q.id}`);
      toast.success('Quiz deleted');
      load();
    } catch {
      toast.error('Could not delete quiz');
    }
  };

  if (loading) return <Loader text="Loading quizzes..." />;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <PageTitle title="Quizzes" />
          <p className="text-sm text-gray-500 mt-1">
            Create and manage quizzes. Open one to analyse responses, or attach it to an assignment or course lesson.
          </p>
        </div>
        {!showNew && (
          <button onClick={() => setShowNew(true)} className="btn-primary flex-shrink-0">
            <Plus className="w-4 h-4" /> New quiz
          </button>
        )}
      </div>

      {showNew && (
        <div className="card mb-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createQuiz(); }}
            placeholder="Quiz title, e.g. Chapter 3 revision"
            className="input-field flex-1"
            autoFocus
          />
          <div className="flex gap-2">
            <button onClick={createQuiz} disabled={creating} className="btn-primary">
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create and add questions
            </button>
            <button onClick={() => { setShowNew(false); setNewTitle(''); }} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      {quizzes.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No quizzes yet"
          message="Create your first quiz, then attach it to an assignment or add it to a course lesson."
        />
      ) : (
        <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden bg-white">
          {quizzes.map((q) => (
            <div key={q.id} className="flex items-center gap-3 p-3 sm:p-4 hover:bg-gray-50 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                <ListChecks className="w-5 h-5 text-indigo-600" />
              </div>
              <button
                onClick={() => navigate(`/quizzes/${q.id}`)}
                className="flex-1 min-w-0 text-left"
              >
                <p className="font-medium text-gray-900 truncate">{q.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                  <span>{q.question_count} question{q.question_count === 1 ? '' : 's'}</span>
                  <span className="text-gray-300">·</span>
                  <QuizAssociation association={q.association} courseTitle={q.course_title} />
                </p>
              </button>
              <button
                onClick={() => navigate(`/quizzes/${q.id}/edit`, { state: { title: q.title } })}
                className="btn-secondary btn-sm flex-shrink-0"
              >
                <Edit2 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Edit questions</span>
              </button>
              <button
                onClick={() => setDel({ open: true, quiz: q })}
                className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors flex-shrink-0"
                title="Delete quiz"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={del.open}
        onClose={() => setDel({ open: false, quiz: null })}
        onConfirm={doDelete}
        title="Delete quiz"
        message={`Delete "${del.quiz?.title}"? Its questions are removed too, and any assignment using it will no longer have a quiz. This cannot be undone.`}
        confirmText="Delete"
      />
    </div>
  );
}

// Small label showing what a quiz is attached to. Falls back to course_title
// for older list payloads that predate the `association` field.
function QuizAssociation({ association, courseTitle }) {
  const a = association || (courseTitle ? { kind: 'course', name: courseTitle } : { kind: 'standalone', name: '' });
  if (a.kind === 'course') {
    return <span className="inline-flex items-center gap-1"><BookOpen className="w-3 h-3" /> {a.name}</span>;
  }
  if (a.kind === 'assignment') {
    return <span className="inline-flex items-center gap-1"><ClipboardList className="w-3 h-3" /> {a.name}</span>;
  }
  return <span className="inline-flex items-center gap-1"><FileQuestion className="w-3 h-3" /> Standalone</span>;
}
