// Export helpers for the Veena Reports module: CSV download, PDF, and Print.
//
// PDF PATH: jspdf is present in client/package.json (and node_modules), so
// exportPdf builds a real PDF on the client. jspdf-autotable is NOT installed,
// so tables are drawn manually with jsPDF text primitives (header row + rows
// with simple wrapping and page breaks). If jspdf ever becomes unavailable at
// runtime, exportPdf falls back to printHtml so the user can pick "Save as PDF"
// from the browser print dialog.

// Turn a title into a safe file slug.
function slug(s) {
  return String(s || 'report')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'report';
}

// Escape one CSV field: wrap in quotes when it holds a comma, quote, or newline.
function csvField(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Trigger a client-side download of text content via a Blob + temporary <a>.
function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the click a tick before revoking the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Build CSV text from columns [{ key, label }] + rows and download it.
// Prepends a UTF-8 BOM so Excel reads accented characters correctly.
export function exportCsv(filename, columns = [], rows = []) {
  const name = String(filename || 'report').endsWith('.csv') ? filename : `${slug(filename)}.csv`;
  const head = columns.map((c) => csvField(c.label)).join(',');
  const body = rows
    .map((row) => columns.map((c) => csvField(row[c.key])).join(','))
    .join('\r\n');
  const csv = `﻿${head}\r\n${body}`;
  downloadBlob(name, csv, 'text/csv;charset=utf-8;');
}

// Escape HTML for safe injection into the print document.
function escHtml(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Build an HTML table string for a section { heading, columns, rows }.
function sectionToTableHtml(section) {
  const cols = section.columns || [];
  const head = cols.map((c) => `<th>${escHtml(c.label)}</th>`).join('');
  const body = (section.rows || [])
    .map((row) => `<tr>${cols.map((c) => `<td>${escHtml(row[c.key])}</td>`).join('')}</tr>`)
    .join('');
  const heading = section.heading ? `<h2>${escHtml(section.heading)}</h2>` : '';
  return `${heading}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// Open a hidden iframe, write a minimal styled HTML document (title + provided
// table HTML), print it, and clean up afterwards. Used by the Print button and
// as the PDF fallback.
export function printHtml(title, html) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #111827; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  h2 { font-size: 15px; margin: 20px 0 8px; color: #374151; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
  th { color: #4b5563; font-weight: 600; }
</style></head><body><h1>${escHtml(title)}</h1>${html}</body></html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 500);
  };

  const idoc = iframe.contentWindow.document;
  idoc.open();
  idoc.write(doc);
  idoc.close();

  const win = iframe.contentWindow;
  win.onafterprint = cleanup;
  // Wait a frame so the document lays out before printing.
  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch (e) {
      cleanup();
    }
  }, 150);
}

// Backwards-friendly alias: print a single section by title + table HTML.
export function printSection(title, html) {
  printHtml(title, html);
}

// Generate and save a PDF. Uses jspdf (real PDF) when available; otherwise falls
// back to printHtml so the user can Save as PDF from the print dialog.
export async function exportPdf(title, sections = []) {
  let jsPDF;
  try {
    // jspdf v4 exports { jsPDF }.
    const mod = await import('jspdf');
    jsPDF = mod.jsPDF || (mod.default && mod.default.jsPDF) || mod.default;
  } catch (e) {
    jsPDF = null;
  }

  if (!jsPDF) {
    // FALLBACK PATH: no jspdf at runtime, print to PDF instead.
    const html = sections.map(sectionToTableHtml).join('');
    printHtml(title, html);
    return;
  }

  // REAL PDF PATH (manual tables, no jspdf-autotable dependency).
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 40;
  const usableW = pageW - margin * 2;
  let y = margin;

  const newPageIfNeeded = (needed) => {
    if (y + needed > pageH - margin) {
      pdf.addPage();
      y = margin;
    }
  };

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text(String(title || 'Report'), margin, y);
  y += 24;

  sections.forEach((section) => {
    const cols = section.columns || [];
    const rows = section.rows || [];

    if (section.heading) {
      newPageIfNeeded(24);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.text(String(section.heading), margin, y);
      y += 16;
    }

    if (!cols.length) return;

    const colW = usableW / cols.length;
    const rowH = 18;

    const drawHeader = () => {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(75, 85, 99);
      cols.forEach((c, i) => {
        pdf.text(String(c.label ?? ''), margin + colW * i + 2, y + 12, { maxWidth: colW - 4 });
      });
      pdf.setDrawColor(229, 231, 235);
      pdf.line(margin, y + rowH, margin + usableW, y + rowH);
      y += rowH;
    };

    newPageIfNeeded(rowH * 2);
    drawHeader();

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(17, 24, 39);
    rows.forEach((row) => {
      if (y + rowH > pageH - margin) {
        pdf.addPage();
        y = margin;
        drawHeader();
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(17, 24, 39);
      }
      cols.forEach((c, i) => {
        const raw = row[c.key];
        const text = raw === undefined || raw === null ? '' : String(raw);
        pdf.text(text, margin + colW * i + 2, y + 12, { maxWidth: colW - 4 });
      });
      pdf.setDrawColor(243, 244, 246);
      pdf.line(margin, y + rowH, margin + usableW, y + rowH);
      y += rowH;
    });

    y += 16;
  });

  pdf.save(`${slug(title)}.pdf`);
}
