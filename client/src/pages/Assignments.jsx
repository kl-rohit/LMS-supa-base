// Admin Assignments — create/manage task assignments and see completion at a
// glance. Tasks are broadcast + mark-done: instructions + optional link + due
// date, targeted at everyone, a group, or specific students.
//
// Quizzes are NOT managed here — they live in the Quizzes module, which owns
// authoring, assigning, and analytics. Quiz-kind rows are filtered out of this
// list so the two modules never overlap.

import { useState, useEffect } from 'react';
import {
  Plus, Edit2, Trash2, ClipboardList, CalendarClock,
  Users, UserRound, UsersRound, ExternalLink, CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { PageTitle } from '../components/ConsoleUI';
import api from '../utils/api';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import Pagination, { usePagination } from '../components/Pagination';
import TargetPicker from '../components/TargetPicker';

const BLANK = {
  title: '', kind: 'task', instructions: '', link: '', due_date: '',
  target_type: 'all', target_id: '', target_ids: [],
};

export default function Assignments() {
  const [assignments, setAssignments] = useState([]);
  const [groups, setGroups] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState({ open: false, assignment: null });

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [aData, gData, sData] = await Promise.all([
        api.get('/assignments'),
        api.get('/groups'),
        api.get('/students'),
      ]);
      // Quizzes live in the Quizzes module — never list quiz-kind assignments here.
      setAssignments((aData.assignments || []).filter((a) => a.kind !== 'quiz'));
      setGroups((gData.groups || []).filter((g) => (g.status || 'active') === 'active'));
      setStudents((sData.students || []).filter((s) => s.status === 'active'));
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
      kind: 'task',
      instructions: a.instructions || '',
      link: a.link || '',
      due_date: a.due_date || '',
      target_type: a.target_type || 'all',
      target_id: a.target_id || '',
      target_ids: Array.isArray(a.target_ids) ? a.target_ids : [],
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (form.target_type === 'group' && !form.target_id) { toast.error('Choose a group'); return; }
    if (form.target_type === 'students' && (form.target_ids || []).length === 0) {
      toast.error('Pick at least one student'); return;
    }
    const payload = {
      title: form.title.trim(),
      kind: 'task',
      instructions: form.instructions,
      link: form.link,
      due_date: form.due_date,
      target_type: form.target_type,
      target_id: (form.target_type === 'group' || form.target_type === 'student') ? form.target_id : '',
      target_ids: form.target_type === 'students' ? form.target_ids : [],
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
        <PageTitle title="Assignments" />
        <button onClick={openAdd} data-tour="assignments-add" className="btn-primary btn-sm">
          <Plus className="w-4 h-4" /> New Assignment
        </button>
      </div>

      {assignments.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No assignments yet"
          message="Set homework, give it a due date, and assign it to everyone, a group, or specific students."
          action={<button onClick={openAdd} className="btn-primary btn-sm"><Plus className="w-4 h-4" /> New Assignment</button>}
        />
      ) : (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {pageAssignments.map((a) => {
            return (
              <div key={a.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-indigo-100">
                      <ClipboardList className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-gray-900 truncate">{a.title}</h3>
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
                  / {a.recipient_count || 0} completed
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input type="text" value={form.title} onChange={set('title')} className="input-field" placeholder="e.g., Practice Raga Yaman, 10 bars" required />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Instructions</label>
            <textarea value={form.instructions} onChange={set('instructions')} className="input-field" rows={3} placeholder="What should the student do?" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Attachment link</label>
            <input type="url" value={form.link} onChange={set('link')} className="input-field" placeholder="https://drive.google.com/… (optional)" />
            <p className="text-xs text-gray-400 mt-1">Paste a Google Drive / PDF link if there's a worksheet.</p>
          </div>

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
            onCreateStudent={fetchData}
            onCreateGroup={fetchData}
          />
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteDialog.open}
        onClose={() => setDeleteDialog({ open: false, assignment: null })}
        onConfirm={handleDelete}
        title="Delete assignment"
        message={`Delete "${deleteDialog.assignment?.title}"? This removes it for all students. This cannot be undone.`}
        confirmText="Delete"
      />
    </div>
  );
}
