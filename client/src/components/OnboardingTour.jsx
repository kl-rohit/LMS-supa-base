// First-login welcome tour — a guided, navigate-and-highlight walkthrough.
// It is NOT the documentation (that lives on the always-available /help page);
// it's the friendly nudge that walks genuinely-new users through the few steps
// that matter, then bows out.
//
// For the academy owner (admin variant) it actually drives the app: it routes
// to Students, then Classes, then Attendance, putting a spotlight on each menu
// item so the owner learns the core loop by seeing it. Parents get a lighter,
// centered welcome carousel (their portal has no setup to walk through).
//
// IMPORTANT: the tour is gated on a SERVER flag so it only appears for:
//   - the owner of a brand-new org           (admin variant)
//   - a parent whose login was just activated (parent variant)
// Established orgs / returning parents never see it. Dismissal clears the
// server flag (per account) AND is remembered in localStorage (per device) so
// it never nags, even before the network round-trip lands.

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Users,
  ClipboardCheck,
  CalendarDays,
  Video,
  Smartphone,
  LayoutDashboard,
  IndianRupee,
  BookOpen,
  Sparkles,
  BarChart3,
  Bell,
  KeyRound,
  FileText,
  ClipboardList,
  UserCircle2,
  MessageSquare,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useOrgBranding } from '../hooks/useOrgBranding';
import api from '../utils/api';
import { BRAND_NAME } from '../config';

const TOUR_VERSION = 'v2';

// Each step optionally carries a `route` (the tour navigates there first) and a
// `target` CSS selector (the element to spotlight). A step with no target is a
// centered card — used for the welcome and the wrap-up.
const STEPS = {
  admin: [
    {
      icon: Sparkles,
      title: 'Welcome to {app}',
      body: 'Let’s set up the essentials in three quick steps. It takes about a minute, and you can leave any time.',
    },
    {
      icon: Users,
      title: 'Start with your students',
      body: 'Open Students to build your roster. Every class, fee and report grows from here.',
      route: '/students',
      target: '[data-tour="nav-students"]',
    },
    {
      icon: CalendarDays,
      title: 'Create your classes',
      body: 'Set up your weekly timetable in Classes so each session is ready to mark.',
      route: '/classes',
      target: '[data-tour="nav-classes"]',
    },
    {
      icon: ClipboardCheck,
      title: 'Mark attendance',
      body: 'Open Attendance to mark who came. Parents are notified the moment you save.',
      route: '/attendance',
      target: '[data-tour="nav-attendance"]',
    },
    {
      icon: BookOpen,
      title: 'You’re ready',
      body: 'That’s the core loop. The Help page has step-by-step guides for everything else whenever you want them.',
    },
  ],
  parent: [
    { icon: Sparkles,        title: 'Welcome to {app}', body: 'Stay close to your child’s music journey — attendance, fees, lessons and progress, all in one place.' },
    { icon: LayoutDashboard, title: 'Your dashboard', body: 'Overview shows upcoming classes, recent attendance and anything due. Start your day here.' },
    { icon: Video,           title: 'Lessons & certificates', body: 'Watch the lessons your teacher shares, take quizzes, and finish a course to earn its certificate.' },
    { icon: IndianRupee,     title: 'Attendance & fees', body: 'Class History shows every session marked; Fees keeps dues and payments clear.' },
    { icon: Smartphone,      title: 'Install & get notified', body: 'Add {app} to your home screen and allow notifications so nothing slips by. The Help page shows you how.' },
  ],
};

