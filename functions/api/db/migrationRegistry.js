// Migration registry — the single source of truth for the in-app
// Export / Import (data migration) feature.
//
// WHY THIS EXISTS
// ---------------
// We move an academy's data between two SEPARATE Catalyst projects (different
// accounts / data centres), so the Catalyst CLI, BaaS export and REST bulk
// APIs are all unavailable. Instead each deployed app exposes authenticated
// Export + Import endpoints; the operator exports from the old app and imports
// into the new app through the normal admin session.
//
// THE RELATIONSHIP PROBLEM (and the fix)
// --------------------------------------
// Catalyst assigns a brand-new 17-digit ROWID to every imported row, so the
// old parent ROWIDs that children point at (Attendance.student_id, etc.) would
// dangle. To preserve relationships across the re-keying we add a `source_id`
// (BIGINT) column to every migrated table in the NEW project. On import each
// row records `source_id = <old ROWID>`; a child's foreign-key columns are then
// remapped by looking up the parent whose `source_id` equals the old FK value:
//
//     SELECT ROWID FROM <RefTable> WHERE source_id = <oldFk> AND org_id = <orgId>
//
// Because `source_id` is persisted, this works across separate requests and
// sessions — which is exactly what the step-by-step (module-by-module) import
// needs. Import parents first (Students, Groups, ...), then their children.
//
// SCHEMA REQUIREMENT (new project only)
// -------------------------------------
// Every table listed in MODULES below must have a `source_id` column of type
// BIGINT in the NEW project. The old project does not need it. AppSettings is
// matched on its natural key (setting_key) instead, so it does not need one.
//
// MULTI-TENANCY
// -------------
// Every domain table carries `org_id`. Export filters by the caller's active
// org; import stamps the caller's active org on every row. Organizations and
// OrgMemberships are intentionally NOT migrated — the destination org is
// created fresh during signup, which also sidesteps the auth-user coupling.

// FK resolvers may be either a string (the referenced module table) or a
// function (row) => tableName | null, for polymorphic / conditional FKs.
//
// requiredFks (optional): which FK columns MUST resolve to an imported parent.
//   - omitted  → ALL fks are required (a missing parent skips the whole row).
//   - []        → none required (missing parents are nulled, the row is kept).
//   - [..cols]  → only the listed cols are required; others are nulled-and-kept.
// This lets activity rows survive a stale/orphaned secondary link (e.g. an
// Attendance row whose class was deleted) while still skipping rows that make
// no sense without their owner (e.g. a membership with no student).

