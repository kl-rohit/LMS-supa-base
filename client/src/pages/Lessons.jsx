// Admin: manage Courses → Lessons → Enrollments.
//
// Flow:
//   - Default view shows a grid of Course cards
//   - Click a course → opens a detail panel with two sub-tabs:
//       • Lessons    — list, drag-or-numbered ordering, add/edit/delete
//       • Enrollments — students enrolled, add more, see progress %
//   - Modals for create/edit Course, create/edit Lesson, enroll students

import { useEffect, useMemo, useState } from 'react';
import {
  Video,
  Plus,
  ArrowLeft,
  Edit2,
  Trash2,
  Users,
  Youtube,
  PlayCircle,
  CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import { useConfirm } from '../contexts/ConfirmContext';
import { extractYouTubeId, ytThumbnail, formatDuration } from '../utils/youtube';

const blankCourse = { name: '', description: '', thumbnail_url: '' };
const blankLesson = { title: '', description: '', video_url: '', duration_seconds: 0 };

export default function Lessons() {
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(null); // course object
  const [tab, setTab] = useState('lessons'); // 'lessons' | 'enrollments'
  const [lessons, setLessons] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [students, setStudents] = useState([]);

  // Modals
  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState(null);
  const [courseForm, setCourseForm] = useState(blankCourse);

  const [lessonModalOpen, setLessonModalOpen] = useState(false);
  const [editingLesson, setEditingLesson] = useState(null);
  const [lessonForm, setLessonForm] = useState(blankLesson);

  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [enrollSelection, setEnrollSelection] = useState([]); // array of student_ids

  const fetchCourses = async () => {
    try {
      setLoading(true);
      const data = await api.get('/courses');
      setCourses(data.courses || []);
    } catch (err) {
      toast.error('Failed to load courses: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchCourseDetail = async (courseId) => {
    try {
      const [lessonsResp, enrollResp, studentsResp] = await Promise.all([
        api.get(`/lessons?course_id=${courseId}`),
        api.get(`/enrollments?course_id=${courseId}`),
        api.get('/students'),
      ]);
      setLessons(lessonsResp.lessons || []);
      setEnrollments(enrollResp.enrollments || []);
      setStudents((studentsResp.students || []).filter((s) => s.status === 'active'));
    } catch (err) {
      toast.error('Failed to load course detail: ' + err.message);
    }
  };

  useEffect(() => { fetchCourses(); }, []);
  useEffect(() => {
    if (selectedCourse?.id) fetchCourseDetail(selectedCourse.id);
  }, [selectedCourse?.id]);

  // ----- Course CRUD -----
  const openCreateCourse = () => {
    setEditingCourse(null);
    setCourseForm(blankCourse);
    setCourseModalOpen(true);
  };
  const openEditCourse = (c) => {
    setEditingCourse(c);
    setCourseForm({
      name: c.name || '',
      description: c.description || '',
      thumbnail_url: c.thumbnail_url || '',
    });
    setCourseModalOpen(true);
  };
  const saveCourse = async () => {
    if (!courseForm.name.trim()) { toast.error('Name is required'); return; }
    try {
      if (editingCourse) {
        await api.put(`/courses/${editingCourse.id}`, courseForm);
        toast.success('Course updated');
      } else {
        await api.post('/courses', courseForm);
        toast.success('Course created');
      }
      setCourseModalOpen(false);
      fetchCourses();
    } catch (err) {
      toast.error('Failed: ' + err.message);
    }
  };
  const deleteCourse = async (c) => {
    const ok = await confirm({
      title: 'Archive this course?',
      message: `"${c.name}" will be hidden from students but its lessons and enrollments are kept. You can hard-delete from the database if needed.`,
      confirmText: 'Archive',
      danger: false,
    });
    if (!ok) return;
    try {
      await api.delete(`/courses/${c.id}`);
      toast.success('Course archived');
      if (selectedCourse?.id === c.id) setSelectedCourse(null);
      fetchCourses();
    } catch (err) {
      toast.error('Failed: ' + err.message);
    }
  };

  // ----- Lesson CRUD -----
  const openCreateLesson = () => {
    setEditingLesson(null);
    setLessonForm(blankLesson);
    setLessonModalOpen(true);
  };
  const openEditLesson = (l) => {
    setEditingLesson(l);
    setLessonForm({
      title: l.title || '',
      description: l.description || '',
      video_url: l.video_url || '',
      duration_seconds: l.duration_seconds || 0,
    });
    setLessonModalOpen(true);
  };
  const saveLesson = async () => {
    if (!lessonForm.title.trim() || !lessonForm.video_url.trim()) {
      toast.error('Title and video URL are required');
      return;
    }
    if (!extractYouTubeId(lessonForm.video_url)) {
      toast.error("Doesn't look like a valid YouTube URL");
      return;
    }
    try {
      if (editingLesson) {
        await api.put(`/lessons/${editingLesson.id}`, lessonForm);
        toast.success('Lesson updated');
      } else {
        await api.post('/lessons', { ...lessonForm, course_id: String(selectedCourse.id) });
        toast.success('Lesson added');
      }
      setLessonModalOpen(false);
      fetchCourseDetail(selectedCourse.id);
    } catch (err) {
      toast.error('Failed: ' + err.message);
    }
  };
  const deleteLesson = async (l) => {
    const ok = await confirm({
      title: 'Delete this lesson?',
      message: `"${l.title}" will be permanently removed. All student progress for this lesson is also deleted.`,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/lessons/${l.id}`);
      toast.success('Lesson deleted');
      fetchCourseDetail(selectedCourse.id);
    } catch (err) {
      toast.error('Failed: ' + err.message);
    }
  };

  // ----- Enroll students -----
  const openEnrollModal = () => {
    setEnrollSelection([]);
    setEnrollModalOpen(true);
  };
  const enrolledIds = useMemo(
    () => new Set(enrollments.map((e) => String(e.student_id))),
    [enrollments]
  );
  const unenrolledStudents = useMemo(
    () => students.filter((s) => !enrolledIds.has(String(s.id))),
    [students, enrolledIds]
  );
  const saveEnrollments = async () => {
    if (enrollSelection.length === 0) return;
    try {
      const resp = await api.post('/enrollments', {
        course_id: String(selectedCourse.id),
        student_ids: enrollSelection.map(String),
      });
      toast.success(`Enrolled ${resp.count || enrollSelection.length} student(s)`);
      setEnrollModalOpen(false);
      fetchCourseDetail(selectedCourse.id);
    } catch (err) {
      toast.error('Failed: ' + err.message);
    }
  };
  const unenroll = async (en) => {
    const ok = await confirm({
      title: 'Unenroll this student?',
      message: `${en.student_name} will lose access to this course's lessons. Their existing progress is preserved if you re-enroll.`,
      confirmText: 'Unenroll',
    });
    if (!ok) return;
    try {
      await api.delete(`/enrollments/${en.id}`);
      toast.success('Unenrolled');
      fetchCourseDetail(selectedCourse.id);
    } catch (err) {
      toast.error('Failed: ' + err.message);
    }
  };

  // ----- Render -----
  if (loading) return <Loader text="Loading lessons..." />;

  // Detail view
  if (selectedCourse) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedCourse(null)}
              className="p-2 rounded-lg hover:bg-gray-100"
              title="Back to courses"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">{selectedCourse.name}</h2>
              {selectedCourse.description && (
                <p className="text-sm text-gray-500 mt-0.5">{selectedCourse.description}</p>
              )}
            </div>
          </div>
          <button onClick={() => openEditCourse(selectedCourse)} className="btn-secondary btn-sm">
            <Edit2 className="w-4 h-4" /> Edit course
          </button>
        </div>

        <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1 w-fit">
          <button
            onClick={() => setTab('lessons')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'lessons' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Lessons ({lessons.length})
          </button>
          <button
            onClick={() => setTab('enrollments')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'enrollments' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Enrollments ({enrollments.length})
          </button>
        </div>

        {tab === 'lessons' && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Lessons</h3>
              <button onClick={openCreateLesson} className="btn-primary btn-sm">
                <Plus className="w-4 h-4" /> Add lesson
              </button>
            </div>
            {lessons.length === 0 ? (
              <EmptyState
                icon={Video}
                title="No lessons yet"
                message="Add your first lesson — paste a YouTube unlisted URL."
              />
            ) : (
              <div className="space-y-2">
                {lessons.map((l, idx) => {
                  const ytId = extractYouTubeId(l.video_url);
                  return (
                    <div key={l.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50">
                      <div className="text-sm font-semibold text-gray-400 w-6">{idx + 1}.</div>
                      {ytId && (
                        <img src={ytThumbnail(ytId)} alt="" className="w-24 h-14 rounded object-cover flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 truncate">{l.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                          {l.duration_seconds > 0 && <span>{formatDuration(l.duration_seconds)}</span>}
                          <a href={l.video_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-red-600 hover:text-red-700">
                            <Youtube className="w-3 h-3" /> Open
                          </a>
                        </p>
                      </div>
                      <button onClick={() => openEditLesson(l)} className="p-1.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50" title="Edit">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteLesson(l)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'enrollments' && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Enrolled students</h3>
              <button onClick={openEnrollModal} className="btn-primary btn-sm" disabled={unenrolledStudents.length === 0}>
                <Plus className="w-4 h-4" /> Add students
              </button>
            </div>
            {enrollments.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No one enrolled yet"
                message="Add students to give them access to this course."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="table-header">Student</th>
                      <th className="table-header text-center">Progress</th>
                      <th className="table-header text-right w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {enrollments.map((en) => (
                      <tr key={en.id} className="hover:bg-gray-50">
                        <td className="table-cell font-medium text-gray-900">{en.student_name || '—'}</td>
                        <td className="table-cell text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-24 bg-gray-100 rounded-full h-2 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${en.progress_percent >= 90 ? 'bg-green-500' : en.progress_percent >= 50 ? 'bg-indigo-500' : 'bg-amber-500'}`}
                                style={{ width: `${en.progress_percent}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-600 w-24 text-left">
                              {en.lessons_completed}/{en.lessons_total} ({en.progress_percent}%)
                            </span>
                          </div>
                        </td>
                        <td className="table-cell text-right">
                          <button onClick={() => unenroll(en)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50" title="Unenroll">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Lesson modal */}
        <Modal
          isOpen={lessonModalOpen}
          onClose={() => setLessonModalOpen(false)}
          title={editingLesson ? 'Edit lesson' : 'Add lesson'}
          size="md"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
              <input
                type="text"
                value={lessonForm.title}
                onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })}
                className="input-field"
                placeholder="e.g. Lesson 3 — Raag Yaman"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">YouTube URL *</label>
              <input
                type="url"
                value={lessonForm.video_url}
                onChange={(e) => setLessonForm({ ...lessonForm, video_url: e.target.value })}
                className="input-field"
                placeholder="https://youtu.be/..."
              />
              <p className="text-xs text-gray-400 mt-1">Paste an unlisted YouTube link. Public links work too.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Duration (seconds, optional)</label>
              <input
                type="number"
                value={lessonForm.duration_seconds}
                onChange={(e) => setLessonForm({ ...lessonForm, duration_seconds: e.target.value })}
                className="input-field"
                placeholder="0 = auto-detect when first played"
                min="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
              <textarea
                value={lessonForm.description}
                onChange={(e) => setLessonForm({ ...lessonForm, description: e.target.value })}
                className="input-field resize-none font-mono text-sm"
                rows={6}
                placeholder={'Add lines like:\n0:00 Introduction\n2:30 Vocal warm-up\n5:45 Raag Yaman alaap'}
              />
              <p className="text-xs text-gray-400 mt-1">
                Lines that start with a timestamp (e.g. <span className="font-mono">0:00 Introduction</span>) become clickable chapter markers in the parent's player.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button onClick={() => setLessonModalOpen(false)} className="btn-secondary btn-sm">Cancel</button>
              <button onClick={saveLesson} className="btn-primary btn-sm">
                {editingLesson ? 'Save' : 'Add lesson'}
              </button>
            </div>
          </div>
        </Modal>

        {/* Enroll modal */}
        <Modal
          isOpen={enrollModalOpen}
          onClose={() => setEnrollModalOpen(false)}
          title={`Enroll students — ${selectedCourse.name}`}
          size="md"
        >
          <div className="space-y-3">
            {unenrolledStudents.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">All active students are already enrolled.</p>
            ) : (
              <>
                <p className="text-sm text-gray-500">Select students to enroll. Already-enrolled students aren't shown.</p>
                <div className="max-h-72 overflow-y-auto border border-gray-200 rounded-lg">
                  {unenrolledStudents.map((s) => {
                    const checked = enrollSelection.includes(String(s.id));
                    return (
                      <label key={s.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b last:border-b-0 border-gray-100">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const sid = String(s.id);
                            setEnrollSelection((prev) => e.target.checked ? [...prev, sid] : prev.filter((x) => x !== sid));
                          }}
                          className="w-4 h-4 text-indigo-600 rounded"
                        />
                        <span className="text-sm text-gray-800">{s.name}</span>
                        <span className="text-xs text-gray-400 ml-auto">{s.parent_name}</span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button onClick={() => setEnrollModalOpen(false)} className="btn-secondary btn-sm">Cancel</button>
              <button onClick={saveEnrollments} className="btn-primary btn-sm" disabled={enrollSelection.length === 0}>
                Enroll {enrollSelection.length > 0 && `(${enrollSelection.length})`}
              </button>
            </div>
          </div>
        </Modal>

        <CourseModal
          isOpen={courseModalOpen}
          onClose={() => setCourseModalOpen(false)}
          form={courseForm}
          setForm={setCourseForm}
          onSave={saveCourse}
          isEdit={!!editingCourse}
        />
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Video className="w-5 h-5 text-indigo-600" /> Courses
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Organize video lessons into courses. Enroll students to give them access.
          </p>
        </div>
        <button onClick={openCreateCourse} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" /> New course
        </button>
      </div>

      {courses.length === 0 ? (
        <EmptyState
          icon={Video}
          title="No courses yet"
          message="Create your first course to start adding lessons."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map((c) => (
            <button
              key={c.id}
              onClick={() => { setSelectedCourse(c); setTab('lessons'); }}
              className="card text-left hover:border-indigo-300 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-semibold text-gray-900">{c.name}</h3>
                <PlayCircle className="w-5 h-5 text-indigo-500 flex-shrink-0" />
              </div>
              {c.description && (
                <p className="text-xs text-gray-500 line-clamp-2">{c.description}</p>
              )}
            </button>
          ))}
        </div>
      )}

      <CourseModal
        isOpen={courseModalOpen}
        onClose={() => setCourseModalOpen(false)}
        form={courseForm}
        setForm={setCourseForm}
        onSave={saveCourse}
        isEdit={!!editingCourse}
      />
    </div>
  );
}

function CourseModal({ isOpen, onClose, form, setForm, onSave, isEdit }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? 'Edit course' : 'New course'} size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="input-field"
            placeholder="e.g. Beginner Carnatic Vocals"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="input-field resize-none"
            rows={3}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button onClick={onClose} className="btn-secondary btn-sm">Cancel</button>
          <button onClick={onSave} className="btn-primary btn-sm">
            {isEdit ? 'Save' : 'Create course'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
