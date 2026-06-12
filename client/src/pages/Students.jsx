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
  Eye,
  EyeOff,
  Camera,
  Columns3,
  ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Papa from 'papaparse';
import api from '../utils/api';
import { useConfirm } from '../contexts/ConfirmContext';
import { formatMobileDisplay } from '../utils/phone';
import { maskPhone } from '../utils/mask';
import { useRevealTimer } from '../hooks/useRevealTimer';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Select from '../components/Select';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import StudentDetailPanel from '../components/StudentDetailPanel';

// Toggleable columns on the Students table. Name + Status are always
// visible (they're how you identify a row); Actions column auto-hides
// when the detail panel handles those interactions instead.
const TOGGLE_COLUMNS = [
  { key: 'parent_name',       label: 'Parent' },
  { key: 'mobile_number',     label: 'Mobile' },
  { key: 'fee_online',        label: 'Online ₹/hr' },
  { key: 'fee_offline',       label: 'Offline ₹/hr' },
  { key: 'fee_offline_group', label: 'Group ₹/hr' },
];
const DEFAULT_VISIBLE_COLS = {
  parent_name: true,
  mobile_number: true,
  fee_online: false,
  fee_offline: false,
  fee_offline_group: false,
};
const COLS_STORAGE_KEY = 'veena_students_visible_cols';

function loadVisibleCols() {
  try {
    const raw = localStorage.getItem(COLS_STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBLE_COLS;
    const parsed = JSON.parse(raw);
    // Merge over defaults so newly-introduced columns get their default state
    return { ...DEFAULT_VISIBLE_COLS, ...parsed };
  } catch {
    return DEFAULT_VISIBLE_COLS;
  }
}
function saveVisibleCols(v) {
  try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(v)); } catch {}
}

const emptyForm = {
  name: '',
  parent_name: '',
  mobile_number: '',
  fee_online: '',
  fee_offline: '',
  fee_offline_group: '',
  min_classes_per_month: '',
  date_of_birth: '',
  notes: '',
  // Self-service / Grade exam fields — usually populated by the parent
  // via the portal, but admin can view + edit here for completeness.
  email: '',
  address: '',
  father_name: '',
  mother_name: '',
  photo_url: '',
};

