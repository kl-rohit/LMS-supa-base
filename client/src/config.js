// GENERATED FILE — do not edit by hand.
// Edit values in config.master.js (repo root) then run `npm run config:gen`
// (build / deploy run it automatically). Hand edits here are overwritten.
// =============================================================================
// FRONTEND CONFIG  (client/src/config.js)  — GENERATED from config.master.js
// =============================================================================
// Brand fallbacks, support contacts, and locale defaults for the React app.
// Each academy still sets its own display name + logo via in-app branding;
// BRAND_NAME below is only the platform fallback shown before that loads.
// =============================================================================

// ---- Brand / support -------------------------------------------------------
export const BRAND_NAME    = 'VidyaSetu';
export const SUPPORT_EMAIL = 'support@veena.app';
export const SUPPORT_PHONE_TEL     = '+919360390883';
export const SUPPORT_PHONE_DISPLAY = '+91 93603 90883';

// ---- Locale / region -------------------------------------------------------
export const DEFAULT_COUNTRY_CODE = '91';
export const DEFAULT_LOCALE       = 'en-IN';
export const DEFAULT_CURRENCY     = 'INR';
export const CURRENCY_SYMBOL      = '₹';

// ---- Pricing (display copy only — billing is not wired) --------------------
// Live (offer) per-student / month prices. The struck-through "regular" anchors
// used on the marketing landing page live in config.master.js too.
export const PLAN_PRICES = {
  core:     1000,
  complete: 2000,
};

// Full pricing detail (base, included students, per-student, struck regulars)
// for the Platform Admin plans comparison.
export const PLAN_PRICING = {
  currency: '₹',
  offerName: 'Limited-time launch offer · introductory pricing',
  core:     { base: 1000, baseRegular: 1500, included: 15, perStudent: 50, perStudentRegular: 75 },
  complete: { base: 2000, baseRegular: 2999, included: 15, perStudent: 90, perStudentRegular: 130 },
};

// Module keys unlocked only on the Complete plan, derived from the feature
// catalog in config.master.js. useModuleFlags reads this to force-hide a
// premium module the org's plan does not include.
export const PREMIUM_MODULES = ['assignments', 'lessons', 'question_papers'];

// Per-feature plan availability (key -> { core, complete }), used by featureOn
// to hide a feature's UI when the org's plan does not include it.
export const FEATURE_PLANS = {
    'students.profiles': { core: true, complete: true },
    'students.contacts': { core: true, complete: true },
    'students.photos': { core: true, complete: true },
    'groups.batches': { core: true, complete: true },
    'students.import': { core: true, complete: true },
    'attendance.daily': { core: true, complete: true },
    'attendance.rosters': { core: true, complete: true },
    'fees.tracking': { core: true, complete: true },
    'fees.perStudent': { core: true, complete: true },
    'fees.additional': { core: true, complete: true },
    'fees.reminders': { core: true, complete: true },
    'fees.statements': { core: true, complete: true },
    'fees.upi_qr': { core: true, complete: true },
    'classes.timetable': { core: true, complete: true },
    'classes.types': { core: true, complete: true },
    'classes.join_links': { core: true, complete: true },
    'classes.exceptions': { core: true, complete: true },
    'camps.run': { core: true, complete: true },
    'camps.roster': { core: true, complete: true },
    'messages.send': { core: true, complete: true },
    'messages.bulk': { core: true, complete: true },
    'messages.templates': { core: true, complete: true },
    'notify.auto': { core: true, complete: true },
    'notify.bell': { core: true, complete: true },
    'notify.push': { core: true, complete: true },
    'notify.digest': { core: true, complete: true },
    'portal.login': { core: true, complete: true },
    'portal.glance': { core: true, complete: true },
    'portal.profile': { core: true, complete: true },
    'portal.feed': { core: true, complete: true },
    'portal.learning': { core: false, complete: true },
    'lessons.build': { core: false, complete: true },
    'lessons.player': { core: false, complete: true },
    'lessons.resources': { core: false, complete: true },
    'lessons.progress': { core: false, complete: true },
    'lessons.enrol': { core: false, complete: true },
    'quizzes.add': { core: false, complete: true },
    'quizzes.standalone': { core: false, complete: true },
    'quizzes.gate': { core: false, complete: true },
    'quizzes.analytics': { core: false, complete: true },
    'quizzes.certs': { core: false, complete: true },
    'assignments.assign': { core: false, complete: true },
    'assignments.due': { core: false, complete: true },
    'assignments.notify': { core: false, complete: true },
    'papers.share': { core: false, complete: true },
    'papers.prep': { core: false, complete: true },
    'reports.basic': { core: true, complete: true },
    'reports.detailed': { core: false, complete: true },
    'reports.lessons': { core: false, complete: true },
    'reports.quiz': { core: false, complete: true },
    'reports.pdf': { core: true, complete: true },
    'pwa.install': { core: true, complete: true },
    'pwa.a2hs': { core: true, complete: true },
    'pwa.theme': { core: true, complete: true },
    'multi.branches': { core: true, complete: true },
    'multi.isolated': { core: true, complete: true },
    'data.export': { core: true, complete: true },
    'support.setup': { core: true, complete: true },
    'support.human': { core: true, complete: true },
  };

