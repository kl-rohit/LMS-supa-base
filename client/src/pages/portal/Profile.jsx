// Parent self-service profile page. Lets the parent fill in personal
// details + upload a passport-style photo so the teacher can pull them
// straight into Grade exam applications without re-entering.
//
// Editable fields (whitelisted on the server — see PORTAL_EDITABLE_FIELDS
// in functions/api/routes/portal.js):
//   name, mobile_number, date_of_birth, email, address,
//   father_name, mother_name
// Plus photo upload via Catalyst Stratus.

import { useEffect, useRef, useState } from 'react';
import {
  User,
  Phone,
  Mail,
  MapPin,
  Cake,
  Users as UsersIcon,
  Camera,
  Save,
  Loader2,
  Image as ImageIcon,
  CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import Loader from '../../components/Loader';

const EMPTY = {
  name: '',
  mobile_number: '',
  date_of_birth: '',
  email: '',
  address: '',
  father_name: '',
  mother_name: '',
  photo_url: '',
  parent_name: '',
  status: '',
};

export default function PortalProfile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [photoPreview, setPhotoPreview] = useState('');   // data URL shown after picking
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { profile } = await api.get('/portal/profile');
        if (cancelled || !profile) return;
        setForm({ ...EMPTY, ...profile });
      } catch (e) {
        toast.error('Failed to load profile: ' + e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const change = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Pick + preview a photo. The actual upload happens on Save so the parent
  // can change their mind without us already having written to Stratus.
  const handlePickPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please pick an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Photo must be 5MB or smaller');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(String(reader.result || ''));
    reader.onerror = () => toast.error('Could not read the file');
    reader.readAsDataURL(file);
  };

  const clearPickedPhoto = () => {
    setPhotoPreview('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Save = upload photo (if newly picked) + PUT profile fields.
  const handleSave = async (e) => {
    e?.preventDefault?.();
    if (saving || uploading) return;
    try {
      setSaving(true);
      // 1. Upload photo first (if any). Save the returned URL into form so
      //    the subsequent PUT also persists it (the server already wrote
      //    photo_url on the photo endpoint — this just keeps local state in sync).
      let nextPhotoUrl = form.photo_url;
      if (photoPreview) {
        setUploading(true);
        const { photo_url } = await api.post('/portal/photo', {
          data: photoPreview,
          filename: 'profile',
        });
        nextPhotoUrl = photo_url || nextPhotoUrl;
        setUploading(false);
        clearPickedPhoto();
      }
      // 2. PUT the rest of the fields. Server whitelists which keys it accepts.
      const { profile } = await api.put('/portal/profile', {
        name: form.name,
        mobile_number: form.mobile_number,
        date_of_birth: form.date_of_birth || null,
        email: form.email,
        address: form.address,
        father_name: form.father_name,
        mother_name: form.mother_name,
      });
      setForm({ ...EMPTY, ...profile, photo_url: nextPhotoUrl });
      toast.success('Profile saved');
    } catch (e2) {
      toast.error('Save failed: ' + e2.message);
    } finally {
      setSaving(false);
      setUploading(false);
    }
  };

  if (loading) return <Loader text="Loading your profile..." />;

  const currentPhoto = photoPreview || form.photo_url || '';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="page-header mb-0">My profile</h2>
        <p className="text-sm text-gray-500 mt-1">
          Keep these details up-to-date — they're used for Grade exam paperwork
          and certificates. Fee and class details are managed by your teacher.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Photo card */}
        <div className="card flex items-start gap-5">
          <div className="flex-shrink-0">
            {currentPhoto ? (
              <img
                src={currentPhoto}
                alt="Profile"
                className="w-28 h-28 rounded-full object-cover border-2 border-indigo-100 shadow-sm"
              />
            ) : (
              <div className="w-28 h-28 rounded-full bg-indigo-50 border-2 border-dashed border-indigo-200 flex items-center justify-center">
                <ImageIcon className="w-10 h-10 text-indigo-300" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900">Photo</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Passport-style headshot, JPG/PNG, up to 5MB.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePickPhoto}
                className="hidden"
                id="photo-input"
              />
              <label
                htmlFor="photo-input"
                className="btn-secondary btn-sm cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                {form.photo_url || photoPreview ? 'Change photo' : 'Choose photo'}
              </label>
              {photoPreview && (
                <>
                  <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Ready to upload on Save
                  </span>
                  <button
                    type="button"
                    onClick={clearPickedPhoto}
                    className="text-xs text-gray-500 hover:text-gray-700 underline"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Student details */}
        <div className="card space-y-4">
          <h3 className="text-base font-semibold text-gray-900">Student details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full name" icon={User}>
              <input
                type="text"
                value={form.name}
                onChange={change('name')}
                className="input-field"
                placeholder="As it should appear on certificates"
                required
              />
            </Field>
            <Field label="Date of birth" icon={Cake}>
              <input
                type="date"
                value={form.date_of_birth || ''}
                onChange={change('date_of_birth')}
                className="input-field"
              />
            </Field>
            <Field label="Mobile number" icon={Phone}>
              <input
                type="tel"
                value={form.mobile_number}
                onChange={change('mobile_number')}
                className="input-field"
                placeholder="10-digit number"
              />
            </Field>
            <Field label="Email" icon={Mail}>
              <input
                type="email"
                value={form.email}
                onChange={change('email')}
                className="input-field"
                placeholder="you@example.com"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address" icon={MapPin}>
                <textarea
                  value={form.address}
                  onChange={change('address')}
                  rows={3}
                  className="input-field"
                  placeholder="Street, City, State, PIN"
                />
              </Field>
            </div>
          </div>
        </div>

        {/* Parent details */}
        <div className="card space-y-4">
          <h3 className="text-base font-semibold text-gray-900">Parent details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Father's name" icon={UsersIcon}>
              <input
                type="text"
                value={form.father_name}
                onChange={change('father_name')}
                className="input-field"
              />
            </Field>
            <Field label="Mother's name" icon={UsersIcon}>
              <input
                type="text"
                value={form.mother_name}
                onChange={change('mother_name')}
                className="input-field"
              />
            </Field>
          </div>
        </div>

        <div className="flex justify-end gap-2 sticky bottom-0 bg-gray-50 -mx-4 lg:-mx-6 px-4 lg:px-6 py-3 border-t border-gray-200">
          <button
            type="submit"
            className="btn-primary"
            disabled={saving || uploading}
          >
            {saving || uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {uploading ? 'Uploading photo...' : 'Saving...'}
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save changes
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, icon: Icon, children }) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">
        {Icon && <Icon className="w-4 h-4 text-gray-400" />}
        {label}
      </span>
      {children}
    </label>
  );
}
