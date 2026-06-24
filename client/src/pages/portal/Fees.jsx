// Parent view: read-only fees with month picker.

import { useEffect, useState } from 'react';
import { IndianRupee, TrendingDown, QrCode, Copy, Check, Smartphone } from 'lucide-react';
import api from '../../utils/api';
import Loader from '../../components/Loader';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Build last N months descending (e.g. ['2026-05', '2026-04', ...])
function recentMonths(n) {
  const d = new Date();
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

export default function PortalFees() {
  const [month, setMonth] = useState(currentYm());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/portal/fees?month=${month}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [month]);

  const monthOpts = recentMonths(12);
  const [y, m] = month.split('-');
  const monthLabel = `${MONTHS[parseInt(m, 10) - 1]} ${y}`;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <IndianRupee className="w-5 h-5 text-indigo-600" />
            Fee summary — {monthLabel}
          </h3>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="select-field text-sm w-auto"
          >
            {monthOpts.map((ym) => {
              const [yy, mm] = ym.split('-');
              return <option key={ym} value={ym}>{MONTHS[parseInt(mm, 10) - 1]} {yy}</option>;
            })}
          </select>
        </div>

        {loading ? (
          <Loader />
        ) : !data ? (
          <p className="text-center text-sm text-gray-400 py-6">Could not load fee data.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Classes attended" value={data.classes_attended} />
            <Stat label="Class fees" value={`₹${Number(data.class_fees).toLocaleString('en-IN')}`} />
            <Stat label="Additional" value={`₹${Number(data.additional_fees).toLocaleString('en-IN')}`} />
            <Stat
              label="Total"
              value={`₹${Number(data.total).toLocaleString('en-IN')}`}
              accent="text-indigo-700"
            />
          </div>
        )}

        {data?.discount > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-green-50 text-green-700 text-sm flex items-center gap-2">
            <TrendingDown className="w-4 h-4" />
            A discount of ₹{Number(data.discount).toLocaleString('en-IN')} has been applied this month.
          </div>
        )}
      </div>

      {!loading && data?.payment?.enabled && (
        <PaymentCard payment={data.payment} amount={Number(data.total) || 0} />
      )}

      {!loading && !data?.payment?.enabled && (
        <p className="text-xs text-gray-400 px-2">
          For payment, please contact your teacher directly. This page is for reference only.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="p-3 rounded-lg bg-gray-50">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${accent || 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

// Builds the UPI pay query a phone understands (pa = payee id, am = amount).
// Amount is prefilled when there is a positive balance; the parent can still
// edit it in their app. Returns '' when there is no UPI id (we then rely on an
// uploaded QR image instead).
function buildUpiQuery(payment, amount) {
  const pa = String(payment?.upi_id || '').trim();
  if (!pa) return '';
  const params = new URLSearchParams();
  params.set('pa', pa);
  if (payment.payee_name) params.set('pn', payment.payee_name);
  if (amount > 0) params.set('am', amount.toFixed(2));
  params.set('cu', 'INR');
  return params.toString();
}

// The generic UPI link (used for the QR and the "Pay now" chooser).
function buildUpiLink(payment, amount) {
  const q = buildUpiQuery(payment, amount);
  return q ? `upi://pay?${q}` : '';
}

// iPhone / iPad detection. On iOS there is no system UPI chooser, and other
// apps (notably WhatsApp) register the generic `upi://` scheme — so tapping a
// bare `upi://pay` link opens WhatsApp instead of a payment app. We therefore
// route iOS users to the app-specific schemes (tez://, phonepe://, paytmmp://)
// and hold back the generic link there. iPadOS reports as MacIntel with touch.
const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// Per-app deep links. Android shows a chooser for the generic upi:// link, but
// iOS has no chooser and ignores upi://, so we also offer each common app's own
// scheme. Same query (so the amount is prefilled). On a device where an app is
// not installed its button simply does nothing, so showing all four is safe.
// `iosSafe: false` marks the generic `upi://pay` entry that WhatsApp hijacks on
// iOS, so it can be left out of the iOS list.
const UPI_APPS = [
  { key: 'gpay',    label: 'Google Pay', scheme: 'tez://upi/pay', iosSafe: true },
  { key: 'phonepe', label: 'PhonePe',    scheme: 'phonepe://pay', iosSafe: true },
  { key: 'paytm',   label: 'Paytm',      scheme: 'paytmmp://pay', iosSafe: true },
  { key: 'bhim',    label: 'BHIM / other', scheme: 'upi://pay', iosSafe: false },
];
function buildAppLinks(payment, amount) {
  const q = buildUpiQuery(payment, amount);
  if (!q) return [];
  return UPI_APPS
    .filter((a) => !IS_IOS || a.iosSafe)
    .map((a) => ({ ...a, href: `${a.scheme}?${q}` }));
}

function PaymentCard({ payment, amount }) {
  // Prefer the academy's uploaded QR image; otherwise generate one from the
  // UPI id with the qrcode lib (dynamic import keeps it out of the main chunk).
  const uploaded = String(payment?.qr_image || '');
  const upiLink = buildUpiLink(payment, amount);
  const [genQr, setGenQr] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    if (uploaded || !upiLink) { setGenQr(''); return; }
    (async () => {
      try {
        const QRCode = (await import('qrcode')).default;
        const url = await QRCode.toDataURL(upiLink, { width: 320, margin: 1 });
        if (alive) setGenQr(url);
      } catch { if (alive) setGenQr(''); }
    })();
    return () => { alive = false; };
  }, [uploaded, upiLink]);

  const qrSrc = uploaded || genQr;
  const appLinks = buildAppLinks(payment, amount);
  const copyUpi = async () => {
    try {
      await navigator.clipboard.writeText(payment.upi_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="card">
      <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-1">
        <QrCode className="w-5 h-5 text-indigo-600" />
        Pay fees
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        Pay
        {amount > 0 ? <> the balance of <span className="font-medium text-gray-700">₹{amount.toLocaleString('en-IN')}</span></> : <> your fees</>}
        {' '}with any UPI app (GPay, PhonePe, Paytm). On your phone, tap your app below to open it with the amount ready. On a computer, scan the QR with your phone.
      </p>

      <div className="flex flex-col items-center text-center gap-3">
        {qrSrc ? (
          <div className="p-3 bg-white rounded-xl border border-gray-200">
            <img src={qrSrc} alt="Payment QR" className="w-44 h-44 object-contain" />
          </div>
        ) : (
          <div className="w-44 h-44 rounded-xl border border-dashed border-gray-300 flex items-center justify-center text-gray-300">
            <QrCode className="w-10 h-10" />
          </div>
        )}

        {/* Mobile: a tap-to-pay deep link that opens the installed UPI app via
            the generic upi:// scheme. Android shows its UPI chooser here. On
            iOS the scheme is hijacked by other apps (e.g. WhatsApp), so this
            generic button is held back and the per-app buttons below are used
            instead. sm:hidden hides it on laptops/desktops, which have no UPI
            app; only shown when a UPI id is set (an uploaded QR image alone
            cannot produce a deep link). */}
        {upiLink && !IS_IOS && (
          <a
            href={upiLink}
            className="sm:hidden w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
          >
            <Smartphone className="w-4 h-4" />
            Pay now
          </a>
        )}

        {/* Per-app buttons: each common app's own scheme, with the amount
            carried in the link so it arrives prefilled. On iOS these are the
            primary way to pay (the generic upi:// link is unsafe there), so the
            label leads; on Android they are an alternative to the chooser. */}
        {appLinks.length > 0 && (
          <div className="sm:hidden w-full">
            <p className="text-xs text-gray-400 mb-2">{IS_IOS ? 'Pay with your app' : 'Or open a specific app'}</p>
            <div className="grid grid-cols-2 gap-2">
              {appLinks.map((a) => (
                <a
                  key={a.key}
                  href={a.href}
                  className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {a.label}
                </a>
              ))}
            </div>
          </div>
        )}

        {payment.payee_name && (
          <p className="text-sm font-medium text-gray-900">{payment.payee_name}</p>
        )}

        {payment.upi_id && (
          <button
            type="button"
            onClick={copyUpi}
            className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {payment.upi_id}
          </button>
        )}

        {payment.note && (
          <p className="text-xs text-gray-500 max-w-sm">{payment.note}</p>
        )}
      </div>
    </div>
  );
}
