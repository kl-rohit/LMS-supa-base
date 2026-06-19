// Admin Question Papers — share past papers, practice sets and sample exams
// as links (PDF / Google Drive). Students see them read-only in their portal.

import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, FileText, ExternalLink, Tag } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';

const BLANK = { title: '', description: '', link: '', category: '' };

export default function QuestionPapers() {
  const [papers, setPapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState({ open: false, paper: null });

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const data = await api.get('/question-papers');
      setPapers(data.papers || []);
    } catch (err) {
      toast.error('Failed to load: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const openAdd = () => { setEditing(null); setForm(BLANK); setModalOpen(true); };
  const openEdit = (p) => {
    setEditing(p);
    setForm({ title: p.title || '', description: p.description || '', link: p.link || '', category: p.category || '' });
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (!form.link.trim()) { toast.error('A link to the paper is required'); return; }
    try {
      setSaving(true);
      if (editing) {
        await api.put(`/question-papers/${editing.id}`, form);
        toast.success('Question paper updated');
      } else {
        await api.post('/question-papers', form);
        toast.success('Question paper added');
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
    const p = deleteDialog.paper;
    if (!p) return;
    try {
      await api.delete(`/question-papers/${p.id}`);
      toast.success('Deleted');
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <Loader text="Loading question papers..." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="page-header mb-0">Question Papers</h2>
        <button onClick={openAdd} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" /> Add Paper
        </button>
      </div>

      {papers.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No question papers yet"
          message="Share past papers, practice sets, and sample exams as PDF or Google Drive links for your students to download."
          action={<button onClick={openAdd} className="btn-primary btn-sm"><Plus className="w-4 h-4" /> Add Paper</button>}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {papers.map((p) => (
            <div key={p.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-rose-100 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-rose-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-medium text-gray-900 truncate">{p.title}</h3>
                    {p.category && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 mt-1">
                        <Tag className="w-3 h-3" /> {p.category}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => openEdit(p)} className="p-1.5 rounded-md hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => setDeleteDialog({ open: true, paper: p })} className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {p.description && <p className="text-sm text-gray-600 mt-3 whitespace-pre-wrap">{p.description}</p>}
              <a href={p.link} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline mt-2 inline-flex items-center gap-1">
                <ExternalLink className="w-3.5 h-3.5" /> Open paper
              </a>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); setForm(BLANK); }}
        title={editing ? 'Edit Question Paper' : 'Add Question Paper'}
        size="sm"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input type="text" value={form.title} onChange={set('title')} className="input-field" placeholder="e.g., Grade 5 Theory — 2024 Paper" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <input type="text" value={form.category} onChange={set('category')} className="input-field" placeholder="e.g., Grade 5, Practice, Mock exam (optional)" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Link *</label>
            <input type="url" value={form.link} onChange={set('link')} className="input-field" placeholder="https://drive.google.com/… or PDF URL" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={form.description} onChange={set('description')} className="input-field" rows={3} placeholder="Optional notes for students…" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => { setModalOpen(false); setEditing(null); setForm(BLANK); }} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Update' : 'Add'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteDialog.open}
        onClose={() => setDeleteDialog({ open: false, paper: null })}
        onConfirm={handleDelete}
        title="Delete question paper"
        message={`Delete "${deleteDialog.paper?.title}"? Students will no longer see it. This cannot be undone.`}
        confirmText="Delete"
      />
    </div>
  );
}
