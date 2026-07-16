// Reusable "create it right here" modal so admins never have to leave an
// association picker just to add a student or a group. Opens on top of the
// picker it was launched from; on success it returns the freshly-created
// record to the caller (via onCreated) so the picker can auto-select it and
// refresh its own list.
//
// Supported types:
//   'student' — name + parent name + mobile (the backend's required trio)
//   'group'   — name + optional description
//
// Kept intentionally minimal: the full Students / Groups pages still own the
// rich forms. This is the fast path for the one field the admin is missing.

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import api from '../utils/api';

const BLANK = {
  name: '',
  parent_name: '',
  mobile_number: '',
  description: '',
};

export default function QuickCreateModal({ type, isOpen, onClose, onCreated }) {
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  // Reset the form each time the modal is opened so a previous entry never
  // bleeds into the next quick-create.
  useEffect(() => {
    if (isOpen) setForm(BLANK);
  }, [isOpen, type]);

  const isStudent = type === 'student';
  const title = isStudent ? 'Add a student' : 'Add a group';

  const valid = isStudent
    ? form.name.trim() && form.parent_name.trim() && String(form.mobile_number).replace(/\D/g, '').length >= 7
    : form.name.trim();

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      if (isStudent) {
        const payload = {
          name: form.name.trim(),
          parent_name: form.parent_name.trim(),
          mobile_number: String(form.mobile_number).trim(),
        };
        const res = await api.post('/students', payload);
        toast.success('Student added');
        onCreated?.(res?.student);
      } else {
        const payload = { name: form.name.trim(), description: form.description.trim() };
        const res = await api.post('/groups', payload);
        toast.success('Group added');
        onCreated?.(res?.group);
      }
      onClose?.();
    } catch (e) {
      toast.error(e.message || 'Could not create');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      onSave={save}
      saving={saving}
      saveDisabled={!valid}
      saveLabel="Add"
    >
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {isStudent ? 'Student name' : 'Group name'}
          </label>
          <input
            type="text"
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="input-field"
            placeholder={isStudent ? 'Full name' : 'e.g. Batch A'}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isStudent) save(); }}
          />
        </div>

        {isStudent ? (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Parent name</label>
              <input
                type="text"
                value={form.parent_name}
                onChange={(e) => setForm({ ...form, parent_name: e.target.value })}
                className="input-field"
                placeholder="Parent or guardian"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mobile number</label>
              <input
                type="tel"
                value={form.mobile_number}
                onChange={(e) => setForm({ ...form, mobile_number: e.target.value })}
                className="input-field"
                placeholder="10-digit mobile"
                onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              />
            </div>
            <p className="text-xs text-gray-400">
              You can fill in the rest of the details later from the Students page.
            </p>
          </>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input-field"
              placeholder="Optional"
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