const MODULES = [
  // ---- Level 0: roots (no foreign keys) ----
  {
    key: 'students',
    table: 'Students',
    label: 'Students',
    fks: {},
  },
  {
    key: 'groups',
    table: 'Groups',
    label: 'Groups / Batches',
    fks: {},
  },
  {
    key: 'courses',
    table: 'Courses',
    label: 'Courses',
    fks: {},
  },
  {
    key: 'question-papers',
    table: 'QuestionPapers',
    label: 'Question Papers',
    fks: {},
  },
  {
    key: 'settings',
    table: 'AppSettings',
    label: 'App Settings',
    fks: {},
    // Matched on its natural key rather than source_id, and upserted instead of
    // duplicated, so re-importing settings is idempotent.
    naturalKey: 'setting_key',
  },

  // ---- Level 1: depend on roots ----
  {
    key: 'camps',
    table: 'Camps',
    label: 'Camps',
    fks: { group_id: 'Groups' },
    // group_id is optional context — keep the camp even if its group is gone.
    requiredFks: [],
  },
  {
    key: 'lessons',
    table: 'Lessons',
    label: 'Lessons',
    fks: { course_id: 'Courses' },
  },
  {
    key: 'group-students',
    table: 'GroupStudents',
    label: 'Group memberships',
    fks: { group_id: 'Groups', student_id: 'Students' },
  },
  {
    key: 'classes',
    table: 'Classes',
    label: 'Classes / Timetable',
    fks: { group_id: 'Groups', student_id: 'Students' },
    // Both links are optional: a class may be a group class OR a 1-on-1, and a
    // stale student_id (e.g. the student left and isn't in this org's export)
    // must NOT cause the whole class — and the attendance hanging off it — to
    // be skipped. Keep the class; drop only the dead link.
    requiredFks: [],
  },
  {
    key: 'enrollments',
    table: 'CourseEnrollments',
    label: 'Course enrollments',
    fks: { course_id: 'Courses', student_id: 'Students' },
  },

  // ---- Level 2: depend on level 1 ----
  {
    key: 'class-students',
    table: 'ClassStudents',
    label: 'Class rosters',
    fks: { class_id: 'Classes', student_id: 'Students' },
  },
  {
    key: 'camp-days',
    table: 'CampDays',
    label: 'Camp days',
    fks: { camp_id: 'Camps' },
  },
  {
    key: 'lesson-quizzes',
    table: 'LessonQuizzes',
    label: 'Lesson quizzes',
    fks: { lesson_id: 'Lessons' },
  },
  {
    key: 'assignments',
    table: 'Assignments',
    label: 'Assignments',
    fks: {
      // Only set when kind === 'quiz'; null otherwise (stays null).
      quiz_lesson_id: 'Lessons',
      // Polymorphic: points at Groups or Students depending on target_type.
      target_id: (row) =>
        row.target_type === 'group'
          ? 'Groups'
          : row.target_type === 'student'
            ? 'Students'
            : null,
    },
    // Both links are optional — a stale quiz lesson or target shouldn't drop
    // the assignment itself.
    requiredFks: [],
  },

  // ---- Level 3: activity / history ----
  {
    key: 'attendance',
    table: 'Attendance',
    label: 'Attendance',
    fks: { student_id: 'Students', class_id: 'Classes' },
    // student_id is the row's owner (skip if missing); class_id is optional
    // context — a stale class link is nulled, the attendance still imports.
    requiredFks: ['student_id'],
  },
  {
    key: 'additional-fees',
    table: 'AdditionalFees',
    label: 'Additional fees',
    fks: { student_id: 'Students' },
  },
  {
    key: 'payments',
    table: 'Payments',
    label: 'Payments',
    fks: { student_id: 'Students' },
  },
  {
    key: 'messages',
    table: 'Messages',
    label: 'Messages',
    fks: { student_id: 'Students' },
  },
  {
    key: 'lesson-progress',
    table: 'LessonProgress',
    label: 'Lesson progress',
    fks: { student_id: 'Students', lesson_id: 'Lessons' },
  },
  {
    key: 'quiz-attempts',
    table: 'QuizAttempts',
    label: 'Quiz attempts',
    fks: { student_id: 'Students', lesson_id: 'Lessons' },
  },
  {
    key: 'assignment-completions',
    table: 'AssignmentCompletions',
    label: 'Assignment completions',
    fks: { assignment_id: 'Assignments', student_id: 'Students' },
  },
];

// Columns Catalyst manages itself; never write these on import.
const SYSTEM_COLS = ['ROWID', 'CREATORID', 'CREATEDTIME', 'MODIFIEDTIME'];

// Client-side aliases added by normalize(); never write these back.
const ALIAS_COLS = ['id', 'created_at', 'updated_at', 'date', 'month', 'year'];

const byKey = new Map(MODULES.map((m) => [m.key, m]));

function getModule(key) {
  return byKey.get(key) || null;
}

// Resolve the referenced table for an FK column on a specific row (handles
// the string and function forms).
function refTableFor(fkSpec, row) {
  if (typeof fkSpec === 'function') return fkSpec(row) || null;
  return fkSpec || null;
}

module.exports = {
  MODULES,
  SYSTEM_COLS,
  ALIAS_COLS,
  getModule,
  refTableFor,
};