// Per-module guided tours, launched on demand from a Help article's
// "Show me around" button (NOT server-gated — they replay any time).
// Each tour routes to the live module page and walks through what's there.
// The first step spotlights the sidebar nav item where it lives; on a narrow
// screen (collapsed sidebar) the engine simply renders it as a centered card,
// so the tour never breaks. Keyed by article slug so HelpGuide can map 1:1.
const MODULE_TOURS = {
  admin: {
    dashboard: [
      { icon: LayoutDashboard, title: 'Dashboard', body: 'Your daily home base: today’s classes, recent attendance and anything that needs your attention.', route: '/dashboard', target: '[data-tour="nav-dashboard"]' },
      { icon: LayoutDashboard, title: 'Your numbers at a glance', body: 'These cards summarise students, attendance and fees so you can read the day in seconds.', route: '/dashboard', target: '[data-tour="dashboard-stats"]' },
    ],
    students: [
      { icon: Users, title: 'Students', body: 'This is your roster. Every class, fee and report grows from the students you add here.', route: '/students', target: '[data-tour="nav-students"]' },
      { icon: Users, title: 'Add a student', body: 'Use Add student to capture name, contact, fee and class mode. You can edit any detail later.', route: '/students', target: '[data-tour="students-add"]' },
      { icon: ClipboardCheck, title: 'Open a profile', body: 'Tap any student to see their attendance, fees and lessons together in one place.', route: '/students' },
    ],
    classes: [
      { icon: CalendarDays, title: 'Classes & timetable', body: 'Build your weekly timetable here so every session is ready to mark.', route: '/classes', target: '[data-tour="nav-classes"]' },
      { icon: CalendarDays, title: 'Add a class', body: 'Create a class with its day, time and students. It then appears on the timetable grid.', route: '/classes', target: '[data-tour="classes-add"]' },
    ],
    attendance: [
      { icon: ClipboardCheck, title: 'Attendance', body: 'Mark who came to each session. Parents are notified the moment you save.', route: '/attendance', target: '[data-tour="nav-attendance"]' },
      { icon: ClipboardCheck, title: 'Mark the roster', body: 'Pick a date and class here to load its roster, then mark each student present or absent.', route: '/attendance', target: '[data-tour="attendance-mark"]' },
    ],
    fees: [
      { icon: IndianRupee, title: 'Fees', body: 'Track dues and payments for every student in one view.', route: '/fees', target: '[data-tour="nav-fees"]' },
      { icon: IndianRupee, title: 'Add a charge or discount', body: 'Add an extra fee or apply a discount here. Balances update right away and parents see it in their portal.', route: '/fees', target: '[data-tour="fees-add"]' },
    ],
    lessons: [
      { icon: Video, title: 'Lessons, quizzes & certificates', body: 'Share video lessons, build quizzes, and let students earn a certificate when they finish a course.', route: '/lessons', target: '[data-tour="nav-lessons"]' },
      { icon: Video, title: 'Create a course', body: 'Start with New course, then add lessons. Add a quiz as a lesson to gate the certificate behind a pass.', route: '/lessons', target: '[data-tour="lessons-add"]' },
    ],
    assignments: [
      { icon: ClipboardList, title: 'Assignments', body: 'Set tasks for your students and keep track of what they hand in.', route: '/assignments', target: '[data-tour="nav-assignments"]' },
      { icon: ClipboardList, title: 'Set a task', body: 'Use New Assignment to give it a title, due date and the students it is for.', route: '/assignments', target: '[data-tour="assignments-add"]' },
    ],
    'question-papers': [
      { icon: FileText, title: 'Question papers', body: 'Share practice papers and past exams for students to download.', route: '/question-papers', target: '[data-tour="nav-question-papers"]' },
      { icon: FileText, title: 'Share a paper', body: 'Add Paper lets you upload a file or paste a link for students to download.', route: '/question-papers', target: '[data-tour="papers-add"]' },
    ],
    reports: [
      { icon: BarChart3, title: 'Reports', body: 'See attendance trends, fee collection and lesson activity at a glance.', route: '/reports', target: '[data-tour="nav-reports"]' },
      { icon: BarChart3, title: 'Switch the view', body: 'These tabs move between overall, monthly, per-student and lesson activity reports.', route: '/reports', target: '[data-tour="reports-tabs"]' },
    ],
    notifications: [
      { icon: MessageSquare, title: 'Notifications & messaging', body: 'Send reminders and updates to parents, and review what has gone out.', route: '/messages', target: '[data-tour="nav-messages"]' },
      { icon: MessageSquare, title: 'Compose a message', body: 'Use Compose to write an update, then pick who receives it. Sent messages stay listed below.', route: '/messages', target: '[data-tour="messages-compose"]' },
    ],
    'parent-logins': [
      { icon: KeyRound, title: 'Parent logins', body: 'Invite parents to their own portal so they can follow attendance, fees and lessons.', route: '/student-logins', target: '[data-tour="nav-student-logins"]' },
      { icon: KeyRound, title: 'Invite a parent', body: 'Create a login for any student and the parent gets an email to set their password.', route: '/student-logins', target: '[data-tour="logins-intro"]' },
    ],
    settings: [
      { icon: SettingsIcon, title: 'Settings & branding', body: 'Set your academy name, logo, colours, fee mode and working hours here.', route: '/settings', target: '[data-tour="nav-settings"]' },
      { icon: SettingsIcon, title: 'Find each section', body: 'These tabs group your setup: school details, schedule, appearance and more.', route: '/settings', target: '[data-tour="settings-tabs"]' },
    ],
  },
  parent: {
    overview: [
      { icon: LayoutDashboard, title: 'Overview', body: 'Your home base: upcoming classes, recent attendance and anything due.', route: '/portal/dashboard', target: '[data-tour="nav-portal/dashboard"]' },
    ],
    attendance: [
      { icon: ClipboardCheck, title: 'Class history', body: 'Every session your child’s teacher has marked, newest first.', route: '/portal/attendance', target: '[data-tour="nav-portal/attendance"]' },
    ],
    fees: [
      { icon: IndianRupee, title: 'Fees', body: 'See what is due and what is paid, all in one place.', route: '/portal/fees', target: '[data-tour="nav-portal/fees"]' },
    ],
    lessons: [
      { icon: Video, title: 'My Lessons', body: 'Watch the lessons your teacher shares, take quizzes, and finish a course to earn its certificate.', route: '/portal/lessons', target: '[data-tour="nav-portal/lessons"]' },
    ],
    assignments: [
      { icon: ClipboardList, title: 'Assignments', body: 'See the tasks your teacher has set and keep track of what is due.', route: '/portal/assignments', target: '[data-tour="nav-portal/assignments"]' },
    ],
    'question-papers': [
      { icon: FileText, title: 'Question papers', body: 'Download practice papers and past exams your teacher shares.', route: '/portal/papers', target: '[data-tour="nav-portal/papers"]' },
    ],
    profile: [
      { icon: UserCircle2, title: 'My Profile', body: 'Your child’s details and your account. Update your contact info here.', route: '/portal/profile', target: '[data-tour="nav-portal/profile"]' },
    ],
  },
};

