import { useState, useEffect, useMemo } from 'react';
import {
  BarChart3,
  User,
  Calendar,
  TrendingUp,
  Copy,
  CopyCheck,
  IndianRupee,
  ClipboardCheck,
  Users,
  ChevronLeft,
  ChevronRight,
  Youtube,
  Search,
  Check,
  X,
  AlertCircle,
  Edit2,
  Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const TABS = [
  { id: 'student', label: 'Student Report', icon: User },
  { id: 'monthly', label: 'Monthly Report', icon: Calendar },
  { id: 'overall', label: 'Overall Report', icon: TrendingUp },
];

export default function Reports() {
  const now = new Date();
  const [activeTab, setActiveTab] = useState('student');
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Student report
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [studentReport, setStudentReport] = useState(null);
  const [loadingStudentReport, setLoadingStudentReport] = useState(false);
  // Class History filters (per-student detailed log)
  const [historyStatusFilter, setHistoryStatusFilter] = useState('all'); // all | present | absent | late
  const [historyMonthFilter, setHistoryMonthFilter] = useState('all'); // 'all' or 'YYYY-MM'
  const [historySearch, setHistorySearch] = useState('');
  // Class History inline edit
  const [editingRow, setEditingRow] = useState(null);
  const [editForm, setEditForm] = useState({ status: 'present', topic: '', notes: '', recording_url: '', fee_charged: 0 });
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Monthly report
  const [monthlyMonth, setMonthlyMonth] = useState(now.getMonth() + 1);
  const [monthlyYear, setMonthlyYear] = useState(now.getFullYear());
  const [monthlyReport, setMonthlyReport] = useState(null);
  const [loadingMonthly, setLoadingMonthly] = useState(false);

  // Overall report
  const [overallReport, setOverallReport] = useState(null);
  const [loadingOverall, setLoadingOverall] = useState(false);

  useEffect(() => {
    fetchStudents();
  }, []);

  useEffect(() => {
    if (activeTab === 'overall') fetchOverallReport();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'monthly') fetchMonthlyReport();
  }, [monthlyMonth, monthlyYear, activeTab]);

  useEffect(() => {
    if (selectedStudentId && activeTab === 'student') fetchStudentReport();
  }, [selectedStudentId, activeTab]);

  const fetchStudents = async () => {
    try {
      setLoading(true);
      const data = await api.get('/students');
      setStudents((data.students || []).filter((s) => s.status === 'active'));
    } catch (err) {
      toast.error('Failed to load students: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchStudentReport = async () => {
    if (!selectedStudentId) return;
    try {
      setLoadingStudentReport(true);
      const data = await api.get(`/reports/student/${selectedStudentId}`);
      setStudentReport(data);
    } catch (err) {
      toast.error('Failed to load report: ' + err.message);
      setStudentReport(null);
    } finally {
      setLoadingStudentReport(false);
    }
  };

  const fetchMonthlyReport = async () => {
    try {
      setLoadingMonthly(true);
      const monthStr = String(monthlyMonth).padStart(2, '0');
      const data = await api.get(`/reports/monthly/${monthlyYear}/${monthStr}`);
      setMonthlyReport(data);
    } catch (err) {
      toast.error('Failed to load report: ' + err.message);
      setMonthlyReport(null);
    } finally {
      setLoadingMonthly(false);
    }
  };

  const fetchOverallReport = async () => {
    try {
      setLoadingOverall(true);
      const data = await api.get('/reports/overall');
      setOverallReport(data);
    } catch (err) {
      toast.error('Failed to load report: ' + err.message);
      setOverallReport(null);
    } finally {
      setLoadingOverall(false);
    }
  };

  // ----- Class History edit/delete -----
  const openEdit = (r) => {
    setEditingRow(r);
    setEditForm({
      status: r.status || 'present',
      topic: r.topic || '',
      notes: r.notes || '',
      recording_url: r.recording_url || '',
      fee_charged: r.fee_charged || 0,
    });
  };

  const closeEdit = () => {
    setEditingRow(null);
    setSavingEdit(false);
  };

  const saveEdit = async () => {
    if (!editingRow) return;
    try {
      setSavingEdit(true);
      const payload = {
        status: editForm.status,
        topic: editForm.topic,
        notes: editForm.notes,
        recording_url: editForm.recording_url,
        fee_charged: editForm.status === 'absent' ? 0 : Number(editForm.fee_charged) || 0,
      };
      await api.put(`/attendance/${editingRow.id}`, payload);
      toast.success('Class record updated');
      closeEdit();
      await fetchStudentReport();
    } catch (err) {
      toast.error('Failed to update: ' + err.message);
      setSavingEdit(false);
    }
  };

  const deleteRecord = async () => {
    if (!confirmDeleteId) return;
    try {
      await api.delete(`/attendance/${confirmDeleteId}`);
      toast.success('Class record deleted');
      setConfirmDeleteId(null);
      closeEdit();
      await fetchStudentReport();
    } catch (err) {
      toast.error('Failed to delete: ' + err.message);
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Report copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const formatStudentReportText = () => {
    if (!studentReport) return '';
    const student = students.find((s) => String(s.id) === String(selectedStudentId));
    let text = `STUDENT REPORT - ${student?.name || 'Unknown'}\n`;
    text += '='.repeat(40) + '\n\n';

    if (studentReport.monthly_breakdown) {
      text += 'MONTHLY BREAKDOWN\n';
      text += '-'.repeat(30) + '\n';
      studentReport.monthly_breakdown.forEach((m) => {
        text += `${m.month_name || `${m.month}/${m.year}`}: `;
        text += `Classes: ${m.total_classes || 0}, `;
        text += `Attendance: ${Math.round(m.attendance_rate || 0)}%, `;
        text += `Fees: \u20B9${Number(m.total_fees || 0).toLocaleString('en-IN')}\n`;
      });
    }

    text += `\nTOTAL CLASSES: ${studentReport.attendance_summary?.total_classes || 0}`;
    text += `\nTOTAL FEES: \u20B9${Number(studentReport.fee_summary?.grand_total || 0).toLocaleString('en-IN')}`;
    text += `\nATTENDANCE RATE: ${Math.round(studentReport.attendance_summary?.attendance_rate || 0)}%`;
    return text;
  };

  const formatMonthlyReportText = () => {
    if (!monthlyReport) return '';
    let text = `MONTHLY REPORT - ${MONTHS[monthlyMonth - 1]} ${monthlyYear}\n`;
    text += '='.repeat(40) + '\n\n';

    if (monthlyReport.students) {
      text += 'STUDENT SUMMARY\n';
      text += '-'.repeat(30) + '\n';
      monthlyReport.students.forEach((s) => {
        text += `${s.student_name}: `;
        text += `Classes: ${s.total_classes || 0}, `;
        text += `Attendance: ${Math.round(s.attendance_rate || 0)}%, `;
        text += `Fees: \u20B9${Number(s.total_fees || 0).toLocaleString('en-IN')}\n`;
      });
    }

    text += `\nTOTAL CLASSES: ${monthlyReport.overview?.unique_classes || 0}`;
    text += `\nTOTAL FEES: \u20B9${Number(monthlyReport.overview?.grand_total_fees || 0).toLocaleString('en-IN')}`;
    text += `\nAVERAGE ATTENDANCE: ${Math.round(monthlyReport.overview?.attendance_rate || 0)}%`;
    return text;
  };

  const formatOverallReportText = () => {
    if (!overallReport) return '';
    let text = 'OVERALL REPORT\n';
    text += '='.repeat(40) + '\n\n';
    text += `Total Students: ${overallReport.students?.active || 0}\n`;
    text += `Total Classes Conducted: ${overallReport.attendance?.total_records || 0}\n`;
    text += `Total Fees Collected: \u20B9${Number(overallReport.fees?.grand_total || 0).toLocaleString('en-IN')}\n`;
    text += `Average Attendance: ${Math.round(overallReport.attendance?.overall_rate || 0)}%\n`;
    return text;
  };

  const changeMonth = (delta) => {
    let m = monthlyMonth + delta;
    let y = monthlyYear;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setMonthlyMonth(m);
    setMonthlyYear(y);
  };

  // Simple bar chart component
  const Bar = ({ value, maxValue, label, sublabel, color = 'bg-indigo-500' }) => {
    const width = maxValue > 0 ? Math.max((value / maxValue) * 100, 2) : 0;
    return (
      <div className="flex items-center gap-3">
        <div className="w-28 text-sm text-gray-700 truncate font-medium">{label}</div>
        <div className="flex-1 flex items-center gap-2">
          <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
            <div
              className={`h-full ${color} rounded-full transition-all duration-500 flex items-center justify-end pr-2`}
              style={{ width: `${width}%` }}
            >
              {width > 15 && (
                <span className="text-white text-xs font-medium">{sublabel || value}</span>
              )}
            </div>
          </div>
          {width <= 15 && (
            <span className="text-xs text-gray-500 font-medium">{sublabel || value}</span>
          )}
        </div>
      </div>
    );
  };

  if (loading) return <Loader text="Loading..." />;

  return (
    <div className="space-y-4">
      <h2 className="page-header mb-0">Reports</h2>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Student Report Tab */}
      {activeTab === 'student' && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-indigo-600" />
                <select
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="select-field w-auto"
                >
                  <option value="">Select a student...</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              {studentReport && (
                <button
                  onClick={() => copyToClipboard(formatStudentReportText())}
                  className={copied ? 'btn-success btn-sm' : 'btn-secondary btn-sm'}
                >
                  {copied ? <><CopyCheck className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Export</>}
                </button>
              )}
            </div>
          </div>

          {!selectedStudentId ? (
            <EmptyState icon={User} title="Select a student" message="Choose a student to view their report." />
          ) : loadingStudentReport ? (
            <Loader text="Loading report..." />
          ) : !studentReport ? (
            <EmptyState icon={BarChart3} title="No data" message="No report data available for this student." />
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="card text-center">
                  <ClipboardCheck className="w-8 h-8 text-indigo-500 mx-auto" />
                  <p className="text-2xl font-bold text-gray-900 mt-2">{studentReport.attendance_summary?.total_classes || 0}</p>
                  <p className="text-sm text-gray-500">Total Classes</p>
                </div>
                <div className="card text-center">
                  <IndianRupee className="w-8 h-8 text-amber-500 mx-auto" />
                  <p className="text-2xl font-bold text-gray-900 mt-2">
                    {'\u20B9'}{Number(studentReport.fee_summary?.grand_total || 0).toLocaleString('en-IN')}
                  </p>
                  <p className="text-sm text-gray-500">Total Fees</p>
                </div>
                <div className="card text-center">
                  <TrendingUp className="w-8 h-8 text-emerald-500 mx-auto" />
                  <p className="text-2xl font-bold text-gray-900 mt-2">
                    {Math.round(studentReport.attendance_summary?.attendance_rate || 0)}%
                  </p>
                  <p className="text-sm text-gray-500">Attendance Rate</p>
                </div>
              </div>

              {/* Monthly Breakdown */}
              {studentReport.monthly_breakdown && studentReport.monthly_breakdown.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Monthly Breakdown</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="table-header">Month</th>
                          <th className="table-header text-center">Classes</th>
                          <th className="table-header text-center">Attendance</th>
                          <th className="table-header text-right">Fees</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {studentReport.monthly_breakdown.map((m, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="table-cell font-medium">{m.month_name || `${MONTHS[(m.month || 1) - 1]} ${m.year}`}</td>
                            <td className="table-cell text-center">{m.total_classes || 0}</td>
                            <td className="table-cell text-center">
                              <div className="flex items-center justify-center gap-2">
                                <div className="w-16 bg-gray-100 rounded-full h-2 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${(m.attendance_rate || 0) >= 80 ? 'bg-green-500' : (m.attendance_rate || 0) >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                                    style={{ width: `${m.attendance_rate || 0}%` }}
                                  />
                                </div>
                                <span className="text-xs text-gray-500">{Math.round(m.attendance_rate || 0)}%</span>
                              </div>
                            </td>
                            <td className="table-cell text-right font-medium">
                              {'\u20B9'}{Number(m.total_fees || 0).toLocaleString('en-IN')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Visual Chart */}
                  <div className="mt-6 space-y-3">
                    <h4 className="text-sm font-semibold text-gray-700">Classes Taken</h4>
                    {(() => {
                      const maxClasses = Math.max(...studentReport.monthly_breakdown.map((m) => m.total_classes || 0), 1);
                      return studentReport.monthly_breakdown.map((m, idx) => (
                        <Bar
                          key={idx}
                          label={m.month_name || `${(MONTHS[(m.month || 1) - 1] || '').substring(0, 3)}`}
                          value={m.total_classes || 0}
                          maxValue={maxClasses}
                          color="bg-indigo-500"
                        />
                      ));
                    })()}
                  </div>

                  <div className="mt-6 space-y-3">
                    <h4 className="text-sm font-semibold text-gray-700">Fees ({'\u20B9'})</h4>
                    {(() => {
                      const maxFees = Math.max(...studentReport.monthly_breakdown.map((m) => m.total_fees || 0), 1);
                      return studentReport.monthly_breakdown.map((m, idx) => (
                        <Bar
                          key={idx}
                          label={m.month_name || `${(MONTHS[(m.month || 1) - 1] || '').substring(0, 3)}`}
                          value={m.total_fees || 0}
                          maxValue={maxFees}
                          sublabel={`\u20B9${Number(m.total_fees || 0).toLocaleString('en-IN')}`}
                          color="bg-amber-500"
                        />
                      ));
                    })()}
                  </div>
                </div>
              )}

              {/* Class History — every class with topic, notes, recording */}
              {studentReport.attendance && studentReport.attendance.length > 0 && (() => {
                // Available months (YYYY-MM) derived from attendance dates, newest first
                const monthSet = new Set();
                studentReport.attendance.forEach((r) => {
                  if (r.date && /^\d{4}-\d{2}/.test(r.date)) monthSet.add(r.date.slice(0, 7));
                });
                const availableMonths = Array.from(monthSet).sort().reverse();

                const records = studentReport.attendance.filter((r) => {
                  if (historyStatusFilter !== 'all' && r.status !== historyStatusFilter) return false;
                  if (historyMonthFilter !== 'all') {
                    if (!r.date || !r.date.startsWith(historyMonthFilter)) return false;
                  }
                  if (historySearch.trim()) {
                    const q = historySearch.toLowerCase();
                    return (
                      (r.topic || '').toLowerCase().includes(q) ||
                      (r.notes || '').toLowerCase().includes(q) ||
                      (r.class_name || '').toLowerCase().includes(q)
                    );
                  }
                  return true;
                });
                return (
                  <div className="card">
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                      <h3 className="font-semibold text-gray-900">
                        Class History <span className="text-sm text-gray-400 font-normal">({records.length} of {studentReport.attendance.length})</span>
                      </h3>
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative">
                          <Search className="w-4 h-4 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={historySearch}
                            onChange={(e) => setHistorySearch(e.target.value)}
                            placeholder="Search topic / notes..."
                            className="input-field text-sm pl-8 w-56"
                          />
                        </div>
                        <select
                          value={historyMonthFilter}
                          onChange={(e) => setHistoryMonthFilter(e.target.value)}
                          className="select-field text-sm w-auto"
                        >
                          <option value="all">All months</option>
                          {availableMonths.map((ym) => {
                            const [y, m] = ym.split('-');
                            return (
                              <option key={ym} value={ym}>
                                {MONTHS[parseInt(m, 10) - 1]} {y}
                              </option>
                            );
                          })}
                        </select>
                        <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-1">
                          {['all', 'present', 'absent', 'late'].map((s) => (
                            <button
                              key={s}
                              onClick={() => setHistoryStatusFilter(s)}
                              className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                                historyStatusFilter === s
                                  ? 'bg-indigo-100 text-indigo-700'
                                  : 'text-gray-500 hover:text-gray-700'
                              }`}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {records.length === 0 ? (
                      <div className="text-center py-6 text-sm text-gray-400">No classes match the filters.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                              <th className="table-header whitespace-nowrap">Date</th>
                              <th className="table-header">Class</th>
                              <th className="table-header text-center">Status</th>
                              <th className="table-header">Topic taught</th>
                              <th className="table-header">Notes / discussed</th>
                              <th className="table-header text-center">Recording</th>
                              <th className="table-header text-right">Fee</th>
                              <th className="table-header text-center w-12"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {records.map((r, idx) => (
                              <tr key={idx} className={r.status === 'absent' ? 'bg-red-50/30' : ''}>
                                <td className="table-cell whitespace-nowrap text-gray-600">
                                  {r.date
                                    ? new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' })
                                    : '-'}
                                </td>
                                <td className="table-cell text-gray-700">
                                  {r.class_name || (r.camp_id ? 'Camp' : 'Ad-hoc')}
                                </td>
                                <td className="table-cell text-center">
                                  {r.status === 'present' && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                                      <Check className="w-3 h-3" /> Present
                                    </span>
                                  )}
                                  {r.status === 'absent' && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
                                      <X className="w-3 h-3" /> Absent
                                    </span>
                                  )}
                                  {r.status === 'late' && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
                                      <AlertCircle className="w-3 h-3" /> Late
                                    </span>
                                  )}
                                </td>
                                <td className="table-cell text-gray-700 max-w-xs">
                                  {r.topic ? (
                                    <span title={r.topic}>{r.topic}</span>
                                  ) : (
                                    <span className="text-gray-300">—</span>
                                  )}
                                </td>
                                <td className="table-cell text-gray-700 max-w-xs">
                                  {r.notes ? (
                                    <span title={r.notes}>{r.notes}</span>
                                  ) : (
                                    <span className="text-gray-300">—</span>
                                  )}
                                </td>
                                <td className="table-cell text-center">
                                  {r.recording_url ? (
                                    <a
                                      href={r.recording_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-red-600 hover:text-red-700"
                                      title="Open recording"
                                    >
                                      <Youtube className="w-4 h-4" />
                                    </a>
                                  ) : (
                                    <span className="text-gray-300">—</span>
                                  )}
                                </td>
                                <td className="table-cell text-right text-gray-700 whitespace-nowrap">
                                  {r.status === 'present' || r.status === 'late'
                                    ? `₹${Number(r.fee_charged || 0).toLocaleString('en-IN')}`
                                    : '—'}
                                </td>
                                <td className="table-cell text-center">
                                  <button
                                    onClick={() => openEdit(r)}
                                    className="p-1 rounded-md hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors"
                                    title="Edit class record"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* Monthly Report Tab */}
      {activeTab === 'monthly' && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between">
              <button onClick={() => changeMonth(-1)} className="p-2 rounded-lg hover:bg-gray-100">
                <ChevronLeft className="w-4 h-4 text-gray-600" />
              </button>
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-indigo-600" />
                <select
                  value={monthlyMonth}
                  onChange={(e) => setMonthlyMonth(Number(e.target.value))}
                  className="select-field w-auto"
                >
                  {MONTHS.map((month, idx) => (
                    <option key={idx} value={idx + 1}>{month}</option>
                  ))}
                </select>
                <select
                  value={monthlyYear}
                  onChange={(e) => setMonthlyYear(Number(e.target.value))}
                  className="select-field w-auto"
                >
                  {[2024, 2025, 2026, 2027].map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                {monthlyReport && (
                  <button
                    onClick={() => copyToClipboard(formatMonthlyReportText())}
                    className={copied ? 'btn-success btn-sm' : 'btn-secondary btn-sm'}
                  >
                    {copied ? <><CopyCheck className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Export</>}
                  </button>
                )}
                <button onClick={() => changeMonth(1)} className="p-2 rounded-lg hover:bg-gray-100">
                  <ChevronRight className="w-4 h-4 text-gray-600" />
                </button>
              </div>
            </div>
          </div>

          {loadingMonthly ? (
            <Loader text="Loading report..." />
          ) : !monthlyReport ? (
            <EmptyState icon={Calendar} title="No data" message={`No data for ${MONTHS[monthlyMonth - 1]} ${monthlyYear}.`} />
          ) : (
            <>
              {/* Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="card text-center">
                  <p className="text-2xl font-bold text-gray-900">{monthlyReport.overview?.unique_students || (monthlyReport.students || []).length}</p>
                  <p className="text-sm text-gray-500">Active Students</p>
                </div>
                <div className="card text-center">
                  <p className="text-2xl font-bold text-gray-900">{monthlyReport.overview?.unique_classes || 0}</p>
                  <p className="text-sm text-gray-500">Total Classes</p>
                </div>
                <div className="card text-center">
                  <p className="text-2xl font-bold text-gray-900">
                    {'\u20B9'}{Number(monthlyReport.overview?.grand_total_fees || 0).toLocaleString('en-IN')}
                  </p>
                  <p className="text-sm text-gray-500">Total Fees</p>
                </div>
                <div className="card text-center">
                  <p className="text-2xl font-bold text-gray-900">
                    {Math.round(monthlyReport.overview?.attendance_rate || 0)}%
                  </p>
                  <p className="text-sm text-gray-500">Avg Attendance</p>
                </div>
              </div>

              {/* Students Table */}
              {monthlyReport.students && monthlyReport.students.length > 0 && (
                <div className="card p-0 overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <h3 className="font-semibold text-gray-900">Student Summary</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="table-header">Student</th>
                          <th className="table-header text-center">Classes</th>
                          <th className="table-header text-center">Attendance</th>
                          <th className="table-header text-right">Fees</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {monthlyReport.students.map((s, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="table-cell font-medium text-gray-900">{s.student_name || s.name}</td>
                            <td className="table-cell text-center">{s.total_classes || 0}</td>
                            <td className="table-cell text-center">
                              <div className="flex items-center justify-center gap-2">
                                <div className="w-16 bg-gray-100 rounded-full h-2 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${(s.attendance_rate || 0) >= 80 ? 'bg-green-500' : (s.attendance_rate || 0) >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                                    style={{ width: `${Math.min(s.attendance_rate || 0, 100)}%` }}
                                  />
                                </div>
                                <span className="text-xs">{Math.round(s.attendance_rate || 0)}%</span>
                              </div>
                            </td>
                            <td className="table-cell text-right font-medium">
                              {'\u20B9'}{Number(s.total_fees || 0).toLocaleString('en-IN')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Visual Charts */}
              {monthlyReport.students && monthlyReport.students.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Fees by Student</h3>
                  <div className="space-y-3">
                    {(() => {
                      const maxFees = Math.max(...monthlyReport.students.map((s) => s.total_fees || 0), 1);
                      return monthlyReport.students.map((s, idx) => (
                        <Bar
                          key={idx}
                          label={s.student_name || s.name || ''}
                          value={s.total_fees || 0}
                          maxValue={maxFees}
                          sublabel={`\u20B9${Number(s.total_fees || 0).toLocaleString('en-IN')}`}
                          color={idx % 3 === 0 ? 'bg-indigo-500' : idx % 3 === 1 ? 'bg-amber-500' : 'bg-emerald-500'}
                        />
                      ));
                    })()}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Edit Class Record modal (Class History inline edit) */}
      <Modal
        isOpen={!!editingRow}
        onClose={closeEdit}
        title="Edit Class Record"
        size="md"
      >
        {editingRow && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600">
              <div>
                <span className="text-gray-400">Date:</span>{' '}
                <span className="font-medium text-gray-700">
                  {editingRow.date
                    ? new Date(editingRow.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' })
                    : '-'}
                </span>
              </div>
              <div className="mt-0.5">
                <span className="text-gray-400">Class:</span>{' '}
                <span className="font-medium text-gray-700">
                  {editingRow.class_name || (editingRow.camp_id ? 'Camp' : 'Ad-hoc')}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <div className="flex gap-2">
                {['present', 'absent', 'late'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setEditForm({ ...editForm, status: s })}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium capitalize border transition-colors ${
                      editForm.status === s
                        ? s === 'present'
                          ? 'bg-green-100 border-green-300 text-green-700'
                          : s === 'absent'
                          ? 'bg-red-100 border-red-300 text-red-700'
                          : 'bg-amber-100 border-amber-300 text-amber-700'
                        : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Topic taught</label>
              <input
                type="text"
                value={editForm.topic}
                onChange={(e) => setEditForm({ ...editForm, topic: e.target.value })}
                placeholder="e.g. Raag Yaman — alaap"
                className="input-field"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes / discussed</label>
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                placeholder="What was covered, homework, observations..."
                rows={3}
                className="input-field resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <span className="inline-flex items-center gap-1">
                  <Youtube className="w-4 h-4 text-red-500" /> Recording URL
                </span>
              </label>
              <input
                type="url"
                value={editForm.recording_url}
                onChange={(e) => setEditForm({ ...editForm, recording_url: e.target.value })}
                placeholder="https://youtube.com/..."
                className="input-field"
              />
            </div>

            {editForm.status !== 'absent' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fee charged ({'₹'})</label>
                <input
                  type="number"
                  min="0"
                  value={editForm.fee_charged}
                  onChange={(e) => setEditForm({ ...editForm, fee_charged: e.target.value })}
                  className="input-field"
                />
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(editingRow.id)}
                className="btn-danger btn-sm"
                disabled={savingEdit}
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={closeEdit} className="btn-secondary btn-sm" disabled={savingEdit}>
                  Cancel
                </button>
                <button type="button" onClick={saveEdit} className="btn-primary btn-sm" disabled={savingEdit}>
                  {savingEdit ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={deleteRecord}
        title="Delete class record?"
        message="This will permanently remove this attendance entry. The student's totals will recalculate. This cannot be undone."
        confirmText="Delete"
        danger
      />

      {/* Overall Report Tab */}
      {activeTab === 'overall' && (
        <div className="space-y-4">
          {loadingOverall ? (
            <Loader text="Loading report..." />
          ) : !overallReport ? (
            <EmptyState icon={TrendingUp} title="No data" message="No overall data available yet." />
          ) : (
            <>
              <div className="flex justify-end">
                <button
                  onClick={() => copyToClipboard(formatOverallReportText())}
                  className={copied ? 'btn-success btn-sm' : 'btn-secondary btn-sm'}
                >
                  {copied ? <><CopyCheck className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Export</>}
                </button>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="card text-center bg-gradient-to-br from-indigo-500 to-purple-600 text-white border-0">
                  <Users className="w-8 h-8 mx-auto opacity-80" />
                  <p className="text-3xl font-bold mt-2">{overallReport.students?.active || 0}</p>
                  <p className="text-sm opacity-80">Total Students</p>
                </div>
                <div className="card text-center bg-gradient-to-br from-blue-500 to-cyan-600 text-white border-0">
                  <ClipboardCheck className="w-8 h-8 mx-auto opacity-80" />
                  <p className="text-3xl font-bold mt-2">{overallReport.attendance?.total_records || 0}</p>
                  <p className="text-sm opacity-80">Classes Conducted</p>
                </div>
                <div className="card text-center bg-gradient-to-br from-amber-500 to-orange-600 text-white border-0">
                  <IndianRupee className="w-8 h-8 mx-auto opacity-80" />
                  <p className="text-3xl font-bold mt-2">
                    {'\u20B9'}{Number(overallReport.fees?.grand_total || 0).toLocaleString('en-IN')}
                  </p>
                  <p className="text-sm opacity-80">Total Fees</p>
                </div>
                <div className="card text-center bg-gradient-to-br from-emerald-500 to-teal-600 text-white border-0">
                  <TrendingUp className="w-8 h-8 mx-auto opacity-80" />
                  <p className="text-3xl font-bold mt-2">
                    {Math.round(overallReport.attendance?.overall_rate || 0)}%
                  </p>
                  <p className="text-sm opacity-80">Avg Attendance</p>
                </div>
              </div>

              {/* Monthly Trends */}
              {overallReport.monthly_revenue && overallReport.monthly_revenue.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Monthly Trends - Classes</h3>
                  <div className="space-y-3">
                    {(() => {
                      const maxClasses = Math.max(...overallReport.monthly_revenue.map((m) => m.total_records || 0), 1);
                      return overallReport.monthly_revenue.map((m, idx) => (
                        <Bar
                          key={idx}
                          label={`${(MONTHS[(parseInt(m.month) || 1) - 1] || '').substring(0, 3)} ${m.year}`}
                          value={m.total_records || 0}
                          maxValue={maxClasses}
                          color="bg-indigo-500"
                        />
                      ));
                    })()}
                  </div>
                </div>
              )}

              {overallReport.monthly_revenue && overallReport.monthly_revenue.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Monthly Trends - Revenue</h3>
                  <div className="space-y-3">
                    {(() => {
                      const maxFees = Math.max(...overallReport.monthly_revenue.map((m) => m.total_revenue || 0), 1);
                      return overallReport.monthly_revenue.map((m, idx) => (
                        <Bar
                          key={idx}
                          label={`${(MONTHS[(parseInt(m.month) || 1) - 1] || '').substring(0, 3)} ${m.year}`}
                          value={m.total_revenue || 0}
                          maxValue={maxFees}
                          sublabel={`\u20B9${Number(m.total_revenue || 0).toLocaleString('en-IN')}`}
                          color="bg-amber-500"
                        />
                      ));
                    })()}
                  </div>
                </div>
              )}

              {overallReport.monthly_revenue && overallReport.monthly_revenue.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Monthly Trends - Attendance Rate</h3>
                  <div className="space-y-3">
                    {overallReport.monthly_revenue.map((m, idx) => {
                      const rate = m.total_records > 0 ? Math.round((m.present / m.total_records) * 100) : 0;
                      return (
                        <Bar
                          key={idx}
                          label={`${(MONTHS[(parseInt(m.month) || 1) - 1] || '').substring(0, 3)} ${m.year}`}
                          value={rate}
                          maxValue={100}
                          sublabel={`${rate}%`}
                          color={rate >= 80 ? 'bg-emerald-500' : rate >= 50 ? 'bg-amber-500' : 'bg-red-500'}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Class Type Distribution */}
              {overallReport.classes && (
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Class Type Distribution</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                      { class_type: 'Online', count: overallReport.classes.online || 0 },
                      { class_type: 'Offline', count: overallReport.classes.offline || 0 },
                      { class_type: 'Offline Group', count: overallReport.classes.offline_group || 0 },
                    ].map((ct, idx) => (
                      <div key={idx} className="bg-gray-50 rounded-xl p-4 text-center">
                        <p className="text-sm text-gray-500">{ct.class_type}</p>
                        <p className="text-2xl font-bold text-gray-900 mt-1">{ct.count}</p>
                        <p className="text-xs text-gray-400">active classes</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
