// Parent/student portal — Question Papers (read-only). Lists papers the
// academy has shared; each opens its PDF / Drive link in a new tab.

import { useState, useEffect } from 'react';
import { FileText, ExternalLink, Tag } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import Loader from '../../components/Loader';
import EmptyState from '../../components/EmptyState';

export default function PortalQuestionPapers() {
  const [papers, setPapers] = useState([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {papers.map((p) => (
        <a
          key={p.id}
          href={p.link}
          target="_blank"
          rel="noopener noreferrer"
          className="card hover:shadow-md transition-shadow group"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-rose-100 flex items-center justify-center flex-shrink-0">
              <FileText className="w-5 h-5 text-rose-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium text-gray-900 truncate group-hover:text-indigo-600">{p.title}</h3>
                <ExternalLink className="w-4 h-4 text-gray-300 group-hover:text-indigo-500 flex-shrink-0" />
              </div>
              {p.category && (
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 mt-1">
                  <Tag className="w-3 h-3" /> {p.category}
                </span>
              )}
              {p.description && <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{p.description}</p>}
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}