// Does a given Help article have a guided tour? HelpGuide uses this to decide
// whether to show its "Show me around" button.
export function hasModuleTour(variant, slug) {
  return Boolean(MODULE_TOURS?.[variant]?.[slug]?.length);
}

// Reserved slug for the "Take the full tour" button: it chains every module
// tour for this variant, in the order they are defined, wrapped in a friendly
// intro and a closing card. Launched like any module tour (replayable, never
// touches the server flag).
export const FULL_TOUR_SLUG = '__full__';

export function hasFullTour(variant) {
  return Object.keys(MODULE_TOURS?.[variant] || {}).length > 0;
}

function buildFullTour(variant) {
  const groups = MODULE_TOURS?.[variant] || {};
  const steps = [
    {
      icon: Sparkles,
      title: 'The full tour',
      body: 'A guided walk through every part of {app}. We’ll move module by module — use Next to go on, or close any time.',
    },
  ];
  Object.values(groups).forEach((moduleSteps) => {
    moduleSteps.forEach((s) => steps.push(s));
  });
  steps.push({
    icon: BookOpen,
    title: 'That’s the whole app',
    body: 'You’ve seen every module. The Help page keeps a written guide for each one, ready whenever you need it.',
  });
  return steps;
}

// Window event a Help article fires to launch that module's tour right now.
// detail: { variant, slug }.
export const LAUNCH_TOUR_EVENT = 'vidyasetu:launch-tour';

export function tourStorageKey(variant) {
  return `vidyasetu.tour.${variant}.${TOUR_VERSION}`;
}

export function hasSeenTour(variant) {
  try { return localStorage.getItem(tourStorageKey(variant)) === 'done'; }
  catch { return false; }
}

// Window event any page can fire to replay the tour on THIS device, without a
// server round-trip — used by the "Replay welcome tour" button on the Help page.
export const REPLAY_EVENT = 'vidyasetu:replay-tour';

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