export default function Students() {
  const confirm = useConfirm();
  // Bank-style mask for phone numbers — toggle reveals all, auto-hides 20s later.
  const phoneReveal = useRevealTimer(20000);
  // Bulk-select state for multi-row operations
  const [selectedIds, setSelectedIds] = useState(new Set());
  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(String(id))) next.delete(String(id));
      else next.add(String(id));
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  // Bulk-edit modal state
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditField, setBulkEditField] = useState('fee_offline_group');
  const [bulkEditValue, setBulkEditValue] = useState('');
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  // Pending photo (data URL) selected via the modal file picker — not yet
  // uploaded to Stratus. handleSubmit POSTs it on save.
  const [photoPending, setPhotoPending] = useState('');
  const photoFileRef = useRef(null);

  // Column visibility (persisted to localStorage). Name/Status always show.
  const [visibleCols, setVisibleCols] = useState(loadVisibleCols);
  const [colsMenuOpen, setColsMenuOpen] = useState(false);
  const colsMenuRef = useRef(null);
  useEffect(() => {
    if (!colsMenuOpen) return;
    const onClick = (e) => {
      if (colsMenuRef.current && !colsMenuRef.current.contains(e.target)) setColsMenuOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [colsMenuOpen]);
  const toggleCol = (key) => {
    setVisibleCols((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveVisibleCols(next);
      return next;
    });
  };

  // Detail panel — null when closed, otherwise the student object.
  const [detailStudent, setDetailStudent] = useState(null);
  const isDetailOpen = detailStudent !== null;
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
      const rows = result.students || [];
      setStudents(rows);

      // Photo URLs in Students.photo_url are Stratus object keys (not
      // loadable URLs). Batch-sign them in one round-trip and patch each
      // row's photo_url with the signed URL. Legacy http(s) values and
      // empty values are returned as-is by the backend.
      const idsWithPhotos = rows.filter((s) => s.photo_url).map((s) => s.id);
      if (idsWithPhotos.length > 0) {
        try {
          const { urls } = await api.post('/students/photo-urls', { ids: idsWithPhotos });
          setStudents((prev) => prev.map((s) => urls?.[String(s.id)]
            ? { ...s, photo_url: urls[String(s.id)] }
            : (s.photo_url && !/^https?:/.test(s.photo_url) ? { ...s, photo_url: '' } : s)
          ));
        } catch (e) {
          // Non-fatal — list still renders, just without photos
          console.error('photo-urls batch failed', e.message);
        }
      }
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
        // Trim empty DOB so backend doesn't reject empty string on Date column
        date_of_birth: form.date_of_birth || null,
        // Don't send the photo_url here — it's either a transient signed URL
        // (from the list batch) or an object key. The dedicated /photo
        // endpoint is the only writer.
        photo_url: undefined,
      };
      let studentId;
      if (editingStudent) {
        await api.put(`/students/${editingStudent.id}`, payload);
        studentId = editingStudent.id;
        toast.success('Student updated');
      } else {
        const created = await api.post('/students', payload);
        studentId = created?.student?.id;
        toast.success('Student added');
      }
      // If the admin picked a new photo in the modal, upload it now that we
      // know the student id (covers both create + edit).
      if (photoPending && studentId) {
        try {
          await api.post(`/students/${studentId}/photo`, { data: photoPending });
        } catch (err) {
          toast.error('Photo upload failed: ' + err.message);
        }
      }
      setModalOpen(false);
      setEditingStudent(null);
      setForm(emptyForm);
      setPhotoPending('');
      if (photoFileRef.current) photoFileRef.current.value = '';
      fetchStudents();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // File picker → base64 preview → stored in photoPending until Save.
  const handlePickPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please pick an image file');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Photo must be 8MB or smaller');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhotoPending(String(reader.result || ''));
    reader.onerror = () => toast.error('Could not read the file');
    reader.readAsDataURL(file);
  };

  const clearPickedPhoto = () => {
    setPhotoPending('');
    if (photoFileRef.current) photoFileRef.current.value = '';
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
      // Catalyst Date columns come back as ISO timestamp; slice to YYYY-MM-DD
      date_of_birth: student.date_of_birth ? String(student.date_of_birth).slice(0, 10) : '',
      notes: student.notes || '',
      email: student.email || '',
      address: student.address || '',
      father_name: student.father_name || '',
      mother_name: student.mother_name || '',
      photo_url: student.photo_url || '',
    });
    setPhotoPending('');
    if (photoFileRef.current) photoFileRef.current.value = '';
    setModalOpen(true);
  };

  const openAdd = () => {
    setEditingStudent(null);
    setForm(emptyForm);
    setPhotoPending('');
    if (photoFileRef.current) photoFileRef.current.value = '';
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

  // Apply the bulk-edit form to every selected student.
  const handleBulkEdit = async () => {
    if (selectedIds.size === 0) return;
    const field = bulkEditField;
    const rawValue = bulkEditValue.trim();
    if (rawValue === '') { toast.error('Enter a value'); return; }
    // Coerce numeric fields
    const isNumeric = ['fee_online', 'fee_offline', 'fee_offline_group', 'min_classes_per_month'].includes(field);
    const value = isNumeric ? (Number(rawValue) || 0) : rawValue;
    const ok = await confirm({
      title: `Update ${selectedIds.size} student(s)?`,
      message: `Set ${field} = ${value} for ${selectedIds.size} selected student(s). This overwrites any existing value.`,
      confirmText: 'Update',
      danger: false,
    });
    if (!ok) return;
    let success = 0;
    for (const id of selectedIds) {
      try {
        await api.put(`/students/${id}`, { [field]: value });
        success++;
      } catch (err) { console.error('bulk edit failed for', id, err.message); }
    }
    toast.success(`Updated ${success}/${selectedIds.size} student(s)`);
    setBulkEditOpen(false);
    clearSelection();
    fetchStudents();
  };

  // Bulk-deactivate (soft delete) every selected student.
  const handleBulkDeactivate = async () => {
    if (selectedIds.size === 0) return;
    const ok = await confirm({
      title: `Deactivate ${selectedIds.size} student(s)?`,
      message: 'They will be hidden from active lists but their records (attendance, fees) are preserved. You can reactivate them later.',
      confirmText: 'Deactivate',
    });
    if (!ok) return;
    let success = 0;
    for (const id of selectedIds) {
      try { await api.delete(`/students/${id}`); success++; }
      catch (err) { console.error('deactivate failed', err.message); }
    }
    toast.success(`Deactivated ${success}/${selectedIds.size}`);
    clearSelection();
    fetchStudents();
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
    <div className={`space-y-4 transition-all duration-200 ${isDetailOpen ? 'lg:mr-[30rem]' : ''}`}>
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
          <button
            onClick={phoneReveal.toggle}
            className="btn-secondary btn-sm"
            title={phoneReveal.revealed ? 'Hide phone numbers (auto-hides in 20s)' : 'Show phone numbers (auto-hides 20s later)'}
          >
            {phoneReveal.revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {phoneReveal.revealed ? 'Hide' : 'Show'} phones
          </button>

          {/* Columns visibility dropdown */}
          <div className="relative" ref={colsMenuRef}>
            <button
              onClick={() => setColsMenuOpen((v) => !v)}
              className="btn-secondary btn-sm"
              title="Show or hide table columns"
            >
              <Columns3 className="w-4 h-4" /> Columns
            </button>
            {colsMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-30 py-1.5">
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  Show columns
                </div>
                {TOGGLE_COLUMNS.map((c) => (
                  <label
                    key={c.key}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={!!visibleCols[c.key]}
                      onChange={() => toggleCol(c.key)}
                      className="w-4 h-4 text-indigo-600 rounded border-gray-300"
                    />
                    <span className="text-gray-700">{c.label}</span>
                  </label>
                ))}
                <div className="px-3 py-1.5 text-xs text-gray-400 border-t border-gray-100">
                  Name + Status always visible.
                </div>
              </div>
            )}
          </div>

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
          {/* Bulk action bar — visible only when ≥1 row is selected */}
          {selectedIds.size > 0 && (
            <div className="bg-indigo-600 text-white px-4 py-2.5 flex items-center justify-between flex-wrap gap-3">
              <span className="text-sm font-medium">
                {selectedIds.size} student{selectedIds.size === 1 ? '' : 's'} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setBulkEditField('fee_offline_group'); setBulkEditValue(''); setBulkEditOpen(true); }}
                  className="px-3 py-1.5 rounded-md bg-white text-indigo-700 text-sm font-medium hover:bg-indigo-50"
                >
                  <Edit2 className="w-4 h-4 inline -mt-0.5 mr-1" /> Bulk edit
                </button>
                <button
                  onClick={handleBulkDeactivate}
                  className="px-3 py-1.5 rounded-md bg-red-500 text-white text-sm font-medium hover:bg-red-600"
                >
                  <Trash2 className="w-4 h-4 inline -mt-0.5 mr-1" /> Deactivate
                </button>
                <button
                  onClick={clearSelection}
                  className="px-3 py-1.5 rounded-md text-white text-sm hover:bg-indigo-500"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="table-header w-8">
                    <input
                      type="checkbox"
                      checked={selectedIds.size > 0 && filteredStudents.every((s) => selectedIds.has(String(s.id)))}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedIds(new Set(filteredStudents.map((s) => String(s.id))));
                        else clearSelection();
                      }}
                      className="w-4 h-4 text-indigo-600 rounded border-gray-300"
                      title="Select all"
                    />
                  </th>
                  <th className="table-header cursor-pointer" onClick={() => handleSort('name')}>
                    <div className="flex items-center gap-1">Name <SortIcon column="name" /></div>
                  </th>
                  {!isDetailOpen && visibleCols.parent_name && (
                    <th className="table-header cursor-pointer" onClick={() => handleSort('parent_name')}>
                      <div className="flex items-center gap-1">Parent <SortIcon column="parent_name" /></div>
                    </th>
                  )}
                  {!isDetailOpen && visibleCols.mobile_number && (
                    <th className="table-header">Mobile</th>
                  )}
                  {!isDetailOpen && visibleCols.fee_online && (
                    <th className="table-header cursor-pointer text-right" onClick={() => handleSort('fee_online')}>
                      <div className="flex items-center justify-end gap-1">Online ₹/hr <SortIcon column="fee_online" /></div>
                    </th>
                  )}
                  {!isDetailOpen && visibleCols.fee_offline && (
                    <th className="table-header cursor-pointer text-right" onClick={() => handleSort('fee_offline')}>
                      <div className="flex items-center justify-end gap-1">Offline ₹/hr <SortIcon column="fee_offline" /></div>
                    </th>
                  )}
                  {!isDetailOpen && visibleCols.fee_offline_group && (
                    <th className="table-header cursor-pointer text-right" onClick={() => handleSort('fee_offline_group')}>
                      <div className="flex items-center justify-end gap-1">Group ₹/hr <SortIcon column="fee_offline_group" /></div>
                    </th>
                  )}
                  <th className="table-header">Status</th>
                  <th className="table-header w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredStudents.map((student) => {
                  const isOpenRow = detailStudent && String(detailStudent.id) === String(student.id);
                  return (
                    <tr
                      key={student.id}
                      onClick={() => setDetailStudent(student)}
                      className={`cursor-pointer transition-colors ${
                        isOpenRow
                          ? 'bg-indigo-50'
                          : selectedIds.has(String(student.id))
                            ? 'bg-indigo-50/40 hover:bg-indigo-50/60'
                            : 'hover:bg-gray-50'
                      }`}
                    >
                      {/* Checkbox click shouldn't open the detail panel */}
                      <td className="table-cell" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(String(student.id))}
                          onChange={() => toggleSelect(student.id)}
                          className="w-4 h-4 text-indigo-600 rounded border-gray-300"
                        />
                      </td>
                      <td className="table-cell font-medium text-gray-900">
                        <div className="flex items-center gap-2">
                          {student.photo_url ? (
                            <img
                              src={student.photo_url}
                              alt=""
                              className="w-7 h-7 rounded-full object-cover border border-gray-200 flex-shrink-0"
                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-semibold text-gray-400 flex-shrink-0">
                              {(student.name || '?').slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          <span className="truncate">{student.name}</span>
                        </div>
                      </td>
                      {!isDetailOpen && visibleCols.parent_name && (
                        <td className="table-cell">{student.parent_name || '-'}</td>
                      )}
                      {!isDetailOpen && visibleCols.mobile_number && (
                        <td className="table-cell font-mono">
                          {student.mobile_number
                            ? (phoneReveal.revealed ? formatMobileDisplay(student.mobile_number) : maskPhone(student.mobile_number))
                            : '-'}
                        </td>
                      )}
                      {!isDetailOpen && visibleCols.fee_online && (
                        <td className="table-cell text-right">{student.fee_online ? `\u20B9${student.fee_online}/hr` : '-'}</td>
                      )}
                      {!isDetailOpen && visibleCols.fee_offline && (
                        <td className="table-cell text-right">{student.fee_offline ? `\u20B9${student.fee_offline}/hr` : '-'}</td>
                      )}
                      {!isDetailOpen && visibleCols.fee_offline_group && (
                        <td className="table-cell text-right">{student.fee_offline_group ? `\u20B9${student.fee_offline_group}/hr` : '-'}</td>
                      )}
                      <td className="table-cell">
                        <span className={student.status === 'active' ? 'badge-active' : 'badge-inactive'}>
                          {student.status}
                        </span>
                      </td>
                      <td className="table-cell text-right text-gray-300">
                        <ChevronRight className="w-4 h-4 inline-block" />
                      </td>
                    </tr>
                  );
                })}
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Date of birth</label>
            <input
              type="date"
              value={form.date_of_birth}
              onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
              className="input-field"
              max={new Date().toISOString().slice(0, 10)}
            />
            <p className="text-xs text-gray-400 mt-1">
              Shown in the Upcoming Birthdays card on the Dashboard. Optional.
            </p>
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
          {/* Parent-managed Grade-exam details. The parent edits these via the
              portal; admin can view + override here. */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-start gap-3 mb-4">
              {(photoPending || form.photo_url) ? (
                <img
                  src={photoPending || form.photo_url}
                  alt=""
                  className="w-16 h-16 rounded-lg object-cover border-2 border-indigo-100 flex-shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-gray-100 border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-400 text-xs text-center flex-shrink-0">
                  No photo
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-gray-800">Grade exam details</h4>
                <p className="text-xs text-gray-400 mb-2">
                  Filled by the parent via the portal — admin can override here.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="file"
                    accept="image/*"
                    ref={photoFileRef}
                    onChange={handlePickPhoto}
                    className="hidden"
                    id="admin-photo-input"
                  />
                  <label htmlFor="admin-photo-input" className="btn-secondary btn-sm cursor-pointer">
                    <Camera className="w-3.5 h-3.5" />
                    {form.photo_url || photoPending ? 'Change photo' : 'Upload photo'}
                  </label>
                  {photoPending && (
                    <>
                      <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                        Will upload on save
                      </span>
                      <button
                        type="button"
                        onClick={clearPickedPhoto}
                        className="text-xs text-gray-500 hover:text-gray-700 underline"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="input-field"
                  placeholder="parent@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Father's name</label>
                <input
                  type="text"
                  value={form.father_name}
                  onChange={(e) => setForm({ ...form, father_name: e.target.value })}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mother's name</label>
                <input
                  type="text"
                  value={form.mother_name}
                  onChange={(e) => setForm({ ...form, mother_name: e.target.value })}
                  className="input-field"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <textarea
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  rows={2}
                  className="input-field"
                  placeholder="Street, City, State, PIN"
                />
              </div>
            </div>
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

      {/* Bulk Edit Modal */}
      <Modal
        isOpen={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        title={`Bulk edit ${selectedIds.size} student(s)`}
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Field</label>
            <Select
              value={bulkEditField}
              onChange={setBulkEditField}
              className="w-full"
              options={[
                { value: 'fee_online', label: 'Online fee (₹/hr)' },
                { value: 'fee_offline', label: 'Offline fee (₹/hr)' },
                { value: 'fee_offline_group', label: 'Group fee (₹/hr)' },
                { value: 'min_classes_per_month', label: 'Minimum classes per month' },
                { value: 'status', label: 'Status (active / inactive)' },
                { value: 'notes', label: 'Notes (will replace existing)' },
              ]}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New value</label>
            {bulkEditField === 'status' ? (
              <Select
                value={bulkEditValue}
                onChange={setBulkEditValue}
                placeholder="— pick —"
                className="w-full"
                options={[
                  { value: 'active', label: 'active' },
                  { value: 'inactive', label: 'inactive' },
                ]}
              />
            ) : (
              <input
                type={['fee_online','fee_offline','fee_offline_group','min_classes_per_month'].includes(bulkEditField) ? 'number' : 'text'}
                value={bulkEditValue}
                onChange={(e) => setBulkEditValue(e.target.value)}
                className="input-field"
                min="0"
              />
            )}
            <p className="text-xs text-gray-400 mt-1">This value will overwrite the existing value on all selected students.</p>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button onClick={() => setBulkEditOpen(false)} className="btn-secondary btn-sm">Cancel</button>
            <button onClick={handleBulkEdit} className="btn-primary btn-sm">Apply to {selectedIds.size}</button>
          </div>
        </div>
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

      {/* Slide-in detail panel */}
      <StudentDetailPanel
        student={detailStudent}
        onClose={() => setDetailStudent(null)}
        onEdit={(s) => { setDetailStudent(null); openEdit(s); }}
        onDelete={(s) => { setDetailStudent(null); setDeleteDialog({ open: true, student: s }); }}
        onReactivate={(s) => { setDetailStudent(null); handleReactivate(s); }}
        formatMobile={formatMobileDisplay}
        phoneRevealed={phoneReveal.revealed}
      />
    </div>
  );
}
