// Shared "who is this for?" picker, reused by the Assignment and Question Paper
// modals. Everyone / A group / Specific students (multi-select, searchable).
// Controlled: value = { target_type, target_id, target_ids }, onChange gets the
// full next value. Theme-safe — base classes auto-invert in dark mode (index.css),
// no `dark:` variants.

import { useState } from 'react';
import { Users, UsersRound, UserRound, Search, Check, Plus } from 'lucide-react';
import QuickCreateModal from './QuickCreateModal';

const MODES = [
  { key: 'all', label: 'Everyone', icon: Users },
  { key: 'group', label: 'A group', icon: UsersRound },
  { key: 'students', label: 'Specific students', icon: UserRound },
];

// onCreateStudent / onCreateGroup: optional. When supplied, an inline "New"
// button appears so the admin can create the missing student/group without
// leaving this picker. The callback receives the created record and should
// re-fetch the parent's students/groups list so it shows up here. The picker
// selects the new record immediately regardless.
export default function TargetPicker({ value, groups = [], students = [], onChange, label = 'Assign to', onCreateStudent, onCreateGroup }) {
  const target_type = value?.target_type || 'all';
  const target_id = value?.target_id || '';
  const target_ids = Array.isArray(value?.target_ids) ? value.target_ids : [];
  const [q, setQ] = useState('');
  const [quickStudent, setQuickStudent] = useState(false);
  const [quickGroup, setQuickGroup] = useState(false);

  const set = (patch) => onChange({ target_type, target_id, target_ids, ...patch });
  const ids = new Set(target_ids.map(String));

  const toggle = (id) => {
    const next = new Set(ids);
    const k = String(id);
    if (next.has(k)) next.delete(k); else next.add(k);
    set({ target_ids: [...next] });
  };

  // Bulk-add a whole group's current members into the specific-students list.
  // A snapshot (not dynamic) — you can then add more groups or hand-pick extras
  // and remove anyone. Groups can be added one after another (they merge).
  const addGroup = (groupId) => {
    if (!groupId) return;
    const g = groups.find((x) => String(x.id) === String(groupId));
    if (!g) return;
    const valid = new Set(students.map((s) => String(s.id)));
    const memberIds = (g.members || []).map(String).filter((id) => valid.has(id));
    const next = new Set(target_ids.map(String));
    memberIds.forEach((id) => next.add(id));
    set({ target_ids: [...next] });
  };

  const filtered = q
    ? students.filter((s) => (s.name || '').toLowerCase().includes(q.toLowerCase()))
    : students;

  const handleQuickStudent = (student) => {
    if (student?.id) set({ target_ids: [...new Set([...target_ids.map(String), String(student.id)])] });
    onCreateStudent?.(student);
  };

  const handleQuickGroup = (group) => {
    if (group?.id) set({ target_id: String(group.id) });
    onCreateGroup?.(group);
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      <div className="grid grid-cols-3 gap-2 mb-2">
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = target_type === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => set({ target_type: m.key, target_id: '', target_ids: m.key === 'students' ? target_ids : [] })}
              className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg border-2 text-xs transition-colors ${active ? 'border-indigo-500 bg-indigo-50 text-indigo-900' : 'border-gray-200 text-gray-600 hover:border-indigo-300'}`}
            >
              <Icon className="w-4 h-4" /> {m.label}
            </button>
          );
        })}
      </div>

      {target_type === 'group' && (
        <div className="flex items-center gap-2">
          <select value={target_id} onChange={(e) => set({ target_id: e.target.value })} className="input-field flex-1" required>
            <option value="">Select a group…</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.member_count || 0})</option>)}
          </select>
          {onCreateGroup && (
            <button type="button" onClick={() => setQuickGroup(true)} className="btn-secondary btn-sm flex-shrink-0 whitespace-nowrap">
              <Plus className="w-3.5 h-3.5" /> New
            </button>
          )}
        </div>
      )}

      {target_type === 'students' && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            {groups.length > 0 && (
              <select value="" onChange={(e) => addGroup(e.target.value)} className="input-field text-sm flex-1">
                <option value="">+ Add a whole group…</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.member_count ?? (g.members ? g.members.length : 0)})</option>)}
              </select>
            )}
            {onCreateStudent && (
              <button type="button" onClick={() => setQuickStudent(true)} className={`btn-secondary btn-sm flex-shrink-0 whitespace-nowrap ${groups.length > 0 ? '' : 'ml-auto'}`}>
                <Plus className="w-3.5 h-3.5" /> New student
              </button>
            )}
          </div>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
            <Search className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search students…"
              className="w-full bg-transparent text-sm focus:outline-none"
            />
            <span className="text-xs text-gray-400 shrink-0">{ids.size} selected</span>
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 px-2 py-3 text-center">No students found</p>
            ) : filtered.map((s) => {
              const on = ids.has(String(s.id));
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left ${on ? 'bg-indigo-50 text-indigo-900' : 'text-gray-700 hover:bg-gray-50'}`}
                >
                  <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'}`}>
                    {on && <Check className="w-3 h-3 text-white" />}
                  </span>
                  {s.name}
                </button>
              );
            })}
          </div>
          </div>
        </div>
      )}

      {onCreateStudent && (
        <QuickCreateModal
          type="student"
          isOpen={quickStudent}
          onClose={() => setQuickStudent(false)}
          onCreated={handleQuickStudent}
        />
      )}
      {onCreateGroup && (
        <QuickCreateModal
          type="group"
          isOpen={quickGroup}
          onClose={() => setQuickGroup(false)}
          onCreated={handleQuickGroup}
        />
      )}
    </div>
  );
}
