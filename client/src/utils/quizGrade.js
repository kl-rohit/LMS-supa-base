// Fixed grade ladder for quiz scores, shared by the student result screen and
// the admin Responses list so the wording matches everywhere. Phrasing stays
// encouraging (no harsh labels). `passed` reflects the quiz's own pass mark.
export function quizGrade(score, passed) {
  const s = Number(score) || 0;
  if (!passed) return { label: 'Needs work', badgeClass: 'bg-amber-50 text-amber-700', textClass: 'text-amber-600' };
  if (s >= 90) return { label: 'Excellent', badgeClass: 'bg-green-50 text-green-700', textClass: 'text-green-600' };
  if (s >= 80) return { label: 'Very good', badgeClass: 'bg-green-50 text-green-700', textClass: 'text-green-600' };
  if (s >= 70) return { label: 'Good', badgeClass: 'bg-indigo-50 text-indigo-700', textClass: 'text-indigo-600' };
  return { label: 'Passed', badgeClass: 'bg-gray-100 text-gray-600', textClass: 'text-gray-600' };
}
