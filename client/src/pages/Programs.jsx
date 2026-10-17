// Admin Programs — plan events/recitals/kutcheris/workshops, pick participating
// students, and optionally bill them (creates Additional Fees). See
// docs/programs-module-spec.md.

import { useState, useEffect } from 'react';
import { Plus, CalendarDays, IndianRupee, Users, Trash2, Edit2, ReceiptIndianRupee } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageTitle } from '../components/ConsoleUI';
import api from '../utils/api';
import Modal from '../components/Modal';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import FieldError from '../components/FieldError';
import { useConfirm } from '../contexts/ConfirmContext';
import { V, validate, firstErrorField, focusField, fieldCls, clearError } from '../utils/validation';

const TYPES = [
  { v: 'recital', l: 'Recital' }, { v: 'kutchery', l: 'Kutchery' },
  { v: 'workshop', l: 'Workshop' }, { v: 'competition', l: 'Competition' }, { v: 'other', l: 'Other' },
];
const today = () => new Date().toISOString().slice(0, 10);
const BLANK = () => ({ name: '', type: 'recital', program_date: today(), fee: '', description: '' });
const rupee = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;

export default function Programs() {
  const confirm = useConfirm();
  const [programs, setPrograms] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('planned');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK());
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState(null); // { program, roster }
  const [pickerSearch, setPickerSearch] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);

  const fetchPrograms = async () => {
    setLoading(true);
    try {
      const d = await api.get(`/programs?status=${statusFilter}`);
      setPrograms(d.programs || []);
    } catch (e) { toast.error('Failed to load programs: ' + e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchPrograms(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.get('/students').then((d) => setStudents((d.students || []).filter((s) => s.status === 'active'))).catch(() => {});
  }, []);

  const openCreate = () => { setEditing(null); setForm(BLANK()); setErrors({}); setFormOpen(true); };
  const openEdit = (p) => {
    setEditing(p);
    setForm({ name: p.name || '', type: p.type || 'recital', program_date: p.program_date || today(), fee: p.fee ? String(p.fee) : '', description: p.description || '', status: p.status || 'planned' });
    setErrors({}); setFormOpen(true);
  };

  const save = async () => {
    const errs = validate(form, {
      name: V.text('Program name', { required: true, max: 120 }),
      program_date: V.date('Date', { required: true }),
      fee: V.nonNegative('Fee', { max: 1000000 }),
    });
    if (Object.keys(errs).length) { setErrors(errs); focusField(firstErrorField(errs)); return; }
    setSaving(true);
    try {
      const body = { ...form, fee: Number(form.fee) || 0 };
      if (editing) await api.put(`/programs/${editing.id || editing.ROWID}`, body);
      else await api.post('/programs', body);
      toast.success(editing ? 'Program updated' : 'Program created');
      setFormOpen(false); fetchPrograms();
    } catch (e) { toast.error('Failed: ' + e.message); }
    finally { setSaving(false); }
  };

  const cancelProgram = async (p) => {
    const ok = await confirm({ title: 'Cancel this program?', message: `"${p.name}" will be marked cancelled. Any fees already billed stay on the students' bills.`, confirmText: 'Cancel program', danger: true });
    if (!ok) return;
    try { await api.delete(`/programs/${p.id || p.ROWID}`); toast.success('Program cancelled'); fetchPrograms(); } catch (e) { toast.error('Failed: ' + e.message); }
  };

  const openDetail = async (p) => {
    setPicked(new Set()); setPickerSearch('');
    try { const d = await api.get(`/programs/${p.id || p.ROWID}`); setDetail(d); }
    catch (e) { toast.error('Failed to open: ' + e.message); }
  };
  const refreshDetail = async () => {
    if (!detail) return;
    const pid = detail.program.id || detail.program.ROWID;
    try { const d = await api.get(`/programs/${pid}`); setDetail(d); } catch { /* ignore */ }
  };

  const rosterIds = new Set((detail?.roster || []).map((r) => String(r.student_id)));
  const nameOf = (sid) => students.find((s) => String(s.id || s.ROWID) === String(sid))?.name || `#${sid}`;
  const candidates = students.filter((s) => !rosterIds.has(String(s.id || s.ROWID)) && (s.name || '').toLowerCase().includes(pickerSearch.toLowerCase()));

  const addPicked = async () => {
    if (!picked.size) return;
    setBusy(true);
    try {
      await api.post(`/programs/${detail.program.id || detail.program.ROWID}/students`, { student_ids: [...picked] });
      toast.success(`Added ${picked.size} participant(s)`); setPicked(new Set()); await refreshDetail();
    } catch (e) { toast.error('Failed: ' + e.message); } finally { setBusy(false); }
  };
  const removeParticipant = async (sid) => {
    try { await api.delete(`/programs/${detail.program.id || detail.program.ROWID}/students/${sid}`); await refreshDetail(); } catch (e) { toast.error('Failed: ' + e.message); }
  };
  const saveNote = async (sid, notes) => {
    const pid = detail.program.id || detail.program.ROWID;
    try {
      await api.put(`/programs/${pid}/students/${sid}`, { notes });
      // reflect the saved note locally without a full refetch
      setDetail((d) => (d ? { ...d, roster: (d.roster || []).map((r) => (String(r.student_id) === String(sid) ? { ...r, notes } : r)) } : d));
      toast.success('Note saved');
    } catch (e) { toast.error('Failed: ' + e.message); }
  };
  const billAll = async () => {
    const p = detail.program;
    if (!(Number(p.fee) > 0)) { toast.error('Set a program fee greater than 0 first (edit the program).'); return; }
    const unbilled = (detail.roster || []).filter((r) => Number(r.billed) !== 1).length;
    if (!unbilled) { toast('Everyone is already billed.'); return; }
    const ok = await confirm({ title: 'Bill participants?', message: `Add ${rupee(p.fee)} to each of the ${unbilled} unbilled participant(s). This appears in Fees and reminders.`, confirmText: 'Bill participants' });
    if (!ok) return;
    setBusy(true);
    try { const r = await api.post(`/programs/${p.id || p.ROWID}/bill`, {}); toast.success(r.message || 'Billed'); await refreshDetail(); }
    catch (e) { toast.error('Failed: ' + e.message); } finally { setBusy(false); }
  };

  if (loading) return <Loader />;

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <PageTitle title="Programs" />
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-base text-sm py-1.5 pr-8" aria-label="Filter by status">
            <option value="planned">Planned</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </select>
          <button onClick={openCreate} className="btn-primary btn-sm"><Plus className="w-4 h-4" /> New program</button>
        </div>
      </div>

      {programs.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No programs yet" message="Plan a recital, kutchery, workshop or competition and add the students taking part." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {programs.map((p) => (
            <div key={p.id || p.ROWID} className="card hover:border-indigo-300 hover:shadow-md transition-all">
              <button type="button" onClick={() => openDetail(p)} className="block w-full text-left">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-gray-900">{p.name}</h3>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">{p.status}</span>
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                  <span className="capitalize">{p.type}</span>
                  <span className="inline-flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" />{p.program_date || '—'}</span>
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-gray-600">
                  <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" />{p.participant_count || 0}</span>
                  {Number(p.fee) > 0 && <span className="inline-flex items-center gap-0.5"><IndianRupee className="w-3.5 h-3.5" />{Number(p.fee).toLocaleString('en-IN')}/student</span>}
                </div>
              </button>
              <div className="mt-3 flex justify-end gap-1">
                <button onClick={() => openEdit(p)} className="p-1.5 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50" aria-label={`Edit ${p.name}`}><Edit2 className="w-4 h-4" /></button>
                {p.status !== 'cancelled' && (
                  <button onClick={() => cancelProgram(p)} className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50" aria-label={`Cancel ${p.name}`}><Trash2 className="w-4 h-4" /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / edit */}
      <Modal isOpen={formOpen} onClose={() => { setFormOpen(false); setErrors({}); }} title={editing ? 'Edit program' : 'New program'} onSave={save} saving={saving} saveLabel={editing ? 'Update' : 'Create'}>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Program name *</label>
            <input data-field="name" value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors((x) => clearError(x, 'name')); }} placeholder="e.g. Annual Recital" className={fieldCls('input-field', errors.name)} />
            <FieldError msg={errors.name} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input-field">
                {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
              <input type="date" data-field="program_date" value={form.program_date} onChange={(e) => { setForm({ ...form, program_date: e.target.value }); setErrors((x) => clearError(x, 'program_date')); }} className={fieldCls('input-field', errors.program_date)} />
              <FieldError msg={errors.program_date} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fee per student (optional)</label>
            <input type="number" min="0" data-field="fee" value={form.fee} onChange={(e) => { setForm({ ...form, fee: e.target.value }); setErrors((x) => clearError(x, 'fee')); }} placeholder="0" className={fieldCls('input-field', errors.fee)} />
            <FieldError msg={errors.fee} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} placeholder="Optional details for your reference" className="input-field" />
          </div>
          {editing && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select value={form.status || 'planned'} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input-field">
                <option value="planned">Planned</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">Mark it Completed once the event is done. Fees already billed stay on the students' bills.</p>
            </div>
          )}
        </div>
      </Modal>

      {/* Detail: roster + add + bill */}
      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={detail?.program?.name || 'Program'} size="lg">
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2 text-sm text-gray-600">
              <span className="capitalize">{detail.program.type} · {detail.program.program_date || '—'}</span>
              {Number(detail.program.fee) > 0 && <span className="font-medium text-indigo-700">{rupee(detail.program.fee)}/student</span>}
            </div>

            {/* participants */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-800">Participants ({detail.roster?.length || 0})</h4>
                {Number(detail.program.fee) > 0 && (
                  <button onClick={billAll} disabled={busy} className="btn-sm inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                    <ReceiptIndianRupee className="w-3.5 h-3.5" /> Bill participants
                  </button>
                )}
              </div>
              {(detail.roster || []).length === 0 ? (
                <p className="text-sm text-gray-500 py-2">No one added yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {detail.roster.map((r) => (
                    <ParticipantRow
                      key={r.id || r.ROWID}
                      name={nameOf(r.student_id)}
                      note={r.notes}
                      billed={Number(r.billed) === 1}
                      onRemove={() => removeParticipant(r.student_id)}
                      onSaveNote={(notes) => saveNote(r.student_id, notes)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* add participants */}
            <div className="border-t border-gray-200 pt-3">
              <h4 className="text-sm font-semibold text-gray-800 mb-2">Add participants</h4>
              <input value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} placeholder="Search students..." className="input-field mb-2" />
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {candidates.length === 0 ? (
                  <p className="text-sm text-gray-400 px-3 py-3">No matching active students.</p>
                ) : candidates.slice(0, 100).map((s) => {
                  const sid = String(s.id || s.ROWID);
                  const on = picked.has(sid);
                  return (
                    <label key={sid} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" checked={on} onChange={() => { const n = new Set(picked); on ? n.delete(sid) : n.add(sid); setPicked(n); }} className="w-4 h-4 rounded text-indigo-600" />
                      <span className="text-gray-800">{s.name}</span>
                    </label>
                  );
                })}
              </div>
              <div className="mt-2 flex justify-end">
                <button onClick={addPicked} disabled={busy || !picked.size} className="btn-primary btn-sm disabled:opacity-50">Add {picked.size || ''} participant{picked.size === 1 ? '' : 's'}</button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// One participant in a program's roster, with an editable per-student itinerary
// note. The note is parent-visible (shown in the portal Programs tab). Saves on
// blur or Enter when changed; an explicit Save button appears while dirty.
function ParticipantRow({ name, note, billed, onRemove, onSaveNote }) {
  const [draft, setDraft] = useState(note || '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(note || ''); }, [note]);
  const dirty = (draft || '') !== (note || '');
  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try { await onSaveNote(draft.trim()); } finally { setSaving(false); }
  };
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-900">{name}</span>
        <span className="flex items-center gap-2">
          {billed && <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">billed</span>}
          <button onClick={onRemove} className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50" aria-label="Remove"><Trash2 className="w-4 h-4" /></button>
        </span>
      </div>
      <div className="mt-1.5 flex items-start gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
          placeholder="Note for this student (song, slot, timing)… parents can see this"
          maxLength={2000}
          className="input-field text-xs py-1 flex-1"
        />
        {dirty && (
          <button onClick={save} disabled={saving} className="btn-primary btn-sm text-xs shrink-0">Save</button>
        )}
      </div>
    </div>
  );
}
