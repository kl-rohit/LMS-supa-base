// Parent/student portal — Question Papers (read-only). Lists papers the
// academy has shared; each opens in an in-app embedded viewer (no redirect to
// Google Drive — same approach as course documents in CoursePlayer).

import { useState, useEffect } from 'react';
import { FileText, Eye, Tag, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import Loader from '../../components/Loader';
import EmptyState from '../../components/EmptyState';
import { driveEmbedUrl } from '../../utils/youtube';

export default function PortalQuestionPapers() {
  const [papers, setPapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null); // paper open in the embedded viewer

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get('/portal/question-papers');
        if (!cancelled) setPapers(data.papers || []);
      } catch {
        if (!cancelled) toast.error('Failed to load question papers');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Loader text="Loading question papers..." />;

  if (papers.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No question papers yet"
        message="When your teacher shares past papers or practice sets, they'll appear here."
      />
    );
  }

  // Prefer Drive's in-app preview embed; fall back to the raw link for anything
  // that isn't a Drive file (best-effort embed, still no redirect).
  const embedUrl = viewing ? (driveEmbedUrl(viewing.link) || viewing.link) : null;

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {papers.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setViewing(p)}
            className="card hover:shadow-md transition-shadow group text-left w-full"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-rose-100 flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5 text-rose-600" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium text-gray-900 truncate group-hover:text-indigo-600">{p.title}</h3>
                  <Eye className="w-4 h-4 text-gray-300 group-hover:text-indigo-500 flex-shrink-0" />
                </div>
                {p.category && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 mt-1">
                    <Tag className="w-3 h-3" /> {p.category}
                  </span>
                )}
                {p.description && <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{p.description}</p>}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* In-app viewer — embeds the paper so the student never leaves for Drive */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/70" onClick={() => setViewing(null)}>
          <div
            className="flex items-center justify-between gap-3 px-4 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-5 h-5 text-rose-600 shrink-0" />
              <h3 className="font-medium text-gray-900 dark:text-white truncate">{viewing.title}</h3>
            </div>
            <button
              onClick={() => setViewing(null)}
              className="text-gray-400 hover:text-gray-600 shrink-0"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 bg-gray-100 dark:bg-gray-950" onClick={(e) => e.stopPropagation()}>
            {embedUrl ? (
              <iframe
                src={embedUrl}
                title={viewing.title}
                className="w-full h-full border-0"
                allowFullScreen
              />
            ) : (
              <div className="p-6 text-sm text-gray-500">This paper can't be previewed.</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
