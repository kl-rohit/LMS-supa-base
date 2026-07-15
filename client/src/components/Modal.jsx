import { useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';

// Pass `onSave` to render a sticky footer with Cancel (bottom-left) and a
// primary Save/Update button (bottom-right) — the standard dialog layout, so
// the action lives where users expect it. `saving` shows a spinner + disables
// it; `saveLabel` sets the text (e.g. "Update" when editing). `cancelLabel`
// overrides the "Cancel" text.
export default function Modal({ isOpen, onClose, title, children, size = 'md', onSave, saveLabel = 'Save', cancelLabel = 'Cancel', saving = false, saveDisabled = false }) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 animate-fade" onClick={onClose} />
      <div
        className={`relative bg-white rounded-xl shadow-xl w-full ${sizeClasses[size]} max-h-[90vh] flex flex-col animate-in`}
      >
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 truncate">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-gray-100 transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <div className="px-6 py-4 overflow-y-auto scrollbar-thin">{children}</div>
        {onSave && (
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 flex-shrink-0">
            <button type="button" onClick={onClose} className="btn-secondary btn-sm">
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || saveDisabled}
              className="btn-primary btn-sm disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? 'Saving…' : saveLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
