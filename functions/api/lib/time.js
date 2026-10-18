// Time helpers. Catalyst functions run in UTC, but every academy is in India,
// so "today" and "this month" must be computed in IST (Asia/Kolkata, UTC+5:30,
// no DST). The trick: shift the clock by the offset, then read the UTC parts of
// the shifted instant to get IST calendar parts. Without this, for the first
// ~5.5h of each IST day the server's "today"/month would be yesterday/last month.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istNow() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

// IST calendar parts for "now": { year, month (1-12), day, dow (0=Sun), iso }.
function istParts() {
  const t = istNow();
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    dow: t.getUTCDay(),
    iso: t.toISOString().slice(0, 10), // YYYY-MM-DD in IST
  };
}

module.exports = { IST_OFFSET_MS, istNow, istParts };
