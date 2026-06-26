import { useState } from 'react';
import { X, Video, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';

// Paste a meeting link (any platform) and push it to a class's students. Saves
// the link on the class (so the portal Join button updates) and sends an in-app
// notification rendered from the editable `online_meeting` template.
//
// Props:
//   classObj  — { id, name, meeting_link? } (required)
//   students  — optional [{ id, name }]. When provided, shows per-student
//               checkboxes (all selected by default) so you can send to a
//               subset. When omitted, sends to the whole class roster.
//   onClose(didSend) — called on cancel (false) or success (true).
export default function ShareMeetingLinkDialog({ open, onClose, classObj, students }) {
  const [link, setLink] = useState(classObj?.meeting_link || '');
  const [selected, setSelected] = useState(() => new Set((students || []).map((s) => String(s.id))));
  const [sending, setSending] = useState(false);

  if (!open || !classObj) return null;

  const toggle = (id) => {
    setSelected((prev) => {
      const n = new Set(prev);
      const k = String(id);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  };

  const send = async () => {
    const url = link.trim();
    if (!url) { toast.error('Paste a meeting link first'); return; }
    if (students && students.length && selected.size === 0) { toast.error('Select at least one student'); return; }
    setSending(true);
    try {
      const body = { meeting_link: url };
      if (students && students.length) body.student_ids = [...selected];
      const r = await api.post(`/classes/${classObj.id}/share-link`, body);
      toast.success(`Link sent to ${r.notified} student${r.notified === 1 ? '' : 's'}`);
      onClose(true);
    } catch (e) {
      toast.error(e.message || 'Failed to send link');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" onClick={() => onClose(false)}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <Video className="w-5 h-5 text-indigo-600" />
          <h3 className="text-base font-semibold text-gray-900">Send meeting link</h3>
          <button onClick={() => onClose(false)} aria-label="Close" className="ml-auto p-1.5 rounded-md text-gray-400 hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {classObj.name ? `${classObj.name} — ` : ''}paste your Zoom / Meet / Jitsi link. Students get a push with the link, and the portal Join button updates.
        </p>

        <input
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://..."
          className="mt-3 w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm text-gray-900"
        />

        {students && students.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-gray-500 mb-1">Send to</p>
            <div className="max-h-40 overflow-auto rounded-lg border border-gray-200 p-2 space-y-1">
              {students.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={selected.has(String(s.id))} onChange={() => toggle(s.id)} />
                  {s.name || `Student ${s.id}`}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => onClose(false)} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
          <button
            onClick={send}
            disabled={sending}
            className="px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            <Send className="w-4 h-4" />
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
