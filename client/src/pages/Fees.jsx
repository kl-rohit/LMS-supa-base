import { useState, useEffect, useMemo } from 'react';
import {
  IndianRupee,
  ChevronDown,
  ChevronUp,
  Plus,
  Calendar,
  Receipt,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Minus,
  Sliders,
  Edit2,
  Trash2,
  Eye,
  EyeOff,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Modal from '../components/Modal';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import Select from '../components/Select';
import Pagination, { usePagination } from '../components/Pagination';
import { useConfirm } from '../contexts/ConfirmContext';
import { useRevealTimer } from '../hooks/useRevealTimer';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function Fees() {
  const confirm = useConfirm();
  // Bank-style mask for all monetary figures on this page.
  const amountReveal = useRevealTimer(20000);
  // Render an amount as either "₹1,200" or "₹••••" based on reveal state.
  const showAmt = (value, opts = {}) => {
    const { signedNegative = false } = opts;
    const num = Number(value) || 0;
    if (amountReveal.revealed) {
      const abs = Math.abs(num).toLocaleString('en-IN');
      return `${signedNegative && num < 0 ? '−' : ''}₹${abs}`;
    }
    return `₹••••`;
  };
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [feesData, setFeesData] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedStudent, setExpandedStudent] = useState(null);
  const [studentBreakdown, setStudentBreakdown] = useState([]);
  const [loadingBreakdown, setLoadingBreakdown] = useState(false);
  const [additionalFees, setAdditionalFees] = useState([]);
  const [addFeeModalOpen, setAddFeeModalOpen] = useState(false);
  // adjustment_type: 'fee' (positive) | 'discount' (stored as negative amount).
  // We reuse the AdditionalFees table for both — discounts are just rows with
  // amount < 0. The monthly aggregation sums these correctly without changes.
  const [feeForm, setFeeForm] = useState({
    student_ids: [],
    description: '',
    amount: '',
    date: formatDateLocal(new Date()),
    adjustment_type: 'fee',
  });
  const [savingFee, setSavingFee] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');

  // Column visibility — user picks which columns to see. Persisted in localStorage.
  const DEFAULT_COLS = {
    classes_taken: true,
    present:       false,
    absent:        false,
    min_status:    true,
    class_fees:    true,
    additional:    true,
    total:         true,
    status:        true,
  };
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = localStorage.getItem('fees_visible_cols');
      if (saved) return { ...DEFAULT_COLS, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_COLS;
  });
  const [colsMenuOpen, setColsMenuOpen] = useState(false);
  useEffect(() => {
    try { localStorage.setItem('fees_visible_cols', JSON.stringify(visibleCols)); } catch {}
  }, [visibleCols]);

  function formatDateLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  useEffect(() => {
    fetchStudents();
  }, []);

  useEffect(() => {
    fetchFees();
  }, [selectedMonth, selectedYear]);

  const fetchStudents = async () => {
    try {
      const data = await api.get('/students');
      setStudents((data.students || []).filter((s) => s.status === 'active'));
    } catch (err) {
      toast.error('Failed to load students: ' + err.message);
    }
  };

  const fetchFees = async () => {
    try {
      setLoading(true);
      const monthStr = String(selectedMonth).padStart(2, '0');
      const [feesResult, additionalResult] = await Promise.all([
        api.get(`/fees/monthly/${selectedYear}/${monthStr}`),
        api.get(`/fees/additional?month=${selectedMonth}&year=${selectedYear}`).catch(() => ({ additional_fees: [] })),
      ]);
      setFeesData(feesResult.students || []);
      setAdditionalFees(additionalResult.additional_fees || []);
    } catch (err) {
      toast.error('Failed to load fees: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchBreakdown = async (studentId) => {
    try {
      setLoadingBreakdown(true);
      const monthStr = String(selectedMonth).padStart(2, '0');
      const dateFrom = `${selectedYear}-${monthStr}-01`;
      const dateTo = `${selectedYear}-${monthStr}-31`;
      const data = await api.get(`/attendance?student_id=${studentId}&from=${dateFrom}&to=${dateTo}`);
      setStudentBreakdown(data?.attendance || []);
    } catch (err) {
      toast.error('Failed to load breakdown: ' + err.message);
      setStudentBreakdown([]);
    } finally {
      setLoadingBreakdown(false);
    }
  };

  const toggleExpand = async (studentId) => {
    if (expandedStudent === studentId) {
      setExpandedStudent(null);
      setStudentBreakdown([]);
    } else {
      setExpandedStudent(studentId);
      await fetchBreakdown(studentId);
    }
  };

  const handleAddFee = async (e) => {
    e.preventDefault();
    if (feeForm.student_ids.length === 0 || !feeForm.description || !feeForm.amount) {
      toast.error('Select at least one student and fill all fields');
      return;
    }
    try {
      setSavingFee(true);
      // Discount stored as a negative AdditionalFees amount.
      const rawAmount = Math.abs(Number(feeForm.amount));
      const signedAmount = feeForm.adjustment_type === 'discount' ? -rawAmount : rawAmount;
      // The fee belongs to the billing month currently being viewed (same as the
      // auto-generated shortfall fee), so it appears right away after saving.
      // feeForm.date stays as the literal record date.
      await api.post('/fees/additional', {
        // Send IDs as strings to preserve Catalyst ROWID precision (17-digit).
        student_ids: feeForm.student_ids.map(String),
        description: feeForm.description,
        amount: signedAmount,
        fee_date: feeForm.date,
        month: selectedMonth,
        year: selectedYear,
      });
      const label = feeForm.adjustment_type === 'discount' ? 'discount' : 'additional fee';
      toast.success(`${label.charAt(0).toUpperCase() + label.slice(1)} applied for ${feeForm.student_ids.length} student(s)`);
      setAddFeeModalOpen(false);
      setFeeForm({ student_ids: [], description: '', amount: '', date: formatDateLocal(new Date()), adjustment_type: 'fee' });
      setStudentSearch('');
      fetchFees();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingFee(false);
    }
  };

  const toggleStudentSelection = (id) => {
    setFeeForm((prev) => {
      const has = prev.student_ids.some((sid) => String(sid) === String(id));
      return {
        ...prev,
        student_ids: has
          ? prev.student_ids.filter((sid) => String(sid) !== String(id))
          : [...prev.student_ids, id],
      };
    });
  };

  const selectAllStudents = () => {
    setFeeForm((prev) => ({
      ...prev,
      student_ids: students.map((s) => s.id),
    }));
  };

  const clearAllStudents = () => {
    setFeeForm((prev) => ({ ...prev, student_ids: [] }));
  };

  const filteredStudentsList = students.filter((s) =>
    s.name.toLowerCase().includes(studentSearch.toLowerCase())
  );

  const changeMonth = (delta) => {
    let m = selectedMonth + delta;
    let y = selectedYear;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setSelectedMonth(m);
    setSelectedYear(y);
    setExpandedStudent(null);
  };

  // Map fees data from API to display format (includes payment status from backend)
  const mergedData = useMemo(() => {
    return feesData.map((f) => ({
      student_id: f.student_id,
      student_name: f.student_name,
      classes_taken: f.class_fees?.total_classes || 0,
      present_count: (f.class_fees?.present || 0) + (f.class_fees?.late || 0), // legacy 'late' → counted as present
      absent_count: f.class_fees?.absent || 0,
      total_marked: f.class_fees?.total_marked || 0,
      min_classes: f.min_classes || 0,
      shortfall_classes: f.shortfall_classes || 0,
      shortfall_amount: f.shortfall_amount || 0,
      class_fee_total: f.class_fees?.total || 0,
      additional_fee_total: f.additional_fees?.total || 0,
      total: f.grand_total || 0,
      paid: !!f.paid,
      payment: f.payment || null,
    })).filter((s) => s.classes_taken > 0 || s.additional_fee_total !== 0)
      .sort((a, b) => a.student_name?.localeCompare(b.student_name));
  }, [feesData]);

  // Bulk-select state — for marking many students as paid at once.
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

  // Mark a student's monthly total as paid.
  const markAsPaid = async (student) => {
    try {
      await api.post('/fees/payments', {
        student_id: student.student_id,
        fee_month: selectedMonth,
        fee_year: selectedYear,
        paid_amount: student.total,
        payment_date: formatDateLocal(new Date()),
      });
      toast.success(`${student.student_name} marked as paid (₹${student.total.toLocaleString('en-IN')})`);
      fetchFees();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Mark every selected unpaid student as paid in one go.
  const bulkMarkPaid = async () => {
    const toMark = mergedData.filter((s) => selectedIds.has(String(s.student_id)) && !s.paid);
    if (toMark.length === 0) {
      toast.error('No unpaid students in selection');
      return;
    }
    const ok = await confirm({
      title: `Mark ${toMark.length} student(s) as paid?`,
      message: `This records a payment for ${toMark.length} student(s) for ${MONTHS[selectedMonth - 1]} ${selectedYear}. You can undo individual payments later from the same row.`,
      confirmText: 'Mark all as paid',
      danger: false,
    });
    if (!ok) return;
    const today = formatDateLocal(new Date());
    let success = 0;
    for (const s of toMark) {
      try {
        await api.post('/fees/payments', {
          student_id: s.student_id,
          fee_month: selectedMonth,
          fee_year: selectedYear,
          paid_amount: s.total,
          payment_date: today,
        });
        success++;
      } catch (err) { console.error('bulk mark failed for', s.student_name, err.message); }
    }
    toast.success(`Marked ${success}/${toMark.length} as paid`);
    clearSelection();
    fetchFees();
  };

  // Add a "Minimum class shortfall" additional-fee row, billing the student
  // for the gap between their attended count and their configured minimum.
  // The amount comes from the backend (avg fee × shortfall classes).
  const applyShortfall = async (student) => {
    if (!student.shortfall_amount || student.shortfall_classes <= 0) return;
    const ok = await confirm({
      title: 'Charge for missed classes?',
      message: `Add ₹${student.shortfall_amount.toLocaleString('en-IN')} to ${student.student_name}'s bill for ${student.shortfall_classes} missed class(es).`,
      confirmText: 'Add charge',
      danger: false,
    });
    if (!ok) return;
    try {
      const monthName = MONTHS[selectedMonth - 1];
      await api.post('/fees/additional', {
        student_id: student.student_id,
        amount: student.shortfall_amount,
        description: `Min class shortfall — ${monthName} ${selectedYear} (${student.shortfall_classes} class${student.shortfall_classes === 1 ? '' : 'es'})`,
        fee_date: formatDateLocal(new Date()),
        month: selectedMonth,
        year: selectedYear,
      });
      toast.success(`Shortfall of ₹${student.shortfall_amount} added`);
      fetchFees();
    } catch (err) {
      toast.error('Failed: ' + err.message);
    }
  };

  // Edit / delete an existing additional fee or discount row.
  const [editFeeId, setEditFeeId] = useState(null);
  const [editFeeForm, setEditFeeForm] = useState({ description: '', amount: '' });

  const openEditFee = (af) => {
    const amt = Number(af.amount) || 0;
    setEditFeeId(af.id);
    setEditFeeForm({
      description: af.description || '',
      amount: String(Math.abs(amt)),
      is_discount: amt < 0,
    });
  };
  const closeEditFee = () => { setEditFeeId(null); };
  const saveEditFee = async () => {
    try {
      const raw = Number(editFeeForm.amount) || 0;
      const signed = editFeeForm.is_discount ? -Math.abs(raw) : Math.abs(raw);
      await api.put(`/fees/additional/${editFeeId}`, {
        description: editFeeForm.description,
        amount: signed,
      });
      toast.success('Updated');
      closeEditFee();
      fetchFees();
    } catch (err) {
      toast.error('Failed: ' + err.message);
    }
  };
  const deleteFee = async (af) => {
    const ok = await confirm({
      title: 'Delete this entry?',
      message: `Remove "${af.description}" (₹${Math.abs(Number(af.amount) || 0).toLocaleString('en-IN')}). The student's total will recalculate.`,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/fees/additional/${af.id}`);
      toast.success('Deleted');
      fetchFees();
    } catch (err) {
      toast.error('Failed: ' + err.message);
    }
  };

  // Undo a payment.
  const undoPayment = async (student) => {
    if (!student.payment?.id) return;
    const ok = await confirm({
      title: 'Undo payment?',
      message: `Mark ${student.student_name}'s payment as not received. You can re-mark it as paid later.`,
      confirmText: 'Undo payment',
    });
    if (!ok) return;
    try {
      await api.delete(`/fees/payments/${student.payment.id}`);
      toast.success('Payment undone');
      fetchFees();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const grandTotal = mergedData.reduce((sum, s) => sum + s.total, 0);
  const classFeesTotal = mergedData.reduce((sum, s) => sum + s.class_fee_total, 0);
  // Split positive (real additional fees) vs negative (discounts) so we can
  // show them as separate lines in the footer totals.
  const positiveAdditional = mergedData.reduce((sum, s) => sum + Math.max(0, s.additional_fee_total), 0);
  const discountTotal = mergedData.reduce((sum, s) => sum + Math.min(0, s.additional_fee_total), 0); // negative
  const additionalFeesTotal = positiveAdditional + discountTotal; // net (kept for backward use)
  const paidTotal = mergedData.filter((s) => s.paid).reduce((sum, s) => sum + s.total, 0);
  const pendingTotal = grandTotal - paidTotal;
  const paidCount = mergedData.filter((s) => s.paid).length;

  // Page the rows (25/page). Totals + "select all unpaid" stay over the full
  // month so figures and bulk actions cover every student, not just this page.
  const { page, setPage, pageCount, pageItems: pageData, total, from, to } = usePagination(mergedData, 25);

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':');
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${m} ${ampm}`;
  };

  if (loading) return <Loader text="Loading fees..." />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="page-header mb-0">Fee Management</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={amountReveal.toggle}
            className="btn-secondary btn-sm"
            title={amountReveal.revealed ? 'Hide amounts (auto-hides in 20s)' : 'Show amounts (auto-hides 20s later)'}
          >
            {amountReveal.revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {amountReveal.revealed ? 'Hide' : 'Show'} amounts
          </button>
          <div className="relative">
            <button
              onClick={() => setColsMenuOpen((v) => !v)}
              className="btn-secondary btn-sm"
              title="Show or hide columns"
            >
              <Sliders className="w-4 h-4" /> Columns
            </button>
            {colsMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setColsMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-20 p-2">
                  <p className="text-xs text-gray-400 px-2 py-1 uppercase tracking-wide">Visible columns</p>
                  {[
                    { k: 'classes_taken', label: 'Classes Attended' },
                    { k: 'present',       label: 'Present count' },
                    { k: 'absent',        label: 'Absent count' },
                    { k: 'min_status',    label: 'Min attendance status' },
                    { k: 'class_fees',    label: 'Class Fees' },
                    { k: 'additional',    label: 'Additional Fees' },
                    { k: 'total',         label: 'Total' },
                    { k: 'status',        label: 'Payment Status' },
                  ].map(({ k, label }) => (
                    <label key={k} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded-md cursor-pointer text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={!!visibleCols[k]}
                        onChange={(e) => setVisibleCols((prev) => ({ ...prev, [k]: e.target.checked }))}
                        className="w-4 h-4 text-indigo-600 rounded"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => { setFeeForm({ ...feeForm, adjustment_type: 'discount' }); setAddFeeModalOpen(true); }}
            className="btn-secondary btn-sm border-green-300 text-green-700 hover:bg-green-50"
          >
            <Minus className="w-4 h-4" /> Apply Discount
          </button>
          <button
            onClick={() => { setFeeForm({ ...feeForm, adjustment_type: 'fee' }); setAddFeeModalOpen(true); }}
            data-tour="fees-add"
            className="btn-primary btn-sm"
          >
            <Plus className="w-4 h-4" /> Add Additional Fee
          </button>
        </div>
      </div>

      {/* Month Selector */}
      <div className="card">
        <div className="flex items-center justify-between">
          <button onClick={() => changeMonth(-1)} className="p-2 rounded-lg hover:bg-gray-100">
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-indigo-600" />
            <div className="flex items-center gap-2">
              <Select
                value={selectedMonth}
                onChange={(v) => { setSelectedMonth(Number(v)); setExpandedStudent(null); }}
                options={MONTHS.map((month, idx) => ({ value: idx + 1, label: month }))}
              />
              <Select
                value={selectedYear}
                onChange={(v) => { setSelectedYear(Number(v)); setExpandedStudent(null); }}
                options={[2024, 2025, 2026, 2027].map((y) => ({ value: y, label: String(y) }))}
              />
            </div>
          </div>
          <button onClick={() => changeMonth(1)} className="p-2 rounded-lg hover:bg-gray-100">
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Fees Table */}
      {mergedData.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No fee records"
          message={`No fee records found for ${MONTHS[selectedMonth - 1]} ${selectedYear}.`}
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
                  onClick={bulkMarkPaid}
                  className="px-3 py-1.5 rounded-md bg-white text-indigo-700 text-sm font-medium hover:bg-indigo-50"
                >
                  <Check className="w-4 h-4 inline -mt-0.5 mr-1" />
                  Mark all as paid
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
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="table-header w-8">
                    <input
                      type="checkbox"
                      onChange={(e) => {
                        if (e.target.checked) {
                          // Select all UNPAID rows (paid rows can't be re-paid)
                          setSelectedIds(new Set(mergedData.filter((s) => !s.paid).map((s) => String(s.student_id))));
                        } else {
                          clearSelection();
                        }
                      }}
                      checked={selectedIds.size > 0 && mergedData.filter((s) => !s.paid).every((s) => selectedIds.has(String(s.student_id)))}
                      className="w-4 h-4 text-indigo-600 rounded border-gray-300"
                      title="Select all unpaid"
                    />
                  </th>
                  <th className="table-header w-8"></th>
                  <th className="table-header">Student</th>
                  {visibleCols.classes_taken && <th className="table-header text-center">Attended</th>}
                  {visibleCols.present       && <th className="table-header text-center">Present</th>}
                  {visibleCols.absent        && <th className="table-header text-center">Absent</th>}
                  {visibleCols.min_status    && <th className="table-header text-center">Min status</th>}
                  {visibleCols.class_fees    && <th className="table-header text-right">Class Fees</th>}
                  {visibleCols.additional    && <th className="table-header text-right">Additional Fees</th>}
                  {visibleCols.total         && <th className="table-header text-right">Total</th>}
                  {visibleCols.status        && <th className="table-header text-center">Status</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pageData.map((student) => (
                  <>
                    <tr
                      key={student.student_id}
                      className={`hover:bg-gray-50 cursor-pointer transition-colors ${selectedIds.has(String(student.student_id)) ? 'bg-indigo-50/40' : ''}`}
                      onClick={() => toggleExpand(student.student_id)}
                    >
                      <td className="table-cell" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(String(student.student_id))}
                          onChange={() => toggleSelect(student.student_id)}
                          disabled={student.paid}
                          className="w-4 h-4 text-indigo-600 rounded border-gray-300 disabled:opacity-30"
                          title={student.paid ? 'Already paid' : 'Select to mark as paid in bulk'}
                        />
                      </td>
                      <td className="table-cell">
                        {expandedStudent === student.student_id ? (
                          <ChevronUp className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        )}
                      </td>
                      <td className="table-cell font-medium text-gray-900">{student.student_name}</td>
                      {visibleCols.classes_taken && (
                        <td className="table-cell text-center">{student.classes_taken}</td>
                      )}
                      {visibleCols.present && (
                        <td className="table-cell text-center text-green-700">{student.present_count}</td>
                      )}
                      {visibleCols.absent && (
                        <td className="table-cell text-center text-red-600">{student.absent_count}</td>
                      )}
                      {visibleCols.min_status && (
                        <td className="table-cell text-center" onClick={(e) => e.stopPropagation()}>
                          {student.min_classes > 0 ? (
                            student.present_count >= student.min_classes ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium" title={`Minimum ${student.min_classes} class(es) per month required`}>
                                <Check className="w-3 h-3" />
                                {student.present_count}/{student.min_classes}
                              </span>
                            ) : (
                              <div className="flex flex-col items-center gap-1">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium" title={`Below minimum: needs ${student.min_classes - student.present_count} more`}>
                                  <X className="w-3 h-3" />
                                  {student.present_count}/{student.min_classes}
                                </span>
                                {!student.paid && student.shortfall_amount > 0 && (
                                  <button
                                    onClick={() => applyShortfall(student)}
                                    className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
                                    title={`Adds a one-time fee of ₹${student.shortfall_amount} for the ${student.shortfall_classes} missed class(es)`}
                                  >
                                    Charge +₹{student.shortfall_amount.toLocaleString('en-IN')}
                                  </button>
                                )}
                              </div>
                            )
                          ) : (
                            <span className="text-xs text-gray-300" title="No minimum configured for this student">—</span>
                          )}
                        </td>
                      )}
                      {visibleCols.class_fees && (
                        <td className="table-cell text-right">{showAmt(student.class_fee_total)}</td>
                      )}
                      {visibleCols.additional && (
                        <td className="table-cell text-right">
                          {student.additional_fee_total === 0 ? (
                            '-'
                          ) : student.additional_fee_total < 0 ? (
                            <span className="text-green-700" title="Discount">
                              {showAmt(student.additional_fee_total, { signedNegative: true })}
                            </span>
                          ) : (
                            <>{showAmt(student.additional_fee_total)}</>
                          )}
                        </td>
                      )}
                      {visibleCols.total && (
                        <td className="table-cell text-right font-bold text-indigo-700">
                          {showAmt(student.total)}
                        </td>
                      )}
                      {visibleCols.status && (
                      <td className="table-cell text-center" onClick={(e) => e.stopPropagation()}>
                        {student.paid ? (
                          <button
                            onClick={() => undoPayment(student)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-xs font-medium hover:bg-green-200 transition-colors"
                            title={`Paid on ${student.payment?.payment_date || ''} \u2014 click to undo`}
                          >
                            <Check className="w-3 h-3" /> Paid
                          </button>
                        ) : (
                          <button
                            onClick={() => markAsPaid(student)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-medium hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                            title="Mark this month's fee as paid"
                          >
                            Mark Paid
                          </button>
                        )}
                      </td>
                      )}
                    </tr>
                    {expandedStudent === student.student_id && (
                      <tr key={`${student.student_id}-breakdown`}>
                        <td colSpan={3 + Object.values(visibleCols).filter(Boolean).length} className="px-4 py-3 bg-gray-50">
                          {loadingBreakdown ? (
                            <div className="py-4 text-center text-sm text-gray-400">Loading breakdown...</div>
                          ) : studentBreakdown.length === 0 ? (
                            <div className="py-4 text-center text-sm text-gray-400">No class records found.</div>
                          ) : (
                            <div className="space-y-3">
                              <h4 className="text-sm font-semibold text-gray-700">Class Breakdown</h4>
                              <div className="overflow-x-auto hidden md:block">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-xs text-gray-500 border-b">
                                      <th className="pb-2 text-left font-medium">Date</th>
                                      <th className="pb-2 text-left font-medium">Class</th>
                                      <th className="pb-2 text-left font-medium">Type</th>
                                      <th className="pb-2 text-left font-medium">Duration</th>
                                      <th className="pb-2 text-left font-medium">Topic</th>
                                      <th className="pb-2 text-right font-medium">Fee</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {studentBreakdown.map((row, idx) => (
                                      <tr key={idx}>
                                        <td className="py-2 text-gray-600 whitespace-nowrap">
                                          {row.date
                                            ? new Date(row.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' })
                                            : '-'}
                                        </td>
                                        <td className="py-2 text-gray-700">
                                          {row.class_name || (row.camp_id ? 'Camp' : 'Ad-hoc')}
                                        </td>
                                        <td className="py-2">
                                          <span className={
                                            row.class_type === 'online' || row.class_type === 'online_group' ? 'badge-online' :
                                            row.class_type === 'offline_group' ? 'badge-offline-group' : 'badge-offline'
                                          }>
                                            {row.class_type === 'online_group' ? 'online group' : row.class_type?.replace('_', ' ')}
                                          </span>
                                        </td>
                                        <td className="py-2 text-gray-600">{row.duration_hours ? `${row.duration_hours}h` : '-'}</td>
                                        <td className="py-2 text-gray-600">{row.topic || '-'}</td>
                                        <td className="py-2 text-right font-medium text-gray-900">
                                          {'\u20B9'}{Number(row.fee_charged || 0).toLocaleString('en-IN')}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {/* Mobile: stacked cards instead of a side-scrolling table */}
                              <div className="md:hidden space-y-2">
                                {studentBreakdown.map((row, idx) => (
                                  <div key={idx} className="rounded-lg border border-gray-200 p-3">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-sm font-medium text-gray-900">
                                        {row.class_name || (row.camp_id ? 'Camp' : 'Ad-hoc')}
                                      </span>
                                      <span className="text-sm font-semibold text-gray-900 flex-shrink-0">
                                        {'₹'}{Number(row.fee_charged || 0).toLocaleString('en-IN')}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                      <span className="text-xs text-gray-500">
                                        {row.date
                                          ? new Date(row.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' })
                                          : '-'}
                                      </span>
                                      <span className={
                                        row.class_type === 'online' || row.class_type === 'online_group' ? 'badge-online' :
                                        row.class_type === 'offline_group' ? 'badge-offline-group' : 'badge-offline'
                                      }>
                                        {row.class_type === 'online_group' ? 'online group' : row.class_type?.replace('_', ' ')}
                                      </span>
                                      {row.duration_hours ? <span className="text-xs text-gray-500">{row.duration_hours}h</span> : null}
                                    </div>
                                    {row.topic && (
                                      <p className="text-xs text-gray-500 mt-1"><span className="text-gray-400">Topic: </span>{row.topic}</p>
                                    )}
                                  </div>
                                ))}
                              </div>

                              {/* Additional fees + discounts for this student */}
                              {additionalFees.filter((af) => String(af.student_id) === String(student.student_id)).length > 0 && (
                                <>
                                  <h4 className="text-sm font-semibold text-gray-700 mt-4">Additional Fees &amp; Discounts</h4>
                                  <div className="space-y-1">
                                    {additionalFees
                                      .filter((af) => String(af.student_id) === String(student.student_id))
                                      .map((af, idx) => {
                                        const amt = Number(af.amount) || 0;
                                        const isDiscount = amt < 0;
                                        return (
                                          <div key={idx} className="flex items-center justify-between py-1.5 text-sm group">
                                            <div className="min-w-0 flex-1">
                                              <span className={isDiscount ? 'text-green-700' : 'text-gray-700'}>
                                                {isDiscount ? '\uD83C\uDFF7\uFE0F ' : ''}{af.description}
                                              </span>
                                              <span className="text-gray-400 ml-2 text-xs">
                                                {new Date(af.fee_date || af.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-2 ml-2" onClick={(e) => e.stopPropagation()}>
                                              <span className={`font-medium ${isDiscount ? 'text-green-700' : 'text-gray-900'}`}>
                                                {isDiscount ? '\u2212' : ''}{'\u20B9'}{Math.abs(amt).toLocaleString('en-IN')}
                                              </span>
                                              <button
                                                onClick={() => openEditFee(af)}
                                                className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                                title="Edit"
                                              >
                                                <Edit2 className="w-3.5 h-3.5" />
                                              </button>
                                              <button
                                                onClick={() => deleteFee(af)}
                                                className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                                title="Delete"
                                              >
                                                <Trash2 className="w-3.5 h-3.5" />
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: stacked cards instead of a side-scrolling table */}
          <div className="md:hidden divide-y divide-gray-100">
            <label className="flex items-center gap-2 px-4 py-2 text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
              <input
                type="checkbox"
                onChange={(e) => {
                  if (e.target.checked) setSelectedIds(new Set(mergedData.filter((s) => !s.paid).map((s) => String(s.student_id))));
                  else clearSelection();
                }}
                checked={selectedIds.size > 0 && mergedData.filter((s) => !s.paid).every((s) => selectedIds.has(String(s.student_id)))}
                className="w-4 h-4 text-indigo-600 rounded border-gray-300"
              />
              Select all unpaid
            </label>
            {pageData.map((student) => {
              const expanded = expandedStudent === student.student_id;
              const belowMin = student.min_classes > 0 && student.present_count < student.min_classes;
              return (
                <div key={student.student_id} className={selectedIds.has(String(student.student_id)) ? 'bg-indigo-50/40' : ''}>
                  <div className="flex items-start gap-3 px-4 py-3 cursor-pointer" onClick={() => toggleExpand(student.student_id)}>
                    <input
                      type="checkbox"
                      onClick={(e) => e.stopPropagation()}
                      checked={selectedIds.has(String(student.student_id))}
                      onChange={() => toggleSelect(student.student_id)}
                      disabled={student.paid}
                      className="w-4 h-4 mt-1 text-indigo-600 rounded border-gray-300 disabled:opacity-30 flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-900 truncate">{student.student_name}</span>
                        <span className="font-bold text-indigo-700 flex-shrink-0">{showAmt(student.total)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <span className="text-xs text-gray-500">
                          {student.classes_taken} attended · <span className="text-green-700">{student.present_count}P</span> / <span className="text-red-600">{student.absent_count}A</span>
                        </span>
                        <span onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
                          {student.paid ? (
                            <button
                              onClick={() => undoPayment(student)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-xs font-medium"
                            >
                              <Check className="w-3 h-3" /> Paid
                            </button>
                          ) : (
                            <button
                              onClick={() => markAsPaid(student)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-medium hover:bg-indigo-50 hover:text-indigo-700"
                            >
                              Mark Paid
                            </button>
                          )}
                        </span>
                      </div>
                      {belowMin && !student.paid && student.shortfall_amount > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); applyShortfall(student); }}
                          className="mt-1 text-xs text-indigo-600 hover:underline"
                        >
                          Below min {student.present_count}/{student.min_classes} — charge +₹{student.shortfall_amount.toLocaleString('en-IN')}
                        </button>
                      )}
                    </div>
                    {expanded ? <ChevronUp className="w-4 h-4 text-gray-400 mt-1 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 mt-1 flex-shrink-0" />}
                  </div>
                  {expanded && (
                    <div className="px-4 pb-3 bg-gray-50">
                      {loadingBreakdown ? (
                        <div className="py-3 text-center text-sm text-gray-400">Loading breakdown...</div>
                      ) : studentBreakdown.length === 0 ? (
                        <div className="py-3 text-center text-sm text-gray-400">No class records found.</div>
                      ) : (
                        <div className="space-y-2">
                          {studentBreakdown.map((row, idx) => (
                            <div key={idx} className="flex items-center justify-between gap-2 text-sm border-b border-gray-100 pb-1.5">
                              <div className="min-w-0">
                                <div className="text-gray-700 truncate">
                                  {row.date ? new Date(row.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '-'}
                                  {' · '}{row.class_name || (row.camp_id ? 'Camp' : 'Ad-hoc')}
                                </div>
                                {row.topic && <div className="text-xs text-gray-400 truncate">{row.topic}</div>}
                              </div>
                              <span className="font-medium text-gray-900 flex-shrink-0">{'₹'}{Number(row.fee_charged || 0).toLocaleString('en-IN')}</span>
                            </div>
                          ))}
                          {additionalFees
                            .filter((af) => String(af.student_id) === String(student.student_id))
                            .map((af, idx) => {
                              const amt = Number(af.amount) || 0;
                              const isDiscount = amt < 0;
                              return (
                                <div key={`af-${idx}`} className="flex items-center justify-between gap-2 text-sm">
                                  <span className={`min-w-0 truncate ${isDiscount ? 'text-green-700' : 'text-gray-700'}`}>
                                    {isDiscount ? '🏷️ ' : ''}{af.description}
                                  </span>
                                  <span className={`font-medium flex-shrink-0 ${isDiscount ? 'text-green-700' : 'text-gray-900'}`}>
                                    {isDiscount ? '−' : ''}{'₹'}{Math.abs(amt).toLocaleString('en-IN')}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  )}
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
            label="students"
          />

          {/* Totals */}
          <div className="bg-indigo-50 border-t border-indigo-200 px-4 py-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <span className="font-semibold text-indigo-900">
                Monthly Total
                <span className="text-xs text-indigo-500 font-normal ml-2">({paidCount}/{mergedData.length} paid)</span>
              </span>
              <div className="flex items-center gap-5 text-sm flex-wrap">
                <span className="text-gray-600">
                  Class: <span className="font-medium">{showAmt(classFeesTotal)}</span>
                </span>
                <span className="text-gray-600">
                  Additional: <span className="font-medium">{showAmt(positiveAdditional)}</span>
                </span>
                {discountTotal < 0 && (
                  <span className="text-green-700">
                    Discounts: <span className="font-semibold">{showAmt(discountTotal, { signedNegative: true })}</span>
                  </span>
                )}
                <span className="text-green-700">
                  Paid: <span className="font-semibold">{showAmt(paidTotal)}</span>
                </span>
                <span className="text-amber-700">
                  Pending: <span className="font-semibold">{showAmt(pendingTotal)}</span>
                </span>
                <span className="text-lg font-bold text-indigo-700">
                  {showAmt(grandTotal)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Additional Fee Modal */}
      <Modal
        isOpen={addFeeModalOpen}
        onClose={() => { setAddFeeModalOpen(false); setFeeForm({ student_ids: [], description: '', amount: '', date: formatDateLocal(new Date()), adjustment_type: 'fee' }); setStudentSearch(''); }}
        title={feeForm.adjustment_type === 'discount' ? 'Apply Discount' : 'Add Additional Fee'}
        size="md"
      >
        <form onSubmit={handleAddFee} className="space-y-4">
          {/* Type toggle: Fee adds to the monthly total, Discount subtracts from it. */}
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg p-1">
            <button
              type="button"
              onClick={() => setFeeForm({ ...feeForm, adjustment_type: 'fee' })}
              className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                feeForm.adjustment_type === 'fee'
                  ? 'bg-white shadow-sm text-indigo-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              + Fee
            </button>
            <button
              type="button"
              onClick={() => setFeeForm({ ...feeForm, adjustment_type: 'discount' })}
              className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                feeForm.adjustment_type === 'discount'
                  ? 'bg-white shadow-sm text-green-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              − Discount
            </button>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Students * <span className="text-gray-400 font-normal">({feeForm.student_ids.length} selected)</span>
            </label>

            {/* Selected students chips */}
            {feeForm.student_ids.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {feeForm.student_ids.map((sid) => {
                  const s = students.find((st) => String(st.id) === String(sid));
                  return s ? (
                    <span key={sid} className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-700 rounded-md text-xs font-medium">
                      {s.name}
                      <button type="button" onClick={() => toggleStudentSelection(sid)} className="hover:text-indigo-900">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ) : null;
                })}
              </div>
            )}

            {/* Search + Select All / Clear */}
            <div className="flex items-center gap-2 mb-1.5">
              <input
                type="text"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                className="input-field flex-1"
                placeholder="Search students..."
              />
              <button type="button" onClick={selectAllStudents} className="text-xs text-indigo-600 hover:text-indigo-800 whitespace-nowrap">
                Select All
              </button>
              <button type="button" onClick={clearAllStudents} className="text-xs text-gray-500 hover:text-gray-700 whitespace-nowrap">
                Clear
              </button>
            </div>

            {/* Student list with checkboxes */}
            <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
              {filteredStudentsList.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-400">No students found</div>
              ) : (
                filteredStudentsList.map((s) => {
                  const checked = feeForm.student_ids.some((sid) => String(sid) === String(s.id));
                  return (
                    <div
                      key={s.id}
                      onClick={() => toggleStudentSelection(s.id)}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0"
                    >
                      <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                        checked ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
                      }`}>
                        {checked && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <span className="text-sm text-gray-700">{s.name}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {feeForm.adjustment_type === 'discount' ? 'Reason for discount *' : 'Description *'}
            </label>
            <input
              type="text"
              value={feeForm.description}
              onChange={(e) => setFeeForm({ ...feeForm, description: e.target.value })}
              className="input-field"
              placeholder={
                feeForm.adjustment_type === 'discount'
                  ? 'e.g., Sibling discount, Loyalty discount'
                  : 'e.g., Stationery, Books, Materials'
              }
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {feeForm.adjustment_type === 'discount' ? 'Discount amount (per student) *' : 'Amount (per student) *'}
            </label>
            <div className="relative">
              <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm ${
                feeForm.adjustment_type === 'discount' ? 'text-green-600 font-semibold' : 'text-gray-400'
              }`}>
                {feeForm.adjustment_type === 'discount' ? `\u2212\u20B9` : '\u20B9'}
              </span>
              <input
                type="number"
                value={feeForm.amount}
                onChange={(e) => setFeeForm({ ...feeForm, amount: e.target.value })}
                className={`input-field ${feeForm.adjustment_type === 'discount' ? 'pl-10' : 'pl-7'}`}
                placeholder="0"
                min="0"
                required
              />
            </div>
            {feeForm.adjustment_type === 'discount' && (
              <p className="text-xs text-green-700 mt-1">
                Enter the positive amount \u2014 it will be applied as a deduction from the monthly total.
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              value={feeForm.date}
              onChange={(e) => setFeeForm({ ...feeForm, date: e.target.value })}
              className="input-field"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setAddFeeModalOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={savingFee || feeForm.student_ids.length === 0}>
              {savingFee
                ? 'Saving...'
                : `${feeForm.adjustment_type === 'discount' ? 'Apply Discount' : 'Add Fee'}${feeForm.student_ids.length > 1 ? ` (${feeForm.student_ids.length} students)` : ''}`}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit existing additional fee / discount */}
      <Modal
        isOpen={!!editFeeId}
        onClose={closeEditFee}
        title={editFeeForm.is_discount ? 'Edit discount' : 'Edit additional fee'}
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
            <input
              type="text"
              value={editFeeForm.description}
              onChange={(e) => setEditFeeForm({ ...editFeeForm, description: e.target.value })}
              className="input-field"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Amount (₹) *
            </label>
            <input
              type="number"
              min="0"
              value={editFeeForm.amount}
              onChange={(e) => setEditFeeForm({ ...editFeeForm, amount: e.target.value })}
              className="input-field"
            />
            <p className="text-xs text-gray-400 mt-1">
              {editFeeForm.is_discount ? 'Stored as a negative amount (subtracted from total).' : 'Stored as a positive amount (added to total).'}
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button type="button" onClick={closeEditFee} className="btn-secondary btn-sm">Cancel</button>
            <button type="button" onClick={saveEditFee} className="btn-primary btn-sm">Save</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
