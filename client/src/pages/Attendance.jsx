import { useState, useEffect, useMemo } from 'react';
import {
  CalendarDays,
  Clock,
  Check,
  X,
  AlertTriangle,
  Save,
  ChevronLeft,
  ChevronRight,
  Monitor,
  MapPin,
  UsersRound,
  IndianRupee,
  ClipboardCheck,
  Trash2,
  Plus,
  Youtube,
  Share2,
  Edit2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';

export default function Attendance() {
  const [selectedDate, setSelectedDate] = useState(formatDateLocal(new Date()));
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedClass, setSelectedClass] = useState(null);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [absenceAlerts, setAbsenceAlerts] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [existingAttendance, setExistingAttendance] = useState([]);
  // Ad-hoc attendance state
  const [adhocOpen, setAdhocOpen] = useState(false);
  const [adhocClassType, setAdhocClassType] = useState('offline');
  const [adhocStartTime, setAdhocStartTime] = useState('09:00');
  const [adhocEndTime, setAdhocEndTime] = useState('10:00');
  const [adhocStudentIds, setAdhocStudentIds] = useState([]);
  const [adhocStudentSearch, setAdhocStudentSearch] = useState('');
  const [adhocName, setAdhocName] = useState('');
  const [adhocTopic, setAdhocTopic] = useState('');
  // Filter the ad-hoc student list by group. '' means show all students.
  const [adhocGroupFilter, setAdhocGroupFilter] = useState('');
  // Class-mode toggle: 'today' uses date-filtered classes, 'any' lets you pick from all classes
  const [classMode, setClassMode] = useState('today');
  const [allClasses, setAllClasses] = useState([]);
  // Inline edit modal for marked attendance rows
  const [editingRecord, setEditingRecord] = useState(null);
  const [editForm, setEditForm] = useState({ status: 'present', topic: '', notes: '', recording_url: '', fee_charged: 0 });
  const [savingEdit, setSavingEdit] = useState(false);
  // Marked attendance for the selected date (across all classes)
  const [dateAttendance, setDateAttendance] = useState([]);

  function formatDateLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (selectedDate) {
      fetchClassesForDate();
      fetchAbsenceAlerts();
      fetchDateAttendance();
    }
  }, [selectedDate]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [studentsData, groupsData] = await Promise.all([
        api.get('/students'),
        api.get('/groups'),
      ]);
      setStudents((studentsData.students || []).filter((s) => s.status === 'active'));
      setGroups(groupsData.groups || []);
    } catch (err) {
      toast.error('Failed to load data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchClassesForDate = async () => {
    try {
      const date = new Date(selectedDate + 'T00:00:00');
      const dayOfWeek = date.getDay();
      // Fetch regular classes AND camp days for the selected date in parallel.
      // Camp days are tagged with `_isCamp` so the UI can render them with
      // a distinct visual marker (orange tent badge).
      const [allClassesResp, campDaysResp] = await Promise.all([
        api.get('/classes'),
        api.get(`/camps/days/by-date/${selectedDate}`).catch(() => ({ days: [] })),
      ]);
      const all = (allClassesResp.classes || []).filter((c) => c.is_active !== 0);
      setAllClasses(all);
      const dayClasses = all.filter((c) => c.day_of_week === dayOfWeek);
      const campDays = (campDaysResp.days || []).map((d) => ({
        ...d,
        _isCamp: true,
        // Camp day cards reuse the same shape as classes so the existing
        // grid + click handler work without branching.
        id: `camp-day-${d.id || d.ROWID}`,
        camp_day_id: d.id || d.ROWID,
        name: d.camp_name || 'Camp',
        student_name: d.camp_name || null,
        group_name: d.camp_name || null,
      }));
      setClasses([...dayClasses, ...campDays]);
      setSelectedClass(null);
      setAttendanceRecords([]);
    } catch (err) {
      toast.error('Failed to load classes: ' + err.message);
    }
  };

  const fetchAbsenceAlerts = async () => {
    try {
      const data = await api.get('/attendance/absent-streaks/all');
      setAbsenceAlerts(data?.alerts || []);
    } catch {
      setAbsenceAlerts([]);
    }
  };

  const fetchDateAttendance = async () => {
    try {
      const data = await api.get(`/attendance/by-date/${selectedDate}`);
      setDateAttendance(data?.attendance || []);
    } catch {
      setDateAttendance([]);
    }
  };

  const handleClassSelect = async (cls) => {
    setSelectedClass(cls);
    try {
      // Camp day branch: fetch any existing attendance via camp_id and use
      // the camp's group members as the student list.
      const isCamp = !!cls._isCamp;
      let existing = [];
      let classStudents = [];

      if (isCamp) {
        // Camp's members were attached to the day payload by the backend.
        classStudents = (cls.members || []).map((m) => {
          const full = students.find((s) => s.id === (m.id || m.student_id));
          return full || m;
        });
        // Fetch existing camp attendance for this day (by date — camp_id filter
        // would also work; date is simpler).
        try {
          const existingResp = await api.get(`/attendance/by-date/${selectedDate}`);
          existing = (existingResp?.attendance || []).filter((a) => String(a.camp_id) === String(cls.camp_id));
        } catch {}
      } else {
        // Load existing attendance for this regular class + date
        const existingResp = await api.get(`/attendance?class_id=${cls.id}&date=${selectedDate}`);
        existing = existingResp?.attendance || [];

        // Determine students for this class
        if (cls.group_id) {
          try {
            const membersResp = await api.get(`/groups/${cls.group_id}/students`);
            classStudents = (membersResp.students || []).map((m) => {
              const full = students.find((s) => s.id === (m.student_id || m.id));
              return full || m;
            });
          } catch {
            classStudents = [];
          }
        } else if (Array.isArray(cls.student_ids) && cls.student_ids.length > 0) {
          classStudents = cls.student_ids
            .map((id) => students.find((s) => s.id === id))
            .filter(Boolean);
        } else if (cls.student_id) {
          const student = students.find((s) => s.id === cls.student_id);
          if (student) classStudents = [student];
        }
      }
      setExistingAttendance(existing);

      // Build attendance records
      const records = classStudents.map((student) => {
        const existingRecord = (existing || []).find(
          (e) => e.student_id === (student.student_id || student.id)
        );
        const studentId = student.student_id || student.id;
        const fee = calculateFee(student, cls);
        const alertInfo = absenceAlerts.find(
          (a) => (a.student_id || a.id) === studentId
        );

        return {
          student_id: studentId,
          student_name: student.name || student.student_name,
          status: existingRecord ? existingRecord.status : 'present',
          topic: existingRecord ? existingRecord.topic || '' : '',
          fee_charged: existingRecord ? existingRecord.fee_charged : fee,
          calculated_fee: fee,
          absent_streak: alertInfo?.consecutive_absences || alertInfo?.absent_count || 0,
          existing_id: existingRecord?.id || null,
          recording_url: existingRecord?.recording_url || '',
        };
      });

      setAttendanceRecords(records);
    } catch (err) {
      toast.error('Failed to load attendance: ' + err.message);
    }
  };

  const calculateFee = (student, cls) => {
    if (!student || !cls) return 0;
    const feeMap = {
      online: student.fee_online || 0,
      offline: student.fee_offline || 0,
      offline_group: student.fee_offline_group || 0,
      online_group: student.fee_offline_group || 0,
    };
    let baseFee = feeMap[cls.class_type] || 0;
    const duration = cls.duration_hours || 1;
    return baseFee * duration;
  };

  const calculateAdhocFee = (student) => {
    return calculateFee(student, {
      class_type: adhocClassType,
      duration_hours: parseDuration(adhocStartTime, adhocEndTime),
    });
  };

  function parseDuration(start, end) {
    if (!start || !end) return 1;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const diff = (eh * 60 + em) - (sh * 60 + sm);
    return diff > 0 ? diff / 60 : 1;
  }

  const toggleAdhocStudent = (id) => {
    setAdhocStudentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Resolve students for the ad-hoc group filter.
  // - Reads `members` from each group (populated by GET /api/groups).
  // - If no group filter is set, returns all active students.
  const adhocVisibleStudents = useMemo(() => {
    let list = students;
    if (adhocGroupFilter) {
      const g = groups.find((gr) => String(gr.id) === String(adhocGroupFilter));
      const memberIds = new Set(((g && g.members) || []).map((m) => String(m.id || m.student_id)));
      list = students.filter((s) => memberIds.has(String(s.id)));
    }
    if (adhocStudentSearch.trim()) {
      const q = adhocStudentSearch.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q));
    }
    return list;
  }, [students, groups, adhocGroupFilter, adhocStudentSearch]);

  // When the user picks a group, auto-select all its members (so they don't have to click each).
  const handleAdhocGroupChange = (groupId) => {
    setAdhocGroupFilter(groupId);
    if (!groupId) return;
    const g = groups.find((gr) => String(gr.id) === String(groupId));
    if (g && Array.isArray(g.members)) {
      setAdhocStudentIds(g.members.map((m) => m.id || m.student_id).filter(Boolean));
    }
  };

  const handleAdhocSubmit = async () => {
    if (adhocStudentIds.length === 0) {
      toast.error('Please select at least one student');
      return;
    }
    try {
      setSubmitting(true);
      const records = adhocStudentIds.map((sid) => {
        const s = students.find((st) => st.id === sid);
        return {
          student_id: sid,
          status: 'present',
          fee_charged: s ? calculateAdhocFee(s) : 0,
          topic: adhocTopic.trim(),
        };
      });
      const payload = {
        date: selectedDate,
        class_type: adhocClassType,
        start_time: adhocStartTime,
        end_time: adhocEndTime,
        duration_hours: parseDuration(adhocStartTime, adhocEndTime),
        name: adhocName.trim() || undefined,
        records,
      };
      await api.post('/attendance/adhoc', payload);
      toast.success(`Marked attendance for ${records.length} student(s)`);
      setAdhocOpen(false);
      setAdhocStudentIds([]);
      setAdhocStudentSearch('');
      setAdhocName('');
      setAdhocTopic('');
      fetchClassesForDate();
      fetchAbsenceAlerts();
      fetchDateAttendance();
    } catch (err) {
      toast.error('Failed: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const updateRecord = (index, field, value) => {
    setAttendanceRecords((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      // If marking absent, set fee to 0
      if (field === 'status') {
        if (value === 'absent') {
          updated[index].fee_charged = 0;
        } else {
          updated[index].fee_charged = updated[index].calculated_fee;
        }
      }
      return updated;
    });
  };

  const handleSubmit = async () => {
    if (!selectedClass || attendanceRecords.length === 0) return;
    try {
      setSubmitting(true);
      const records = attendanceRecords.map((r) => ({
        student_id: r.student_id,
        status: r.status,
        topic: r.topic,
        recording_url: r.recording_url || '',
        fee_charged: r.status === 'present' ? r.fee_charged : 0,
      }));
      if (selectedClass._isCamp) {
        // Camp day → camp-specific endpoint (de-dupes by camp_id + date)
        await api.post(`/camps/days/${selectedClass.camp_day_id}/attendance`, { records });
      } else {
        await api.post('/attendance/bulk', {
          class_id: selectedClass.id,
          date: selectedDate,
          records,
        });
      }
      toast.success('Attendance saved successfully!');
      fetchAbsenceAlerts();
      fetchDateAttendance();
    } catch (err) {
      toast.error('Failed to save attendance: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const deleteAttendanceRecord = async (recordIndex) => {
    const record = attendanceRecords[recordIndex];
    if (!record?.existing_id) return;
    if (!window.confirm(`Delete attendance record for ${record.student_name}?`)) return;
    try {
      await api.delete(`/attendance/${record.existing_id}`);
      // Update the record to remove existing_id (mark as new/unsaved)
      setAttendanceRecords((prev) => {
        const updated = [...prev];
        updated[recordIndex] = {
          ...updated[recordIndex],
          existing_id: null,
          status: 'present',
          topic: '',
          fee_charged: updated[recordIndex].calculated_fee,
        };
        return updated;
      });
      // Also update existingAttendance list
      setExistingAttendance((prev) => prev.filter((e) => e.id !== record.existing_id));
      toast.success(`Attendance deleted for ${record.student_name}`);
      fetchAbsenceAlerts();
      fetchDateAttendance();
    } catch (err) {
      toast.error('Failed to delete: ' + err.message);
    }
  };

  const deleteDateGroup = async (group) => {
    if (!group?.records?.length) return;
    if (!window.confirm(`Delete all ${group.records.length} attendance record(s) for "${group.class_name}"?`)) return;
    try {
      await Promise.all(group.records.map((r) => api.delete(`/attendance/${r.id}`)));
      toast.success(`Deleted ${group.records.length} record(s)`);
      fetchDateAttendance();
      fetchAbsenceAlerts();
      if (selectedClass && group.class_id === selectedClass.id) {
        handleClassSelect(selectedClass);
      }
    } catch (err) {
      toast.error('Failed to delete some records: ' + err.message);
    }
  };

  const deleteDateRecord = async (rec) => {
    if (!rec?.id) return;
    if (!window.confirm(`Delete ${rec.student_name}'s attendance for ${rec.class_name}?`)) return;
    try {
      await api.delete(`/attendance/${rec.id}`);
      toast.success('Attendance record deleted');
      fetchDateAttendance();
      fetchAbsenceAlerts();
      // If this record is currently shown in the per-class form, refresh it too
      if (selectedClass && rec.class_id === selectedClass.id) {
        handleClassSelect(selectedClass);
      }
    } catch (err) {
      toast.error('Failed to delete: ' + err.message);
    }
  };

  // Inline edit for a marked attendance row.
  const openEditRecord = (rec) => {
    setEditingRecord(rec);
    setEditForm({
      status: rec.status || 'present',
      topic: rec.topic || '',
      notes: rec.notes || '',
      recording_url: rec.recording_url || '',
      fee_charged: rec.fee_charged || 0,
    });
  };

  const closeEditRecord = () => {
    setEditingRecord(null);
    setSavingEdit(false);
  };

  const saveEditRecord = async () => {
    if (!editingRecord) return;
    try {
      setSavingEdit(true);
      const payload = {
        status: editForm.status,
        topic: editForm.topic,
        notes: editForm.notes,
        recording_url: editForm.recording_url,
        fee_charged: editForm.status === 'absent' ? 0 : Number(editForm.fee_charged) || 0,
      };
      await api.put(`/attendance/${editingRecord.id}`, payload);
      toast.success('Attendance updated');
      closeEditRecord();
      fetchDateAttendance();
      fetchAbsenceAlerts();
      if (selectedClass && editingRecord.class_id === selectedClass.id) {
        handleClassSelect(selectedClass);
      }
    } catch (err) {
      toast.error('Failed to update: ' + err.message);
      setSavingEdit(false);
    }
  };

  const deleteAllAttendance = async () => {
    const savedRecords = attendanceRecords.filter((r) => r.existing_id);
    if (savedRecords.length === 0) {
      toast.error('No saved attendance records to delete');
      return;
    }
    if (!window.confirm(`Delete all ${savedRecords.length} attendance record(s) for this class on ${selectedDate}?`)) return;
    try {
      await Promise.all(savedRecords.map((r) => api.delete(`/attendance/${r.existing_id}`)));
      // Reset all records to unsaved state
      setAttendanceRecords((prev) =>
        prev.map((r) => ({
          ...r,
          existing_id: null,
          status: 'present',
          topic: '',
          fee_charged: r.calculated_fee,
        }))
      );
      setExistingAttendance([]);
      toast.success(`Deleted ${savedRecords.length} attendance record(s)`);
      fetchAbsenceAlerts();
      fetchDateAttendance();
    } catch (err) {
      toast.error('Failed to delete some records: ' + err.message);
    }
  };

  const changeDate = (delta) => {
    const date = new Date(selectedDate + 'T00:00:00');
    date.setDate(date.getDate() + delta);
    setSelectedDate(formatDateLocal(date));
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':');
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${m} ${ampm}`;
  };

  const calcDuration = (start, end) => {
    if (!start || !end) return '';
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff <= 0) return '';
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  };

  const runningTotal = useMemo(() => {
    return attendanceRecords.reduce((sum, r) => {
      return sum + (r.status === 'present' ? Number(r.fee_charged) || 0 : 0);
    }, 0);
  }, [attendanceRecords]);

  const presentCount = attendanceRecords.filter((r) => r.status === 'present').length;
  const absentCount = attendanceRecords.filter((r) => r.status === 'absent').length;

  // Group attendance records for the selected date by class
  const dateAttendanceGroups = useMemo(() => {
    const map = new Map();
    for (const rec of dateAttendance) {
      const key = rec.class_id;
      if (!map.has(key)) {
        map.set(key, {
          class_id: rec.class_id,
          class_name: rec.class_name || 'Unknown class',
          class_type: rec.class_class_type || rec.class_type,
          records: [],
        });
      }
      map.get(key).records.push(rec);
    }
    return Array.from(map.values());
  }, [dateAttendance]);

  const dateTotalFee = useMemo(
    () => dateAttendance.reduce((s, r) => s + (Number(r.fee_charged) || 0), 0),
    [dateAttendance]
  );

  const classTypeIcons = {
    online: Monitor,
    offline: MapPin,
    offline_group: UsersRound,
    online_group: UsersRound,
  };

  const classTypeColors = {
    online: 'border-blue-500 bg-blue-50 hover:bg-blue-100',
    offline: 'border-emerald-500 bg-emerald-50 hover:bg-emerald-100',
    offline_group: 'border-purple-500 bg-purple-50 hover:bg-purple-100',
    online_group: 'border-cyan-500 bg-cyan-50 hover:bg-cyan-100',
  };

  const selectedClassTypeColor = {
    online: 'ring-blue-400 border-blue-400',
    offline: 'ring-emerald-400 border-emerald-400',
    offline_group: 'ring-purple-400 border-purple-400',
    online_group: 'ring-cyan-400 border-cyan-400',
  };

  const dayName = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  if (loading) return <Loader text="Loading..." />;

  return (
    <div className="space-y-4">
      {/* Absence Alerts Banner */}
      {absenceAlerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <h3 className="font-semibold text-red-800">Absence Alerts</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {absenceAlerts.map((alert, idx) => (
              <span key={idx} className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm">
                {alert.student_name || alert.name}
                <span className="font-bold">({alert.consecutive_absences || alert.absent_count})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Date Picker */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CalendarDays className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Mark Attendance</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => changeDate(-1)} className="p-2 rounded-lg hover:bg-gray-100">
              <ChevronLeft className="w-4 h-4 text-gray-600" />
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="input-field w-auto"
            />
            <button onClick={() => changeDate(1)} className="p-2 rounded-lg hover:bg-gray-100">
              <ChevronRight className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-1 ml-8">{dayName}</p>
      </div>

      {/* Classes for the day */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
              {classMode === 'today'
                ? `Classes on this day (${classes.length})`
                : `All classes (${allClasses.length})`}
            </h3>
            <div className="flex items-center bg-white rounded-lg border border-gray-200 p-0.5">
              <button
                onClick={() => setClassMode('today')}
                className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                  classMode === 'today' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Today
              </button>
              <button
                onClick={() => setClassMode('any')}
                className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                  classMode === 'any' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Any class
              </button>
            </div>
          </div>
          <button
            onClick={() => setAdhocOpen((v) => !v)}
            className="btn-secondary btn-sm"
          >
            <Plus className="w-4 h-4" />
            {adhocOpen ? 'Cancel ad-hoc' : 'Ad-hoc attendance'}
          </button>
        </div>

        {adhocOpen && (
          <div className="card mb-4 border-indigo-200 bg-indigo-50/30">
            <div className="flex items-center gap-2 mb-3">
              <ClipboardCheck className="w-5 h-5 text-indigo-600" />
              <h3 className="font-semibold text-gray-900">Ad-hoc attendance</h3>
              <span className="text-xs text-gray-500">No class needed — just pick students.</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Session name (optional)</label>
                <input
                  type="text"
                  value={adhocName}
                  onChange={(e) => setAdhocName(e.target.value)}
                  className="input-field text-sm"
                  placeholder={`Ad-hoc ${selectedDate}`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Class type</label>
                <select
                  value={adhocClassType}
                  onChange={(e) => setAdhocClassType(e.target.value)}
                  className="select-field text-sm"
                >
                  <option value="online">Online</option>
                  <option value="offline">Offline (Individual)</option>
                  <option value="offline_group">Offline (Group)</option>
                  <option value="online_group">Online (Group)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start time</label>
                <input
                  type="time"
                  value={adhocStartTime}
                  onChange={(e) => setAdhocStartTime(e.target.value)}
                  className="input-field text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">End time</label>
                <input
                  type="time"
                  value={adhocEndTime}
                  onChange={(e) => setAdhocEndTime(e.target.value)}
                  className="input-field text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Topic (optional)</label>
                <input
                  type="text"
                  value={adhocTopic}
                  onChange={(e) => setAdhocTopic(e.target.value)}
                  className="input-field text-sm"
                  placeholder="What was taught..."
                />
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Students <span className="text-gray-400">({adhocStudentIds.length} selected)</span>
              </label>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <select
                  value={adhocGroupFilter}
                  onChange={(e) => handleAdhocGroupChange(e.target.value)}
                  className="select-field text-sm w-auto"
                  title="Filter by group (selecting a group auto-picks all its members)"
                >
                  <option value="">All students</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      Group: {g.name} {g.member_count ? `(${g.member_count})` : ''}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={adhocStudentSearch}
                  onChange={(e) => setAdhocStudentSearch(e.target.value)}
                  className="input-field text-sm flex-1 min-w-[150px]"
                  placeholder="Search students..."
                />
                <button
                  type="button"
                  onClick={() => setAdhocStudentIds(adhocVisibleStudents.map((s) => s.id))}
                  className="text-xs text-indigo-600 hover:text-indigo-800 whitespace-nowrap"
                  title="Select every student currently visible"
                >
                  Select All
                </button>
                <button type="button" onClick={() => setAdhocStudentIds([])} className="text-xs text-gray-500 hover:text-gray-700 whitespace-nowrap">
                  Clear
                </button>
              </div>
              <div className="border border-gray-200 rounded-lg max-h-44 overflow-y-auto bg-white">
                {adhocVisibleStudents.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-400">
                    {adhocGroupFilter ? 'No students in this group' : 'No students found'}
                  </div>
                ) : (
                  adhocVisibleStudents.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0"
                    >
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={adhocStudentIds.includes(s.id)}
                        onChange={() => toggleAdhocStudent(s.id)}
                      />
                      <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                        adhocStudentIds.includes(s.id)
                          ? 'bg-indigo-600 border-indigo-600'
                          : 'border-gray-300'
                      }`}>
                        {adhocStudentIds.includes(s.id) && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <span className="text-sm text-gray-700">{s.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setAdhocOpen(false);
                  setAdhocGroupFilter('');
                  setAdhocStudentIds([]);
                  setAdhocStudentSearch('');
                  setAdhocTopic('');
                  setAdhocName('');
                }}
                className="btn-secondary btn-sm"
              >Cancel</button>
              <button onClick={handleAdhocSubmit} disabled={submitting || adhocStudentIds.length === 0} className="btn-primary btn-sm">
                <Save className="w-4 h-4" />
                {submitting ? 'Saving...' : 'Mark Present & Save'}
              </button>
            </div>
          </div>
        )}

        {(classMode === 'today' ? classes : allClasses).length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={classMode === 'today' ? 'No classes scheduled' : 'No classes'}
            message={classMode === 'today' ? `No classes are scheduled for ${dayName}.` : 'No classes have been created yet.'}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(classMode === 'today' ? classes : allClasses).map((cls) => {
              const TypeIcon = classTypeIcons[cls.class_type] || MapPin;
              const isSelected = selectedClass?.id === cls.id;
              return (
                <button
                  key={cls.id}
                  onClick={() => handleClassSelect(cls)}
                  className={`text-left border-l-4 rounded-xl p-4 transition-all ${
                    cls._isCamp
                      ? 'border-amber-500 bg-amber-50 hover:bg-amber-100'
                      : classTypeColors[cls.class_type] || 'border-gray-300 bg-gray-50'
                  } ${
                    isSelected
                      ? `ring-2 ${cls._isCamp ? 'ring-amber-400' : (selectedClassTypeColor[cls.class_type] || 'ring-indigo-400')} shadow-md`
                      : 'shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900">{cls.name}</p>
                        {cls._isCamp && (
                          <span className="badge bg-amber-200 text-amber-800 text-[10px] font-bold uppercase tracking-wider">
                            Camp
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-sm text-gray-600">
                          {formatTime(cls.start_time)} - {formatTime(cls.end_time)}
                        </span>
                        <span className="text-xs text-gray-400">
                          ({calcDuration(cls.start_time, cls.end_time)})
                        </span>
                      </div>
                      {(cls.student_name || cls.group_name || (cls.student_names && cls.student_names.length > 0)) && (
                        <p className="text-xs text-gray-500 mt-1 truncate" title={cls.student_names ? cls.student_names.join(', ') : ''}>
                          {cls._isCamp
                            ? `${cls.members?.length || 0} members${cls.daily_fee ? ` · ₹${cls.daily_fee}/day` : ''}`
                            : cls.group_name
                              ? `Group: ${cls.group_name}`
                              : (cls.student_names && cls.student_names.length > 1
                                  ? `${cls.student_names.length} students`
                                  : cls.student_name)}
                        </p>
                      )}
                    </div>
                    <TypeIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Attendance Form */}
      {selectedClass && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                {selectedClass.name} - Attendance
              </h3>
              <p className="text-sm text-gray-500">
                {formatTime(selectedClass.start_time)} - {formatTime(selectedClass.end_time)}
                {' '}({calcDuration(selectedClass.start_time, selectedClass.end_time)})
                {' '}&bull; {selectedClass.class_type?.replace('_', ' ')}
              </p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-green-600 font-medium">
                <Check className="w-4 h-4 inline mr-1" />{presentCount} Present
              </span>
              <span className="text-red-600 font-medium">
                <X className="w-4 h-4 inline mr-1" />{absentCount} Absent
              </span>
              <span className="font-semibold text-indigo-700">
                <IndianRupee className="w-4 h-4 inline mr-0.5" />{runningTotal.toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          {attendanceRecords.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title="No students"
              message="No students are assigned to this class."
            />
          ) : (
            <>
              {/* "Apply recording URL to all" — convenience for group classes */}
              <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg">
                <span className="text-xs text-amber-800 font-medium whitespace-nowrap">Recording URL (apply to all):</span>
                <input
                  type="url"
                  placeholder="https://youtu.be/..."
                  className="input-field text-sm flex-1 bg-white"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const url = e.target.value.trim();
                      if (!url) return;
                      setAttendanceRecords((prev) => prev.map((r) => ({ ...r, recording_url: url })));
                      e.target.value = '';
                      toast.success('Recording URL applied to all students');
                    }
                  }}
                />
                <span className="text-xs text-amber-700">Press Enter to apply</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="table-header">Student</th>
                      <th className="table-header text-center">Status</th>
                      <th className="table-header">Topic</th>
                      <th className="table-header">Recording</th>
                      <th className="table-header text-right">Fee</th>
                      <th className="table-header text-center w-16"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {attendanceRecords.map((record, idx) => (
                      <tr key={record.student_id} className={`${record.status === 'absent' ? 'bg-red-50/50' : ''}`}>
                        <td className="table-cell">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{record.student_name}</span>
                            {record.absent_streak >= 2 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                                <AlertTriangle className="w-3 h-3" />
                                {record.absent_streak} absent
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="table-cell">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => updateRecord(idx, 'status', 'present')}
                              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                record.status === 'present'
                                  ? 'bg-green-500 text-white shadow-sm'
                                  : 'bg-gray-100 text-gray-500 hover:bg-green-50 hover:text-green-600'
                              }`}
                            >
                              <Check className="w-4 h-4" /> Present
                            </button>
                            <button
                              onClick={() => updateRecord(idx, 'status', 'absent')}
                              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                record.status === 'absent'
                                  ? 'bg-red-500 text-white shadow-sm'
                                  : 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-600'
                              }`}
                            >
                              <X className="w-4 h-4" /> Absent
                            </button>
                          </div>
                        </td>
                        <td className="table-cell">
                          <input
                            type="text"
                            value={record.topic}
                            onChange={(e) => updateRecord(idx, 'topic', e.target.value)}
                            className="input-field text-sm"
                            placeholder="What was taught..."
                          />
                        </td>
                        <td className="table-cell">
                          <div className="flex items-center gap-1">
                            <input
                              type="url"
                              value={record.recording_url || ''}
                              onChange={(e) => updateRecord(idx, 'recording_url', e.target.value)}
                              className="input-field text-sm flex-1"
                              placeholder="YouTube URL"
                            />
                            {record.recording_url && (
                              <a
                                href={record.recording_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 rounded-md text-red-500 hover:bg-red-50"
                                title="Open recording"
                              >
                                <Youtube className="w-4 h-4" />
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="table-cell text-right">
                          {record.status === 'present' ? (
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-gray-400 text-sm">{'\u20B9'}</span>
                              <input
                                type="number"
                                value={record.fee_charged}
                                onChange={(e) => updateRecord(idx, 'fee_charged', Number(e.target.value))}
                                className="input-field text-sm w-24 text-right"
                                min="0"
                              />
                            </div>
                          ) : (
                            <span className="text-gray-400 text-sm">-</span>
                          )}
                        </td>
                        <td className="table-cell text-center">
                          {record.existing_id && (
                            <button
                              onClick={() => deleteAttendanceRecord(idx)}
                              className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="Delete attendance record"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary & Submit */}
              <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="text-sm">
                    <span className="text-gray-500">Total Students: </span>
                    <span className="font-medium">{attendanceRecords.length}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-gray-500">Session Fee Total: </span>
                    <span className="font-bold text-indigo-700">{'\u20B9'}{runningTotal.toLocaleString('en-IN')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {existingAttendance.length > 0 && (
                    <button
                      onClick={deleteAllAttendance}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors text-sm font-medium"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete All
                    </button>
                  )}
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="btn-primary"
                  >
                    <Save className="w-4 h-4" />
                    {submitting ? 'Saving...' : 'Save Attendance'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Marked attendance for the selected date, grouped by class */}
      <div className="card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-indigo-600" />
            <h3 className="text-lg font-semibold text-gray-900">
              Marked attendance &mdash; {dayName}
            </h3>
            <span className="text-xs text-gray-500">
              ({dateAttendance.length} record{dateAttendance.length === 1 ? '' : 's'})
            </span>
          </div>
          {dateAttendance.length > 0 && (
            <span className="font-semibold text-indigo-700 text-sm">
              <IndianRupee className="w-4 h-4 inline mr-0.5" />
              {dateTotalFee.toLocaleString('en-IN')}
            </span>
          )}
        </div>

        {dateAttendance.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No attendance marked"
            message={`No attendance has been marked for ${dayName} yet.`}
          />
        ) : (
          <div className="space-y-3">
            {dateAttendanceGroups.map((group) => {
              const groupTotal = group.records.reduce(
                (s, r) => s + (Number(r.fee_charged) || 0),
                0
              );
              const presentN = group.records.filter((r) => r.status === 'present').length;
              const absentN = group.records.filter((r) => r.status === 'absent').length;
              const lateN = group.records.filter((r) => r.status === 'late').length;
              return (
                <div key={group.class_id} className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between bg-gray-50 px-4 py-2 border-b border-gray-200 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{group.class_name}</span>
                      {group.class_type && (
                        <span className="text-xs text-gray-500">
                          &bull; {String(group.class_type).replace('_', ' ')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-green-600">{presentN} present</span>
                      {absentN > 0 && <span className="text-red-600">{absentN} absent</span>}
                      {lateN > 0 && <span className="text-amber-600">{lateN} late</span>}
                      <span className="font-semibold text-indigo-700">
                        <IndianRupee className="w-3 h-3 inline mr-0.5" />
                        {groupTotal.toLocaleString('en-IN')}
                      </span>
                      <button
                        onClick={() => deleteDateGroup(group)}
                        className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete all records for this class on this date"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {group.records.map((rec) => (
                      <div key={rec.id} className="flex items-center justify-between px-4 py-2 text-sm">
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-gray-900">{rec.student_name}</span>
                          {rec.topic && (
                            <span className="text-gray-500 ml-2 truncate">&mdash; {rec.topic}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 ml-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              rec.status === 'present'
                                ? 'bg-green-100 text-green-700'
                                : rec.status === 'absent'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {rec.status}
                          </span>
                          <span className="text-gray-700 w-16 text-right">
                            {rec.status === 'present' || rec.status === 'late'
                              ? `\u20B9${Number(rec.fee_charged || 0).toLocaleString('en-IN')}`
                              : '-'}
                          </span>
                          <button
                            onClick={() => openEditRecord(rec)}
                            className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                            title="Edit this attendance record"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => deleteDateRecord(rec)}
                            className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Delete this attendance record"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit attendance record modal */}
      <Modal
        isOpen={!!editingRecord}
        onClose={closeEditRecord}
        title="Edit attendance"
        size="md"
      >
        {editingRecord && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600">
              <div>
                <span className="text-gray-400">Student:</span>{' '}
                <span className="font-medium text-gray-700">{editingRecord.student_name}</span>
              </div>
              <div className="mt-0.5">
                <span className="text-gray-400">Class:</span>{' '}
                <span className="font-medium text-gray-700">{editingRecord.class_name || '—'}</span>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Fee charged (₹)</label>
                <input
                  type="number"
                  min="0"
                  value={editForm.fee_charged}
                  onChange={(e) => setEditForm({ ...editForm, fee_charged: e.target.value })}
                  className="input-field"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button type="button" onClick={closeEditRecord} className="btn-secondary btn-sm" disabled={savingEdit}>
                Cancel
              </button>
              <button type="button" onClick={saveEditRecord} className="btn-primary btn-sm" disabled={savingEdit}>
                {savingEdit ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