// Full feature catalog (categories + labels + plan flags) for the Platform
// Admin plans/pricing comparison view.
export const FEATURE_CATALOG = [
  { name: 'Students & Attendance', items: [
      { key: 'students.profiles', label: 'Student profiles & full history', core: true, complete: true, enforce: 'module' },
      { key: 'students.contacts', label: 'Parent contacts (kept private)', core: true, complete: true, enforce: 'inherent' },
      { key: 'students.photos', label: 'Student photos', core: true, complete: true, enforce: 'client' },
      { key: 'groups.batches', label: 'Groups & batches', core: true, complete: true, enforce: 'module' },
      { key: 'students.import', label: 'Bulk CSV import', core: true, complete: true, enforce: 'inline' },
      { key: 'attendance.daily', label: 'One-tap daily attendance', core: true, complete: true, enforce: 'module' },
      { key: 'attendance.rosters', label: 'Auto-built class rosters', core: true, complete: true, enforce: 'inherent' }
  ] },
  { name: 'Fees & Payments', items: [
      { key: 'fees.tracking', label: 'Fee tracking & dues', core: true, complete: true, enforce: 'module' },
      { key: 'fees.perStudent', label: 'Per-student fee plans', core: true, complete: true, enforce: 'client' },
      { key: 'fees.additional', label: 'Additional charges & discounts', core: true, complete: true, enforce: 'inline' },
      { key: 'fees.reminders', label: 'Automatic monthly reminders', core: true, complete: true, enforce: 'inline' },
      { key: 'fees.statements', label: 'Monthly statements per student', core: true, complete: true, enforce: 'inherent' },
      { key: 'fees.upi_qr', label: 'UPI & pay-by-QR collection', core: true, complete: true, enforce: 'inline' }
  ] },
  { name: 'Classes & Scheduling', items: [
      { key: 'classes.timetable', label: 'Weekly timetable grid', core: true, complete: true, enforce: 'module' },
      { key: 'classes.types', label: 'Online, in-person & group classes', core: true, complete: true, enforce: 'inherent' },
      { key: 'classes.join_links', label: 'One-tap join links for online classes', core: true, complete: true, enforce: 'inline' },
      { key: 'classes.exceptions', label: 'Reschedule or cancel a single date', core: true, complete: true, enforce: 'inline' }
  ] },
  { name: 'Camps & Workshops', items: [
      { key: 'camps.run', label: 'Short-term camps & intensives', core: true, complete: true, enforce: 'module' },
      { key: 'camps.roster', label: 'Own dates, roster & attendance', core: true, complete: true, enforce: 'inherent' }
  ] },
  { name: 'Communication & Notifications', items: [
      { key: 'messages.send', label: 'WhatsApp & in-app messaging', core: true, complete: true, enforce: 'module' },
      { key: 'messages.bulk', label: 'Bulk "Send all" messages', core: true, complete: true, enforce: 'client' },
      { key: 'messages.templates', label: 'Editable message templates', core: true, complete: true, enforce: 'inline' },
      { key: 'notify.auto', label: 'Absence alerts & fee reminders', core: true, complete: true, enforce: 'inherent' },
      { key: 'notify.bell', label: 'In-app notification bell', core: true, complete: true, enforce: 'client' },
      { key: 'notify.push', label: 'Web-push to the lock screen', core: true, complete: true, enforce: 'inline' },
      { key: 'notify.digest', label: 'Automatic morning class digest', core: true, complete: true, enforce: 'inherent' }
  ] },
  { name: 'Parent Portal', items: [
      { key: 'portal.login', label: 'Secure per-family login', core: true, complete: true, enforce: 'inherent' },
      { key: 'portal.glance', label: 'Attendance & fees at a glance', core: true, complete: true, enforce: 'inherent' },
      { key: 'portal.profile', label: 'Profile self-service', core: true, complete: true, enforce: 'inline' },
      { key: 'portal.feed', label: '"For you" activity feed', core: true, complete: true, enforce: 'inherent' },
      { key: 'portal.learning', label: 'Lessons & assignments view', core: false, complete: true, enforce: 'module' }
  ] },
  { name: 'Lessons & Courses', items: [
      { key: 'lessons.build', label: 'Build video courses', core: false, complete: true, enforce: 'module' },
      { key: 'lessons.player', label: 'Distraction-free lesson player', core: false, complete: true, enforce: 'module' },
      { key: 'lessons.resources', label: 'Notes & resources per lesson', core: false, complete: true, enforce: 'module' },
      { key: 'lessons.progress', label: 'Per-student progress tracking', core: false, complete: true, enforce: 'module' },
      { key: 'lessons.enrol', label: 'One-click course enrolment', core: false, complete: true, enforce: 'module' }
  ] },
  { name: 'Quizzes & Certificates', items: [
      { key: 'quizzes.add', label: 'Add quizzes to lessons', core: false, complete: true, enforce: 'module' },
      { key: 'quizzes.standalone', label: 'Standalone quizzes with JSON import', core: false, complete: true, enforce: 'inherent' },
      { key: 'quizzes.gate', label: 'Gate course completion on quizzes', core: false, complete: true, enforce: 'module' },
      { key: 'quizzes.analytics', label: 'Analytics, leaderboard & answer breakdown', core: false, complete: true, enforce: 'inherent' },
      { key: 'quizzes.certs', label: 'Auto-issued completion certificates', core: false, complete: true, enforce: 'module' }
  ] },
  { name: 'Assignments', items: [
      { key: 'assignments.assign', label: 'Assign work to students or batches', core: false, complete: true, enforce: 'module' },
      { key: 'assignments.due', label: 'Families see what is due', core: false, complete: true, enforce: 'module' },
      { key: 'assignments.notify', label: 'Notifications on new assignments', core: false, complete: true, enforce: 'module' }
  ] },
  { name: 'Question Papers', items: [
      { key: 'papers.share', label: 'Share practice papers to the portal', core: false, complete: true, enforce: 'module' },
      { key: 'papers.prep', label: 'Students prepare any time', core: false, complete: true, enforce: 'module' }
  ] },
  { name: 'Reports', items: [
      { key: 'reports.basic', label: 'Attendance & fee summaries', core: true, complete: true, enforce: 'module' },
      { key: 'reports.detailed', label: 'Detailed reports & trends', core: false, complete: true, enforce: 'inline' },
      { key: 'reports.lessons', label: 'Lesson activity reports', core: false, complete: true, enforce: 'inline' },
      { key: 'reports.quiz', label: 'Quiz outcomes report', core: false, complete: true, enforce: 'inline' },
      { key: 'reports.pdf', label: 'One-click PDF report export', core: true, complete: true, enforce: 'inline' }
  ] },
  { name: 'Mobile & PWA', items: [
      { key: 'pwa.install', label: 'Installable mobile app (PWA)', core: true, complete: true, enforce: 'inherent' },
      { key: 'pwa.a2hs', label: 'Add to home screen on Android & iPhone', core: true, complete: true, enforce: 'inherent' },
      { key: 'pwa.theme', label: 'Dark mode & brand themes', core: true, complete: true, enforce: 'inherent' }
  ] },
  { name: 'Multi-academy & Data', items: [
      { key: 'multi.branches', label: 'Run multiple branches from one login', core: true, complete: true, enforce: 'inherent' },
      { key: 'multi.isolated', label: 'Isolated, private data per academy', core: true, complete: true, enforce: 'inherent' },
      { key: 'data.export', label: 'Data export & backup', core: true, complete: true, enforce: 'inline' }
  ] },
  { name: 'Support', items: [
      { key: 'support.setup', label: 'Guided setup & walkthrough', core: true, complete: true, enforce: 'inherent' },
      { key: 'support.human', label: 'Real human support', core: true, complete: true, enforce: 'inherent' }
  ] }
];

export default {
  BRAND_NAME,
  SUPPORT_EMAIL,
  SUPPORT_PHONE_TEL,
  SUPPORT_PHONE_DISPLAY,
  DEFAULT_COUNTRY_CODE,
  DEFAULT_LOCALE,
  DEFAULT_CURRENCY,
  CURRENCY_SYMBOL,
  PLAN_PRICES,
  PLAN_PRICING,
  PREMIUM_MODULES,
  FEATURE_PLANS,
  FEATURE_CATALOG,
};
