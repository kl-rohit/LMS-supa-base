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
  LineChart as LineChartIcon,
  Wallet,
  UserCheck,
  Clock,
  GraduationCap,
  Gauge,
  FileText,
  Download,
  Printer,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Select from '../components/Select';
import { Donut, BarChart, LineChart, GroupedBarChart, TrendArrow, MobileCardTable, CHART_COLORS } from '../components/Charts';
import { PageHeader, MetricCard } from '../components/ConsoleUI';
import { exportCsv, exportPdf, printSection } from '../utils/reportExport';
import { useModuleFlags } from '../hooks/useModuleFlags';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

// Basic reports — available on every plan (Core and Complete).
const BASIC_TABS = [
  { id: 'student', label: 'Student Report', icon: User,
    desc: 'One student in full: attendance history, fees charged, and lesson progress over time.' },
  { id: 'monthly', label: 'Monthly Report', icon: Calendar,
    desc: 'Every student’s classes, attendance rate, and fees for a chosen month, side by side.' },
  { id: 'overall', label: 'Overall Report', icon: TrendingUp,
    desc: 'Your academy at a glance: students, classes conducted, fees collected, and attendance.' },
  { id: 'lessons', label: 'Lesson Activity', icon: Youtube,
    desc: 'Who is watching and completing each course, with progress and last activity.' },
];

// Detailed reports — unlocked on the Complete plan.
const ADVANCED_TABS = [
  { id: 'revenue', label: 'Revenue Trend', icon: LineChartIcon,
    desc: 'Class fees and additional income month by month, with this month set against last.' },
  { id: 'defaulters', label: 'Fees Due', icon: Wallet,
    desc: 'Students with an amount outstanding for the month, ranked, with the total due.' },
  { id: 'retention', label: 'Retention', icon: UserCheck,
    desc: 'Active vs inactive students, and how many new students joined each month.' },
  { id: 'slots', label: 'Attendance by Slot', icon: Clock,
    desc: 'How attendance varies across the days of the week and across your classes.' },
  { id: 'courses', label: 'Course Completion', icon: GraduationCap,
    desc: 'How far students have progressed through each course, with completion rates.' },
  { id: 'capacity', label: 'Class Capacity', icon: Gauge,
    desc: 'How full each active batch runs against its roster, to spot room to grow.' },
];

// Current month as YYYY-MM (local time).
function thisMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// A short, friendly label for a YYYY-MM key.
function monthKeyLabel(ym) {
  if (!ym || !/^\d{4}-\d{2}/.test(ym)) return ym || '';
  const [y, m] = ym.split('-');
  return `${MONTHS_SHORT[parseInt(m, 10) - 1]} ${y}`;
}

