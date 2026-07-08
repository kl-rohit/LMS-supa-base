// Grade label for a quiz score, shared by the student result screen and the
// admin Responses list so the wording matches everywhere.
//
// If the quiz defines custom bands (an array of { label, min }), those take
// precedence: the highest band whose `min` <= score wins. Otherwise a fixed
// fallback ladder is used. Phrasing stays encouraging (no harsh labels).
// `passed` reflects the quiz's own pass mark.

const CLS = {
  good:   { badgeClass: 'bg-green-50 text-green-700', textClass: 'text-green-600' },
  indigo: { badgeClass: 'bg-indigo-50 text-indigo-700', textClass: 'text-indigo-600' },
  gray:   { badgeClass: 'bg-gray-100 text-gray-600', textClass: 'text-gray-600' },
  amber:  { badgeClass: 'bg-amber-50 text-amber-700', textClass: 'text-amber-600' },
};

export function quizGrade(score, passed, bands) {
  const s = Number(score) || 0;

  // Custom per-quiz bands.
  const list = Array.isArray(bands) ? bands.filter((b) => b && b.label) : [];
  if (list.length) {
    const sorted = [...list].sort((a, b) => (Number(b.min) || 0) - (Number(a.min) || 0));
    const hit = sorted.find((b) => s >= (Number(b.min) || 0)) || sorted[sorted.length - 1];
    const tone = !passed ? 'amber' : (hit === sorted[0] ? 'good' : 'indigo');
    return { label: hit.label, ...CLS[tone] };
  }

  // Fixed fallback ladder.
  if (!passed) return { label: 'Needs work', ...CLS.amber };
  if (s >= 90) return { label: 'Excellent', ...CLS.good };
  if (s >= 80) return { label: 'Very good', ...CLS.good };
  if (s >= 70) return { label: 'Good', ...CLS.indigo };
  return { label: 'Passed', ...CLS.gray };
}
