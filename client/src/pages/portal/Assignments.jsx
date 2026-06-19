// Parent/student portal — Assignments.
//   • task assignments: read instructions, open any attached link, tap
//     "Mark as done" (and undo).
//   • quiz assignments: tap "Take quiz" to take it inline via the shared
//     LessonQuiz component (auto-graded); status reflects the QuizAttempts row.

import { useState, useEffect } from 'react';
import {
  ClipboardList, ListChecks, CalendarClock, ExternalLink, CheckCircle2,
  Circle, ArrowLeft, PlayCircle, Award, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import Loader from '../../components/Loader';
import EmptyState from '../../components/EmptyState';
import LessonQuiz from '../../components/LessonQuiz';

export default function PortalAssignments() {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [activeQuiz, setActiveQuiz] = useState(null); // assignment object when taking a quiz

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const data = await api.get('/portal/assignments');
      setAssignments(data.assignments || []);
    } catch (err) {
      toast.error('Failed to load assignments');
    } finally {
      setLoading(false);
    }
  };

  const markDone = async (a) => {
    try {
      setBusyId(a.id);
      await api.post(`/portal/assignments/${a.id}/complete`);
      setAssignments((prev) => prev.map((x) => x.id === a.id ? { ...x, completed: true, status: 'done' } : x));
      toast.success('Marked as done');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update');
    } finally {
      setBusyId(null);
    }
  };

  const undoDone = async (a) => {
    try {
      setBusyId(a.id);
      await api.delete(`/portal/assignments/${a.id}/complete`);
      setAssignments((prev) => prev.map((x) => x.id === a.id ? { ...x, completed: false, status: 'pending' } : x));
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update');
    } finally {
      setBusyId(null);
    }
  };

  // ---- Quiz-taking view ----
  if (activeQuiz) {
    return (
      <div className="space-y-3 max-w-2xl mx-auto">
        <button
          onClick={() => { setActiveQuiz(null); fetchData(); }}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft className="w-4 h-4" /> Back to assignments
        </button>
        <LessonQuiz
          key={activeQuiz.id}
          lesson={{ title: activeQuiz.title, quiz_required: false }}
          endpointBase={`/portal/assignments/${activeQuiz.id}`}
        />
      </div>
    );
  }

  if (loading) return <Loader text="Loading assignments..." />;

  if (assignments.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No assignments"
        message="When your teacher sets homework or a quiz, it'll show up here."
      />
    );
  }

  // Pending first, then completed.
  const sorted = [...assignments].sort((a, b) => Number(!!a.completed) - Number(!!b.completed));

  return (
    <div className="space-y-3">
      {sorted.map((a) => {
        const isQuiz = a.kind === 'quiz';
        const done = isQuiz ? a.status === 'passed' : a.completed;
        return (
          <div key={a.id} className={`card ${done ? 'opacity-80' : ''}`}>
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isQuiz ? 'bg-violet-100' : 'bg-indigo-100'}`}>
                {isQuiz ? <ListChecks className="w-5 h-5 text-violet-600" /> : <ClipboardList className="w-5 h-5 text-indigo-600" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-medium text-gray-900">{a.title}</h3>
                  {isQuiz ? (
                    a.status === 'passed' ? (
                      <span className="badge text-[10px] font-semibold bg-green-100 text-green-700">Passed {a.attempt?.score}%</span>
                    ) : a.status === 'attempted' ? (
                      <span className="badge text-[10px] font-semibold bg-amber-100 text-amber-700">Tried {a.attempt?.score}%</span>
                    ) : (
                      <span className="badge text-[10px] font-semibold bg-violet-100 text-violet-700">Quiz</span>
                    )
                  ) : (
                    done && <span className="badge text-[10px] font-semibold bg-green-100 text-green-700">Done</span>
                  )}
                </div>
                {a.due_date && (
                  <p className="text-xs text-amber-600 mt-1 inline-flex items-center gap-1">
                    <CalendarClock className="w-3.5 h-3.5" /> Due {a.due_date}
                  </p>
                )}
                {a.instructions && <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{a.instructions}</p>}
                {a.link && (
                  <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline mt-2 inline-flex items-center gap-1">
                    <ExternalLink className="w-3.5 h-3.5" /> Open attachment
                  </a>
                )}

                {/* Actions */}
                <div className="mt-3">
                  {isQuiz ? (
                    <button onClick={() => setActiveQuiz(a)} className={done ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'}>
                      {done ? <><Award className="w-4 h-4" /> Review / retake</> : <><PlayCircle className="w-4 h-4" /> Take quiz</>}
                    </button>
                  ) : done ? (
                    <button onClick={() => undoDone(a)} disabled={busyId === a.id} className="inline-flex items-center gap-1.5 text-sm text-green-600 hover:text-gray-600">
                      {busyId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Completed — undo
                    </button>
                  ) : (
                    <button onClick={() => markDone(a)} disabled={busyId === a.id} className="btn-primary btn-sm">
                      {busyId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Circle className="w-4 h-4" />} Mark as done
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