// Locate the spotlight target. The page it lives on may still be loading, so we
// poll briefly. Resolves with a DOMRect when found, or null after the timeout
// (the step then renders as a centered card — the tour never breaks).
function locateTarget(selector, { timeout = 1600, interval = 80 } = {}) {
  return new Promise((resolve) => {
    if (!selector) { resolve(null); return; }
    const started = Date.now();
    // A target counts as usable only if it actually sits within the viewport.
    // This matters on mobile / PWA where the sidebar is off-canvas: a nav link
    // still has a size but its rect is translated off the left edge, so we skip
    // it and let the step render as a centered card instead of an off-screen ring.
    const onScreen = (r) =>
      r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
    const tick = () => {
      const el = document.querySelector(selector);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          if (onScreen(rect)) { resolve(rect); return; }
          // In the DOM and sized but scrolled out of view (e.g. an in-page
          // control below the fold) — pull it into view and re-measure.
          try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* ignore */ }
          const r2 = el.getBoundingClientRect();
          if (onScreen(r2)) { resolve(r2); return; }
          // Still off-screen (off-canvas sidebar) → fall through to the timeout.
        }
      }
      if (Date.now() - started >= timeout) { resolve(null); return; }
      setTimeout(tick, interval);
    };
    tick();
  });
}

// Place the coach card near the spotlight. Prefer the right of the element
// (the sidebar case); fall back to below it, always clamped on-screen.
function cardPositionFor(rect) {
  if (!rect) return null;
  const margin = 12;
  const cardW = 320;
  // Tall enough to cover the busiest step (icon header + a few lines of body +
  // progress + controls). Under-estimating here let the bottom-clamp leave the
  // Next button below the fold on shorter viewports, where the fixed overlay
  // cannot scroll — so the user could not reach it. The wrapper also gets a
  // max-height + overflow-y as a final safety net.
  const cardH = 340;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = rect.right + margin;
  let top = rect.top;

  if (left + cardW > vw - margin) {
    left = Math.min(rect.left, vw - cardW - margin);
    top = rect.bottom + margin;
  }
  left = Math.max(margin, Math.min(left, vw - cardW - margin));
  top = Math.max(margin, Math.min(top, vh - cardH - margin));
  return { top, left, width: cardW };
}

