// Data migration panel (Settings → Backup & migrate).
//
// Moves an academy's data between two separate Catalyst deployments. Export
// from the OLD app, import into the NEW app — either the whole academy in one
// click, or module by module in dependency order (recommended for a careful,
// verifiable migration).
//
// JSON is the format that preserves relationships across the move (each row
// keeps its old ROWID, which the backend uses to re-link children to their new
// parents). CSV export is offered per module for human-readable backups.

import { useEffect, useState } from 'react';
import {
  Download, Upload, Loader2, CheckCircle2, AlertTriangle,
  Database, RefreshCw, FileJson, FileSpreadsheet, Image as ImageIcon,
  Trash2, ShieldAlert, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useOrgBranding } from '../hooks/useOrgBranding';

// ---------- small file + CSV helpers ----------------------------------------

function downloadFile(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

// Minimal CSV serializer — quotes fields containing comma, quote or newline.
function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Array.from(rows.reduce((set, r) => {
    Object.keys(r).forEach((k) => set.add(k));
    return set;
  }, new Set()));
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.join(',');
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\n');
  return `${head}\n${body}`;
}

// Minimal CSV parser — handles quoted fields with commas / newlines.
function fromCsv(text) {
  const rows = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { record.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record.push(field); field = '';
      if (record.length > 1 || record[0] !== '') rows.push(record);
      record = [];
    } else field += c;
  }
  if (field !== '' || record.length) { record.push(field); rows.push(record); }
  if (rows.length < 2) return [];
  const cols = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {};
    cols.forEach((c, idx) => { obj[c] = r[idx] === '' ? null : r[idx]; });
    return obj;
  });
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}

function readText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// ---------- component --------------------------------------------------------

