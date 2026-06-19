// First-login welcome tour — a lightweight, dismissible modal carousel.
// It is NOT the documentation (that lives on the always-available /help page);
// it's the friendly nudge that points genuinely-new users at the few things
// that matter, then bows out.
//
// IMPORTANT: the tour is gated on a SERVER flag so it only appears for:
//   - the owner of a brand-new org           (admin variant)
//   - a parent whose login was just activated (parent variant)
// Established orgs / returning parents never see it. Dismissal clears the
// server flag (per account) AND is remembered in localStorage (per device) so
// it never nags, even before the network round-trip lands.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Users,
  ClipboardCheck,
  Video,
  Smartphone,
  LayoutDashboard,
  IndianRupee,
  BookOpen,
  Sparkles,
} from 'lucide-react';
import { useOrgBranding } from '../hooks/useOrgBranding';
import api from '../utils/api';

const TOUR_VERSION = 'v1';

const SLIDES = {
  admin: [
    { icon: Sparkles,        title: 'Welcome to {app}', body: 'Run your whole academy from one place — students, classes, attendance, fees and lessons. Here’s the 20-second tour.' },
    { icon: Users,           title: 'Add students & classes', body: 'Start in Students and Classes. Build your roster and weekly timetable — everything else flows from these.' },
    { icon: ClipboardCheck,  title: 'Take attendance in a tap', body: 'Attendance prefills from the timetable. Mark present/absent and parents are notified instantly.' },
    { icon: Video,           title: 'Share lessons & fees', body: 'Upload lesson videos, set fees, and invite parents from Parent Logins so families can follow along.' },
    { icon: Smartphone,      title: 'Install & get notified', body: 'Add {app} to your home screen and turn on notifications. The Help page has step-by-step install guides.' },
  ],
  parent: [
    { icon: Sparkles,        title: 'Welcome to {app}', body: 'Stay close to your child’s music journey — attendance, fees, lessons and progress, all in one place.' },
    { icon: LayoutDashboard, title: 'Your dashboard', body: 'Overview shows upcoming classes, recent attendance and anything due. Start your day here.' },
    { icon: Video,           title: 'Lessons & certificates', body: 'Watch the lessons your teacher shares, take quizzes, and finish a course to earn its certificate.' },
    { icon: IndianRupee,     title: 'Attendance & fees', body: 'Class History shows every session marked; Fees keeps dues and payments clear — no surprises.' },
    { icon: Smartphone,      title: 'Install & get notified', body: 'Add {app} to your home screen and allow notifications so nothing slips by. The Help page shows you how.' },
  ],
};

export function tourStorageKey(variant) {
  return `vidyasetu.tour.${variant}.${TOUR_VERSION}`;
}

export function hasSeenTour(variant) {
  try { return localStorage.getItem(tourStorageKey(variant)) === 'done'; }
  catch { return false; }
}

function markSeenLocally(variant) {
  try { localStorage.setItem(tourStorageKey(variant), 'done'); } catch {}
}

// Ask the server whether this account still has the welcome tour pending.
// Returns false on any error (fail closed — never pop the tour on a hiccup).
async function fetchPending(variant) {
  try {
    if (variant === 'admin') {
      const res = await api.get('/settings/app');
      return res?.settings?.['onboarding.admin_pending'] === 'true';
    }
    const res = await api.get('/portal/me');
    return res?.onboarding_pending === true;
  } catch {
    return false;
  }
}

// Clear the server flag so the tour never shows again for this account.
async function clearPending(variant) {
  try {
    if (variant === 'admin') {
      await api.put('/settings/app', { settings: { 'onboarding.admin_pending': 'false' } });
    } else {
      await api.post('/portal/onboarding-seen');
    }
  } catch { /* non-fatal — localStorage still suppresses it on this device */ }
}

export default function OnboardingTour({ variant = 'parent', helpPath }) {
  const navigate = useNavigate();
  const branding = useOrgBranding();
  const appName = branding.name || 'VidyaSetu';
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  // Decide once on mount. If this device has already seen it, skip entirely
  // (no network). Otherwise ask the server — only brand-new accounts have the
  // pending flag set. If not pending, remember that locally so we don't ask
  // again on every page load.
  useEffect(() => {
    let cancelled = false;
    if (hasSeenTour(variant)) return;
    (async () => {
      const pending = await fetchPending(variant);
      if (cancelled) return;
      if (pending) setOpen(true);
      else markSeenLocally(variant);
    })();
    return () => { cancelled = true; };
  }, [variant]);

  if (!open) return null;

  const slides = SLIDES[variant];
  const slide = slides[i];
  const Icon = slide.icon;
  const isLast = i === slides.length - 1;
  const fill = (s) => s.replace(/\{app\}/g, appName);

  const dismiss = () => {
    markSeenLocally(variant);
    clearPending(variant); // fire-and-forget — clears the per-account server flag
    setOpen(false);
  };

  const openGuide = () => {
    dismiss();
    if (helpPath) navigate(helpPath);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={dismiss} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome tour"
        className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden"
      >
        {/* Header band */}
        <div className="bg-indigo-600 px-6 pt-6 pb-8 text-white relative">
          <button
            onClick={dismiss}
            className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-white/20 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <span className="inline-flex w-12 h-12 rounded-xl bg-white/15 items-center justify-center mb-3">
            <Icon className="w-6 h-6" />
          </span>
          <h3 className="text-xl font-bold leading-snug">{fill(slide.title)}</h3>
        </div>

        <div className="px-6 py-5">
          <p className="text-sm text-gray-700 leading-relaxed min-h-[3.5rem]">{fill(slide.body)}</p>

          {/* Progress dots */}
          <div className="flex items-center justify-center gap-1.5 mt-5">
            {slides.map((_, idx) => (
              <span
                key={idx}
                className={`h-1.5 rounded-full transition-all ${
                  idx === i ? 'w-5 bg-indigo-600' : 'w-1.5 bg-gray-300'
                }`}
              />
            ))}
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between mt-5">
            {i > 0 ? (
              <button onClick={() => setI(i - 1)} className="btn-secondary btn-sm">
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
            ) : (
              <button onClick={dismiss} className="text-sm text-gray-500 hover:text-gray-700 px-2">
                Skip
              </button>
            )}

            {isLast ? (
              <div className="flex gap-2">
                <button onClick={dismiss} className="btn-secondary btn-sm">Got it</button>
                {helpPath && (
                  <button onClick={openGuide} className="btn-primary btn-sm">
                    <BookOpen className="w-4 h-4" />
                    Open guide
                  </button>
                )}
              </div>
            ) : (
              <button onClick={() => setI(i + 1)} className="btn-primary btn-sm">
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
