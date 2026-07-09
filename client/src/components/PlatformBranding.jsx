// Platform-admin branding editor (global, not per-academy). Edits the single
// platformsettings record: name, tagline, logo, support contacts, offer text.
// Reads/writes /api/platform/branding; the public /api/branding serves the same
// values to login + landing. Logo is stored as a compressed data URL so login
// and static pages can show it with no signed-URL/auth juggling.
import { useState, useEffect, useRef } from 'react';
import { Loader2, Upload, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';

const FIELDS = [
  { key: 'brand_name', label: 'Platform name', placeholder: 'VidyaSetu' },
  { key: 'tagline', label: 'Tagline', placeholder: 'Bridging teachers and learners' },
  { key: 'offer_name', label: 'Offer banner text (blank = none)', placeholder: 'Limited-time launch offer' },
  { key: 'support_email', label: 'Support email', placeholder: 'support@yourdomain' },
  { key: 'support_phone_display', label: 'Support phone (shown)', placeholder: '+91 90000 00000' },
  { key: 'support_phone_tel', label: 'Support phone (tel: digits)', placeholder: '+919000000000' },
];

export default function PlatformBranding() {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      try { setForm(await api.get('/platform/branding')); }
      catch { toast.error('Could not load branding'); setForm({}); }
      finally { setLoading(false); }
    })();
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Downscale + compress an uploaded logo to a small PNG data URL (<=240px).
  const onLogo = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { toast.error('Please pick an image under 3 MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 240;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        set('logo_url', canvas.toDataURL('image/png'));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.put('/platform/branding', form);
      setForm(saved);
      toast.success('Branding saved');
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-10 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Platform branding</h2>
        <p className="text-sm text-gray-500 mt-1">Global identity for the whole product. Shows on the login screen and marketing pages. Each academy still shows its own name and logo inside the app.</p>
      </div>

      <div className="card space-y-4">
        {/* Logo */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl border border-gray-200 overflow-hidden bg-gray-50 flex items-center justify-center flex-shrink-0">
            {form?.logo_url
              ? <img src={form.logo_url} alt="Logo" className="w-full h-full object-cover" />
              : <span className="text-xs text-gray-400">No logo</span>}
          </div>
          <div>
            <button type="button" onClick={() => fileRef.current?.click()} className="btn-secondary btn-sm"><Upload className="w-4 h-4" /> Upload logo</button>
            {form?.logo_url && <button type="button" onClick={() => set('logo_url', '')} className="ml-2 text-xs text-red-600 hover:text-red-700">Remove</button>}
            <p className="text-xs text-gray-400 mt-1">Square works best. Auto-resized to 240px.</p>
            <input ref={fileRef} type="file" accept="image/*" onChange={onLogo} className="hidden" />
          </div>
        </div>

        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
            <input
              value={form?.[f.key] || ''}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder={f.placeholder}
              className="input-field w-full"
            />
          </div>
        ))}

        <div className="flex justify-end pt-1">
          <button type="button" onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save branding
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Note: the browser-tab title and the "install app" name are set at build time from the config value, so those two update on the next deploy rather than instantly. Everything a visitor reads (login, landing, pricing) updates live.
      </p>
    </div>
  );
}