export default function DataMigration() {
  const branding = useOrgBranding();
  const [modules, setModules] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // module key or 'ALL' currently working
  const [results, setResults] = useState({}); // key → import result summary
  const [progress, setProgress] = useState(null); // { done, total, label } during a run
  const [summary, setSummary] = useState(null); // completion popup: { kind, totals, rows }
  // Delete-all is gated behind a successful "Export everything" in THIS session
  // so a full backup always exists before any data is wiped.
  const [exportedThisSession, setExportedThisSession] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  async function loadCounts() {
    try {
      const res = await api.get('/migration/counts');
      setCounts(res?.counts || {});
    } catch (e) {
      // counts are best-effort (table may not exist on a fresh project)
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/migration/modules');
        if (!cancelled) setModules(res?.modules || []);
        await loadCounts();
      } catch (e) {
        toast.error('Failed to load migration plan: ' + e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- export ----
  async function exportAll() {
    setBusy('EXPORT_ALL');
    try {
      const bundle = await api.get('/migration/export');
      downloadFile(`veena-export-all-${stamp()}.json`, JSON.stringify(bundle, null, 2));
      setExportedThisSession(true);
      toast.success('Exported the full academy');
    } catch (e) {
      toast.error('Export failed: ' + e.message);
    } finally {
      setBusy(null);
    }
  }

  // ---- delete everything (DESTRUCTIVE) ----
  // Enabled only after a full export this session, and only once the typed
  // academy name matches. The backend re-validates both before deleting.
  async function purgeAll() {
    setBusy('PURGE');
    setSummary(null);
    try {
      const res = await api.post('/migration/purge', { confirm: confirmText.trim() });
      const rows = (res?.summary || []).map((s) => ({
        label: s.table,
        deleted: s.deleted || 0,
        errors: s.error ? 1 : 0,
        failed: s.error,
      }));
      setConfirmText('');
      setExportedThisSession(false);
      setResults({});
      await loadCounts();
      setSummary({
        kind: 'purge',
        totals: { deleted: res?.total_deleted ?? 0, errors: rows.filter((r) => r.errors).length },
        rows,
      });
      toast.success(`Deleted ${res?.total_deleted ?? 0} rows. The academy is now empty.`);
    } catch (e) {
      toast.error('Delete failed: ' + e.message);
    } finally {
      setBusy(null);
    }
  }

  async function exportModule(mod, format) {
    setBusy(mod.key);
    try {
      const res = await api.get(`/migration/export/${mod.key}`);
      const rows = res?.rows || [];
      if (format === 'csv') {
        downloadFile(`${mod.key}-${stamp()}.csv`, toCsv(rows), 'text/csv');
      } else {
        downloadFile(`${mod.key}-${stamp()}.json`, JSON.stringify(res, null, 2));
      }
      toast.success(`Exported ${rows.length} ${mod.label.toLowerCase()}`);
    } catch (e) {
      toast.error('Export failed: ' + e.message);
    } finally {
      setBusy(null);
    }
  }

  // ---- import everything (client-orchestrated, module by module) ----
  // Each module goes through its own endpoint in dependency order, so every
  // request stays well under the gateway timeout, the row-by-row results fill in
  // live, and the run ends with a summary popup. A single module failing is
  // recorded and the rest continue. Photos upload last.
  async function importAll() {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    let bundle;
    try {
      bundle = JSON.parse(await readText(file));
    } catch (e) {
      toast.error('Could not read the file: ' + e.message);
      return;
    }
    if (!bundle.modules) { toast.error('Not a full-academy export bundle (missing modules)'); return; }

    const labelFor = (k) => modules.find((m) => m.key === k)?.label || k;
    const order = (bundle.order || Object.keys(bundle.modules))
      .filter((k) => Array.isArray(bundle.modules[k]) && bundle.modules[k].length > 0);
    const hasPhotos = Array.isArray(bundle.modules.students) && bundle.modules.students.length > 0;
    const total = order.length + (hasPhotos ? 1 : 0);

    setBusy('IMPORT_ALL');
    setSummary(null);
    const rows = [];
    const totals = { imported: 0, skipped: 0, errors: 0 };
    let done = 0;

    const record = (label, res, failed) => {
      const imported = res?.imported || 0;
      const skipped = res?.skipped || 0;
      const errors = failed ? 1 : (res?.errors?.length || 0);
      totals.imported += imported;
      totals.skipped += skipped;
      totals.errors += errors;
      rows.push({ label, imported, skipped, errors, failed });
    };

    try {
      for (const key of order) {
        setProgress({ done, total, label: labelFor(key) });
        try {
          const res = await api.post(`/migration/import/${key}`, { rows: bundle.modules[key] });
          setResults((prev) => ({ ...prev, [key]: res }));
          record(labelFor(key), res);
        } catch (e) {
          record(labelFor(key), null, e.message);
        }
        done += 1;
      }
      if (hasPhotos) {
        setProgress({ done, total, label: 'Student photos' });
        try {
          const res = await api.post('/migration/import-photos', { rows: bundle.modules.students });
          setResults((prev) => ({ ...prev, students: { ...(prev.students || {}), photos: res } }));
          record('Student photos', res);
        } catch (e) {
          record('Student photos', null, e.message);
        }
        done += 1;
      }
      await loadCounts();
      setSummary({ kind: 'import', totals, rows });
      toast.success(`Import complete — ${totals.imported} imported, ${totals.errors} errors`);
    } finally {
      setProgress(null);
      setBusy(null);
    }
  }

  async function importModule(mod) {
    const file = await pickFile('.json,.csv');
    if (!file) return;
    setBusy(mod.key);
    try {
      const text = await readText(file);
      let rows;
      if (file.name.toLowerCase().endsWith('.csv')) {
        rows = fromCsv(text);
      } else {
        const parsed = JSON.parse(text);
        rows = Array.isArray(parsed) ? parsed : parsed.rows;
      }
      if (!Array.isArray(rows)) throw new Error('Could not read rows from the file');
      const res = await api.post(`/migration/import/${mod.key}`, { rows });
      setResults((prev) => ({ ...prev, [mod.key]: res }));
      toast.success(`${mod.label}: imported ${res.imported}, skipped ${res.skipped}, errors ${res.errors?.length || 0}`);
      await loadCounts();
    } catch (e) {
      toast.error('Import failed: ' + e.message);
    } finally {
      setBusy(null);
    }
  }

  // Second-pass photo import for Students. Feed it the same Students export
  // (JSON) — it matches each student by their old ROWID and uploads the photo.
  async function importPhotos() {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    setBusy('students');
    try {
      const parsed = JSON.parse(await readText(file));
      const rows = Array.isArray(parsed) ? parsed : parsed.rows;
      if (!Array.isArray(rows)) throw new Error('Could not read student rows from the file');
      const res = await api.post('/migration/import-photos', { rows });
      toast.success(`Photos: uploaded ${res.imported}, skipped ${res.skipped}, errors ${res.errors?.length || 0}`);
      setResults((prev) => ({ ...prev, students: { ...(prev.students || {}), photos: res } }));
    } catch (e) {
      toast.error('Photo import failed: ' + e.message);
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-500 py-10">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading migration plan…
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2">
      {/* Intro */}
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 dark:bg-indigo-950/30 dark:border-indigo-900 p-4">
        <div className="flex items-start gap-3">
          <Database className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
          <div className="text-sm text-gray-700 space-y-1">
            <p className="font-semibold text-gray-900 dark:text-white">Backup &amp; migrate</p>
            <p>
              Export this academy to a file, then import it into another deployment.
              Use <span className="font-medium">Export everything</span> for a one-shot move,
              or go module by module (top to bottom) for a careful, verifiable migration.
            </p>
            <p className="text-xs text-gray-500">
              JSON keeps every relationship intact across the move. CSV is offered per
              module for readable backups.
            </p>
          </div>
        </div>
      </div>

      {/* Whole-academy actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={exportAll}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy === 'EXPORT_ALL' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Export everything
        </button>
        <button
          onClick={importAll}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-lg border border-indigo-600 text-indigo-700 dark:text-indigo-300 px-4 py-2 text-sm font-medium hover:bg-indigo-50 dark:hover:bg-indigo-950/40 disabled:opacity-50"
        >
          {busy === 'IMPORT_ALL' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Import everything
        </button>
        <button
          onClick={loadCounts}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-lg text-gray-500 px-3 py-2 text-sm hover:text-gray-700 disabled:opacity-50"
          title="Refresh row counts"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Live progress while importing everything */}
      {progress && (
        <div className="rounded-lg border border-indigo-200 dark:border-indigo-900 bg-white dark:bg-gray-900 p-3">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="inline-flex items-center gap-2 text-gray-700 dark:text-gray-200">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
              Importing {progress.label}…
            </span>
            <span className="text-xs text-gray-500">{progress.done} / {progress.total}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div
              className="h-full bg-indigo-600 transition-all"
              style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Per-module list */}
      <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
        {modules.map((mod) => {
          const c = counts[mod.key];
          const r = results[mod.key];
          const working = busy === mod.key;
          return (
            <div key={mod.key} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 dark:text-white">{mod.label}</span>
                  {typeof c === 'number' && (
                    <span className="text-xs rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">
                      {c} {c === 1 ? 'row' : 'rows'}
                    </span>
                  )}
                  {mod.depends_on?.length > 0 && (
                    <span className="text-[11px] text-gray-400">after {mod.depends_on.join(', ')}</span>
                  )}
                </div>
                {r && (
                  <>
                    <div className="mt-1 flex items-center gap-3 text-xs">
                      <span className="inline-flex items-center gap-1 text-green-600">
                        <CheckCircle2 className="w-3.5 h-3.5" /> {r.imported} imported
                      </span>
                      {r.skipped > 0 && <span className="text-gray-500">{r.skipped} skipped</span>}
                      {r.errors?.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <AlertTriangle className="w-3.5 h-3.5" /> {r.errors.length} errors
                        </span>
                      )}
                    </div>
                    {r.errors?.length > 0 && (
                      <div className="mt-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-2 text-[11px] text-amber-800 dark:text-amber-300 space-y-0.5">
                        {r.errors.slice(0, 5).map((e, i) => (
                          <div key={i} className="break-words">
                            {e.source_id ? <span className="opacity-60">#{e.source_id}: </span> : null}{e.error}
                          </div>
                        ))}
                        {r.errors.length > 5 && (
                          <div className="opacity-60">+ {r.errors.length - 5} more with the same kind of error</div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => exportModule(mod, 'json')}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  title="Export as JSON"
                >
                  {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileJson className="w-3.5 h-3.5" />}
                  JSON
                </button>
                <button
                  onClick={() => exportModule(mod, 'csv')}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  title="Export as CSV"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
                </button>
                <button
                  onClick={() => importModule(mod)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 rounded-md bg-gray-900 text-white px-2.5 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
                  title="Import JSON or CSV into this module"
                >
                  <Upload className="w-3.5 h-3.5" /> Import
                </button>
                {mod.key === 'students' && (
                  <button
                    onClick={importPhotos}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1 rounded-md border border-indigo-500 text-indigo-700 dark:text-indigo-300 px-2.5 py-1.5 text-xs font-medium hover:bg-indigo-50 dark:hover:bg-indigo-950/40 disabled:opacity-50"
                    title="Second pass: upload student photos (run after importing Students). Feed the Students JSON export."
                  >
                    <ImageIcon className="w-3.5 h-3.5" /> Photos
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Danger zone — delete every row this academy owns. Gated on a full
          export this session AND typing the academy name to confirm. */}
      {(() => {
        const orgName = (branding.name || '').trim();
        const typed = confirmText.trim();
        const nameMatches = orgName
          ? typed.toLowerCase() === orgName.toLowerCase()
          : typed.length > 0;
        const canDelete = exportedThisSession && nameMatches && busy === null;
        return (
          <div className="rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-3">
                <div className="text-sm text-gray-700 space-y-1">
                  <p className="font-semibold text-red-700 dark:text-red-300">Delete all academy data</p>
                  <p>
                    Removes every student, class, attendance record, fee, lesson and
                    message for this academy. Your login and the academy itself stay,
                    but all the data is gone for good. This cannot be undone.
                  </p>
                  <p className="text-xs text-gray-500">
                    Export everything first — the button below stays locked until you do.
                  </p>
                </div>

                {!exportedThisSession ? (
                  <p className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                    <Download className="w-3.5 h-3.5" />
                    Run <span className="font-semibold">Export everything</span> above to unlock deletion.
                  </p>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <input
                      type="text"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder={orgName ? `Type "${orgName}" to confirm` : 'Type the academy name to confirm'}
                      className="flex-1 rounded-md border border-red-300 dark:border-red-800 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                    />
                    <button
                      onClick={purgeAll}
                      disabled={!canDelete}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 text-white px-4 py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {busy === 'PURGE' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      Delete all data
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Completion popup — shown when an Import-all or Delete-all run finishes */}
      {summary && (() => {
        const isImport = summary.kind === 'import';
        const clean = (summary.totals.errors || 0) === 0;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSummary(null)}>
            <div
              className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 shadow-xl border border-gray-200 dark:border-gray-800 max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  {clean
                    ? <CheckCircle2 className="w-5 h-5 text-green-600" />
                    : <AlertTriangle className="w-5 h-5 text-amber-600" />}
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">
                      {isImport ? 'Import complete' : 'Delete complete'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {isImport
                        ? `${summary.totals.imported} imported · ${summary.totals.skipped} skipped · ${summary.totals.errors} errors`
                        : `${summary.totals.deleted} rows deleted · ${summary.totals.errors} errors`}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSummary(null)}
                  className="text-gray-400 hover:text-gray-600 shrink-0"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="overflow-y-auto p-2">
                {summary.rows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
                    <span className="text-gray-700 dark:text-gray-200 truncate">{r.label}</span>
                    <span className="text-xs shrink-0">
                      {r.failed ? (
                        <span className="text-red-600" title={r.failed}>failed</span>
                      ) : isImport ? (
                        <span className="text-gray-500">
                          <span className="text-green-600 font-medium">{r.imported}</span> in
                          {r.skipped > 0 && <> · {r.skipped} skip</>}
                          {r.errors > 0 && <> · <span className="text-amber-600">{r.errors} err</span></>}
                        </span>
                      ) : (
                        <span className="text-green-600 font-medium">{r.deleted}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
              <div className="p-4 border-t border-gray-100 dark:border-gray-800">
                <button
                  onClick={() => setSummary(null)}
                  className="w-full rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
