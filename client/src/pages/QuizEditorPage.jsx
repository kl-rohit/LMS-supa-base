// Route wrapper so the quiz editor is deep-linkable at /quizzes/:lessonId/edit.
// QuizEditor is a full-screen overlay component; here we render it as a page and
// send the user back to the quiz's analysis screen on close. The title comes
// from navigation state when available, else a quick fetch.
import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import api from '../utils/api';
import QuizEditor from '../components/QuizEditor';

export default function QuizEditorPage() {
  const { lessonId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [title, setTitle] = useState(location.state?.title || '');

  useEffect(() => {
    if (title) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await api.get(`/quizzes/${lessonId}/detail`);
        if (!cancelled) setTitle(d.quiz?.title || 'Quiz');
      } catch { if (!cancelled) setTitle('Quiz'); }
    })();
    return () => { cancelled = true; };
  }, [lessonId, title]);

  return (
    <QuizEditor
      lesson={{ id: lessonId, title: title || 'Quiz' }}
      onClose={() => navigate(`/quizzes/${lessonId}`)}
    />
  );
}
