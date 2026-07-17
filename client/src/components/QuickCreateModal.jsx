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
import FieldError from './FieldError';
import { V, validate, firstErrorField, focusField, fieldCls, clearError } from '../utils/validation';

const BLANK = {
  name: '',
  parent_name: '',
  mobile_number: '',
  description: '',
};

export default function QuickCreateModal({ type, isOpen, onClose, onCreated }) {
  const [form, setForm] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // Reset the form each time the modal is opened so a previous entry never
  // bleeds into the next quick-create.
  useEffect(() => {
    if (isOpen) { setForm(BLANK); setErrors({}); }
  }, [isOpen, type]);

  const isStudent = type === 'student';
  const title = isStudent ? 'Add a student' : 'Add a group';

  const save = async () => {
    if (saving) return;
    // Per-field validation: highlight the offending inputs rather than a single toast.
    const errs = isStudent
      ? validate(form, {
          name: V.name('Student name'),
          parent_name: V.name('Parent name'),
          mobile_number: V.phone10({ required: true }),
        })
      : validate(form, {
          name: V.text('Group name', { required: true, max: 80 }),
        });
    if (Object.keys(errs).length) {
      setErrors(errs);
      focusField(firstErrorField(errs));
      toast.error('Please fix the highlighted fields');
      return;
    }
    setErrors({});
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
            data-field="name"
            value={form.name}
            onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors((x) => clearError(x, 'name')); }}
            className={fieldCls('input-field', errors.name)}
            placeholder={isStudent ? 'Full name' : 'e.g. Batch A'}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isStudent) save(); }}
          />
          <FieldError msg={errors.name} />
        </div>

        {isStudent ? (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Parent name</label>
              <input
                type="text"
                data-field="parent_name"
                value={form.parent_name}
                onChange={(e) => { setForm({ ...form, parent_name: e.target.value }); setErrors((x) => clearError(x, 'parent_name')); }}
                className={fieldCls('input-field', errors.parent_name)}
                placeholder="Parent or guardian"
              />
              <FieldError msg={errors.parent_name} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mobile number</label>
              <input
                type="tel"
                data-field="mobile_number"
                value={form.mobile_number}
                onChange={(e) => { setForm({ ...form, mobile_number: e.target.value }); setErrors((x) => clearError(x, 'mobile_number')); }}
                className={fieldCls('input-field', errors.mobile_number)}
                placeholder="10-digit mobile"
                onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              />
              <FieldError msg={errors.mobile_number} />
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
