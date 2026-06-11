import { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  Clock,
  Calendar,
  Filter,
  Monitor,
  MapPin,
  UsersRound,
  Check,
  X,
  Wifi,
  Tent,
  Archive,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useConfirm } from '../contexts/ConfirmContext';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const emptyForm = {
  name: '',
  class_type: 'offline',
  day_of_week: 0,
  start_time: '09:00',
  end_time: '10:00',
  student_ids: [],
  group_id: '',
};

const isGroupType = (type) => type === 'offline_group' || type === 'online_group';

export default function Classes() {
  const confirm = useConfirm();
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClass, setEditingClass] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState({ open: false, cls: null });
  const [typeFilter, setTypeFilter] = useState('all');
  const [studentSearch, setStudentSearch] = useState('');

  // ----- Camps tab state -----
  // activeTab: 'schedule' (weekly grid) | 'camps' (camps list)
  const [activeTab, setActiveTab] = useState('schedule');
  const [camps, setCamps] = useState([]);
  const [campsStatusFilter, setCampsStatusFilter] = useState('active'); // active | archived
  const [campFormOpen, setCampFormOpen] = useState(false);
  const [campDetail, setCampDetail] = useState(null); // selected camp for detail modal
  const [campForm, setCampForm] = useState({
    name: '',
    group_id: '',
    start_date: new Date().toISOString().slice(0, 10),
    total_days: 5,
    daily_fee: 0,
    sameSchedule: true,
    sharedStart: '17:00',
    sharedEnd: '18:00',
    sharedType: 'offline_group',
    perDay: [], // [{ day_date, start_time, end_time, class_type }]
    notes: '',
  });
  const [savingCamp, setSavingCamp] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [classesData, studentsData, groupsData] = await Promise.all([
        api.get('/classes'),
        api.get('/students'),
        api.get('/groups'),
      ]);
      setClasses(classesData.classes || []);
      setStudents((studentsData.students || []).filter((s) => s.status === 'active'));
      setGroups(groupsData.groups || []);
    } catch (err) {
      toast.error('Failed to load data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Refresh camps whenever the user switches into the Camps tab or changes the
  // status filter. Loaded lazily so visiting the page doesn't trigger an extra
  // request unless needed.
  const fetchCamps = async () => {
    try {
      const data = await api.get(`/camps?status=${campsStatusFilter}`);
      setCamps(data.camps || []);
    } catch (err) {
      toast.error('Failed to load camps: ' + err.message);
    }
  };
  useEffect(() => {
    if (activeTab === 'camps') fetchCamps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, campsStatusFilter]);

  // ----- Camp form helpers -----
  // Stays in local time — never goes through UTC — so the date string we
  // return matches what the user picked (browser-local). Going via toISOString
  // would shift by the browser's UTC offset and drop a day in tz like IST.
  function addDaysISO(d, n) {
    const [y, m, day] = d.split('-').map(Number);
    const dt = new Date(y, m - 1, day);
    dt.setDate(dt.getDate() + n);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  function buildScheduleFromForm() {
    const { sameSchedule, sharedStart, sharedEnd, sharedType, perDay, start_date, total_days } = campForm;
    if (sameSchedule) {
      const rows = [];
      for (let i = 0; i < total_days; i++) {
        rows.push({
          day_date: addDaysISO(start_date, i),
          start_time: sharedStart,
          end_time: sharedEnd,
          class_type: sharedType,
        });
      }
      return rows;
    }
    return perDay;
  }
  function regeneratePerDay() {
    const { start_date, total_days, sharedStart, sharedEnd, sharedType } = campForm;
    const rows = [];
    for (let i = 0; i < total_days; i++) {
      rows.push({
        day_date: addDaysISO(start_date, i),
        start_time: sharedStart,
        end_time: sharedEnd,
        class_type: sharedType,
      });
    }
    setCampForm((prev) => ({ ...prev, perDay: rows }));
  }
  function openCampForm() {
    // todayLocal builds the YYYY-MM-DD from local-time components so the
    // default doesn't slip a day in IST. (.toISOString() converts to UTC,
    // which can be the previous day after evening hours.)
    const now = new Date();
    const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    setCampForm({
      name: '',
      group_id: '',
      start_date: todayLocal,
      total_days: 5,
      daily_fee: 0,
      sameSchedule: true,
      sharedStart: '17:00',
      sharedEnd: '18:00',
      sharedType: 'offline_group',
      perDay: [],
      notes: '',
    });
    setCampFormOpen(true);
  }
  async function saveCamp() {
    const { name, group_id, start_date, total_days } = campForm;
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!group_id) { toast.error('Pick a group'); return; }
    if (!start_date) { toast.error('Start date is required'); return; }
    if (!total_days || total_days < 1) { toast.error('Total days must be at least 1'); return; }
    try {
      setSavingCamp(true);
      const schedule = buildScheduleFromForm();
      if (!schedule.length) {
        toast.error('Schedule is empty — set start date and total days first');
        setSavingCamp(false);
        return;
      }
      const result = await api.post('/camps', {
        name: name.trim(),
        // Send group_id as a STRING — Catalyst ROWIDs are 17 digits and lose
        // precision when converted to JS Number.
        group_id: String(group_id),
        start_date,
        total_days: Number(total_days),
        daily_fee: Number(campForm.daily_fee) || 0,
        notes: campForm.notes || '',
        schedule,
      });
      toast.success(`Camp created with ${result.camp?.days?.length || schedule.length} days`);
      setCampFormOpen(false);
      fetchCamps();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingCamp(false);
    }
  }
  async function changeCampStatus(camp, status) {
    try {
      await api.put(`/camps/${camp.id}`, { status });
      toast.success(`Camp ${status === 'archived' ? 'archived' : status === 'completed' ? 'marked complete' : 'updated'}`);
      fetchCamps();
      if (campDetail?.id === camp.id) setCampDetail(null);
    } catch (err) {
      toast.error(err.message);
    }
  }
  async function deleteCamp(camp) {
    const ok = await confirm({
      title: 'Delete this camp?',
      message: `Permanently remove the camp "${camp.name}". Attendance records linked to it will be kept.`,
      confirmText: 'Delete camp',
    });
    if (!ok) return;
    try {
      await api.delete(`/camps/${camp.id}`);
      toast.success('Camp deleted');
      fetchCamps();
      if (campDetail?.id === camp.id) setCampDetail(null);
    } catch (err) {
      toast.error(err.message);
    }
  }

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

  const toggleStudentSelection = (id) => {
    setForm((prev) => {
      const has = prev.student_ids.some((sid) => String(sid) === String(id));
      return {
        ...prev,
        student_ids: has
          ? prev.student_ids.filter((sid) => String(sid) !== String(id))
          : [...prev.student_ids, id],
      };
    });
  };

  const filteredStudentsList = students.filter((s) =>
    s.name.toLowerCase().includes(studentSearch.toLowerCase())
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Class name is required');
      return;
    }

    const isGroup = isGroupType(form.class_type);

    if (isGroup && !form.group_id) {
      toast.error('Please select a group');
      return;
    }
    if (!isGroup && form.student_ids.length === 0) {
      toast.error('Please select at least one student');
      return;
    }

    try {
      setSaving(true);
      const [sh, sm] = form.start_time.split(':').map(Number);
      const [eh, em] = form.end_time.split(':').map(Number);
      const diffMinutes = (eh * 60 + em) - (sh * 60 + sm);
      const durationHours = diffMinutes > 0 ? diffMinutes / 60 : 1;

      if (editingClass) {
        // Edit mode: send full student_ids list for individual classes;
        // backend replaces class_students rows accordingly.
        const payload = {
          name: form.name,
          class_type: form.class_type,
          day_of_week: Number(form.day_of_week),
          start_time: form.start_time,
          end_time: form.end_time,
          group_id: isGroup ? String(form.group_id) : null,
          duration_hours: durationHours,
        };
        if (!isGroup) {
          payload.student_ids = form.student_ids.map(String);
        }
        await api.put(`/classes/${editingClass.id}`, payload);
        toast.success('Class updated');
      } else {
        // Create mode: one class with multiple students for individual types.
        const payload = {
          name: form.name,
          class_type: form.class_type,
          day_of_week: Number(form.day_of_week),
          start_time: form.start_time,
          end_time: form.end_time,
          group_id: isGroup ? String(form.group_id) : null,
          duration_hours: durationHours,
        };
        if (isGroup) {
          payload.student_id = null;
        } else {
          payload.student_ids = form.student_ids.map(String);
        }
        await api.post('/classes', payload);
        toast.success(
          isGroup
            ? 'Class created'
            : form.student_ids.length > 1
              ? `Class created with ${form.student_ids.length} students`
              : 'Class created'
        );
      }
      setModalOpen(false);
      setEditingClass(null);
      setForm(emptyForm);
      setStudentSearch('');
      fetchData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (cls) => {
    setEditingClass(cls);
    // Prefer the array from class_students (cls.student_ids), fall back to
    // the legacy single student_id when present.
    const ids = Array.isArray(cls.student_ids) && cls.student_ids.length > 0
      ? cls.student_ids
      : cls.student_id ? [cls.student_id] : [];
    setForm({
      name: cls.name || '',
      class_type: cls.class_type || 'offline',
      day_of_week: cls.day_of_week ?? 0,
      start_time: cls.start_time || '09:00',
      end_time: cls.end_time || '10:00',
      student_ids: ids,
      group_id: cls.group_id || '',
    });
    setStudentSearch('');
    setModalOpen(true);
  };

  const openAdd = (dayOfWeek) => {
    setEditingClass(null);
    setForm({ ...emptyForm, day_of_week: dayOfWeek ?? 0 });
    setStudentSearch('');
    setModalOpen(true);
  };

  const handleDelete = async () => {
    const cls = deleteDialog.cls;
    if (!cls) return;
    try {
      await api.delete(`/classes/${cls.id}`);
      toast.success('Class deleted');
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const classesByDay = useMemo(() => {
    let filtered = classes;
    if (typeFilter !== 'all') {
      filtered = filtered.filter((c) => c.class_type === typeFilter);
    }
    const grouped = {};
    for (let i = 0; i < 7; i++) {
      grouped[i] = filtered
        .filter((c) => c.day_of_week === i)
        .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    }
    return grouped;
  }, [classes, typeFilter]);

  const classTypeColors = {
    online: 'border-l-blue-500 bg-blue-50',
    offline: 'border-l-emerald-500 bg-emerald-50',
    offline_group: 'border-l-purple-500 bg-purple-50',
    online_group: 'border-l-cyan-500 bg-cyan-50',
  };

  const classTypeIcons = {
    online: Monitor,
    offline: MapPin,
    offline_group: UsersRound,
    online_group: Wifi,
  };

  const classTypeLabel = (type) => {
    switch (type) {
      case 'online': return 'Online';
      case 'offline': return 'Offline';
      case 'offline_group': return 'Offline Group';
      case 'online_group': return 'Online Group';
      default: return type?.replace('_', ' ');
    }
  };

  const today = new Date().getDay();

  if (loading) return <Loader text="Loading classes..." />;

  return (
    <div className="space-y-4">
      {/* Tab strip: Weekly Schedule vs Camps */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('schedule')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'schedule'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Calendar className="w-4 h-4" /> Weekly Schedule
        </button>
        <button
          onClick={() => setActiveTab('camps')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'camps'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Tent className="w-4 h-4" /> Camps
        </button>
      </div>

      {activeTab === 'schedule' && (
      <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="page-header mb-0">Weekly Schedule</h2>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-1 flex-wrap">
            <Filter className="w-4 h-4 text-gray-400 ml-2" />
            {['all', 'online', 'offline', 'offline_group', 'online_group'].map((type) => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                  typeFilter === type
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {type === 'all' ? 'All' : classTypeLabel(type)}
              </button>
            ))}
          </div>
          <button onClick={() => openAdd(today)} className="btn-primary btn-sm">
            <Plus className="w-4 h-4" /> Add Class
          </button>
        </div>
      </div>

      {/* Weekly Calendar */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {DAYS.map((day, idx) => (
          <div
            key={idx}
            className={`card ${idx === today ? 'ring-2 ring-indigo-300 border-indigo-200' : ''}`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h3 className={`font-semibold ${idx === today ? 'text-indigo-700' : 'text-gray-900'}`}>
                  {day}
                </h3>
                {idx === today && (
                  <span className="badge bg-indigo-100 text-indigo-700">Today</span>
                )}
              </div>
              <span className="text-xs text-gray-400">{classesByDay[idx]?.length || 0} classes</span>
            </div>

            {classesByDay[idx]?.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-xs text-gray-400">No classes</p>
                <button
                  onClick={() => openAdd(idx)}
                  className="text-xs text-indigo-500 hover:text-indigo-600 mt-1"
                >
                  + Add class
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {classesByDay[idx].map((cls) => {
                  const TypeIcon = classTypeIcons[cls.class_type] || MapPin;
                  return (
                    <div
                      key={cls.id}
                      className={`border-l-4 rounded-lg p-3 ${classTypeColors[cls.class_type] || 'bg-gray-50 border-l-gray-300'}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 text-sm truncate">{cls.name}</p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <Clock className="w-3 h-3 text-gray-400 flex-shrink-0" />
                            <span className="text-xs text-gray-500">
                              {formatTime(cls.start_time)} - {formatTime(cls.end_time)}
                            </span>
                            <span className="text-xs text-gray-400">
                              ({calcDuration(cls.start_time, cls.end_time)})
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <TypeIcon className="w-3 h-3 text-gray-400 flex-shrink-0" />
                            <span className="text-xs text-gray-500">
                              {classTypeLabel(cls.class_type)}
                            </span>
                          </div>
                          {(cls.student_name || cls.group_name || (cls.student_names && cls.student_names.length > 0)) && (
                            <p className="text-xs text-gray-500 mt-1 truncate" title={cls.student_names ? cls.student_names.join(', ') : ''}>
                              {cls.group_name
                                ? `Group: ${cls.group_name}`
                                : (cls.student_names && cls.student_names.length > 1
                                    ? `${cls.student_names.length} students: ${cls.student_names.join(', ')}`
                                    : cls.student_name)}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 ml-2">
                          <button
                            onClick={() => openEdit(cls)}
                            className="p-1 rounded hover:bg-white/70 text-gray-400 hover:text-indigo-600"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteDialog({ open: true, cls })}
                            className="p-1 rounded hover:bg-white/70 text-gray-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <button
                  onClick={() => openAdd(idx)}
                  className="w-full text-xs text-indigo-500 hover:text-indigo-600 py-1 text-center"
                >
                  + Add class
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      </>
      )}

      {activeTab === 'camps' && (
      <>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="page-header mb-0">Camps</h2>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-1">
              {['active', 'completed', 'archived'].map((s) => (
                <button
                  key={s}
                  onClick={() => setCampsStatusFilter(s)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                    campsStatusFilter === s
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <button onClick={openCampForm} className="btn-primary btn-sm">
              <Plus className="w-4 h-4" /> New Camp
            </button>
          </div>
        </div>

        {camps.length === 0 ? (
          <EmptyState
            icon={Tent}
            title={`No ${campsStatusFilter} camps`}
            message={
              campsStatusFilter === 'active'
                ? 'Click "New Camp" to schedule a special program.'
                : `Camps marked ${campsStatusFilter} will appear here.`
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {camps.map((c) => (
              <div
                key={c.id}
                onClick={() => setCampDetail(c)}
                className="card cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-amber-500"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Group: {c.group_name || '—'}</p>
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-600">
                      <Calendar className="w-3 h-3" />
                      <span>{c.start_date} → {c.end_date}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {c.total_days} days
                      {c.daily_fee ? <span> · ₹{c.daily_fee}/day</span> : null}
                    </div>
                  </div>
                  <span className={`badge text-xs capitalize ${
                    c.status === 'active' ? 'bg-green-100 text-green-700' :
                    c.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>{c.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </>
      )}

      {/* Camp create modal */}
      <Modal
        isOpen={campFormOpen}
        onClose={() => setCampFormOpen(false)}
        title="New Camp"
        size="lg"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Camp name *</label>
              <input
                type="text"
                value={campForm.name}
                onChange={(e) => setCampForm({ ...campForm, name: e.target.value })}
                className="input-field text-sm"
                placeholder="e.g. Summer Camp 2026"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Group *</label>
              <select
                value={campForm.group_id}
                onChange={(e) => setCampForm({ ...campForm, group_id: e.target.value })}
                className="select-field text-sm"
              >
                <option value="">Select group...</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name} {g.member_count ? `(${g.member_count})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Start date *</label>
              <input
                type="date"
                value={campForm.start_date}
                onChange={(e) => setCampForm({ ...campForm, start_date: e.target.value })}
                className="input-field text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Total days *</label>
              <input
                type="number"
                min={1}
                max={60}
                value={campForm.total_days}
                onChange={(e) => setCampForm({ ...campForm, total_days: Number(e.target.value) })}
                className="input-field text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Daily fee (per student, optional)</label>
              <input
                type="number"
                min={0}
                value={campForm.daily_fee}
                onChange={(e) => setCampForm({ ...campForm, daily_fee: Number(e.target.value) })}
                className="input-field text-sm"
                placeholder="0 = use student's group rate"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={campForm.sameSchedule}
              onChange={(e) => setCampForm({ ...campForm, sameSchedule: e.target.checked })}
            />
            <span className="text-sm text-gray-700">Same schedule every day</span>
          </label>

          {campForm.sameSchedule ? (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start time</label>
                <input
                  type="time"
                  value={campForm.sharedStart}
                  onChange={(e) => setCampForm({ ...campForm, sharedStart: e.target.value })}
                  className="input-field text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">End time</label>
                <input
                  type="time"
                  value={campForm.sharedEnd}
                  onChange={(e) => setCampForm({ ...campForm, sharedEnd: e.target.value })}
                  className="input-field text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Class type</label>
                <select
                  value={campForm.sharedType}
                  onChange={(e) => setCampForm({ ...campForm, sharedType: e.target.value })}
                  className="select-field text-sm"
                >
                  <option value="online">Online</option>
                  <option value="offline">Offline</option>
                  <option value="offline_group">Offline (Group)</option>
                  <option value="online_group">Online (Group)</option>
                </select>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-600">Per-day schedule</p>
                <button type="button" onClick={regeneratePerDay} className="text-xs text-indigo-600 hover:text-indigo-800">
                  Auto-fill from start date
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
                {(campForm.perDay.length ? campForm.perDay : Array.from({ length: campForm.total_days }).map((_, i) => ({
                  day_date: addDaysISO(campForm.start_date, i),
                  start_time: campForm.sharedStart,
                  end_time: campForm.sharedEnd,
                  class_type: campForm.sharedType,
                }))).map((d, i) => (
                  <div key={i} className="grid grid-cols-4 gap-2 p-2 border-b border-gray-100 last:border-0 text-sm">
                    <input
                      type="date"
                      value={d.day_date}
                      onChange={(e) => {
                        const rows = [...(campForm.perDay.length ? campForm.perDay : Array.from({ length: campForm.total_days }).map((_, j) => ({
                          day_date: addDaysISO(campForm.start_date, j),
                          start_time: campForm.sharedStart,
                          end_time: campForm.sharedEnd,
                          class_type: campForm.sharedType,
                        })))];
                        rows[i] = { ...rows[i], day_date: e.target.value };
                        setCampForm({ ...campForm, perDay: rows });
                      }}
                      className="input-field text-xs"
                    />
                    <input
                      type="time"
                      value={d.start_time}
                      onChange={(e) => {
                        const rows = [...(campForm.perDay.length ? campForm.perDay : Array.from({ length: campForm.total_days }).map((_, j) => ({
                          day_date: addDaysISO(campForm.start_date, j),
                          start_time: campForm.sharedStart,
                          end_time: campForm.sharedEnd,
                          class_type: campForm.sharedType,
                        })))];
                        rows[i] = { ...rows[i], start_time: e.target.value };
                        setCampForm({ ...campForm, perDay: rows });
                      }}
                      className="input-field text-xs"
                    />
                    <input
                      type="time"
                      value={d.end_time}
                      onChange={(e) => {
                        const rows = [...(campForm.perDay.length ? campForm.perDay : Array.from({ length: campForm.total_days }).map((_, j) => ({
                          day_date: addDaysISO(campForm.start_date, j),
                          start_time: campForm.sharedStart,
                          end_time: campForm.sharedEnd,
                          class_type: campForm.sharedType,
                        })))];
                        rows[i] = { ...rows[i], end_time: e.target.value };
                        setCampForm({ ...campForm, perDay: rows });
                      }}
                      className="input-field text-xs"
                    />
                    <select
                      value={d.class_type}
                      onChange={(e) => {
                        const rows = [...(campForm.perDay.length ? campForm.perDay : Array.from({ length: campForm.total_days }).map((_, j) => ({
                          day_date: addDaysISO(campForm.start_date, j),
                          start_time: campForm.sharedStart,
                          end_time: campForm.sharedEnd,
                          class_type: campForm.sharedType,
                        })))];
                        rows[i] = { ...rows[i], class_type: e.target.value };
                        setCampForm({ ...campForm, perDay: rows });
                      }}
                      className="select-field text-xs"
                    >
                      <option value="online">Online</option>
                      <option value="offline">Offline</option>
                      <option value="offline_group">Offline (Group)</option>
                      <option value="online_group">Online (Group)</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setCampFormOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={saveCamp} disabled={savingCamp} className="btn-primary">
              {savingCamp ? 'Saving...' : `Create Camp (${campForm.total_days} days)`}
            </button>
          </div>
        </div>
      </Modal>

      {/* Camp detail modal */}
      <Modal
        isOpen={!!campDetail}
        onClose={() => setCampDetail(null)}
        title={campDetail?.name || 'Camp'}
        size="lg"
      >
        {campDetail && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <div className="text-gray-600">
                <div>Group: <span className="font-medium text-gray-900">{campDetail.group_name}</span></div>
                <div>Dates: <span className="font-medium text-gray-900">{campDetail.start_date} → {campDetail.end_date}</span></div>
                <div>Members: <span className="font-medium text-gray-900">{campDetail.members?.length || 0}</span></div>
                {campDetail.daily_fee ? <div>Daily fee: <span className="font-medium text-gray-900">₹{campDetail.daily_fee}</span></div> : null}
              </div>
              <span className={`badge text-xs capitalize ${
                campDetail.status === 'active' ? 'bg-green-100 text-green-700' :
                campDetail.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                'bg-gray-100 text-gray-600'
              }`}>{campDetail.status}</span>
            </div>

            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="table-header">Date</th>
                    <th className="table-header">Time</th>
                    <th className="table-header">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(campDetail.days || []).map((d) => (
                    <tr key={d.id}>
                      <td className="table-cell">{d.day_date}</td>
                      <td className="table-cell">{d.start_time} – {d.end_time}</td>
                      <td className="table-cell">{(d.class_type || '').replace('_', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-gray-500">
              Mark attendance for each day from the <strong>Attendance</strong> page — camp days appear there alongside regular classes.
            </p>

            <div className="flex justify-end gap-2 pt-2 flex-wrap">
              {campDetail.status === 'active' && (
                <button onClick={() => changeCampStatus(campDetail, 'completed')} className="btn-secondary btn-sm">
                  <Check className="w-4 h-4" /> Mark Complete
                </button>
              )}
              {campDetail.status !== 'archived' && (
                <button onClick={() => changeCampStatus(campDetail, 'archived')} className="btn-secondary btn-sm">
                  <Archive className="w-4 h-4" /> Archive
                </button>
              )}
              <button onClick={() => deleteCamp(campDetail)} className="btn-danger btn-sm">
                <Trash2 className="w-4 h-4" /> Delete permanently
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setEditingClass(null); setForm(emptyForm); setStudentSearch(''); }}
        title={editingClass ? 'Edit Class' : 'Add Class'}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Class Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input-field"
              placeholder="e.g., Veena Basics"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Class Type</label>
              <select
                value={form.class_type}
                onChange={(e) => setForm({ ...form, class_type: e.target.value, student_ids: [], group_id: '' })}
                className="select-field"
              >
                <option value="online">Online</option>
                <option value="offline">Offline (Individual)</option>
                <option value="offline_group">Offline (Group)</option>
                <option value="online_group">Online (Group)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Day of Week</label>
              <select
                value={form.day_of_week}
                onChange={(e) => setForm({ ...form, day_of_week: e.target.value })}
                className="select-field"
              >
                {DAYS.map((day, idx) => (
                  <option key={idx} value={idx}>{day}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                className="input-field"
              />
            </div>
          </div>

          {form.start_time && form.end_time && (
            <p className="text-sm text-gray-500">
              Duration: <span className="font-medium">{calcDuration(form.start_time, form.end_time) || 'Invalid'}</span>
            </p>
          )}

          {isGroupType(form.class_type) ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Group *</label>
              <select
                value={form.group_id}
                onChange={(e) => setForm({ ...form, group_id: e.target.value, student_ids: [] })}
                className="select-field"
              >
                <option value="">Select a group...</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Students *
                {' '}<span className="text-gray-400 font-normal">({form.student_ids.length} selected)</span>
              </label>

              {/* Selected student chips */}
              {form.student_ids.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.student_ids.map((sid) => {
                    const s = students.find((st) => st.id === sid);
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
                <button type="button" onClick={() => setForm((prev) => ({ ...prev, student_ids: students.map((s) => s.id) }))} className="text-xs text-indigo-600 hover:text-indigo-800 whitespace-nowrap">
                  Select All
                </button>
                <button type="button" onClick={() => setForm((prev) => ({ ...prev, student_ids: [] }))} className="text-xs text-gray-500 hover:text-gray-700 whitespace-nowrap">
                  Clear
                </button>
              </div>

              {/* Student list with checkboxes */}
              <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
                {filteredStudentsList.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-400">No students found</div>
                ) : (
                  filteredStudentsList.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0"
                    >
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={form.student_ids.includes(s.id)}
                        onChange={() => toggleStudentSelection(s.id)}
                      />
                      <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                        form.student_ids.includes(s.id)
                          ? 'bg-indigo-600 border-indigo-600'
                          : 'border-gray-300'
                      }`}>
                        {form.student_ids.includes(s.id) && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <span className="text-sm text-gray-700">{s.name}</span>
                    </label>
                  ))
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1">All selected students will be linked to this single class.</p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => { setModalOpen(false); setEditingClass(null); }} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : editingClass ? 'Update' : 'Create Class'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteDialog.open}
        onClose={() => setDeleteDialog({ open: false, cls: null })}
        onConfirm={handleDelete}
        title="Delete Class"
        message={`Are you sure you want to delete "${deleteDialog.cls?.name}"?`}
        confirmText="Delete"
      />
    </div>
  );
}
