// In-app help & documentation — a Zoho-style knowledge base rendered at
// /help (admin) and /portal/help (parent). One component, two content sets.
//
// Layout: a sticky table-of-contents sidebar (grouped by category) + a deep
// per-module article. Each article is data (blocks), so the content stays easy
// to edit and renders consistently. Articles are deep-linkable: /help/:slug.
//
// The "Install the app" and "Turn on notifications" sections are interactive
// and machine-aware (real PWA install + real push subscription), shared by
// both variants. Keep the prose concrete and friendly — the audience is
// academy owners and parents, not engineers.

import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Smartphone, Share, PlusSquare, MonitorDown, Download, CheckCircle2,
  Bell, BellRing, BellOff, Phone, Mail, Users, ClipboardCheck, IndianRupee,
  Video, BarChart3, Calendar, KeyRound, LayoutDashboard, UserCircle2,
  ClipboardList, FileText, HelpCircle, ChevronRight, ChevronDown, ArrowRight,
  ArrowLeft, BookOpen, Lightbulb, Info, Settings as SettingsIcon, RotateCcw,
  Compass, Footprints, UsersRound, Award,
} from 'lucide-react';
import usePwaInstall from '../hooks/usePwaInstall';
import usePush from '../hooks/usePush';
import { REPLAY_EVENT, LAUNCH_TOUR_EVENT, FULL_TOUR_SLUG, hasModuleTour, hasFullTour } from './OnboardingTour';
import { useOrgBranding } from '../hooks/useOrgBranding';
import { BRAND_NAME, SUPPORT_EMAIL, SUPPORT_PHONE_TEL, SUPPORT_PHONE_DISPLAY } from '../config';

/* ------------------------------------------------------------------ */
/* Interactive, machine-aware blocks (install + notifications)        */
/* ------------------------------------------------------------------ */

function Step({ n, children }) {
  return (
    <li className="flex gap-3">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">
        {n}
      </span>
      <span className="pt-0.5 text-sm text-gray-700">{children}</span>
    </li>
  );
}