// Last N month keys (YYYY-MM) ending this month, oldest first — for the picker.
function recentMonthKeys(n) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

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

  // ----- Detailed reports (Complete plan) -----
  const { plan, loaded: planLoaded } = useModuleFlags();
  const isComplete = plan === 'complete';
  const tabs = useMemo(() => (isComplete ? [...BASIC_TABS, ...ADVANCED_TABS] : BASIC_TABS), [isComplete]);
  // Sidebar report groups (Reports Center style). Detailed group only on Complete.
  const tabGroups = useMemo(() => ([
    { heading: 'Overview', tabs: BASIC_TABS },
    ...(isComplete ? [{ heading: 'Detailed reports', tabs: ADVANCED_TABS }] : []),
  ]), [isComplete]);
  const [reportSearch, setReportSearch] = useState('');
  const activeMeta = useMemo(() => tabs.find((t) => t.id === activeTab) || BASIC_TABS[0], [tabs, activeTab]);

  // One bag of state per detailed report: { data, loading }.
  const [adv, setAdv] = useState({}); // { [tabId]: { data, loading } }
  const [revenueMonths, setRevenueMonths] = useState(6);
  const [defaultersMonth, setDefaultersMonth] = useState(thisMonthKey());
  const [statement, setStatement] = useState(null); // drill-down: { id, name } -> modal
  const [statementMonth, setStatementMonth] = useState(thisMonthKey());

  const setAdvState = (id, patch) =>
    setAdv((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));

  // Generic detailed-report fetch. Stores under adv[id].
  const fetchAdvanced = async (id, url) => {
    try {
      setAdvState(id, { loading: true });
      const data = await api.get(url);
      setAdvState(id, { data, loading: false });
    } catch (err) {
      toast.error('Could not load report: ' + err.message);
      setAdvState(id, { data: null, loading: false });
    }
  };

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

  // Load the detailed report when its tab opens or its filter changes.
  useEffect(() => {
    if (!isComplete) return;
    if (activeTab === 'revenue') fetchAdvanced('revenue', `/reports/revenue?months=${revenueMonths}`);
  }, [activeTab, revenueMonths, isComplete]);

  useEffect(() => {
    if (!isComplete) return;
    if (activeTab === 'defaulters') fetchAdvanced('defaulters', `/reports/defaulters?month=${defaultersMonth}`);
  }, [activeTab, defaultersMonth, isComplete]);

  useEffect(() => {
    if (!isComplete) return;
    if (activeTab === 'retention') fetchAdvanced('retention', '/reports/retention');
    if (activeTab === 'slots') fetchAdvanced('slots', '/reports/attendance-slots');
    if (activeTab === 'courses') fetchAdvanced('courses', '/reports/course-completion');
    if (activeTab === 'capacity') fetchAdvanced('capacity', '/reports/capacity');
  }, [activeTab, isComplete]);

  // Drill-down: open a single student's combined statement in a modal.
  const openStatement = async (id, name) => {
    setStatement({ id, name, loading: true });
    try {
      const data = await api.get(`/reports/student-statement/${id}?month=${statementMonth}`);
      setStatement({ id, name, data });
    } catch (err) {
      toast.error('Could not load statement: ' + err.message);
      setStatement(null);
    }
  };

  // Refresh an open statement when the chosen month changes.
  useEffect(() => {
    if (statement?.id) openStatement(statement.id, statement.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statementMonth]);

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

  // Consolidated PDF: one document that bundles every headline block on the
  // Overall tab into labelled sections (summary, attendance, fees, classes,
  // monthly trend). Reuses exportPdf's multi-section table renderer.
  const downloadOverallPdf = () => {
    if (!overallReport) return;
    const r = overallReport;
    const kv = (rows) => ({ columns: [{ key: 'k', label: 'Metric' }, { key: 'v', label: 'Value' }], rows });
    const sections = [];
    sections.push({
      heading: 'Summary',
      ...kv([
        { k: 'Total students', v: r.students?.active || 0 },
        { k: 'Classes conducted', v: r.attendance?.total_records || 0 },
        { k: 'Total fees collected', v: rupee(r.fees?.grand_total) },
        { k: 'Average attendance', v: `${Math.round(r.attendance?.overall_rate || 0)}%` },
      ]),
    });
    sections.push({
      heading: 'Attendance',
      ...kv([
        { k: 'Present', v: r.attendance?.present || 0 },
        { k: 'Absent', v: r.attendance?.absent || 0 },
        { k: 'Late', v: r.attendance?.late || 0 },
        { k: 'Attendance rate', v: `${Math.round(r.attendance?.overall_rate || 0)}%` },
      ]),
    });
    sections.push({
      heading: 'Fees',
      ...kv([
        { k: 'Class fees', v: rupee(r.fees?.class_fees) },
        { k: 'Additional fees', v: rupee(r.fees?.additional) },
        { k: 'Grand total', v: rupee(r.fees?.grand_total) },
      ]),
    });
    if (r.classes) {
      sections.push({
        heading: 'Classes by type',
        ...kv([
          { k: 'Online', v: r.classes.online || 0 },
          { k: 'Offline', v: r.classes.offline || 0 },
          { k: 'Online group', v: r.classes.online_group || 0 },
          { k: 'Offline group', v: r.classes.offline_group || 0 },
        ]),
      });
    }
    if (Array.isArray(r.monthly_revenue) && r.monthly_revenue.length) {
      sections.push({
        heading: 'Monthly trend',
        columns: [
          { key: 'month', label: 'Month' },
          { key: 'classes', label: 'Classes' },
          { key: 'revenue', label: 'Revenue' },
        ],
        rows: r.monthly_revenue.map((m) => ({
          month: `${(MONTHS[(parseInt(m.month) || 1) - 1] || '').substring(0, 3)} ${m.year}`,
          classes: m.total_records || 0,
          revenue: rupee(m.revenue ?? m.grand_total ?? m.total),
        })),
      });
    }
    exportPdf('Overall report', sections);
    toast.success('Report downloaded');
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

  // Build a plain HTML table for the print window from the same columns/rows.
  const buildPrintHtml = (columns, rows) => {
    const head = columns.map((c) => `<th style="text-align:${c.align || 'left'}">${c.label}</th>`).join('');
    const body = rows
      .map((r) => `<tr>${columns.map((c) => `<td style="text-align:${c.align || 'left'}">${c.text ? c.text(r) : (r[c.key] ?? '')}</td>`).join('')}</tr>`)
      .join('');
    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  };

  // Shared CSV / PDF / Print bar for a detailed report. `columns` is
  // [{ key, label, align, text? }] where text(row) gives a formatted string.
  const ExportBar = ({ title, columns, rows }) => {
    const csvCols = columns.map((c) => ({ key: c.key, label: c.label }));
    const csvRows = rows.map((r) => {
      const o = {};
      columns.forEach((c) => { o[c.key] = c.text ? c.text(r) : (r[c.key] ?? ''); });
      return o;
    });
    const disabled = !rows.length;
    return (
      <div className="flex items-center gap-2">
        <button className="btn-secondary btn-sm" disabled={disabled} title="Download CSV"
          onClick={() => exportCsv(`${title}.csv`, csvCols, csvRows)}>
          <Download className="w-4 h-4" /> CSV
        </button>
        <button className="btn-secondary btn-sm" disabled={disabled} title="Download PDF"
          onClick={() => exportPdf(title, [{ heading: title, columns: csvCols, rows: csvRows }])}>
          <FileText className="w-4 h-4" /> PDF
        </button>
        <button className="btn-secondary btn-sm" disabled={disabled} title="Print"
          onClick={() => printSection(title, buildPrintHtml(columns, rows))}>
          <Printer className="w-4 h-4" /> Print
        </button>
      </div>
    );
  };

  // Section heading shared by detailed reports.
  // Section header for a detailed report. With a title it labels a sub-section
  // (justify-between); without one it is just a right-aligned controls bar (the
  // report name already shows in the panel banner above).
  const AdvHeader = ({ icon: Icon, title, children }) => (
    <div className={`flex items-center gap-3 mb-4 flex-wrap ${title ? 'justify-between' : 'justify-end'}`}>
      {title && (
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 text-indigo-600" />} {title}
        </h3>
      )}
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  );

  const rupee = (v) => '₹' + Number(v || 0).toLocaleString('en-IN');

  // Render a rate-like value as a whole percent. Accepts a 0..1 fraction or an
  // already-scaled 0..100 number.
  const asPctSafe = (v) => { const n = Number(v) || 0; return Math.round(n <= 1 ? n * 100 : n); };

  if (loading || !planLoaded) return <Loader text="Loading..." />;

  return (
    <div className="space-y-4">
      <PageHeader title="Reports" subtitle="Insights across attendance, fees, and learning" live={false} />


      {/* Reports Center: a categorized sidebar on desktop, a picker on mobile,
          and the selected report in the main panel. */}
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6" data-tour="reports-tabs">
        {/* Mobile: compact report picker (replaces the long wrapping tab strip) */}
        <div className="lg:hidden">
          <Select
            value={activeTab}
            onChange={setActiveTab}
            ariaLabel="Choose a report"
            options={tabs.map((t) => ({ value: t.id, label: t.label }))}
          />
        </div>

        {/* Desktop: grouped, searchable sidebar */}
        <aside className="hidden lg:block w-60 flex-shrink-0">
          <div className="card p-3 sticky top-4 space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={reportSearch}
                onChange={(e) => setReportSearch(e.target.value)}
                placeholder="Search reports"
                className="input-field text-sm pl-8"
              />
            </div>
            {tabGroups.map((group) => {
              const items = group.tabs.filter((t) =>
                t.label.toLowerCase().includes(reportSearch.trim().toLowerCase()));
              if (!items.length) return null;
              return (
                <div key={group.heading}>
                  <p className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{group.heading}</p>
                  <div className="space-y-0.5">
                    {items.map((tab) => {
                      const Icon = tab.icon;
                      const active = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`w-full flex items-center gap-2.5 pl-2.5 pr-2 py-2 rounded-lg text-sm text-left border-l-2 transition-colors ${
                            active
                              ? 'bg-gray-100 text-gray-900 font-semibold border-indigo-500'
                              : 'text-gray-600 hover:bg-gray-50 border-transparent'
                          }`}
                        >
                          <Icon className="w-4 h-4 flex-shrink-0" />
                          <span className="truncate">{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Report panel */}
        <main className="flex-1 min-w-0">
          <div className="space-y-4">
            {/* Report name + what it is about */}
            <div className="flex items-start gap-3">
              {activeMeta.icon && (
                <span className="hidden sm:flex w-10 h-10 rounded-xl bg-gray-100 items-center justify-center flex-shrink-0">
                  <activeMeta.icon className="w-5 h-5 text-indigo-600" />
                </span>
              )}
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-gray-900 leading-tight">{activeMeta.label}</h3>
                {activeMeta.desc && <p className="text-sm text-gray-500 mt-0.5">{activeMeta.desc}</p>}
              </div>
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
              <div className="flex justify-end gap-2">
                <button
                  onClick={downloadOverallPdf}
                  className="btn-secondary btn-sm"
                  title="Download the whole report as a PDF"
                >
                  <Download className="w-4 h-4" /> PDF
                </button>
                <button
                  onClick={() => copyToClipboard(formatOverallReportText())}
                  className={copied ? 'btn-success btn-sm' : 'btn-secondary btn-sm'}
                >
                  {copied ? <><CopyCheck className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Export</>}
                </button>
              </div>

              {/* Summary Cards \u2014 clean console tiles (match the Dashboard). */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <MetricCard label="Total Students" value={(overallReport.students?.active || 0).toLocaleString('en-IN')} accent="indigo" icon={Users} />
                <MetricCard label="Classes Conducted" value={(overallReport.attendance?.total_records || 0).toLocaleString('en-IN')} accent="blue" icon={ClipboardCheck} />
                <MetricCard label="Total Fees" value={`\u20B9${Number(overallReport.fees?.grand_total || 0).toLocaleString('en-IN')}`} accent="amber" icon={IndianRupee} />
                <MetricCard
                  label="Avg Attendance"
                  value={`${Math.round(overallReport.attendance?.overall_rate || 0)}%`}
                  accent="emerald"
                  icon={TrendingUp}
                  tone={(overallReport.attendance?.overall_rate || 0) >= 80 ? 'good' : (overallReport.attendance?.overall_rate || 0) >= 60 ? 'warn' : 'bad'}
                />
              </div>

              {/* Visual overview — colourful, theme-aware charts from the same data */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Attendance</h3>
                  <Donut
                    size={150}
                    centervalue={`${Math.round(overallReport.attendance?.overall_rate || 0)}%`}
                    centerlabel="present"
                    data={[
                      { label: 'Present', value: overallReport.attendance?.present || 0, color: CHART_COLORS.present },
                      { label: 'Absent', value: overallReport.attendance?.absent || 0, color: CHART_COLORS.absent },
                      { label: 'Late', value: overallReport.attendance?.late || 0, color: CHART_COLORS.late },
                    ]}
                  />
                </div>
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Students</h3>
                  <Donut
                    size={150}
                    centervalue={overallReport.students?.total || 0}
                    centerlabel="total"
                    data={[
                      { label: 'Active', value: overallReport.students?.active || 0, color: CHART_COLORS.active },
                      { label: 'Inactive', value: overallReport.students?.inactive || 0, color: CHART_COLORS.inactive },
                    ]}
                  />
                </div>
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Fees collected</h3>
                  <BarChart
                    fmt={(v) => '₹' + Number(v).toLocaleString('en-IN')}
                    data={[
                      { label: 'Class fees', value: overallReport.fees?.class_fees || 0, color: CHART_COLORS.fees },
                      { label: 'Additional', value: overallReport.fees?.additional || 0, color: CHART_COLORS.additional },
                    ]}
                  />
                </div>
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Classes by type</h3>
                  <BarChart
                    data={[
                      { label: 'Online', value: overallReport.classes?.online || 0, color: CHART_COLORS.series[0] },
                      { label: 'Offline', value: overallReport.classes?.offline || 0, color: CHART_COLORS.series[1] },
                      { label: 'Online group', value: overallReport.classes?.online_group || 0, color: CHART_COLORS.series[2] },
                      { label: 'Offline group', value: overallReport.classes?.offline_group || 0, color: CHART_COLORS.series[3] },
                    ]}
                  />
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

      {/* ===================== DETAILED REPORTS (Complete plan) ===================== */}
      {(() => {
        const data = (id) => adv[id]?.data;
        const busy = (id) => adv[id]?.loading;
        const asPct = (v) => { const n = Number(v) || 0; return Math.round(n <= 1 ? n * 100 : n); };
        const mShort = (ym) => MONTHS_SHORT[parseInt((ym || '').split('-')[1], 10) - 1] || ym;

        // ---------- Revenue Trend ----------
        if (activeTab === 'revenue') {
          const d = data('revenue');
          const months = d?.months || [];
          const last = months[months.length - 1];
          const prev = months[months.length - 2];
          return (
            <div className="card">
              <AdvHeader>
                <Select
                  value={revenueMonths}
                  onChange={(v) => setRevenueMonths(Number(v))}
                  ariaLabel="Number of months"
                  options={[{ value: 3, label: 'Last 3 months' }, { value: 6, label: 'Last 6 months' }, { value: 12, label: 'Last 12 months' }]}
                />
                <ExportBar
                  title="Revenue Trend"
                  columns={[
                    { key: 'label', label: 'Month' },
                    { key: 'class_fees', label: 'Class fees', align: 'right', text: (r) => rupee(r.class_fees) },
                    { key: 'additional', label: 'Additional', align: 'right', text: (r) => rupee(r.additional) },
                    { key: 'total', label: 'Total', align: 'right', text: (r) => rupee(r.total) },
                  ]}
                  rows={months}
                />
              </AdvHeader>
              {busy('revenue') ? <Loader text="Loading report..." /> : months.length === 0 ? (
                <EmptyState icon={LineChartIcon} title="No revenue yet" message="Revenue appears here as classes and fees are recorded." />
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                    <div className="rounded-xl bg-gray-50 p-4">
                      <p className="text-xs text-gray-500">This month</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{rupee(last?.total)}</p>
                      <div className="mt-1"><TrendArrow current={last?.total} previous={prev?.total} goodIsUp fmt={rupee} /></div>
                    </div>
                    <div className="rounded-xl bg-gray-50 p-4">
                      <p className="text-xs text-gray-500">Class fees ({months.length} mo)</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{rupee(d?.totals?.class_fees)}</p>
                    </div>
                    <div className="rounded-xl bg-gray-50 p-4">
                      <p className="text-xs text-gray-500">Additional ({months.length} mo)</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{rupee(d?.totals?.additional)}</p>
                    </div>
                  </div>
                  <LineChart
                    fmt={rupee}
                    series={[
                      { name: 'Total', color: CHART_COLORS.series[0], points: months.map((m) => ({ x: mShort(m.ym), y: m.total })) },
                      { name: 'Class fees', color: CHART_COLORS.fees, points: months.map((m) => ({ x: mShort(m.ym), y: m.class_fees })) },
                      { name: 'Additional', color: CHART_COLORS.additional, points: months.map((m) => ({ x: mShort(m.ym), y: m.additional })) },
                    ]}
                  />
                  <div className="mt-5">
                    <MobileCardTable
                      keyField="ym"
                      rows={[...months].reverse()}
                      columns={[
                        { key: 'label', label: 'Month' },
                        { key: 'class_fees', label: 'Class fees', align: 'right', render: (r) => rupee(r.class_fees) },
                        { key: 'additional', label: 'Additional', align: 'right', render: (r) => rupee(r.additional) },
                        { key: 'total', label: 'Total', align: 'right', render: (r) => <span className="font-semibold">{rupee(r.total)}</span> },
                      ]}
                    />
                  </div>
                </>
              )}
            </div>
          );
        }

        // ---------- Fees Due (defaulters) ----------
        if (activeTab === 'defaulters') {
          const d = data('defaulters');
          const rows = d?.defaulters || [];
          return (
            <div className="card">
              <AdvHeader>
                <Select
                  value={defaultersMonth}
                  onChange={setDefaultersMonth}
                  ariaLabel="Month"
                  options={recentMonthKeys(12).map((ym) => ({ value: ym, label: monthKeyLabel(ym) }))}
                />
                <ExportBar
                  title="Fees Due"
                  columns={[
                    { key: 'name', label: 'Student' },
                    { key: 'due', label: 'Amount due', align: 'right', text: (r) => rupee(r.due) },
                  ]}
                  rows={rows}
                />
              </AdvHeader>
              {busy('defaulters') ? <Loader text="Loading report..." /> : rows.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="All settled" message={`No dues recorded for ${monthKeyLabel(defaultersMonth)}.`} />
              ) : (
                <>
                  <div className="rounded-xl bg-gray-50 p-4 mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-500">Total due · {monthKeyLabel(defaultersMonth)}</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{rupee(d?.total_due)}</p>
                    </div>
                    <p className="text-sm text-gray-500">{d?.count || rows.length} student{(d?.count || rows.length) === 1 ? '' : 's'}</p>
                  </div>
                  <p className="text-xs text-gray-400 mb-3">Tap a student to open their statement.</p>
                  <MobileCardTable
                    keyField="student_id"
                    rows={rows}
                    onRowClick={(r) => openStatement(r.student_id, r.name)}
                    columns={[
                      { key: 'name', label: 'Student' },
                      { key: 'due', label: 'Amount due', align: 'right', render: (r) => <span className="font-semibold text-gray-900">{rupee(r.due)}</span> },
                    ]}
                  />
                </>
              )}
            </div>
          );
        }

        // ---------- Retention ----------
        if (activeTab === 'retention') {
          const d = data('retention');
          const joins = d?.joins_by_month || [];
          return (
            <div className="space-y-4">
              <div className="card">
                {busy('retention') ? <Loader text="Loading report..." /> : !d ? (
                  <EmptyState icon={UserCheck} title="No data" message="Retention appears once students are enrolled." />
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-center">
                    <Donut
                      size={150}
                      centervalue={d.total || 0}
                      centerlabel="students"
                      data={[
                        { label: 'Active', value: d.active || 0, color: CHART_COLORS.active },
                        { label: 'Inactive', value: d.inactive || 0, color: CHART_COLORS.inactive },
                      ]}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-xl bg-gray-50 p-4">
                        <p className="text-xs text-gray-500">Active</p>
                        <p className="text-2xl font-bold text-gray-900 mt-1">{d.active || 0}</p>
                      </div>
                      <div className="rounded-xl bg-gray-50 p-4">
                        <p className="text-xs text-gray-500">Inactive</p>
                        <p className="text-2xl font-bold text-gray-900 mt-1">{d.inactive || 0}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {!busy('retention') && joins.length > 0 && (
                <div className="card">
                  <AdvHeader icon={TrendingUp} title="New students by month">
                    <ExportBar
                      title="New students by month"
                      columns={[{ key: 'label', label: 'Month' }, { key: 'count', label: 'New students', align: 'right' }]}
                      rows={joins}
                    />
                  </AdvHeader>
                  <LineChart
                    series={[{ name: 'New students', color: CHART_COLORS.series[1], points: joins.map((j) => ({ x: mShort(j.ym), y: j.count })) }]}
                  />
                </div>
              )}
            </div>
          );
        }

        // ---------- Attendance by Slot ----------
        if (activeTab === 'slots') {
          const d = data('slots');
          const byDay = d?.by_day || [];
          const byClass = d?.by_class || [];
          return (
            <div className="space-y-4">
              <div className="card">
                <AdvHeader icon={Clock} title="Attendance by Day" />
                {busy('slots') ? <Loader text="Loading report..." /> : byDay.length === 0 ? (
                  <EmptyState icon={Clock} title="No attendance yet" message="Attendance patterns appear once classes are recorded." />
                ) : (
                  <GroupedBarChart
                    groups={byDay.map((r) => r.day)}
                    series={[
                      { name: 'Present', color: CHART_COLORS.present, values: byDay.map((r) => r.present || 0) },
                      { name: 'Absent', color: CHART_COLORS.absent, values: byDay.map((r) => r.absent || 0) },
                      { name: 'Late', color: CHART_COLORS.late, values: byDay.map((r) => r.late || 0) },
                    ]}
                  />
                )}
              </div>
              {!busy('slots') && byClass.length > 0 && (
                <div className="card">
                  <AdvHeader icon={ClipboardCheck} title="By class">
                    <ExportBar
                      title="Attendance by class"
                      columns={[
                        { key: 'name', label: 'Class' },
                        { key: 'present', label: 'Present', align: 'right' },
                        { key: 'absent', label: 'Absent', align: 'right' },
                        { key: 'late', label: 'Late', align: 'right' },
                        { key: 'rate', label: 'Rate', align: 'right', text: (r) => `${asPct(r.rate)}%` },
                      ]}
                      rows={byClass}
                    />
                  </AdvHeader>
                  <MobileCardTable
                    keyField="class_id"
                    rows={byClass}
                    columns={[
                      { key: 'name', label: 'Class' },
                      { key: 'present', label: 'Present', align: 'right' },
                      { key: 'absent', label: 'Absent', align: 'right' },
                      { key: 'late', label: 'Late', align: 'right' },
                      { key: 'rate', label: 'Rate', align: 'right', render: (r) => <span className="font-semibold">{asPct(r.rate)}%</span> },
                    ]}
                  />
                </div>
              )}
            </div>
          );
        }

        // ---------- Course Completion ----------
        if (activeTab === 'courses') {
          const d = data('courses');
          const courses = d?.courses || [];
          return (
            <div className="card">
              <AdvHeader>
                <ExportBar
                  title="Course Completion"
                  columns={[
                    { key: 'name', label: 'Course' },
                    { key: 'lessons_total', label: 'Lessons', align: 'right' },
                    { key: 'enrolled', label: 'Enrolled', align: 'right' },
                    { key: 'completion_rate', label: 'Completion', align: 'right', text: (r) => `${asPct(r.completion_rate)}%` },
                  ]}
                  rows={courses}
                />
              </AdvHeader>
              {busy('courses') ? <Loader text="Loading report..." /> : courses.length === 0 ? (
                <EmptyState icon={GraduationCap} title="No courses yet" message="Completion rates appear once courses have enrolled students." />
              ) : (
                <>
                  <BarChart
                    fmt={(v) => `${asPct(v)}%`}
                    data={courses.map((c, i) => ({ label: c.name, value: asPct(c.completion_rate), color: CHART_COLORS.series[i % CHART_COLORS.series.length] }))}
                  />
                  <div className="mt-5">
                    <MobileCardTable
                      keyField="course_id"
                      rows={courses}
                      columns={[
                        { key: 'name', label: 'Course' },
                        { key: 'lessons_total', label: 'Lessons', align: 'right' },
                        { key: 'enrolled', label: 'Enrolled', align: 'right' },
                        { key: 'completion_rate', label: 'Completion', align: 'right', render: (r) => <span className="font-semibold">{asPct(r.completion_rate)}%</span> },
                      ]}
                    />
                  </div>
                </>
              )}
            </div>
          );
        }

        // ---------- Class Capacity ----------
        if (activeTab === 'capacity') {
          const d = data('capacity');
          const classes = d?.classes || [];
          return (
            <div className="card">
              <AdvHeader>
                <ExportBar
                  title="Class Capacity"
                  columns={[
                    { key: 'name', label: 'Class' },
                    { key: 'day', label: 'Day' },
                    { key: 'roster', label: 'Roster', align: 'right' },
                    { key: 'attended_avg', label: 'Avg present', align: 'right', text: (r) => Math.round(Number(r.attended_avg) || 0) },
                    { key: 'utilisation', label: 'Utilisation', align: 'right', text: (r) => `${asPct(r.utilisation)}%` },
                  ]}
                  rows={classes}
                />
              </AdvHeader>
              {busy('capacity') ? <Loader text="Loading report..." /> : classes.length === 0 ? (
                <EmptyState icon={Gauge} title="No active classes" message="Capacity appears once you have active classes with a roster." />
              ) : (
                <>
                  <BarChart
                    fmt={(v) => `${asPct(v)}%`}
                    data={classes.map((c, i) => ({ label: c.name, value: asPct(c.utilisation), color: CHART_COLORS.series[i % CHART_COLORS.series.length] }))}
                  />
                  <div className="mt-5">
                    <MobileCardTable
                      keyField="class_id"
                      rows={classes}
                      columns={[
                        { key: 'name', label: 'Class' },
                        { key: 'day', label: 'Day' },
                        { key: 'roster', label: 'Roster', align: 'right' },
                        { key: 'utilisation', label: 'Utilisation', align: 'right', render: (r) => <span className="font-semibold">{asPct(r.utilisation)}%</span> },
                      ]}
                    />
                  </div>
                </>
              )}
            </div>
          );
        }

        return null;
      })()}

      {/* Drill-down: single-student combined statement */}
      <Modal
        isOpen={!!statement}
        onClose={() => setStatement(null)}
        title={statement ? `Statement · ${statement.name}` : 'Statement'}
        size="md"
      >
        {statement && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Select
                value={statementMonth}
                onChange={setStatementMonth}
                ariaLabel="Statement month"
                options={recentMonthKeys(12).map((ym) => ({ value: ym, label: monthKeyLabel(ym) }))}
              />
            </div>
            {statement.loading || !statement.data ? (
              <Loader text="Loading statement..." />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">Attendance</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">{asPctSafe(statement.data.attendance?.rate)}%</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {statement.data.attendance?.present || 0} present · {statement.data.attendance?.absent || 0} absent · {statement.data.attendance?.late || 0} late
                    </p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">Fees</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">{rupee(statement.data.fees?.total)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {rupee(statement.data.fees?.class_fees)} class · {rupee(statement.data.fees?.additional)} additional
                    </p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-3 col-span-2">
                    <p className="text-xs text-gray-500">Lessons</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {statement.data.lessons?.completed || 0} / {statement.data.lessons?.enrolled || 0}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">completed of enrolled</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      const s = statement.data;
                      exportPdf(`Statement ${statement.name} ${monthKeyLabel(statementMonth)}`, [{
                        heading: `${statement.name} · ${monthKeyLabel(statementMonth)}`,
                        columns: [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }],
                        rows: [
                          { metric: 'Attendance rate', value: `${asPctSafe(s.attendance?.rate)}%` },
                          { metric: 'Present / Absent / Late', value: `${s.attendance?.present || 0} / ${s.attendance?.absent || 0} / ${s.attendance?.late || 0}` },
                          { metric: 'Class fees', value: rupee(s.fees?.class_fees) },
                          { metric: 'Additional fees', value: rupee(s.fees?.additional) },
                          { metric: 'Total fees', value: rupee(s.fees?.total) },
                          { metric: 'Lessons completed', value: `${s.lessons?.completed || 0} / ${s.lessons?.enrolled || 0}` },
                        ],
                      }]);
                    }}
                  >
                    <FileText className="w-4 h-4" /> PDF
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
          </div>
        </main>
      </div>
    </div>
  );
}
