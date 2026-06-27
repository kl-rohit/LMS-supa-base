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
  Search,
  Check,
  X,
  Edit2,
  Trash2,
  Youtube,
  PlayCircle,
  CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Select from '../components/Select';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const TABS = [
  { id: 'student', label: 'Student Report', icon: User },
  { id: 'monthly', label: 'Monthly Report', icon: Calendar },
  { id: 'overall', label: 'Overall Report', icon: TrendingUp },
  { id: 'lessons', label: 'Lesson Activity', icon: Youtube },
];

// Parse a Catalyst CREATEDTIME / MODIFIEDTIME value into a Date. Most data
// centres return a human format ("Jun 20, 2026 02:30 PM") that new Date()
// reads directly; some return an ISO-ish form with colon-separated millis
// ("2026-06-20 14:30:05:123"). Try the native parse first, then fix the
// ISO-with-colon-millis shape. Returns null when unparseable (so callers can
// fall back instead of rendering "Invalid Date").
function parseTs(v) {
  if (!v) return null;
  let d = new Date(v);
  if (!isNaN(d.getTime())) return d;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?::(\d{1,3}))?/);
  if (m) {
    d = new Date(`${m[1]}T${m[2]}${m[3] ? '.' + m[3].padStart(3, '0') : ''}`);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

export default function Reports() {
  const now = new Date();
  const [activeTab, setActiveTab] = useState('overall');
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
  const [editForm, setEditForm] = useState({ status: 'present', topic: '', notes: '', fee_charged: 0 });
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

  // Lessons activity report (cross-student × cross-course progress)
  const [lessonActivity, setLessonActivity] = useState([]);
  const [loadingLessons, setLoadingLessons] = useState(false);
  const [lessonStudentFilter, setLessonStudentFilter] = useState('all');
  const [lessonCourseFilter, setLessonCourseFilter] = useState('all');

  // Per-student lesson progress, shown inline on the Student Report tab
  const [studentLessons, setStudentLessons] = useState([]);

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

  useEffect(() => {
    if (activeTab === 'lessons') fetchLessonActivity();
  }, [activeTab]);

  // Fetch this student's lesson progress when they're picked on the Student tab.
  useEffect(() => {
    if (selectedStudentId && activeTab === 'student') {
      api.get(`/lessons/activity?student_id=${selectedStudentId}`)
        .then((d) => setStudentLessons(d.activity || []))
        .catch(() => setStudentLessons([]));
    }
  }, [selectedStudentId, activeTab]);

  const fetchLessonActivity = async () => {
    try {
      setLoadingLessons(true);
      const data = await api.get('/lessons/activity');
      setLessonActivity(data.activity || []);
    } catch (err) {
      toast.error('Failed to load lesson activity: ' + err.message);
    } finally {
      setLoadingLessons(false);
    }
  };

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
      <div className="flex flex-wrap border-b border-gray-200" data-tour="reports-tabs">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600 dark:text-white'
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
                <Select
                  value={selectedStudentId}
                  onChange={setSelectedStudentId}
                  placeholder="Select a student..."
                  options={[
                    { value: '', label: 'Select a student...' },
                    ...students.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
                {selectedStudentId && studentReport?.attendance && (() => {
                  const monthSet = new Set();
                  studentReport.attendance.forEach((r) => {
                    if (r.date && /^\d{4}-\d{2}/.test(r.date)) monthSet.add(r.date.slice(0, 7));
                  });
                  const availableMonths = Array.from(monthSet).sort().reverse();
                  return (
                    <Select
                      value={historyMonthFilter}
                      onChange={setHistoryMonthFilter}
                      ariaLabel="Filter Class History & Absences by month"
                      options={[
                        { value: 'all', label: 'All months' },
                        ...availableMonths.map((ym) => {
                          const [y, m] = ym.split('-');
                          return { value: ym, label: `${MONTHS[parseInt(m, 10) - 1]} ${y}` };
                        }),
                      ]}
                    />
                  );
                })()}
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

              {/* Absences — quick list with dates + topics. Respects the top-of-page month filter. */}
              {studentReport.attendance && (() => {
                const absences = studentReport.attendance.filter((r) => {
                  if (r.status !== 'absent') return false;
                  if (historyMonthFilter !== 'all' && (!r.date || !r.date.startsWith(historyMonthFilter))) return false;
                  return true;
                });
                if (absences.length === 0) return null;
                const monthLabel = historyMonthFilter === 'all' ? 'all-time' : (() => {
                  const [y, m] = historyMonthFilter.split('-');
                  return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
                })();
                return (
                  <div className="card">
                    <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <X className="w-5 h-5 text-red-500" />
                      Absences <span className="text-sm text-gray-400 font-normal">({absences.length} · {monthLabel})</span>
                    </h3>
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {absences.map((r) => (
                        <div key={r.id} className="flex items-center justify-between gap-4 px-3 py-2 rounded-md bg-red-50/40 border border-red-100">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800 whitespace-nowrap">
                              {r.date
                                ? new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' })
                                : '-'}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5 truncate">
                              {r.class_name || (r.camp_id ? 'Camp' : 'Ad-hoc')}
                              {r.topic ? ` — ${r.topic}` : ''}
                            </p>
                          </div>
                          <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
                            <X className="w-3 h-3" /> Absent
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Lesson Progress — per-course progress for the selected student */}
              {studentLessons.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <Youtube className="w-5 h-5 text-red-500" />
                    Lesson Progress
                    <span className="text-sm text-gray-400 font-normal">({studentLessons.length} course{studentLessons.length === 1 ? '' : 's'})</span>
                  </h3>
                  <div className="space-y-3">
                    {studentLessons.map((r) => {
                      const isComplete = r.percent_complete >= 90;
                      return (
                        <div key={r.course_id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100">
                          <div className="flex-shrink-0">
                            {isComplete ? (
                              <CheckCircle2 className="w-6 h-6 text-green-500" />
                            ) : (
                              <PlayCircle className="w-6 h-6 text-indigo-500" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-800 truncate">{r.course_name}</p>
                            <div className="mt-1 flex items-center gap-2">
                              <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${isComplete ? 'bg-green-500' : r.percent_complete >= 50 ? 'bg-indigo-500' : 'bg-amber-500'}`}
                                  style={{ width: `${r.percent_complete}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500 whitespace-nowrap">
                                {r.lessons_completed}/{r.lessons_total} · {r.percent_complete}%
                              </span>
                            </div>
                            <p className="text-xs text-gray-400 mt-1">
                              {r.total_watched_minutes > 0 ? `${r.total_watched_minutes} min watched` : 'Not started'}
                              {parseTs(r.last_activity_at) && (
                                <> · Last opened {parseTs(r.last_activity_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</>
                              )}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Monthly Breakdown */}
              {studentReport.monthly_breakdown && studentReport.monthly_breakdown.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Monthly Breakdown</h3>
                  <div className="overflow-x-auto hidden md:block">
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

                  {/* Mobile cards */}
                  <div className="md:hidden divide-y divide-gray-100">
                    {studentReport.monthly_breakdown.map((m, idx) => (
                      <div key={idx} className="py-3 first:pt-0">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-medium text-gray-900">{m.month_name || `${MONTHS[(m.month || 1) - 1]} ${m.year}`}</span>
                          <span className="font-semibold text-gray-900">{'\u20B9'}{Number(m.total_fees || 0).toLocaleString('en-IN')}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          <span>{m.total_classes || 0} classes</span>
                          <div className="flex items-center gap-1.5 flex-1">
                            <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${(m.attendance_rate || 0) >= 80 ? 'bg-green-500' : (m.attendance_rate || 0) >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                                style={{ width: `${m.attendance_rate || 0}%` }}
                              />
                            </div>
                            <span>{Math.round(m.attendance_rate || 0)}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
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
                        <Select
                          value={historyMonthFilter}
                          onChange={setHistoryMonthFilter}
                          options={[
                            { value: 'all', label: 'All months' },
                            ...availableMonths.map((ym) => {
                              const [y, m] = ym.split('-');
                              return { value: ym, label: `${MONTHS[parseInt(m, 10) - 1]} ${y}` };
                            }),
                          ]}
                        />
                        <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-1">
                          {['all', 'present', 'absent'].map((s) => (
                            <button
                              key={s}
                              onClick={() => setHistoryStatusFilter(s)}
                              className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                                historyStatusFilter === s
                                  ? 'bg-indigo-100 text-gray-900 dark:bg-indigo-600 dark:text-white'
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
                      <>
                      <div className="overflow-x-auto hidden md:block">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                              <th className="table-header whitespace-nowrap">Date</th>
                              <th className="table-header">Class</th>
                              <th className="table-header text-center">Status</th>
                              <th className="table-header">Topic taught</th>
                              <th className="table-header">Notes / discussed</th>
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
                                  {(r.status === 'present' || r.status === 'late') && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                                      <Check className="w-3 h-3" /> Present
                                    </span>
                                  )}
                                  {r.status === 'absent' && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
                                      <X className="w-3 h-3" /> Absent
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

                      {/* Mobile cards */}
                      <div className="md:hidden space-y-3">
                        {records.map((r, idx) => (
                          <div key={idx} className={`rounded-lg border p-3 ${r.status === 'absent' ? 'border-red-100 bg-red-50/40' : 'border-gray-100'}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-gray-900">
                                  {r.date
                                    ? new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' })
                                    : '-'}
                                </div>
                                <div className="text-xs text-gray-500">{r.class_name || (r.camp_id ? 'Camp' : 'Ad-hoc')}</div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {(r.status === 'present' || r.status === 'late') && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                                    <Check className="w-3 h-3" /> Present
                                  </span>
                                )}
                                {r.status === 'absent' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
                                    <X className="w-3 h-3" /> Absent
                                  </span>
                                )}
                                <button
                                  onClick={() => openEdit(r)}
                                  className="p-1 rounded-md hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors"
                                  title="Edit class record"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            {r.topic && (
                              <p className="mt-2 text-sm text-gray-700"><span className="text-gray-400">Topic: </span>{r.topic}</p>
                            )}
                            {r.notes && (
                              <p className="mt-1 text-sm text-gray-700"><span className="text-gray-400">Notes: </span>{r.notes}</p>
                            )}
                            {(r.status === 'present' || r.status === 'late') && (
                              <p className="mt-1 text-sm text-gray-700"><span className="text-gray-400">Fee: </span>{`₹${Number(r.fee_charged || 0).toLocaleString('en-IN')}`}</p>
                            )}
                          </div>
                        ))}
                      </div>
                      </>
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
                <Select
                  value={monthlyMonth}
                  onChange={(v) => setMonthlyMonth(Number(v))}
                  options={MONTHS.map((month, idx) => ({ value: idx + 1, label: month }))}
                />
                <Select
                  value={monthlyYear}
                  onChange={(v) => setMonthlyYear(Number(v))}
                  options={[2024, 2025, 2026, 2027].map((y) => ({ value: y, label: String(y) }))}
                />
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
                  <div className="overflow-x-auto hidden md:block">
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
                            <td className="table-cell font-medium">
                              <button
                                onClick={() => {
                                  setSelectedStudentId(String(s.student_id || s.id));
                                  setActiveTab('student');
                                }}
                                className="text-indigo-600 hover:text-indigo-800 hover:underline text-left"
                                title="View this student's full report"
                              >
                                {s.student_name || s.name}
                              </button>
                            </td>
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

                  {/* Mobile cards */}
                  <div className="md:hidden divide-y divide-gray-100">
                    {monthlyReport.students.map((s, idx) => (
                      <div key={idx} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-1.5 gap-2">
                          <button
                            onClick={() => {
                              setSelectedStudentId(String(s.student_id || s.id));
                              setActiveTab('student');
                            }}
                            className="font-medium text-indigo-600 hover:underline text-left min-w-0 truncate"
                            title="View this student's full report"
                          >
                            {s.student_name || s.name}
                          </button>
                          <span className="font-semibold text-gray-900 shrink-0">{'\u20B9'}{Number(s.total_fees || 0).toLocaleString('en-IN')}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          <span>{s.total_classes || 0} classes</span>
                          <div className="flex items-center gap-1.5 flex-1">
                            <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${(s.attendance_rate || 0) >= 80 ? 'bg-green-500' : (s.attendance_rate || 0) >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                                style={{ width: `${Math.min(s.attendance_rate || 0, 100)}%` }}
                              />
                            </div>
                            <span>{Math.round(s.attendance_rate || 0)}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
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
        onSave={saveEdit}
        saving={savingEdit}
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
                {['present', 'absent'].map((s) => (
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

      {/* Lesson Activity Tab — cross-student progress overview */}
      {activeTab === 'lessons' && (
        <div className="space-y-4">
          {loadingLessons ? (
            <Loader text="Loading lesson activity..." />
          ) : (() => {
            // Build filter options
            const studentOpts = Array.from(new Map(
              lessonActivity.map((r) => [String(r.student_id), r.student_name])
            ).entries());
            const courseOpts = Array.from(new Map(
              lessonActivity.map((r) => [String(r.course_id), r.course_name])
            ).entries());

            const filtered = lessonActivity.filter((r) => {
              if (lessonStudentFilter !== 'all' && String(r.student_id) !== lessonStudentFilter) return false;
              if (lessonCourseFilter !== 'all' && String(r.course_id) !== lessonCourseFilter) return false;
              return true;
            });

            return (
              <>
                <div className="card">
                  <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                      <Youtube className="w-5 h-5 text-red-500" />
                      Lesson Activity
                      <span className="text-sm text-gray-400 font-normal">
                        ({filtered.length} of {lessonActivity.length})
                      </span>
                    </h3>
                    <div className="flex items-center gap-2">
                      <Select
                        value={lessonStudentFilter}
                        onChange={setLessonStudentFilter}
                        options={[
                          { value: 'all', label: 'All students' },
                          ...studentOpts.map(([id, name]) => ({ value: id, label: name || '(unknown)' })),
                        ]}
                      />
                      <Select
                        value={lessonCourseFilter}
                        onChange={setLessonCourseFilter}
                        options={[
                          { value: 'all', label: 'All courses' },
                          ...courseOpts.map(([id, name]) => ({ value: id, label: name || '(unknown)' })),
                        ]}
                      />
                    </div>
                  </div>

                  {filtered.length === 0 ? (
                    <EmptyState
                      icon={Youtube}
                      title="No lesson activity yet"
                      message="Once parents start watching lessons, their progress will appear here."
                    />
                  ) : (
                    <>
                    <div className="overflow-x-auto hidden md:block">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="table-header">Student</th>
                            <th className="table-header">Course</th>
                            <th className="table-header text-center">Progress</th>
                            <th className="table-header text-center">Lessons</th>
                            <th className="table-header text-right">Watched</th>
                            <th className="table-header whitespace-nowrap">Last activity</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {filtered.map((r, idx) => {
                            const isComplete = r.percent_complete >= 90;
                            return (
                              <tr key={idx} className="hover:bg-gray-50">
                                <td className="table-cell font-medium text-gray-900">{r.student_name || '—'}</td>
                                <td className="table-cell text-gray-700">{r.course_name || '—'}</td>
                                <td className="table-cell">
                                  <div className="flex items-center justify-center gap-2">
                                    <div className="w-24 bg-gray-100 rounded-full h-2 overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${isComplete ? 'bg-green-500' : r.percent_complete >= 50 ? 'bg-indigo-500' : 'bg-amber-500'}`}
                                        style={{ width: `${r.percent_complete}%` }}
                                      />
                                    </div>
                                    <span className="text-xs text-gray-600 w-10 text-left">
                                      {r.percent_complete}%
                                    </span>
                                    {isComplete && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                                  </div>
                                </td>
                                <td className="table-cell text-center text-gray-700">
                                  {r.lessons_completed}/{r.lessons_total}
                                </td>
                                <td className="table-cell text-right text-gray-700 whitespace-nowrap">
                                  {r.total_watched_minutes > 0 ? `${r.total_watched_minutes} min` : '—'}
                                </td>
                                <td className="table-cell text-gray-500 whitespace-nowrap text-xs">
                                  {parseTs(r.last_activity_at)
                                    ? parseTs(r.last_activity_at).toLocaleString('en-IN', {
                                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                                      })
                                    : 'Never opened'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {/* Mobile: stacked cards instead of a side-scrolling table */}
                    <div className="md:hidden space-y-3">
                      {filtered.map((r, idx) => {
                        const isComplete = r.percent_complete >= 90;
                        return (
                          <div key={idx} className="rounded-lg border border-gray-200 p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-medium text-gray-900 truncate">{r.student_name || '—'}</p>
                                <p className="text-xs text-gray-500 truncate">{r.course_name || '—'}</p>
                              </div>
                              {isComplete && <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />}
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${isComplete ? 'bg-green-500' : r.percent_complete >= 50 ? 'bg-indigo-500' : 'bg-amber-500'}`}
                                  style={{ width: `${r.percent_complete}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-600 flex-shrink-0">{r.percent_complete}%</span>
                            </div>
                            <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                              <span>{r.lessons_completed}/{r.lessons_total} lessons</span>
                              <span>{r.total_watched_minutes > 0 ? `${r.total_watched_minutes} min` : '—'}</span>
                            </div>
                            <p className="mt-1 text-xs text-gray-400">
                              {parseTs(r.last_activity_at)
                                ? parseTs(r.last_activity_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                                : 'Never opened'}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                    </>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