// Per-platform "Add to Home Screen" instructions + native install button.
function InstallInstructions({ appName }) {
  const { installed, isIOS, canPrompt, promptInstall } = usePwaInstall();
  const [tab, setTab] = useState(isIOS ? 'ios' : 'android');

  if (installed) {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
        You’re using the installed app — you’re all set.
      </div>
    );
  }

  const tabs = [
    { id: 'ios', label: 'iPhone / iPad', icon: Smartphone },
    { id: 'android', label: 'Android', icon: Smartphone },
    { id: 'desktop', label: 'Desktop', icon: MonitorDown },
  ];

  return (
    <div>
      <p className="text-sm text-gray-600 mb-4">
        Install {appName} to your home screen for a full-screen, app-like
        experience that opens instantly and supports notifications.
      </p>

      {canPrompt && (
        <button onClick={promptInstall} className="btn-primary mb-4">
          <Download className="w-4 h-4" />
          Install {appName}
        </button>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {tabs.map((t) => {
          const TIcon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                active
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <TIcon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'ios' && (
        <ol className="space-y-2">
          <Step n={1}>Open this page in <strong>Safari</strong> (install isn’t available in other iOS browsers).</Step>
          <Step n={2}>Tap the <strong>Share</strong> icon <Share className="inline w-4 h-4 -mt-0.5 text-indigo-600" /> in the toolbar.</Step>
          <Step n={3}>Scroll down and tap <strong>Add to Home Screen</strong> <PlusSquare className="inline w-4 h-4 -mt-0.5 text-indigo-600" />.</Step>
          <Step n={4}>Tap <strong>Add</strong>. The {appName} icon now sits on your home screen.</Step>
        </ol>
      )}
      {tab === 'android' && (
        <ol className="space-y-2">
          <Step n={1}>Open this page in <strong>Chrome</strong>.</Step>
          <Step n={2}>Tap the <strong>⋮</strong> menu (top-right).</Step>
          <Step n={3}>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</Step>
          <Step n={4}>Confirm <strong>Install</strong>. The app appears in your app drawer and home screen.</Step>
        </ol>
      )}
      {tab === 'desktop' && (
        <ol className="space-y-2">
          <Step n={1}>Open {appName} in <strong>Chrome</strong> or <strong>Edge</strong>.</Step>
          <Step n={2}>Click the <strong>install icon</strong> <MonitorDown className="inline w-4 h-4 -mt-0.5 text-indigo-600" /> at the right edge of the address bar.</Step>
          <Step n={3}>Click <strong>Install</strong>. {appName} opens in its own window and pins to your taskbar/dock.</Step>
        </ol>
      )}
    </div>
  );
}

// Reads real per-device push state and either subscribes for real or explains
// exactly what to do. Uses the same usePush hook + endpoints as the bell.
function NotificationSetup({ variant, appName }) {
  const pushBase = variant === 'admin' ? '/notifications' : '/portal';
  const { isSupported, permission, subscribed, busy, subscribe, unsubscribe } = usePush(pushBase);
  const { isIOS, installed } = usePwaInstall();

  const iosNeedsInstall = isIOS && !installed;

  let body;
  if (iosNeedsInstall) {
    body = (
      <div className="text-sm bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-3">
        <p className="font-medium text-gray-900 flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-indigo-600" /> Install the app first
        </p>
        <p className="mt-1 text-gray-600">
          On iPhone and iPad, notifications only work from the installed app. Add {appName} to your
          Home Screen using the steps above, open it from there, then return here to switch them on.
        </p>
      </div>
    );
  } else if (!isSupported) {
    body = (
      <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        This browser doesn’t support push notifications. Try Chrome or Edge — or install the app (see above).
      </div>
    );
  } else if (permission === 'denied') {
    body = (
      <div className="text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
        <p className="font-medium text-amber-900 flex items-center gap-2">
          <BellOff className="w-4 h-4" /> Notifications are blocked for this site
        </p>
        <p className="mt-1 text-amber-800">
          Open your browser’s site settings for this page, set <strong>Notifications</strong> to “Allow”,
          then reload and try again.
        </p>
        {isIOS && (
          <p className="mt-1 text-amber-800">
            On iPhone/iPad: <strong>Settings → Notifications → {appName}</strong> and turn on Allow Notifications.
          </p>
        )}
      </div>
    );
  } else if (subscribed) {
    body = (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <BellRing className="w-4 h-4 flex-shrink-0" />
          Notifications are <strong className="mx-1">on</strong> for this device.
        </div>
        <button onClick={unsubscribe} disabled={busy} className="btn-secondary btn-sm">
          <BellOff className="w-4 h-4" />
          {busy ? 'Turning off…' : 'Turn off on this device'}
        </button>
      </div>
    );
  } else {
    body = (
      <div>
        <button onClick={subscribe} disabled={busy} className="btn-primary">
          <BellRing className="w-4 h-4" />
          {busy ? 'Enabling…' : 'Enable notifications on this device'}
        </button>
        <p className="text-xs text-gray-500 mt-2">
          Your browser will ask for permission — tap <strong>Allow</strong>. You can turn them off here anytime.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-gray-600 mb-4">
        For the most reliable delivery, install the app first (see above) — especially on iPhone,
        where notifications only work from the installed app.
      </p>
      {body}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Block renderer (article body)                                      */
/* ------------------------------------------------------------------ */

// Minimal inline formatting: **bold** and the {app} token.
function inline(text, appName) {
  if (typeof text !== 'string') return text;
  const withApp = text.split('{app}').join(appName);
  const parts = withApp.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} className="font-semibold text-gray-900">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  );
}

function Block({ block, variant, appName }) {
  switch (block.type) {
    case 'h':
      return <h3 className="text-base font-semibold text-gray-900 mt-6 mb-2 first:mt-0">{inline(block.text, appName)}</h3>;
    case 'p':
      return <p className="text-sm text-gray-600 leading-relaxed mb-3">{inline(block.text, appName)}</p>;
    case 'list':
      return (
        <ul className="list-disc pl-5 space-y-1.5 text-sm text-gray-600 mb-4">
          {block.items.map((it, i) => <li key={i}>{inline(it, appName)}</li>)}
        </ul>
      );
    case 'steps':
      return (
        <ol className="space-y-2.5 mb-4">
          {block.items.map((it, i) => <Step key={i} n={i + 1}>{inline(it, appName)}</Step>)}
        </ol>
      );
    case 'tip':
      return (
        <div className="flex gap-2 text-sm bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2.5 mb-4 text-gray-700">
          <Lightbulb className="w-4 h-4 text-indigo-600 flex-shrink-0 mt-0.5" />
          <span>{inline(block.text, appName)}</span>
        </div>
      );
    case 'note':
      return (
        <div className="flex gap-2 text-sm bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 mb-4 text-amber-800">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{inline(block.text, appName)}</span>
        </div>
      );
    case 'actions':
      return (
        <div className="flex flex-wrap gap-2 mb-4">
          {block.items.map((a) => (
            <Link key={a.to} to={a.to} className="btn-secondary btn-sm">
              {a.label}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          ))}
        </div>
      );
    case 'faq':
      return (
        <div className="space-y-2 mb-4">
          {block.items.map((f, i) => (
            <details key={i} className="group border border-gray-200 rounded-lg px-3 py-2.5">
              <summary className="flex items-center justify-between gap-2 cursor-pointer list-none text-sm font-medium text-gray-900">
                {inline(f.q, appName)}
                <ChevronDown className="w-4 h-4 text-gray-400 transition group-open:rotate-180 flex-shrink-0" />
              </summary>
              <p className="mt-2 text-sm text-gray-600 leading-relaxed">{inline(f.a, appName)}</p>
            </details>
          ))}
        </div>
      );
    case 'install':
      return <InstallInstructions appName={appName} />;
    case 'notifications':
      return <NotificationSetup variant={variant} appName={appName} />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Content                                                            */
/* ------------------------------------------------------------------ */

const ADMIN_ARTICLES = [
  {
    slug: 'welcome', category: 'Get started', icon: BookOpen, title: 'Welcome & quick start',
    summary: 'What {app} does and how to get going in your first 15 minutes.',
    blocks: [
      { type: 'p', text: '{app} is an all-in-one academy management app. Run admissions, attendance, fees, timetables, online lessons and parent communication from one place — on your phone or your computer.' },
      { type: 'h', text: 'What you can do' },
      { type: 'list', items: [
        '**Students & classes** — keep your roster, batches and weekly timetable in one place.',
        '**Attendance & fees** — mark attendance in a tap and track every payment.',
        '**Online lessons** — share video courses, quizzes and certificates.',
        '**Parent portal** — families follow attendance, fees and lessons live.',
        '**Notifications** — automatic reminders for classes, fees and new content.',
      ] },
      { type: 'h', text: 'Your first 15 minutes' },
      { type: 'steps', items: [
        'Add a few students under **Students** (or import a list).',
        'Create your batches and weekly timetable under **Classes**.',
        'Mark a session in **Attendance** — parents are notified instantly.',
        'Record a payment or a due in **Fees**.',
        'Invite parents from **Parent Logins** so they can follow along.',
      ] },
      { type: 'actions', items: [
        { label: 'Add a student', to: '/students' },
        { label: 'Set up classes', to: '/classes' },
        { label: 'Invite parents', to: '/student-logins' },
      ] },
      { type: 'h', text: 'Install the app' },
      { type: 'install' },
      { type: 'h', text: 'Turn on notifications' },
      { type: 'notifications' },
      { type: 'tip', text: 'Every screen in {app} is documented here — use the topics list to jump straight to what you need.' },
      { type: 'tip', text: 'Prefer a guided walkthrough? Tap **Show me around** at the top of Help for a tour that highlights each screen as it goes.' },
    ],
  },
  {
    slug: 'dashboard', category: 'Run your academy', icon: LayoutDashboard, title: 'Dashboard',
    summary: 'Your daily home base — today’s classes, attendance and dues at a glance.',
    blocks: [
      { type: 'p', text: 'The Dashboard summarises today’s classes, recent attendance and any outstanding fees so you can see what needs attention the moment you open the app.' },
      { type: 'h', text: 'What you’ll see' },
      { type: 'list', items: [
        '**Today’s classes**, drawn from your timetable.',
        '**Attendance snapshot** for recent sessions.',
        '**Outstanding fees** — totals and who owes what.',
        'Quick links into your most-used screens.',
      ] },
      { type: 'tip', text: 'If the numbers look off and you manage more than one academy, check you’re viewing the right organisation.' },
      { type: 'actions', items: [{ label: 'Open Dashboard', to: '/dashboard' }] },
    ],
  },
  {
    slug: 'students', category: 'Run your academy', icon: Users, title: 'Students',
    summary: 'Your roster — add, import, edit and view each student’s full history.',
    blocks: [
      { type: 'p', text: 'Students is your full roster: contact details, batch, fee plan and a complete per-student history.' },
      { type: 'h', text: 'Add a student' },
      { type: 'steps', items: [
        'Go to **Students** and tap **Add student**.',
        'Enter name, contact number and (optionally) email.',
        'Assign a batch/class and a fee plan if you use them.',
        'Save — the student now appears in attendance, fees and reports.',
      ] },
      { type: 'h', text: 'Import many at once' },
      { type: 'steps', items: [
        'Tap **Import** on the Students page.',
        'Download the sample CSV and fill in your students.',
        'Upload the file — rows are validated and added in bulk.',
      ] },
      { type: 'h', text: 'Edit or view history' },
      { type: 'p', text: 'Tap any student to open their profile: edit details and see attendance, fees, lessons and their parent-login status.' },
      { type: 'h', text: 'Enroll in a course' },
      { type: 'p', text: 'Open a student and use **Courses → Enroll in a course** to add them to any course in one tap. They get access in the portal right away. Picking a course they already have is safe — it simply tells you they are already enrolled.' },
      { type: 'tip', text: 'Keep phone numbers accurate — they’re used for parent logins and notifications.' },
      { type: 'faq', items: [
        { q: 'Can I remove a student?', a: 'Yes — open the student and use the remove option. Their past attendance and fee records are kept for your reports.' },
        { q: 'What’s a batch?', a: 'A batch is a group/class students belong to (e.g. “Beginner — Mon/Wed”). It powers timetable and attendance prefill.' },
      ] },
      { type: 'actions', items: [{ label: 'Open Students', to: '/students' }] },
    ],
  },
  {
    slug: 'groups', category: 'Run your academy', icon: UsersRound, title: 'Groups',
    summary: 'Named groups of students you can reuse across classes and attendance.',
    blocks: [
      { type: 'p', text: 'A group is a reusable set of students — a batch, an ensemble or any cohort you teach together. Build a group once and reuse it when you set up classes and take attendance, instead of picking students one by one each time.' },
      { type: 'note', text: 'Don’t see Groups in the menu? Enable the module in **Settings → Modules**.' },
      { type: 'h', text: 'Create a group' },
      { type: 'steps', items: [
        'Open **Groups** and add a new group.',
        'Give it a clear name (e.g. “Beginners — Mon/Wed”) and an optional description.',
        'Add the students who belong to it.',
        'Save — the group is ready to use when you build a class roster.',
      ] },
      { type: 'h', text: 'Use a group in a class' },
      { type: 'p', text: 'When you create a class you can start from a group’s members and add a few extra students on top, so the roster comes together in seconds.' },
      { type: 'tip', text: 'Mark a group inactive when a batch finishes — its members and history stay, and you can filter it out of the active list.' },
      { type: 'faq', items: [
        { q: 'What’s the difference between a group and a class?', a: 'A group is just a named list of students you reuse. A class adds the schedule — a group can fill a class roster, and the class is what drives the timetable and attendance.' },
      ] },
      { type: 'actions', items: [{ label: 'Open Groups', to: '/groups' }] },
    ],
  },
  {
    slug: 'classes', category: 'Run your academy', icon: Calendar, title: 'Classes & timetable',
    summary: 'Batches and a weekly timetable that prefills attendance.',
    blocks: [
      { type: 'p', text: 'Classes holds your batches and a weekly timetable. The timetable powers attendance — sessions you schedule here prefill the attendance screen automatically.' },
      { type: 'h', text: 'Create a class / batch' },
      { type: 'steps', items: [
        'Go to **Classes** and add a batch with a name and its students.',
        'Open the **Timetable** and place the batch on the days and times it meets.',
        'Set your working hours in **Settings → Schedule** so the grid shades non-working time.',
      ] },
      { type: 'h', text: 'One-off changes' },
      { type: 'p', text: 'Need to cancel or add a session for a single day? Use a timetable exception so your regular weekly pattern stays intact.' },
      { type: 'h', text: 'Online classes & meeting links' },
      { type: 'p', text: 'Set a class type to Online (or Online group) and paste its meeting link (Google Meet, Zoom or Zoho Meet). Parents then see a Join button on that class in their portal.' },
      { type: 'steps', items: [
        'When you add or edit a class, choose an **Online** class type and paste the **Meeting link**.',
        'Leave a class link blank to fall back to your **academy default link** from **Settings → Working hours → Online classes**.',
        'In Settings, pick your provider and paste one default link that every online class can reuse.',
      ] },
      { type: 'h', text: 'Send a fresh link & notify students' },
      { type: 'p', text: 'Generate a meeting on any platform, then push the link to students at session time. The link is saved to the class (so the Join button updates) and a notification is sent to the students you choose.' },
      { type: 'steps', items: [
        'On the **Classes** page, tap the **video icon** on an online class — or open the class in **Attendance** and tap **Send meeting link**.',
        'Paste the link. In Attendance you can tick **which students** receive it; from Classes it goes to the whole batch.',
        'Tap **Send** — each student gets a push and a portal notification with the link.',
      ] },
      { type: 'tip', text: 'The message wording comes from the **Online meeting link** template in **Settings → Templates**, where you can edit it (placeholders: {class_name}, {time}, {link}, {name}).' },
      { type: 'tip', text: 'For a permanent Google Meet link, create it with “Create a meeting for later” (or attach it to a recurring Calendar event) — that URL stays the same every time. An “instant meeting” link changes each time, so it will not work as a default.' },
      { type: 'tip', text: 'The timetable shades hours outside your working day, so free slots are easy to spot.' },
      { type: 'h', text: 'Camps & workshops' },
      { type: 'p', text: 'If the Camps module is on, a camp runs across several dated days. You can reschedule or cancel a single day while the rest stay as they are.' },
      { type: 'steps', items: [
        'Open a camp and find the day you want to change.',
        'Tap **Move** to set a new date or time for just that day.',
        'Tap **Cancel** to take a day off; it then shows as Cancelled with a **Restore** option.',
      ] },
      { type: 'note', text: 'A cancelled day drops out of attendance for that date, so it will not appear as a session to mark.' },
      { type: 'actions', items: [{ label: 'Open Classes', to: '/classes' }] },
    ],
  },
  {
    slug: 'attendance', category: 'Run your academy', icon: ClipboardCheck, title: 'Attendance',
    summary: 'Mark presence in a tap; parents are notified automatically.',
    blocks: [
      { type: 'p', text: 'Attendance lets you mark who’s present in a tap. The day’s sessions prefill from your timetable, and parents of absentees are notified automatically.' },
      { type: 'h', text: 'Mark attendance' },
      { type: 'steps', items: [
        'Open **Attendance** — today’s scheduled batch is loaded for you.',
        'Tap each student **Present** or **Absent** (or mark all present, then flip the exceptions).',
        'Save. Parents of absentees are notified, and the record feeds your reports.',
      ] },
      { type: 'h', text: 'A different day or batch' },
      { type: 'p', text: 'Use the date and batch controls at the top to record or review any other session.' },
      { type: 'tip', text: 'After recording, the view groups Present and Absent students so you can double-check at a glance.' },
      { type: 'faq', items: [
        { q: 'Do parents see attendance?', a: 'Yes — it appears in their portal’s Class History, and absentees get a notification.' },
      ] },
      { type: 'actions', items: [{ label: 'Take attendance', to: '/attendance' }] },
    ],
  },
  {
    slug: 'fees', category: 'Run your academy', icon: IndianRupee, title: 'Fees',
    summary: 'Track dues and payments, send reminders, share receipts.',
    blocks: [
      { type: 'p', text: 'Fees tracks dues and payments for every student, with reminders and receipts.' },
      { type: 'h', text: 'Record a payment or due' },
      { type: 'steps', items: [
        'Open **Fees** and find the student.',
        'Add a due (amount + date) or log a payment received.',
        'The balance updates and the parent sees it in their portal.',
      ] },
      { type: 'h', text: 'Reminders' },
      { type: 'p', text: 'Send fee reminders to parents without leaving the app; upcoming and overdue amounts are highlighted.' },
      { type: 'h', text: 'Let parents pay by UPI / QR' },
      { type: 'p', text: 'Add your payment details once and parents get a scannable QR plus a tap-to-pay button on their Fees tab. You can set this up in two ways:' },
      { type: 'list', items: [
        '**Enter a UPI ID** — {app} generates the QR for you and fills in the amount due automatically.',
        '**Upload your own QR image** — use this if your bank or payment app gave you a ready-made QR.',
      ] },
      { type: 'steps', items: [
        'Go to **Settings → Billing → Payment QR for parents**.',
        'Enter your **UPI ID** and **payee name** (and an optional note), or upload your own **QR image**.',
        'Save.',
      ] },
      { type: 'h', text: 'What parents see' },
      { type: 'list', items: [
        'On a **computer** — a QR to scan with their phone.',
        'On a **phone** — a “Pay now” button that opens their UPI app (GPay, PhonePe, Paytm) with the outstanding balance prefilled.',
        'A button to **copy your UPI ID**, plus your payee name and note.',
      ] },
      { type: 'tip', text: 'A UPI ID is the cleaner choice — the amount is filled in for the parent and there is no image to keep up to date. Payment itself is handled by the parent’s own UPI app; {app} does not process the money.' },
      { type: 'tip', text: 'Set fee plans on students so dues can be generated consistently.' },
      { type: 'actions', items: [{ label: 'Open Fees', to: '/fees' }] },
    ],
  },
  {
    slug: 'lessons', category: 'Teach online', icon: Video, title: 'Lessons, quizzes & certificates',
    summary: 'Build video courses, add quizzes, and award certificates.',
    blocks: [
      { type: 'p', text: 'Lessons is your online classroom: organise video courses, add quizzes, and award completion certificates.' },
      { type: 'h', text: 'Create a course & add lessons' },
      { type: 'steps', items: [
        'Go to **Lessons** and create a course.',
        'Add lessons — paste a video link (it plays inside {app} with native sharing and external controls hidden) or add a **Quiz** lesson.',
        'Arrange the order; students watch top to bottom.',
      ] },
      { type: 'h', text: 'Quizzes' },
      { type: 'steps', items: [
        'Add a lesson and choose the **Quiz** type.',
        'Write questions and mark the correct answers; mark it **required** if it must be passed to continue.',
        'Students take it in the portal and you see their results.',
      ] },
      { type: 'h', text: 'Certificates' },
      { type: 'p', text: 'When a student completes a course (including any required quizzes), {app} issues a downloadable completion certificate automatically.' },
      { type: 'tip', text: 'Required quizzes gate progress — students must pass before the course counts as complete.' },
      { type: 'faq', items: [
        { q: 'Which video links work?', a: 'Standard video URLs are supported and play in a clean in-app player with sharing and external controls hidden.' },
      ] },
      { type: 'actions', items: [{ label: 'Open Lessons', to: '/lessons' }] },
    ],
  },
  {
    slug: 'certificate', category: 'Teach online', icon: Award, title: 'Certificates & branding',
    summary: 'Design the completion certificate students earn — your wording, logo, seal and colours.',
    blocks: [
      { type: 'p', text: 'When a student finishes a course (including any required quizzes), {app} issues a downloadable completion certificate. You decide how it looks and reads from one place.' },
      { type: 'h', text: 'Turn certificates on' },
      { type: 'steps', items: [
        'Go to **Settings → Certificate**.',
        'Switch **Offer certificates** on.',
        'A live preview updates as you change each option below.',
      ] },
      { type: 'h', text: 'What you can customise' },
      { type: 'list', items: [
        '**Title & body** — the heading (e.g. “Certificate of Completion”) and the line of wording under the student’s name.',
        '**Signatory name** — who the certificate is signed by.',
        '**Your logo** — upload it to brand the certificate.',
        '**Signature image** — upload a signature to print above the signatory name.',
        '**Student photo, seal and footer** — toggle each on or off.',
        '**Brand colour** — use your academy accent colour on the certificate.',
        '**Verification** — when on, a QR/verification mark is added so the certificate can be checked as genuine.',
      ] },
      { type: 'tip', text: 'Upload a transparent PNG for your logo and signature so they sit cleanly on the certificate background.' },
      { type: 'faq', items: [
        { q: 'When is a certificate issued?', a: 'Automatically, the moment a student completes every lesson in a course and passes any required quizzes.' },
        { q: 'Can I change the design later?', a: 'Yes — update the options any time. New certificates use the latest design.' },
      ] },
      { type: 'actions', items: [{ label: 'Open Settings', to: '/settings' }] },
    ],
  },
  {
    slug: 'assignments', category: 'Teach online', icon: ClipboardList, title: 'Assignments',
    summary: 'Set work and track what’s due. (Optional module.)',
    blocks: [
      { type: 'p', text: 'Set assignments for your students and track what’s been given and what’s due.' },
      { type: 'note', text: 'Don’t see Assignments in the menu? Enable the module in **Settings → Modules**.' },
      { type: 'h', text: 'Create an assignment' },
      { type: 'steps', items: [
        'Open **Assignments** and tap add.',
        'Give it a title, description and due date.',
        'Save — students and parents see it in their portal.',
      ] },
      { type: 'actions', items: [{ label: 'Open Assignments', to: '/assignments' }] },
    ],
  },
  {
    slug: 'question-papers', category: 'Teach online', icon: FileText, title: 'Question papers',
    summary: 'Share practice and exam papers to download. (Optional module.)',
    blocks: [
      { type: 'p', text: 'Share practice and exam papers for students to download.' },
      { type: 'note', text: 'Don’t see Question Papers? Enable the module in **Settings → Modules**.' },
      { type: 'h', text: 'Add a paper' },
      { type: 'steps', items: [
        'Open **Question Papers** and add a new paper.',
        'Upload the file and give it a clear title.',
        'It appears in the portal for students to download.',
      ] },
      { type: 'actions', items: [{ label: 'Open Question Papers', to: '/question-papers' }] },
    ],
  },
  {
    slug: 'reports', category: 'Insights & setup', icon: BarChart3, title: 'Reports',
    summary: 'Trends for attendance, fee collection and lesson activity.',
    blocks: [
      { type: 'p', text: 'Reports turns your day to day data into trends. Every report works on a phone, and the charts follow your light or dark theme.' },
      { type: 'h', text: 'Always available' },
      { type: 'list', items: [
        '**Student report** with full class history, fees and lesson progress.',
        '**Monthly report** across all students for any month.',
        '**Overall report** with attendance, fees and class mix at a glance.',
        '**Lesson activity** showing who is watching and completing.',
      ] },
      { type: 'h', text: 'Detailed reports (Complete plan)' },
      { type: 'p', text: 'On the Complete plan you also get six deeper reports, each with a colourful chart.' },
      { type: 'list', items: [
        '**Revenue trend** month by month, with this month compared to last.',
        '**Fees due** for any month, with the total and a per student list.',
        '**Retention** showing active vs inactive students and new joins.',
        '**Attendance by slot** across the week and per class.',
        '**Course completion** rates per course.',
        '**Class capacity** showing how full each batch runs.',
      ] },
      { type: 'h', text: 'Filter, export and drill in' },
      { type: 'steps', items: [
        'Pick a **month or range** at the top of a report to focus the numbers.',
        'Tap a student in **Fees due** to open their combined **statement** for that month.',
        'Use **CSV**, **PDF** or **Print** on any detailed report to share or file it.',
      ] },
      { type: 'tip', text: 'On a phone, wide tables switch to easy to read cards, and charts scale to fit.' },
      { type: 'actions', items: [{ label: 'Open Reports', to: '/reports' }] },
    ],
  },
  {
    slug: 'notifications', category: 'Communicate', icon: Bell, title: 'Notifications & messaging',
    summary: 'Automatic alerts to parents, plus your own in-app inbox.',
    blocks: [
      { type: 'p', text: '{app} keeps parents informed automatically and lets you reach them directly.' },
      { type: 'h', text: 'Automatic alerts parents receive' },
      { type: 'list', items: [
        'Attendance marked (absentees).',
        'Fee dues and reminders.',
        'New lessons, quizzes and assignments.',
        'A daily morning class digest, plus a weekly summary.',
        'Online class meeting links you send from a class.',
      ] },
      { type: 'h', text: 'Turn on notifications for yourself' },
      { type: 'notifications' },
      { type: 'h', text: 'The notification bell' },
      { type: 'p', text: 'The bell in the top bar is your in-app inbox with unread counts; tap an item to jump straight to the relevant screen.' },
    ],
  },
  {
    slug: 'parent-logins', category: 'Communicate', icon: KeyRound, title: 'Parent logins',
    summary: 'Invite families into the parent portal.',
    blocks: [
      { type: 'p', text: 'Parent Logins lets families into the parent portal to follow their child’s progress.' },
      { type: 'h', text: 'Invite a parent' },
      { type: 'steps', items: [
        'Open **Parent Logins**.',
        'Find the student and create an invite using the parent’s contact.',
        'Share the sign-in link; the parent sets their own password on first login.',
      ] },
      { type: 'tip', text: 'Each parent sees only their own child’s data.' },
      { type: 'faq', items: [
        { q: 'Can one parent see two children?', a: 'Yes, if both students are linked to the same parent contact.' },
      ] },
      { type: 'actions', items: [{ label: 'Open Parent Logins', to: '/student-logins' }] },
    ],
  },
  {
    slug: 'settings', category: 'Insights & setup', icon: SettingsIcon, title: 'Settings & branding',
    summary: 'Your academy name and logo, theme, working hours and modules.',
    blocks: [
      { type: 'p', text: 'Settings is where you tailor {app} to your academy.' },
      { type: 'list', items: [
        '**Profile / branding** — your academy name and logo, shown across the app and to parents.',
        '**Appearance** — light/dark theme and accent colour.',
        '**Schedule** — working hours that shape the timetable grid.',
        '**Modules** — turn optional features on or off (Groups, Fees, Messages, Reports, Lessons, Assignments, Question Papers).',
      ] },
      { type: 'tip', text: 'Upload your logo here — it replaces the default mark in the sidebar and on parent screens.' },
      { type: 'actions', items: [{ label: 'Open Settings', to: '/settings' }] },
    ],
  },
  {
    slug: 'install-app', category: 'Insights & setup', icon: Smartphone, title: 'Install the app',
    summary: 'Add {app} to your phone or desktop for instant, full-screen access.',
    blocks: [
      { type: 'p', text: '{app} is a PWA — install it to your phone or desktop for a full-screen, app-like experience that opens instantly and supports notifications.' },
      { type: 'install' },
      { type: 'faq', items: [
        { q: 'Is it in the App Store / Play Store?', a: 'No download stores needed — you install straight from the browser using the steps above.' },
      ] },
    ],
  },
  {
    slug: 'faq', category: 'Help', icon: HelpCircle, title: 'FAQ & troubleshooting',
    summary: 'Quick answers to the most common questions.',
    blocks: [
      { type: 'faq', items: [
        { q: 'I’m not getting notifications.', a: 'Open the **Notifications** topic and enable them on this device. On iPhone/iPad you must install the app first.' },
        { q: 'Sign-out isn’t working.', a: 'Use the sign-out option in the sidebar; it clears your session and returns you to the login page. If a page seems stuck, refresh once.' },
        { q: 'A feature is missing from the menu.', a: 'Some modules (Assignments, Question Papers) are optional — enable them in **Settings → Modules**.' },
        { q: 'The app looks out of date after an update.', a: 'Refresh the page, or close and reopen the installed app, to pick up the latest version.' },
      ] },
      { type: 'p', text: 'Still stuck? Reach us using the contacts below.' },
    ],
  },
];

const PARENT_ARTICLES = [
  {
    slug: 'welcome', category: 'Get started', icon: BookOpen, title: 'Welcome',
    summary: 'Your window into your child’s learning — and how to get going.',
    blocks: [
      { type: 'p', text: 'Welcome to {app} — your window into your child’s learning. Follow classes, attendance, fees and lessons in one place, on your phone or computer.' },
      { type: 'h', text: 'What you can do' },
      { type: 'list', items: [
        'See **upcoming classes** and **attendance** history.',
        'Check **fees** — what’s due and what’s paid.',
        'Watch **lessons**, take **quizzes** and earn **certificates**.',
        'Get **notifications** for classes, fees and new content.',
      ] },
      { type: 'h', text: 'Get going' },
      { type: 'steps', items: [
        'Open your **Overview** to see today at a glance.',
        'Visit **My Lessons** to start learning.',
        'Turn on notifications so you never miss an update.',
      ] },
      { type: 'actions', items: [
        { label: 'Open Overview', to: '/portal/dashboard' },
        { label: 'My Lessons', to: '/portal/lessons' },
      ] },
      { type: 'h', text: 'Install the app' },
      { type: 'install' },
      { type: 'h', text: 'Turn on notifications' },
      { type: 'notifications' },
    ],
  },
  {
    slug: 'overview', category: 'Your child', icon: LayoutDashboard, title: 'Overview',
    summary: 'Today at a glance — classes, attendance and fees.',
    blocks: [
      { type: 'p', text: 'Your Overview summarises upcoming classes, recent attendance and any pending fees.' },
      { type: 'list', items: [
        'Next classes from the timetable.',
        'Latest attendance.',
        'Outstanding fees, if any.',
      ] },
      { type: 'tip', text: 'For an online class, a **Join** button appears on the upcoming class card. It turns solid from 15 minutes before the class starts, so you can join on time.' },
      { type: 'actions', items: [{ label: 'Open Overview', to: '/portal/dashboard' }] },
    ],
  },
  {
    slug: 'attendance', category: 'Your child', icon: ClipboardCheck, title: 'Class history',
    summary: 'Every session your child was marked present or absent.',
    blocks: [
      { type: 'p', text: 'Class History shows every session your child was marked present or absent.' },
      { type: 'tip', text: 'If something looks wrong, contact your academy — they record attendance.' },
      { type: 'actions', items: [{ label: 'Open Class History', to: '/portal/attendance' }] },
    ],
  },
  {
    slug: 'fees', category: 'Your child', icon: IndianRupee, title: 'Fees',
    summary: 'Dues and payment history, always up to date.',
    blocks: [
      { type: 'p', text: 'Fees lists your dues and payment history so there are no surprises.' },
      { type: 'list', items: ['Amounts due and their dates.', 'Payments already recorded.'] },
      { type: 'h', text: 'Pay by UPI' },
      { type: 'p', text: 'If your academy has set up online payments, you can pay straight from the Fees tab.' },
      { type: 'steps', items: [
        'On a phone, tap **Pay now** — your UPI app (GPay, PhonePe, Paytm) opens with the balance prefilled.',
        'On a computer, scan the QR code with your phone’s UPI app.',
      ] },
      { type: 'note', text: 'Payments are recorded by your academy. After paying, it may take a little time to show here once they confirm it.' },
      { type: 'actions', items: [{ label: 'Open Fees', to: '/portal/fees' }] },
    ],
  },
  {
    slug: 'lessons', category: 'Learning', icon: Video, title: 'My Lessons, quizzes & certificates',
    summary: 'Watch courses, take quizzes, and earn certificates.',
    blocks: [
      { type: 'p', text: 'My Lessons holds the video courses and quizzes your teacher shares.' },
      { type: 'h', text: 'Watch & progress' },
      { type: 'steps', items: [
        'Open **My Lessons** and pick a course.',
        'Watch lessons in order.',
        'Complete any required quiz to keep going.',
      ] },
      { type: 'h', text: 'Quizzes & certificates' },
      { type: 'p', text: 'Some lessons are quizzes — answer the questions to continue. Finish a whole course (including required quizzes) to unlock its **completion certificate**, which you can download.' },
      { type: 'actions', items: [{ label: 'Open My Lessons', to: '/portal/lessons' }] },
    ],
  },
  {
    slug: 'assignments', category: 'Learning', icon: ClipboardList, title: 'Assignments',
    summary: 'See what’s been set and what’s due.',
    blocks: [
      { type: 'p', text: 'Assignments shows what your teacher has set and when it’s due.' },
      { type: 'actions', items: [{ label: 'Open Assignments', to: '/portal/assignments' }] },
    ],
  },
  {
    slug: 'question-papers', category: 'Learning', icon: FileText, title: 'Question papers',
    summary: 'Download practice and exam papers.',
    blocks: [
      { type: 'p', text: 'Download practice and exam papers your teacher shares.' },
      { type: 'actions', items: [{ label: 'Open Question Papers', to: '/portal/papers' }] },
    ],
  },
  {
    slug: 'profile', category: 'Your account', icon: UserCircle2, title: 'My Profile',
    summary: 'Keep details and photo current for paperwork.',
    blocks: [
      { type: 'p', text: 'My Profile keeps your details current — they feed exam paperwork and certificates.' },
      { type: 'h', text: 'Add a photo' },
      { type: 'steps', items: [
        'Open **My Profile**.',
        'Add or update your details.',
        'Upload a passport-style photo for paperwork.',
      ] },
      { type: 'tip', text: 'Accurate details mean correct names and photos on certificates.' },
      { type: 'actions', items: [{ label: 'Open My Profile', to: '/portal/profile' }] },
    ],
  },
  {
    slug: 'notifications', category: 'Your account', icon: Bell, title: 'Notifications',
    summary: 'Get alerts for attendance, fees and new lessons.',
    blocks: [
      { type: 'p', text: 'Get alerts the moment attendance is marked, a fee falls due, or a new lesson arrives.' },
      { type: 'notifications' },
      { type: 'p', text: 'The bell in the top bar is your in-app inbox — tap an item to open it.' },
    ],
  },
  {
    slug: 'install-app', category: 'Your account', icon: Smartphone, title: 'Install the app',
    summary: 'Add {app} to your home screen for instant access.',
    blocks: [
      { type: 'p', text: 'Install {app} to your home screen for instant, full-screen access and reliable notifications.' },
      { type: 'install' },
    ],
  },
  {
    slug: 'faq', category: 'Help', icon: HelpCircle, title: 'FAQ',
    summary: 'Quick answers for parents and students.',
    blocks: [
      { type: 'faq', items: [
        { q: 'I can’t see my child’s data.', a: 'Make sure you signed in with the contact your academy linked. If it’s still empty, contact them to check your login.' },
        { q: 'Notifications aren’t arriving.', a: 'Open the **Notifications** topic and enable them on this device. On iPhone/iPad, install the app first.' },
        { q: 'A video won’t play.', a: 'Check your connection and refresh. Lessons play inside the app; you don’t need any other app.' },
      ] },
      { type: 'p', text: 'Need more help? Your academy can assist — or reach us using the contacts below.' },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

function groupByCategory(articles) {
  const groups = [];
  for (const a of articles) {
    let g = groups.find((x) => x.cat === a.category);
    if (!g) { g = { cat: a.category, items: [] }; groups.push(g); }
    g.items.push(a);
  }
  return groups;
}

export default function HelpGuide({ variant = 'parent', basePath, slug }) {
  const branding = useOrgBranding();
  const appName = branding.name || BRAND_NAME;
  const navigate = useNavigate();
  const topRef = useRef(null);

  const articles = variant === 'admin' ? ADMIN_ARTICLES : PARENT_ARTICLES;
  const base = basePath || (variant === 'admin' ? '/help' : '/portal/help');
  const current = articles.find((a) => a.slug === slug) || articles[0];
  const idx = articles.indexOf(current);
  const prev = idx > 0 ? articles[idx - 1] : null;
  const next = idx < articles.length - 1 ? articles[idx + 1] : null;
  const groups = groupByCategory(articles);

  // Scroll to the top of the article when the topic changes (works inside the
  // app's scrollable main area, not just the window).
  useEffect(() => {
    try { topRef.current?.scrollIntoView({ block: 'start' }); } catch { /* ignore */ }
  }, [current.slug]);

  const CurrentIcon = current.icon;

  return (
    <div className="max-w-6xl mx-auto" ref={topRef}>
      <header className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 mb-1">Help &amp; Guide</p>
          <h2 className="page-header mb-1">{appName} documentation</h2>
          <p className="text-sm text-gray-500">
            {variant === 'admin'
              ? 'Everything you need to run your academy — module by module.'
              : 'Everything you need to follow your child’s progress.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start sm:self-auto flex-shrink-0">
          {hasFullTour(variant) && (
            <button
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent(LAUNCH_TOUR_EVENT, { detail: { variant, slug: FULL_TOUR_SLUG } })
                )
              }
              className="btn-primary btn-sm"
              title="Walk through every module, one after another"
            >
              <Footprints className="w-4 h-4" />
              Take the full tour
            </button>
          )}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent(REPLAY_EVENT))}
            className="btn-secondary btn-sm"
            title="Play the first-login welcome walkthrough again"
          >
            <RotateCcw className="w-4 h-4" />
            Replay welcome tour
          </button>
        </div>
      </header>

      {/* Mobile topic picker */}
      <select
        value={current.slug}
        onChange={(e) => navigate(`${base}/${e.target.value}`)}
        className="select-field lg:hidden mb-5"
        aria-label="Choose a help topic"
      >
        {groups.map((g) => (
          <optgroup key={g.cat} label={g.cat}>
            {g.items.map((a) => <option key={a.slug} value={a.slug}>{a.title}</option>)}
          </optgroup>
        ))}
      </select>

      <div className="lg:grid lg:grid-cols-[230px_1fr] lg:gap-8 items-start">
        {/* Sidebar TOC */}
        <nav className="hidden lg:block lg:sticky lg:top-4 self-start text-sm" aria-label="Help topics">
          {groups.map((g) => (
            <div key={g.cat} className="mb-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">{g.cat}</p>
              <ul className="space-y-0.5">
                {g.items.map((a) => {
                  const active = a.slug === current.slug;
                  return (
                    <li key={a.slug}>
                      <Link
                        to={`${base}/${a.slug}`}
                        className={`block px-2.5 py-1.5 rounded-md transition-colors ${
                          active
                            ? 'bg-indigo-50 text-indigo-700 font-medium dark:bg-indigo-600/20'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                      >
                        {a.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Article */}
        <div className="min-w-0">
          <article className="card">
            <div className="flex items-start gap-3 mb-4 pb-4 border-b border-gray-100">
              <span className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
                <CurrentIcon className="w-5 h-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-bold text-gray-900">{current.title}</h1>
                {current.summary && (
                  <p className="text-sm text-gray-500 mt-0.5">{inline(current.summary, appName)}</p>
                )}
              </div>
              {/* Launch the live, navigate-and-highlight tour for this module. */}
              {hasModuleTour(variant, current.slug) && (
                <button
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent(LAUNCH_TOUR_EVENT, { detail: { variant, slug: current.slug } })
                    )
                  }
                  className="btn-primary btn-sm flex-shrink-0 self-start"
                  title={`Take a quick guided tour of ${current.title}`}
                >
                  <Compass className="w-4 h-4" />
                  Show me around
                </button>
              )}
            </div>

            {current.blocks.map((b, i) => (
              <Block key={i} block={b} variant={variant} appName={appName} />
            ))}
          </article>

          {/* Prev / Next */}
          <div className="flex items-stretch gap-3 mt-4">
            {prev ? (
              <Link to={`${base}/${prev.slug}`} className="flex-1 card hover:border-indigo-200 transition-colors flex items-center gap-2 text-left">
                <ArrowLeft className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[11px] text-gray-400">Previous</span>
                  <span className="block text-sm font-medium text-gray-900 truncate">{prev.title}</span>
                </span>
              </Link>
            ) : <span className="flex-1" />}
            {next ? (
              <Link to={`${base}/${next.slug}`} className="flex-1 card hover:border-indigo-200 transition-colors flex items-center justify-end gap-2 text-right">
                <span className="min-w-0">
                  <span className="block text-[11px] text-gray-400">Next</span>
                  <span className="block text-sm font-medium text-gray-900 truncate">{next.title}</span>
                </span>
                <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
              </Link>
            ) : <span className="flex-1" />}
          </div>

          {/* Contact */}
          <div className="card mt-4">
            <div className="flex items-center gap-2 mb-3">
              <Phone className="w-5 h-5 text-indigo-600" />
              <h3 className="text-base font-semibold text-gray-900">Need a hand?</h3>
            </div>
            <p className="text-sm text-gray-600 mb-3">
              {variant === 'admin'
                ? 'We’re happy to help you get set up or answer any question.'
                : `If something doesn’t look right, your academy can help — or reach the ${BRAND_NAME} team:`}
            </p>
            <div className="flex flex-wrap gap-2">
              <a href={`tel:${SUPPORT_PHONE_TEL}`} className="btn-secondary btn-sm">
                <Phone className="w-4 h-4" /> {SUPPORT_PHONE_DISPLAY}
              </a>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="btn-secondary btn-sm">
                <Mail className="w-4 h-4" /> {SUPPORT_EMAIL}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
