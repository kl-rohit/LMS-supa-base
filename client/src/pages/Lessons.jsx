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
  Scissors,
  FolderTree,
  GripVertical,
  FileText,
  ListChecks,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import Tooltip from '../components/Tooltip';
import QuizEditor from '../components/QuizEditor';
import TargetPicker from '../components/TargetPicker';
import { useConfirm } from '../contexts/ConfirmContext';
import { extractYouTubeId, ytThumbnail, formatDuration, parseTimeString, parseChapters, extractDriveId } from '../utils/youtube';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Sortable lesson row — wraps the lesson card in @dnd-kit's useSortable.
// The drag handle (grip icon) is the only element that initiates drag;
// the rest of the row stays clickable.
function SortableLessonRow({ lesson, displayIdx, onEdit, onDelete, onQuiz }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lesson.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };
  const type = lesson.content_type || 'video';
  const isDoc = type === 'document';
  const isQuiz = type === 'quiz';
  const ytId = isDoc || isQuiz ? null : extractYouTubeId(lesson.video_url);
  const hasSegment = !isDoc && !isQuiz && ((lesson.start_seconds || 0) > 0 || (lesson.end_seconds || 0) > 0);
  const openUrl = isDoc ? lesson.content_url : lesson.video_url;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className="flex items-center gap-2 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 bg-white"
    >
      <button
        {...listeners}
        className="p-1 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
        title="Drag to reorder"
        aria-label="Drag to reorder"
        type="button"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="text-sm font-semibold text-gray-400 w-6">{displayIdx + 1}.</div>
      {ytId ? (
        <img src={ytThumbnail(ytId)} alt="" className="w-24 h-14 rounded object-cover flex-shrink-0 hidden sm:block" loading="lazy" />
      ) : isQuiz ? (
        <div className="w-24 h-14 rounded bg-indigo-50 items-center justify-center flex-shrink-0 hidden sm:flex">
          <ListChecks className="w-6 h-6 text-indigo-500" />
        </div>
      ) : (
        <div className="w-24 h-14 rounded bg-blue-50 items-center justify-center flex-shrink-0 hidden sm:flex">
          <FileText className="w-6 h-6 text-blue-500" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-gray-900 truncate flex items-center gap-2">
          {lesson.title}
          {isDoc && (
            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-normal">PDF</span>
          )}
          {isQuiz && (
            <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full font-normal inline-flex items-center gap-1">
              <ListChecks className="w-3 h-3" /> Quiz
            </span>
          )}
          {isQuiz && lesson.quiz_required && (
            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-normal">Required</span>
          )}
        </p>
        <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
          {isQuiz ? (
            <span>
              {lesson.quiz_count > 0
                ? `${lesson.quiz_count} question${lesson.quiz_count === 1 ? '' : 's'}`
                : 'No questions yet — click the list icon to add'}
            </span>
          ) : (
            <>
              {hasSegment && (
                <span className="font-mono text-indigo-600">
                  {formatDuration(lesson.start_seconds || 0)}–{lesson.end_seconds ? formatDuration(lesson.end_seconds) : 'end'}
                </span>
              )}
              {!hasSegment && !isDoc && lesson.duration_seconds > 0 && <span>{formatDuration(lesson.duration_seconds)}</span>}
              <a href={openUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 ${isDoc ? 'text-blue-600 hover:text-blue-700' : 'text-red-600 hover:text-red-700'}`}>
                {isDoc ? <FileText className="w-3 h-3" /> : <Youtube className="w-3 h-3" />} Open
              </a>
            </>
          )}
        </p>
      </div>
      {isQuiz && (
        <button
          onClick={() => onQuiz(lesson)}
          className={`p-1.5 rounded relative flex-shrink-0 ${
            lesson.quiz_count > 0
              ? 'text-indigo-600 hover:bg-indigo-50'
              : 'text-amber-600 hover:bg-amber-50 animate-pulse'
          }`}
          title={lesson.quiz_count > 0 ? `Edit questions (${lesson.quiz_count})` : 'Add questions'}
          type="button"
        >
          <ListChecks className="w-4 h-4" />
          {lesson.quiz_count > 0 && (
            <span className="absolute -top-1 -right-1 bg-indigo-600 text-white text-[10px] leading-none font-semibold rounded-full min-w-[14px] h-[14px] px-1 flex items-center justify-center">
              {lesson.quiz_count}
            </span>
          )}
        </button>
      )}
      <button onClick={() => onEdit(lesson)} className="p-1.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50" title="Edit" type="button">
        <Edit2 className="w-4 h-4" />
      </button>
      <button onClick={() => onDelete(lesson)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50" title="Delete" type="button">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

const blankCourse = { name: '', description: '', thumbnail_url: '' };
const blankLesson = {
  title: '',
  description: '',
  content_type: 'video',  // 'video' | 'document' | 'quiz'
  video_url: '',
  content_url: '',         // Drive URL for document-type lessons
  duration_seconds: 0,
  section_name: '',
  start_seconds_str: '',
  end_seconds_str: '',
  quiz_required: false,    // quiz lessons only — gates the certificate
  quiz_shuffle: false,     // quiz lessons only — randomise question + option order
};

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

  // Quiz authoring modal — holds the quiz lesson whose questions are edited.
  const [quizLesson, setQuizLesson] = useState(null);

  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  // Audience for enrolling — shared TargetPicker shape. Defaults to hand-pick.
  const [enrollTarget, setEnrollTarget] = useState({ target_type: 'students', target_id: '', target_ids: [] });
  const [groups, setGroups] = useState([]);

  // Split-video-into-chapter-lessons modal state
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [splitForm, setSplitForm] = useState({
    section_name: '',
    video_url: '',
    chapters_text: '',
  });

  // Drag-and-drop sensors. PointerSensor (8px drag distance threshold) for
  // mouse; TouchSensor (250ms long-press) for mobile; Keyboard for a11y.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // On drag end: reorder local list, infer new section_name from neighbors,
  // push the new order to the backend.
  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = lessons.findIndex((l) => String(l.id) === String(active.id));
    const newIdx = lessons.findIndex((l) => String(l.id) === String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;

    const moved = arrayMove(lessons, oldIdx, newIdx);

    // Infer section_name for the moved lesson based on its new neighbors.
    const movedIdx = moved.findIndex((l) => String(l.id) === String(active.id));
    const prev = moved[movedIdx - 1];
    const next = moved[movedIdx + 1];
    let newSection = moved[movedIdx].section_name || '';
    if (prev && next && (prev.section_name || '') === (next.section_name || '')) {
      newSection = prev.section_name || '';
    } else if (prev) {
      newSection = prev.section_name || '';
    } else if (next) {
      newSection = next.section_name || '';
    }
    moved[movedIdx] = { ...moved[movedIdx], section_name: newSection };

    // Optimistic UI update
    setLessons(moved);

    // Send the new order to backend (one update per lesson — small N)
    const updates = moved.map((l, i) => ({
      id: l.id,
      order_index: i + 1,
      section_name: String(l.id) === String(active.id) ? newSection : (l.section_name || ''),
    }));
    api.post('/lessons/reorder', { updates }).catch((err) => {
      toast.error('Reorder failed: ' + err.message);
      // Revert by refetching
      fetchCourseDetail(selectedCourse.id);
    });
  };

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
      content_type: l.content_type || 'video',
      video_url: l.video_url || '',
      content_url: l.content_url || '',
      duration_seconds: l.duration_seconds || 0,
      section_name: l.section_name || '',
      start_seconds_str: l.start_seconds ? formatDuration(l.start_seconds) : '',
      end_seconds_str: l.end_seconds ? formatDuration(l.end_seconds) : '',
      quiz_required: !!l.quiz_required,
      quiz_shuffle: !!l.quiz_shuffle,
    });
    setLessonModalOpen(true);
  };
  const saveLesson = async () => {
    if (!lessonForm.title.trim()) {
      toast.error('Title is required');
      return;
    }
    const isDoc = lessonForm.content_type === 'document';
    const isQuiz = lessonForm.content_type === 'quiz';

    // Quiz lessons carry no URL — questions are authored separately.
    if (!isQuiz) {
      const url = isDoc ? lessonForm.content_url.trim() : lessonForm.video_url.trim();
      if (!url) {
        toast.error(isDoc ? 'Drive URL is required' : 'YouTube URL is required');
        return;
      }
      if (isDoc) {
        if (!extractDriveId(url)) {
          toast.error("Doesn't look like a valid Google Drive URL");
          return;
        }
      } else if (!extractYouTubeId(url)) {
        toast.error("Doesn't look like a valid YouTube URL");
        return;
      }
    }

    const url = isQuiz ? '' : (isDoc ? lessonForm.content_url.trim() : lessonForm.video_url.trim());
    const start = (isDoc || isQuiz) ? 0 : parseTimeString(lessonForm.start_seconds_str);
    const end   = (isDoc || isQuiz) ? 0 : parseTimeString(lessonForm.end_seconds_str);
    if (end > 0 && start >= end) {
      toast.error('End time must be after start time');
      return;
    }
    const payload = {
      title: lessonForm.title,
      description: lessonForm.description,
      content_type: lessonForm.content_type,
      video_url: (isDoc || isQuiz) ? '' : url,
      content_url: isDoc ? url : '',
      duration_seconds: (isDoc || isQuiz) ? 0 : (Number(lessonForm.duration_seconds) || 0),
      section_name: lessonForm.section_name.trim(),
      start_seconds: start,
      end_seconds: end,
    };
    // Only quiz lessons send quiz_required (gates the certificate) and the
    // shuffle flag (randomise question + option order per student).
    if (isQuiz) {
      payload.quiz_required = !!lessonForm.quiz_required;
      payload.quiz_shuffle = !!lessonForm.quiz_shuffle;
    }
    try {
      if (editingLesson) {
        await api.put(`/lessons/${editingLesson.id}`, payload);
        toast.success('Lesson updated');
      } else {
        const resp = await api.post('/lessons', { ...payload, course_id: String(selectedCourse.id) });
        toast.success('Lesson added');
        // For a brand-new quiz lesson, jump straight into authoring questions.
        if (isQuiz && resp?.lesson) {
          setLessonModalOpen(false);
          await fetchCourseDetail(selectedCourse.id);
          setQuizLesson(resp.lesson);
          return;
        }
      }
      setLessonModalOpen(false);
      fetchCourseDetail(selectedCourse.id);
    } catch (err) {
      toast.error('Failed: ' + err.message);
    }
  };
  // Parse the pasted chapter text and build a Lesson per chapter, all sharing
  // the same video URL. The chapter's start = its timestamp, end = the next
  // chapter's timestamp (or 0 for the last one = until end of video).
  const splitPreview = () => {
    const chapters = parseChapters(splitForm.chapters_text);
    return chapters.map((c, i) => {
      const next = chapters[i + 1];
      return {
        title: c.title,
        start_seconds: c.start,
        end_seconds: next ? next.start : 0, // 0 = play to end
      };
    });
  };

  const handleSplit = async () => {
    if (!splitForm.video_url.trim()) { toast.error('Video URL is required'); return; }
    if (!extractYouTubeId(splitForm.video_url)) { toast.error('Invalid YouTube URL'); return; }
    const preview = splitPreview();
    if (preview.length === 0) {
      toast.error('No chapters detected. Paste lines like "0:00 Introduction"');
      return;
    }
    const lessons = preview.map((p) => ({
      title: p.title,
      video_url: splitForm.video_url.trim(),
      section_name: splitForm.section_name.trim(),
      start_seconds: p.start_seconds,
      end_seconds: p.end_seconds,
    }));
    try {
      const resp = await api.post('/lessons/bulk', {
        course_id: String(selectedCourse.id),
        lessons,
      });
      toast.success(`Created ${resp.count} lesson(s)`);
      setSplitModalOpen(false);
      setSplitForm({ section_name: '', video_url: '', chapters_text: '' });
      fetchCourseDetail(selectedCourse.id);
    } catch (err) {
      toast.error('Failed: ' + err.message);
    }
  };

  // ----- Quiz authoring -----
  const openQuiz = (l) => setQuizLesson(l);
  // QuizEditor reports its current persisted question count so we can keep the
  // badge on the lesson row in sync without refetching the whole course.
  const handleQuizCount = (count) => {
    if (!quizLesson) return;
    setLessons((prev) => prev.map((l) => (String(l.id) === String(quizLesson.id) ? { ...l, quiz_count: count } : l)));
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
    setEnrollTarget({ target_type: 'students', target_id: '', target_ids: [] });
    setEnrollModalOpen(true);
    // Load groups lazily for the picker (one read, only when needed).
    if (groups.length === 0) {
      api.get('/groups').then((r) => setGroups(r.groups || [])).catch(() => {});
    }
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
    // Build the request from the picker. Everyone / a Group resolve on the
    // server (shared audience resolver); Specific students send the picked ids.
    let body;
    if (enrollTarget.target_type === 'all') body = { target_type: 'all' };
    else if (enrollTarget.target_type === 'group') { if (!enrollTarget.target_id) { toast.error('Pick a group'); return; } body = { target_type: 'group', target_id: String(enrollTarget.target_id) }; }
    else { if (!enrollTarget.target_ids?.length) return; body = { target_type: 'students', target_ids: enrollTarget.target_ids.map(String) }; }
    try {
      const resp = await api.post('/enrollments', { course_id: String(selectedCourse.id), ...body });
      toast.success(resp.count > 0 ? `Enrolled ${resp.count} student${resp.count === 1 ? '' : 's'}` : 'Everyone in that audience is already enrolled');
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
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'lessons' ? 'bg-indigo-100 text-gray-900 dark:bg-indigo-600 dark:text-white' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Lessons ({lessons.length})
          </button>
          <button
            onClick={() => setTab('enrollments')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'enrollments' ? 'bg-indigo-100 text-gray-900 dark:bg-indigo-600 dark:text-white' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Enrollments ({enrollments.length})
          </button>
        </div>

        {tab === 'lessons' && (
          <div className="card">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="font-semibold text-gray-900">Lessons</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSplitModalOpen(true)}
                  className="btn-secondary btn-sm"
                  title="Split one video into multiple chapter-lessons"
                >
                  <Scissors className="w-4 h-4" /> Split video
                </button>
                <button onClick={openCreateLesson} className="btn-primary btn-sm">
                  <Plus className="w-4 h-4" /> Add lesson
                </button>
              </div>
            </div>
            {lessons.length === 0 ? (
              <EmptyState
                icon={Video}
                title="No lessons yet"
                message="Add your first lesson — paste a YouTube unlisted URL. Or use 'Split video' if you have one video to break into chapters."
              />
            ) : (
              <>
                <p className="text-xs text-gray-400 mb-3 px-1">
                  Drag the <GripVertical className="inline w-3.5 h-3.5 -mt-0.5" /> handle to reorder. Cross-section drag updates the section automatically.
                </p>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={lessons.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                      {lessons.map((l, idx) => {
                        // Show section header at the start of each new section
                        const prevSection = idx > 0 ? (lessons[idx - 1].section_name || '') : null;
                        const thisSection = l.section_name || '';
                        const showHeader = thisSection && thisSection !== prevSection;
                        // Section-local index = position within its section (1-based)
                        let sectionLocalIdx = idx;
                        for (let i = idx - 1; i >= 0; i--) {
                          if ((lessons[i].section_name || '') !== thisSection) { sectionLocalIdx = idx - i - 1; break; }
                          if (i === 0) { sectionLocalIdx = idx; break; }
                        }
                        return (
                          <div key={l.id}>
                            {showHeader && (
                              <div className="flex items-center gap-2 mt-4 mb-2 pl-1">
                                <FolderTree className="w-4 h-4 text-indigo-500" />
                                <span className="text-sm font-semibold text-gray-700">{thisSection}</span>
                              </div>
                            )}
                            <SortableLessonRow
                              lesson={l}
                              displayIdx={sectionLocalIdx}
                              onEdit={openEditLesson}
                              onDelete={deleteLesson}
                              onQuiz={openQuiz}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
              </>
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
              <>
              <div className="overflow-x-auto hidden md:block">
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
              {/* Mobile: stacked cards instead of a side-scrolling table */}
              <div className="md:hidden space-y-2">
                {enrollments.map((en) => (
                  <div key={en.id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-900 truncate">{en.student_name || '—'}</span>
                      <button onClick={() => unenroll(en)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0" title="Unenroll">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${en.progress_percent >= 90 ? 'bg-green-500' : en.progress_percent >= 50 ? 'bg-indigo-500' : 'bg-amber-500'}`}
                          style={{ width: `${en.progress_percent}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-600 flex-shrink-0">
                        {en.lessons_completed}/{en.lessons_total} ({en.progress_percent}%)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              </>
            )}
          </div>
        )}

        {/* Lesson modal */}
        <Modal
          isOpen={lessonModalOpen}
          onClose={() => setLessonModalOpen(false)}
          title={editingLesson ? 'Edit lesson' : 'Add lesson'}
          size="md"
          onSave={saveLesson}
          saveLabel={editingLesson ? 'Save' : 'Add lesson'}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Lesson type</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={!!editingLesson}
                  onClick={() => setLessonForm({ ...lessonForm, content_type: 'video' })}
                  className={`px-2 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    lessonForm.content_type === 'video'
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                      : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <Youtube className="w-4 h-4 inline -mt-0.5 mr-1" />
                  Video
                </button>
                <button
                  type="button"
                  disabled={!!editingLesson}
                  onClick={() => setLessonForm({ ...lessonForm, content_type: 'document' })}
                  className={`px-2 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    lessonForm.content_type === 'document'
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                      : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <FileText className="w-4 h-4 inline -mt-0.5 mr-1" />
                  Document
                </button>
                <button
                  type="button"
                  disabled={!!editingLesson}
                  onClick={() => setLessonForm({ ...lessonForm, content_type: 'quiz' })}
                  className={`px-2 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    lessonForm.content_type === 'quiz'
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                      : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <ListChecks className="w-4 h-4 inline -mt-0.5 mr-1" />
                  Quiz
                </button>
              </div>
              {editingLesson && (
                <p className="text-xs text-gray-400 mt-1">Lesson type can't be changed after creation.</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
              <input
                type="text"
                value={lessonForm.title}
                onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })}
                className="input-field"
                placeholder={lessonForm.content_type === 'document' ? 'e.g. Raag Yaman — Notation PDF' : 'e.g. Lesson 3 — Raag Yaman'}
                autoFocus
              />
            </div>
            {lessonForm.content_type === 'document' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Google Drive URL *</label>
                <input
                  type="url"
                  value={lessonForm.content_url}
                  onChange={(e) => setLessonForm({ ...lessonForm, content_url: e.target.value })}
                  className="input-field"
                  placeholder="https://drive.google.com/file/d/..."
                />
                <p className="text-xs text-gray-400 mt-1">
                  In Drive: share the file as "Anyone with the link can view".
                  For best privacy, disable download/print/copy in Drive's sharing settings.
                </p>
              </div>
            ) : lessonForm.content_type === 'quiz' ? (
              <div className="space-y-3">
                <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={!!lessonForm.quiz_required}
                    onChange={(e) => setLessonForm({ ...lessonForm, quiz_required: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded mt-0.5"
                  />
                  <span>
                    <span className="text-sm font-medium text-gray-800">Required to earn the certificate</span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                      Students can still skip ahead, but the course certificate won't be issued
                      until this quiz is passed. Leave off for an optional / practice quiz.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={!!lessonForm.quiz_shuffle}
                    onChange={(e) => setLessonForm({ ...lessonForm, quiz_shuffle: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded mt-0.5"
                  />
                  <span>
                    <span className="text-sm font-medium text-gray-800">Shuffle questions &amp; answers</span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                      Each student sees the questions — and the options within each question —
                      in a random order. Discourages copying and rote answer-position memorisation.
                    </span>
                  </span>
                </label>
                <div className="flex items-start gap-2 text-xs text-indigo-700 bg-indigo-50 rounded-lg p-3">
                  <ListChecks className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    {editingLesson
                      ? 'Use the list icon on the lesson row to add or edit questions.'
                      : "After you save, you'll add the questions next."}
                  </span>
                </div>
              </div>
            ) : (
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
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Section (optional)</label>
              <input
                type="text"
                value={lessonForm.section_name}
                onChange={(e) => setLessonForm({ ...lessonForm, section_name: e.target.value })}
                className="input-field"
                placeholder="e.g. Introduction, Practice, Advanced"
                list="section-suggestions"
              />
              {/* Suggest existing section names from current course lessons */}
              <datalist id="section-suggestions">
                {[...new Set(lessons.map((l) => l.section_name).filter(Boolean))].map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <p className="text-xs text-gray-400 mt-1">Lessons with the same section group together in the parent's sidebar.</p>
            </div>

            {lessonForm.content_type === 'video' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start time</label>
                    <input
                      type="text"
                      value={lessonForm.start_seconds_str}
                      onChange={(e) => setLessonForm({ ...lessonForm, start_seconds_str: e.target.value })}
                      className="input-field font-mono"
                      placeholder="0:00 or 150"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">End time</label>
                    <input
                      type="text"
                      value={lessonForm.end_seconds_str}
                      onChange={(e) => setLessonForm({ ...lessonForm, end_seconds_str: e.target.value })}
                      className="input-field font-mono"
                      placeholder="(end of video)"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-400 -mt-2">
                  For a chapter-as-lesson, set start/end to slice a shared video. Leave both blank to use the full video.
                </p>

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
              </>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
              <textarea
                value={lessonForm.description}
                onChange={(e) => setLessonForm({ ...lessonForm, description: e.target.value })}
                className="input-field resize-none font-mono text-sm"
                rows={6}
                placeholder={lessonForm.content_type === 'video'
                  ? 'Add lines like:\n0:00 Introduction\n2:30 Vocal warm-up\n5:45 Raag Yaman alaap'
                  : lessonForm.content_type === 'quiz'
                  ? 'Optional intro shown above the quiz (e.g. "10 questions, 70% to pass").'
                  : 'Optional notes shown with this document.'}
              />
              {lessonForm.content_type === 'video' && (
                <p className="text-xs text-gray-400 mt-1">
                  Lines that start with a timestamp (e.g. <span className="font-mono">0:00 Introduction</span>) become clickable chapter markers in the parent's player.
                </p>
              )}
            </div>
          </div>
        </Modal>

        {/* Enroll modal */}
        <Modal
          isOpen={enrollModalOpen}
          onClose={() => setEnrollModalOpen(false)}
          title={`Enroll students — ${selectedCourse.name}`}
          size="md"
          onSave={saveEnrollments}
          saveDisabled={enrollTarget.target_type === 'students' ? !enrollTarget.target_ids?.length : enrollTarget.target_type === 'group' ? !enrollTarget.target_id : false}
          saveLabel={enrollTarget.target_type === 'all' ? 'Enroll everyone' : enrollTarget.target_type === 'group' ? 'Enroll group' : `Enroll ${enrollTarget.target_ids?.length ? `(${enrollTarget.target_ids.length})` : ''}`}
        >
          <div className="space-y-3">
            {unenrolledStudents.length === 0 && enrollTarget.target_type === 'students' ? (
              <p className="text-sm text-gray-500 text-center py-6">All active students are already enrolled.</p>
            ) : (
              <TargetPicker
                value={enrollTarget}
                groups={groups}
                students={unenrolledStudents}
                onChange={setEnrollTarget}
                label="Enrol which students?"
                onCreateStudent={() => { if (selectedCourse?.id) fetchCourseDetail(selectedCourse.id); }}
                onCreateGroup={() => api.get('/groups').then((r) => setGroups(r.groups || [])).catch(() => {})}
              />
            )}
            {enrollTarget.target_type === 'all' && (
              <p className="text-sm text-gray-500">Enrols every active student who isn't already in this course. Existing enrolments and their progress are untouched.</p>
            )}
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

        {/* Quiz authoring */}
        {quizLesson && (
          <QuizEditor
            lesson={quizLesson}
            onClose={() => setQuizLesson(null)}
            onCountChange={handleQuizCount}
          />
        )}

        {/* Split video into chapter-lessons */}
        <Modal
          isOpen={splitModalOpen}
          onClose={() => setSplitModalOpen(false)}
          title="Split one video into chapter-lessons"
          size="lg"
          onSave={handleSplit}
          saveLabel="Create lessons"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Paste a YouTube URL once. List the chapters below (timestamp + title). Each chapter
              becomes its own Lesson, all sharing the same video URL, in the same Section.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Section name</label>
              <input
                type="text"
                value={splitForm.section_name}
                onChange={(e) => setSplitForm({ ...splitForm, section_name: e.target.value })}
                className="input-field"
                placeholder="e.g. Section 1 — Foundations"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">YouTube URL *</label>
              <input
                type="url"
                value={splitForm.video_url}
                onChange={(e) => setSplitForm({ ...splitForm, video_url: e.target.value })}
                className="input-field"
                placeholder="https://youtu.be/..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Chapters *</label>
              <textarea
                value={splitForm.chapters_text}
                onChange={(e) => setSplitForm({ ...splitForm, chapters_text: e.target.value })}
                className="input-field font-mono text-sm resize-none"
                rows={8}
                placeholder={'0:00 Introduction\n2:30 Vocal warm-up\n5:45 Raag Yaman alaap\n10:00 Practice exercises'}
              />
              <p className="text-xs text-gray-400 mt-1">One line per chapter. Format: <span className="font-mono">timestamp title</span></p>
            </div>

            {/* Preview */}
            {(() => {
              const preview = splitPreview();
              if (preview.length === 0) return null;
              return (
                <div className="border border-indigo-100 bg-indigo-50/50 rounded-lg p-3">
                  <p className="text-xs font-semibold text-indigo-700 mb-2">
                    Preview — will create {preview.length} lesson(s):
                  </p>
                  <div className="space-y-1">
                    {preview.map((p, i) => (
                      <div key={i} className="text-xs text-gray-700 flex items-center gap-2">
                        <span className="font-mono text-indigo-600 w-24">
                          {formatDuration(p.start_seconds)}–{p.end_seconds ? formatDuration(p.end_seconds) : 'end'}
                        </span>
                        <span className="font-medium">{p.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

          </div>
        </Modal>
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
        <button onClick={openCreateCourse} data-tour="lessons-add" className="btn-primary btn-sm">
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
            <div
              key={c.id}
              className="card relative hover:border-indigo-300 hover:shadow-md transition-all"
            >
              <button
                type="button"
                onClick={() => { setSelectedCourse(c); setTab('lessons'); }}
                className="absolute inset-0 z-0 rounded-lg"
                aria-label={`Open ${c.name}`}
              />
              <div className="relative z-10 pointer-events-none">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-gray-900">{c.name}</h3>
                  <PlayCircle className="w-5 h-5 text-indigo-500 flex-shrink-0" />
                </div>
                {c.description && (
                  <p className="text-xs text-gray-500 line-clamp-2">{c.description}</p>
                )}
              </div>
              <div className="relative z-10 mt-3 flex justify-end">
                <Tooltip label="Archive course">
                  <button
                    type="button"
                    onClick={() => deleteCourse(c)}
                    className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    aria-label={`Archive ${c.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </Tooltip>
              </div>
            </div>
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
    <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? 'Edit course' : 'New course'} size="md" onSave={onSave} saveLabel={isEdit ? 'Save' : 'Create course'}>
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
      </div>
    </Modal>
  );
}
