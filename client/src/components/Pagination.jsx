// Reusable client-side pagination.
//
// Every list page already loads its full dataset and filters it in memory,
// so pagination here is purely a display concern: slice the filtered array
// and render a compact control underneath. Two pieces:
//
//   usePagination(items, pageSize)  -> { page, setPage, pageCount, pageItems, total, from, to, pageSize }
//   <Pagination ... />              -> the control bar (auto-hides on a single page)
//
// The hook auto-clamps the page when the list shrinks (search/filter change)
// so you never end up stranded on an empty page 4 after filtering down to 8 rows.

import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const DEFAULT_PAGE_SIZE = 25;

export function usePagination(items, pageSize = DEFAULT_PAGE_SIZE) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const [page, setPage] = useState(1);

  // Clamp when the underlying list changes size (e.g. a filter narrows it).
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return list.slice(start, start + pageSize);
  }, [list, page, pageSize]);

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return { page, setPage, pageCount, pageItems, total, from, to, pageSize };
}

// Build a compact page-number sequence with ellipses, e.g. 1 … 4 5 [6] 7 8 … 20
function pageWindow(page, pageCount) {
  const pages = [];
  const push = (p) => pages.push(p);
  const window = 1; // neighbours on each side of current
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || (p >= page - window && p <= page + window)) {
      push(p);
    } else if (pages[pages.length - 1] !== '…') {
      push('…');
    }
  }
  return pages;
}

export default function Pagination({ page, pageCount, setPage, from, to, total, label = 'items', className = '' }) {
  // Nothing to page through — keep the row count line but hide the controls.
  const single = pageCount <= 1;
  const go = (p) => setPage(Math.min(pageCount, Math.max(1, p)));

  return (
    <div className={`px-4 py-3 bg-gray-50 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 ${className}`}>
      <span className="text-sm text-gray-500">
        {total === 0
          ? `No ${label}`
          : <>Showing <span className="font-medium text-gray-700">{from}</span>–<span className="font-medium text-gray-700">{to}</span> of <span className="font-medium text-gray-700">{total}</span> {label}</>}
      </span>

      {!single && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => go(page - 1)}
            disabled={page <= 1}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {pageWindow(page, pageCount).map((p, idx) =>
            p === '…' ? (
              <span key={`gap-${idx}`} className="w-8 h-8 inline-flex items-center justify-center text-gray-400 text-sm select-none">…</span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => go(p)}
                aria-current={p === page ? 'page' : undefined}
                className={`inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-md text-sm font-medium transition-colors ${
                  p === page
                    ? 'bg-indigo-600 text-white'
                    : 'border border-gray-200 text-gray-600 hover:bg-white'
                }`}
              >
                {p}
              </button>
            )
          )}

          <button
            type="button"
            onClick={() => go(page + 1)}
            disabled={page >= pageCount}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
