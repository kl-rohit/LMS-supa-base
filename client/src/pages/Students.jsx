import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Upload,
  ChevronUp,
  ChevronDown,
  X,
  FileJson,
  FileSpreadsheet,
  Users,
  RotateCcw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Papa from 'papaparse';
import api from '../utils/api';
import { useConfirm } from '../contexts/ConfirmContext';
import { formatMobileDisplay } from '../utils/phone';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';

const emptyForm = {
  name: '',
  parent_name: '',
  mobile_number: '',
  fee_online: '',
  fee_offline: '',
  fee_offline_group: '',
  min_classes_per_month: '',
  notes: '',
};

export default function Students() {
  const confirm = useConfirm();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState({ open: false, student: null });
  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });
  const [importModalOpen, setImportModalOpen] = useState(false);
  const fileInputRef = useRef(null);
  const jsonInputRef = useRef(null);

  useEffect(() => {
    fetchStudents();
  }, []);

  const fetchStudents = async () => {
    try {
      setLoading(true);
      const result = await api.get('/students');
      setStudents(result.students || []);
    } catch (err) {
      toast.error('Failed to load students: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Student name is required');
      return;
    }
    try {
      setSaving(true);
      const payload = {
        ...form,
        fee_online: form.fee_online ? Number(form.fee_online) : 0,
        fee_offline: form.fee_offline ? Number(form.fee_offline) : 0,
        fee_offline_group: form.fee_offline_group ? Number(form.fee_offline_group) : 0,
        min_classes_per_month: form.min_classes_per_month ? Number(form.min_classes_per_month) : 0,
      };
      if (editingStudent) {
        await api.put(`/students/${editingStudent.id}`, payload);
        toast.success('Student updated');
      } else {
        await api.post('/students', payload);
        toast.success('Student added');
      }
      setModalOpen(false);
      setEditingStudent(null);
      setForm(emptyForm);
      fetchStudents();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (student) => {
    setEditingStudent(student);
    setForm({
      name: student.name || '',
      parent_name: student.parent_name || '',
      mobile_number: student.mobile_number || '',
      fee_online: student.fee_online || '',
      fee_offline: student.fee_offline || '',
      fee_offline_group: student.fee_offline_group || '',
      min_classes_per_month: student.min_classes_per_month || '',
      notes: student.notes || '',
    });
    setModalOpen(true);
  };

  const openAdd = () => {
    setEditingStudent(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  // Reactivate an inactive student — flips status back to 'active'.
  const handleReactivate = async (student) => {
    try {
      await api.put(`/students/${student.id}`, { status: 'active' });
      toast.success(`${student.name} reactivated`);
      fetchStudents();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async () => {
    const student = deleteDialog.student;
    if (!student) return;
    try {
      // Inactive students get permanently deleted; active ones are deactivated.
      const url = student.status === 'inactive'
        ? `/students/${student.id}?force=true`
        : `/students/${student.id}`;
      await api.delete(url);
      toast.success(student.status === 'inactive' ? 'Student permanently deleted' : 'Student deactivated');
      fetchStudents();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteAllInactive = async () => {
    const inactiveCount = students.filter((s) => s.status === 'inactive').length;
    if (inactiveCount === 0) {
      toast.error('No inactive students to delete');
      return;
    }
    const ok = await confirm({
      title: 'Delete all inactive students?',
      message: `This will permanently delete ${inactiveCount} inactive student(s). Their attendance and fee records will be kept, but the students themselves will be gone. This cannot be undone.`,
      confirmText: 'Delete all',
    });
    if (!ok) return;
    try {
      const data = await api.delete('/students/inactive');
      toast.success(data?.message || 'Inactive students deleted');
      fetchStudents();
    } catch (err) {
      toast.error('Failed to delete: ' + err.message);
    }
  };

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const handleCSVImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const students = results.data.map((row) => ({
            name: row.name || row.Name || '',
            parent_name: row.parent_name || row['Parent Name'] || '',
            mobile_number: row.mobile_number || row['Mobile'] || row['Phone'] || '',
            fee_online: Number(row.fee_online || row['Fee Online'] || 0),
            fee_offline: Number(row.fee_offline || row['Fee Offline'] || 0),
            fee_offline_group: Number(row.fee_offline_group || row['Fee Group'] || 0),
            notes: row.notes || row.Notes || '',
          }));
          const valid = students.filter((s) => s.name.trim());
          if (valid.length === 0) {
            toast.error('No valid students found in CSV');
            return;
          }
          await api.post('/import/students', { students: valid });
          toast.success(`Imported ${valid.length} students`);
          setImportModalOpen(false);
          fetchStudents();
        } catch (err) {
          toast.error('Import failed: ' + err.message);
        }
      },
      error: (err) => {
        toast.error('CSV parse error: ' + err.message);
      },
    });
    e.target.value = '';
  };

  const handleJSONImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const arr = Array.isArray(data) ? data : data.students || [];
        const valid = arr.filter((s) => s.name && s.name.trim());
        if (valid.length === 0) {
          toast.error('No valid students found in JSON');
          return;
        }
        await api.post('/import/students', { students: valid });
        toast.success(`Imported ${valid.length} students`);
        setImportModalOpen(false);
        fetchStudents();
      } catch (err) {
        toast.error('JSON import failed: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const filteredStudents = useMemo(() => {
    let list = students;
    if (statusFilter === 'active') {
      list = list.filter((s) => s.status === 'active');
    } else if (statusFilter === 'inactive') {
      list = list.filter((s) => s.status === 'inactive');
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name?.toLowerCase().includes(q) ||
          s.parent_name?.toLowerCase().includes(q) ||
          s.mobile_number?.includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      const { key, direction } = sortConfig;
      let aVal = a[key] ?? '';
      let bVal = b[key] ?? '';
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();
      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [students, search, statusFilter, sortConfig]);

  const SortIcon = ({ column }) => {
    if (sortConfig.key !== column) return <ChevronUp className="w-3 h-3 text-gray-300" />;
    return sortConfig.direction === 'asc' ? (
      <ChevronUp className="w-3 h-3 text-indigo-600" />
    ) : (
      <ChevronDown className="w-3 h-3 text-indigo-600" />
    );
  };

  if (loading) return <Loader text="Loading students..." />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="page-header mb-0">Students</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {statusFilter === 'inactive' && students.some((s) => s.status === 'inactive') && (
            <button
              onClick={handleDeleteAllInactive}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors text-sm font-medium"
              title="Permanently delete every inactive student"
            >
              <Trash2 className="w-4 h-4" />
              Delete all inactive
            </button>
          )}
          <button onClick={() => setImportModalOpen(true)} className="btn-secondary btn-sm">
            <Upload className="w-4 h-4" /> Import
          </button>
          <button onClick={openAdd} className="btn-primary btn-sm">
            <Plus className="w-4 h-4" /> Add Student
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search students..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field pl-10"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="select-field w-auto"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      {filteredStudents.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No students found"
          message={search ? 'Try adjusting your search or filters.' : 'Add your first student to get started.'}
          action={
            !search && (
              <button onClick={openAdd} className="btn-primary btn-sm">
                <Plus className="w-4 h-4" /> Add Student
              </button>
            )
          }
        />
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="table-header cursor-pointer" onClick={() => handleSort('name')}>
                    <div className="flex items-center gap-1">Name <SortIcon column="name" /></div>
                  </th>
                  <th className="table-header cursor-pointer" onClick={() => handleSort('parent_name')}>
                    <div className="flex items-center gap-1">Parent <SortIcon column="parent_name" /></div>
                  </th>
                  <th className="table-header">Mobile</th>
                  <th className="table-header cursor-pointer text-right" onClick={() => handleSort('fee_online')}>
                    <div className="flex items-center justify-end gap-1">Online ₹/hr <SortIcon column="fee_online" /></div>
                  </th>
                  <th className="table-header cursor-pointer text-right" onClick={() => handleSort('fee_offline')}>
                    <div className="flex items-center justify-end gap-1">Offline ₹/hr <SortIcon column="fee_offline" /></div>
                  </th>
                  <th className="table-header cursor-pointer text-right" onClick={() => handleSort('fee_offline_group')}>
                    <div className="flex items-center justify-end gap-1">Group ₹/hr <SortIcon column="fee_offline_group" /></div>
                  </th>
                  <th className="table-header">Status</th>
                  <th className="table-header text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredStudents.map((student) => (
                  <tr key={student.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell font-medium text-gray-900">{student.name}</td>
                    <td className="table-cell">{student.parent_name || '-'}</td>
                    <td className="table-cell">{student.mobile_number ? formatMobileDisplay(student.mobile_number) : '-'}</td>
                    <td className="table-cell text-right">{student.fee_online ? `\u20B9${student.fee_online}/hr` : '-'}</td>
                    <td className="table-cell text-right">{student.fee_offline ? `\u20B9${student.fee_offline}/hr` : '-'}</td>
                    <td className="table-cell text-right">{student.fee_offline_group ? `\u20B9${student.fee_offline_group}/hr` : '-'}</td>
                    <td className="table-cell">
                      <span className={student.status === 'active' ? 'badge-active' : 'badge-inactive'}>
                        {student.status}
                      </span>
                    </td>
                    <td className="table-cell text-right">
                      <div className="flex items-center justify-end gap-1">
                        {student.status === 'inactive' && (
                          <button
                            onClick={() => handleReactivate(student)}
                            className="p-1.5 rounded-md hover:bg-green-50 text-gray-400 hover:text-green-600 transition-colors"
                            title="Reactivate student"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(student)}
                          className="p-1.5 rounded-md hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteDialog({ open: true, student })}
                          className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                          title={student.status === 'inactive' ? 'Delete permanently' : 'Deactivate'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-500">
            Showing {filteredStudents.length} of {students.length} students
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setEditingStudent(null); setForm(emptyForm); }}
        title={editingStudent ? 'Edit Student' : 'Add Student'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input-field"
              placeholder="Student name"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Parent Name</label>
            <input
              type="text"
              value={form.parent_name}
              onChange={(e) => setForm({ ...form, parent_name: e.target.value })}
              className="input-field"
              placeholder="Parent name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mobile Number</label>
            <div className="flex items-stretch">
              <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-gray-600 text-sm font-medium">
                +91
              </span>
              <input
                type="tel"
                value={form.mobile_number}
                onChange={(e) => setForm({ ...form, mobile_number: e.target.value })}
                onBlur={(e) => {
                  // Normalize to digits-only on blur; if user enters 10 digits,
                  // store the bare 10-digit number (we'll add +91 at WhatsApp time).
                  const digits = String(e.target.value).replace(/\D/g, '');
                  // If the user pasted "+919876543210", strip the leading 91 for consistency.
                  const cleaned = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
                  if (cleaned !== form.mobile_number) {
                    setForm({ ...form, mobile_number: cleaned });
                  }
                }}
                className="input-field rounded-l-none"
                placeholder="98765 43210"
                maxLength={12}
                inputMode="numeric"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">10-digit Indian mobile. +91 added automatically when sending.</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Online Fee/hr</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{'\u20B9'}</span>
                <input
                  type="number"
                  value={form.fee_online}
                  onChange={(e) => setForm({ ...form, fee_online: e.target.value })}
                  className="input-field pl-7"
                  placeholder="0"
                  min="0"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Offline Fee/hr</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{'\u20B9'}</span>
                <input
                  type="number"
                  value={form.fee_offline}
                  onChange={(e) => setForm({ ...form, fee_offline: e.target.value })}
                  className="input-field pl-7"
                  placeholder="0"
                  min="0"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Group Fee/hr</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{'\u20B9'}</span>
                <input
                  type="number"
                  value={form.fee_offline_group}
                  onChange={(e) => setForm({ ...form, fee_offline_group: e.target.value })}
                  className="input-field pl-7"
                  placeholder="0"
                  min="0"
                />
              </div>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Minimum classes per month</label>
            <input
              type="number"
              value={form.min_classes_per_month}
              onChange={(e) => setForm({ ...form, min_classes_per_month: e.target.value })}
              className="input-field"
              placeholder="0 = no minimum"
              min="0"
              max="31"
            />
            <p className="text-xs text-gray-400 mt-1">
              Fees page will flag students who attend fewer than this each month. Leave blank or 0 for no minimum.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="input-field"
              rows={3}
              placeholder="Any additional notes..."
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => { setModalOpen(false); setEditingStudent(null); setForm(emptyForm); }} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : editingStudent ? 'Update' : 'Add Student'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Import Modal */}
      <Modal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Import Students"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Import students from a CSV or JSON file. CSV should have headers: name, parent_name, mobile_number, fee_online, fee_offline, fee_offline_group, notes.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center gap-2 p-6 border-2 border-dashed border-gray-300 rounded-xl hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
            >
              <FileSpreadsheet className="w-8 h-8 text-indigo-500" />
              <span className="text-sm font-medium text-gray-700">Upload CSV</span>
            </button>
            <button
              onClick={() => jsonInputRef.current?.click()}
              className="flex flex-col items-center gap-2 p-6 border-2 border-dashed border-gray-300 rounded-xl hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
            >
              <FileJson className="w-8 h-8 text-indigo-500" />
              <span className="text-sm font-medium text-gray-700">Upload JSON</span>
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleCSVImport}
            className="hidden"
          />
          <input
            ref={jsonInputRef}
            type="file"
            accept=".json"
            onChange={handleJSONImport}
            className="hidden"
          />
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteDialog.open}
        onClose={() => setDeleteDialog({ open: false, student: null })}
        onConfirm={handleDelete}
        title={deleteDialog.student?.status === 'inactive' ? 'Permanently delete student' : 'Remove Student'}
        message={
          deleteDialog.student?.status === 'inactive'
            ? `Permanently delete "${deleteDialog.student?.name}" and all their attendance, fees, and group memberships? This cannot be undone.`
            : `Are you sure you want to remove "${deleteDialog.student?.name}"? This will mark them as inactive.`
        }
        confirmText={deleteDialog.student?.status === 'inactive' ? 'Delete permanently' : 'Remove'}
      />
    </div>
  );
}
