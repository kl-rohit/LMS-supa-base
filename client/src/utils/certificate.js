// Course-completion certificate PDF generation.
//
// jsPDF is loaded with a dynamic import() so it lands in its own webpack chunk
// — the ~350KB library only downloads when a student actually downloads a
// certificate, keeping it out of the main bundle. The QR library (qrcode) is
// likewise dynamic-imported and only when verification is turned on.
//
// Per-academy customisation comes from the backend cert payload (see
// routes/portal.js GET /courses/:id/certificate): institute logo, student
// photo, signature image, editable title + body, brand accent colour, a gold
// completion seal, an academy contact footer, and a verification QR.

import { accentToHex } from './theme';

// Convert '#rrggbb' to an [r,g,b] array jsPDF wants. Falls back to indigo.
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [79, 70, 229];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Build a QR data URL for the verification link. Returns '' when the qrcode
// library can't load or no URL was supplied — caller renders without it.
async function makeQrDataUrl(text) {
  if (!text) return '';
  try {
    const QR = (await import('qrcode')).default;
    return await QR.toDataURL(text, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
  } catch {
    return '';
  }
}

// Draw a landscape A4 certificate and trigger a download. `cert` shape:
//   { student_name, course_name, academy_name, lessons_total, completed_at,
//     certificate_id, title, body, signatory_name,
//     show_logo, show_photo, show_signature, show_seal, show_footer,
//     use_brand_color, accent, logo_data, signature_data, student_photo_data,
//     contact_phone, contact_email, verify_code, verify_url }
export async function downloadCertificate(cert) {
  const c = cert || {};
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const cx = W / 2;

  // Brand accent drives the border + title + course colour. When the academy
  // turns brand colour off, `accent` arrives as 'default' → stock indigo.
  const BRAND = hexToRgb(accentToHex(c.use_brand_color === false ? 'default' : c.accent));
  const DARK = [17, 24, 39];
  const GRAY = [107, 114, 128];
  const LIGHT = [156, 163, 175];
  const GOLD = [201, 162, 39];

  // Resolve the verification QR up front (so the rest of the layout can leave
  // room for it). Both are best-effort and degrade to empty.
  const verifyUrl = c.verify_url
    ? (c.verify_url.startsWith('http') ? c.verify_url : `${window.location.origin}${c.verify_url}`)
    : '';
  const qrDataUrl = verifyUrl ? await makeQrDataUrl(verifyUrl) : '';

  // Decorative double border in the brand colour.
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(3);
  doc.rect(24, 24, W - 48, H - 48);
  doc.setLineWidth(1);
  doc.rect(34, 34, W - 68, H - 68);

  // Institute logo (centred, top). Drawn first so text sits below it.
  let headerY = 88;
  if (c.show_logo !== false && c.logo_data) {
    try {
      const LOGO_H = 56;
      const LOGO_W = 56;
      doc.addImage(c.logo_data, 'JPEG', cx - LOGO_W / 2, 50, LOGO_W, LOGO_H, undefined, 'FAST');
      headerY = 132;
    } catch { /* bad image — skip, keep default header position */ }
  }

  // Academy name (header).
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...BRAND);
  doc.text(c.academy_name || 'Academy', cx, headerY, { align: 'center' });

  // Title (editable).
  doc.setFontSize(34);
  doc.setTextColor(...DARK);
  doc.text(c.title || 'Certificate of Completion', cx, headerY + 56, { align: 'center' });

  let y = headerY + 56;

  // Subtitle.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(...GRAY);
  doc.text('This is to certify that', cx, y + 44, { align: 'center' });

  // Student name (wrapped if long).
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(...DARK);
  const nameLines = doc.splitTextToSize(c.student_name || 'Student', W - 240);
  doc.text(nameLines, cx, y + 84, { align: 'center' });
  let afterName = y + 84 + (nameLines.length - 1) * 30;

  // Completion line (editable body).
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(...GRAY);
  doc.text(c.body || 'has successfully completed the course', cx, afterName + 34, { align: 'center' });

  // Course name (wrapped if long).
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(21);
  doc.setTextColor(...BRAND);
  const courseLines = doc.splitTextToSize(c.course_name || 'Course', W - 240);
  doc.text(courseLines, cx, afterName + 72, { align: 'center' });
  const afterCourse = afterName + 72 + (courseLines.length - 1) * 24;

  // Date.
  let dateStr = '';
  try {
    dateStr = new Date(c.completed_at).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { dateStr = ''; }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(...GRAY);
  if (dateStr) doc.text(`Completed on ${dateStr}`, cx, afterCourse + 40, { align: 'center' });

  if (c.lessons_total) {
    doc.setFontSize(11);
    doc.setTextColor(...LIGHT);
    doc.text(`${c.lessons_total} lesson${c.lessons_total === 1 ? '' : 's'} completed`, cx, afterCourse + 60, { align: 'center' });
  }

  // Student photo (top-left, inside the inner border).
  if (c.show_photo !== false && c.student_photo_data) {
    try {
      const P = 72;
      doc.setDrawColor(...LIGHT);
      doc.setLineWidth(1);
      doc.addImage(c.student_photo_data, 'JPEG', 56, 56, P, P, undefined, 'FAST');
      doc.rect(56, 56, P, P);
    } catch { /* skip bad photo */ }
  }

  // Gold completion seal (bottom-left area).
  if (c.show_seal !== false) {
    const sx = 130;
    const sy = H - 96;
    doc.setDrawColor(...GOLD);
    doc.setFillColor(...GOLD);
    doc.setLineWidth(2);
    doc.circle(sx, sy, 30, 'S');
    doc.circle(sx, sy, 24, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...GOLD);
    doc.text('CERTIFIED', sx, sy - 2, { align: 'center' });
    doc.setFontSize(7);
    doc.text('COMPLETION', sx, sy + 9, { align: 'center' });
  }

  // Signature image + signatory name (bottom-right area).
  const sigCx = W - 150;
  const sigBaseY = H - 78;
  if (c.show_signature !== false && c.signature_data) {
    try {
      doc.addImage(c.signature_data, 'JPEG', sigCx - 60, sigBaseY - 46, 120, 38, undefined, 'FAST');
    } catch { /* skip bad signature */ }
  }
  if (c.signatory_name || c.show_signature !== false) {
    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.8);
    doc.line(sigCx - 70, sigBaseY, sigCx + 70, sigBaseY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...DARK);
    if (c.signatory_name) doc.text(c.signatory_name, sigCx, sigBaseY + 16, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text('Authorised Signatory', sigCx, sigBaseY + 28, { align: 'center' });
  }

  // Verification QR (bottom-centre) + small caption.
  if (qrDataUrl) {
    try {
      const Q = 56;
      doc.addImage(qrDataUrl, 'PNG', cx - Q / 2, H - 104, Q, Q, undefined, 'FAST');
      doc.setFontSize(8);
      doc.setTextColor(...LIGHT);
      doc.text('Scan to verify', cx, H - 40, { align: 'center' });
    } catch { /* skip QR */ }
  }

  // Academy contact footer (bottom strip).
  if (c.show_footer !== false) {
    const bits = [];
    if (c.contact_phone) bits.push(String(c.contact_phone));
    if (c.contact_email) bits.push(String(c.contact_email));
    if (bits.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...GRAY);
      doc.text(bits.join('  ·  '), cx, H - 26, { align: 'center' });
    }
  }

  // Certificate id (very bottom).
  doc.setFontSize(8);
  doc.setTextColor(...LIGHT);
  doc.text(c.certificate_id || '', cx, H - 14, { align: 'center' });

  const safe = String(c.course_name || 'course').replace(/[^\w\d\- ]+/g, '').slice(0, 60).trim();
  const filename = `Certificate - ${safe || 'course'}.pdf`;

  // doc.save() works on desktop, but inside mobile browsers and in-app webviews
  // a blob download is often dropped silently. So build the blob ourselves and
  // trigger it via a real anchor; if the download attribute is ignored, the
  // target="_blank" lets the device open the PDF in its viewer instead.
  try {
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Give the browser time to consume the blob before revoking the URL.
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 15000);
    return true;
  } catch {
    // Last resort: jsPDF's own saver.
    doc.save(filename);
    return true;
  }
}