export default function OnboardingTour({ variant = 'parent', helpPath }) {
  const navigate = useNavigate();
  const branding = useOrgBranding();
  const appName = branding.name || BRAND_NAME;
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  // 'welcome' = the server-gated first-login tour; 'module' = an on-demand
  // tour launched from a Help article (never touches the server flag).
  const [mode, setMode] = useState('welcome');
  const [activeSteps, setActiveSteps] = useState(STEPS[variant] || STEPS.parent);

  // Decide once on mount. The SERVER flag is authoritative: it's set for a
  // brand-new account at signup, and a platform admin can re-arm it to replay
  // the tour for an existing org (see PUT /platform/orgs/:id reset_onboarding).
  // Established accounts have no flag → fetchPending returns false → never shows.
  // Dismissing clears the flag, so it doesn't return on the next load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await fetchPending(variant);
      if (cancelled) return;
      if (pending) {
        setMode('welcome');
        setActiveSteps(STEPS[variant] || STEPS.parent);
        setI(0);
        setOpen(true);
      }
    })();
    return () => { cancelled = true; };
  }, [variant]);

  // Same-device manual replay — the Help page fires this so the owner can see
  // the welcome walkthrough again right now, no server flag needed.
  useEffect(() => {
    const onReplay = () => {
      setMode('welcome');
      setActiveSteps(STEPS[variant] || STEPS.parent);
      setI(0);
      setRect(null);
      setOpen(true);
    };
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_EVENT, onReplay);
  }, [variant]);

  // On-demand module tour — a Help article fires this with { variant, slug }.
  // We only react to events meant for THIS variant, and ignore unknown slugs.
  useEffect(() => {
    const onLaunch = (e) => {
      const d = e?.detail || {};
      if (d.variant && d.variant !== variant) return;
      // The full tour chains every module tour for this variant.
      const steps = d.slug === FULL_TOUR_SLUG
        ? buildFullTour(variant)
        : MODULE_TOURS?.[variant]?.[d.slug];
      if (!steps?.length) return;
      setMode('module');
      setActiveSteps(steps);
      setI(0);
      setRect(null);
      setOpen(true);
    };
    window.addEventListener(LAUNCH_TOUR_EVENT, onLaunch);
    return () => window.removeEventListener(LAUNCH_TOUR_EVENT, onLaunch);
  }, [variant]);

  const steps = activeSteps?.length ? activeSteps : (STEPS[variant] || STEPS.parent);
  const step = steps[i];

  // When the active step changes: route to its page (if any), then locate the
  // element to spotlight. Centered steps clear the spotlight.
  useEffect(() => {
    if (!open || !step) return;
    let cancelled = false;
    if (step.route) navigate(step.route);
    setRect(null);
    (async () => {
      const found = await locateTarget(step.target);
      if (!cancelled) setRect(found);
    })();
    return () => { cancelled = true; };
    // navigate is stable; re-run on step index / open changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, i]);

  // Keep the spotlight glued to the element as the layout shifts.
  const reposition = useCallback(() => {
    if (!step?.target) return;
    const el = document.querySelector(step.target);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setRect(r);
    }
  }, [step]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, reposition]);

  if (!open || !step) return null;

  const Icon = step.icon;
  const isLast = i === steps.length - 1;
  const fill = (s) => s.replace(/\{app\}/g, appName);

  const dismiss = () => {
    // Only the welcome tour owns the per-account server flag. Module tours are
    // replayable on demand, so closing one leaves the flag untouched.
    if (mode === 'welcome') clearPending(variant); // fire-and-forget
    setOpen(false);
  };

  const openGuide = () => {
    dismiss();
    if (helpPath) navigate(helpPath);
  };

  const next = () => { if (!isLast) setI(i + 1); };
  const back = () => { if (i > 0) setI(i - 1); };

  const cardPos = cardPositionFor(rect);

  // Coach card body — shared between the spotlight and centered layouts.
  const card = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome tour"
      className="bg-white rounded-2xl shadow-xl overflow-hidden"
    >
      <div className="bg-indigo-600 px-5 pt-5 pb-6 text-white relative">
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-white/20 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
        <span className="inline-flex w-11 h-11 rounded-xl bg-white/15 items-center justify-center mb-3">
          <Icon className="w-6 h-6" />
        </span>
        <h3 className="text-lg font-bold leading-snug pr-6">{fill(step.title)}</h3>
      </div>

      <div className="px-5 py-4">
        <p className="text-sm text-gray-700 leading-relaxed min-h-[3.5rem]">{fill(step.body)}</p>

        {/* Progress: dots for short tours, a compact "step x of y" for long ones
            (the full tour chains every module, so the dots would overflow). */}
        {steps.length > 12 ? (
          <p className="text-center text-xs font-medium text-gray-500 mt-4">
            Step {i + 1} of {steps.length}
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-1.5 mt-4">
            {steps.map((_, idx) => (
              <span
                key={idx}
                className={`h-1.5 rounded-full transition-all ${
                  idx === i ? 'w-5 bg-indigo-600' : 'w-1.5 bg-gray-300'
                }`}
              />
            ))}
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-between mt-4">
          {i > 0 ? (
            <button onClick={back} className="btn-secondary btn-sm">
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          ) : (
            <button onClick={dismiss} className="text-sm text-gray-500 hover:text-gray-700 px-2">
              {mode === 'module' ? 'Close' : 'Skip'}
            </button>
          )}

          {isLast ? (
            mode === 'module' ? (
              <button onClick={dismiss} className="btn-primary btn-sm">Done</button>
            ) : (
              <div className="flex gap-2">
                <button onClick={dismiss} className="btn-secondary btn-sm">Got it</button>
                {helpPath && (
                  <button onClick={openGuide} className="btn-primary btn-sm">
                    <BookOpen className="w-4 h-4" />
                    Open guide
                  </button>
                )}
              </div>
            )
          ) : (
            <button onClick={next} className="btn-primary btn-sm">
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // Spotlight layout: a dimmed page with a cut-out ring around the target, and
  // the coach card anchored beside it.
  if (cardPos) {
    return (
      <div className="fixed inset-0 z-[60]" aria-live="polite">
        {/* The ring's huge box-shadow dims everything except the target. */}
        <div
          className="fixed rounded-xl ring-2 ring-white pointer-events-none transition-all duration-200"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55)',
          }}
        />
        <div
          className="fixed w-[20rem] max-w-[calc(100vw-1.5rem)] max-h-[calc(100vh-1.5rem)] overflow-y-auto transition-all duration-200"
          style={{ top: cardPos.top, left: cardPos.left }}
        >
          {card}
        </div>
      </div>
    );
  }

  // Centered layout: welcome / wrap-up, or any step whose target wasn’t found
  // (e.g. a collapsed sidebar on mobile). The page is still routed behind it.
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      <div className="relative w-full sm:max-w-md">
        {card}
      </div>
    </div>
  );
}
