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
// Build the jsPDF document + a suggested filename for a certificate. Shared by
// downloadCertificate (saves it) and previewCertificate (shows it inline).
async function buildCertificateDoc(cert) {
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

  // Academy name (header) — a clean sans caps line above the ceremonial serif
  // title, with airy tracking so it reads as a masthead.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...BRAND);
  doc.text((c.academy_name || 'Academy').toUpperCase(), cx, headerY, { align: 'center', charSpace: 1.5 });

  // Title (editable) — serif for a formal, premium certificate feel.
  doc.setFont('times', 'bold');
  doc.setFontSize(40);
  doc.setTextColor(...DARK);
  doc.text(c.title || 'Certificate of Completion', cx, headerY + 60, { align: 'center' });

  // Brand accent rule under the title — a small centred flourish dividing the
  // masthead from the body.
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(2);
  doc.line(cx - 46, headerY + 74, cx + 46, headerY + 74);

  let y = headerY + 60;

  // Subtitle — serif italic connector.
  doc.setFont('times', 'italic');
  doc.setFontSize(15);
  doc.setTextColor(...GRAY);
  doc.text('This is to certify that', cx, y + 56, { align: 'center' });

  // Student name (wrapped if long) — the largest serif line, the focal point.
  doc.setFont('times', 'bold');
  doc.setFontSize(30);
  doc.setTextColor(...DARK);
  const nameLines = doc.splitTextToSize(c.student_name || 'Student', W - 240);
  doc.text(nameLines, cx, y + 98, { align: 'center' });
  const afterName = y + 98 + (nameLines.length - 1) * 32;

  // Completion line (editable body) — serif italic connector.
  doc.setFont('times', 'italic');
  doc.setFontSize(15);
  doc.setTextColor(...GRAY);
  doc.text(c.body || 'has successfully completed the course', cx, afterName + 40, { align: 'center' });

  // Course name (wrapped if long) — serif, brand colour.
  doc.setFont('times', 'bold');
  doc.setFontSize(23);
  doc.setTextColor(...BRAND);
  const courseLines = doc.splitTextToSize(c.course_name || 'Course', W - 240);
  doc.text(courseLines, cx, afterName + 80, { align: 'center' });
  const afterCourse = afterName + 80 + (courseLines.length - 1) * 26;

  // Date.
  let dateStr = '';
  try {
    dateStr = new Date(c.completed_at).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { dateStr = ''; }
  doc.setFont('times', 'italic');
  doc.setFontSize(13);
  doc.setTextColor(...GRAY);
  if (dateStr) doc.text(`Completed on ${dateStr}`, cx, afterCourse + 46, { align: 'center' });

  if (c.lessons_total) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...LIGHT);
    doc.text(`${c.lessons_total} lesson${c.lessons_total === 1 ? '' : 's'} completed`.toUpperCase(), cx, afterCourse + 64, { align: 'center', charSpace: 0.8 });
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

  // Gold completion seal (bottom-left area). An award medallion: a tinted
  // disc with layered gold rings, a notched ribbon edge, ribbon tails, and a
  // crowning star above the two text lines.
  if (c.show_seal !== false) {
    const sx = 130;
    const sy = H - 96;
    const GOLD_TINT = [248, 236, 197];
    const GOLD_DEEP = [166, 130, 28];

    // Ribbon tails hang below the disc so the medallion reads as a hanging
    // award. Drawn first so the disc layers over their tops.
    doc.setFillColor(...GOLD_DEEP);
    doc.setDrawColor(...GOLD_DEEP);
    doc.setLineWidth(0.5);
    doc.triangle(sx - 12, sy + 18, sx - 4, sy + 18, sx - 14, sy + 46, 'F');
    doc.triangle(sx - 14, sy + 46, sx - 4, sy + 18, sx - 4, sy + 40, 'F');
    doc.triangle(sx + 4, sy + 18, sx + 12, sy + 18, sx + 14, sy + 46, 'F');
    doc.triangle(sx + 14, sy + 46, sx + 4, sy + 18, sx + 4, sy + 40, 'F');

    // Notched outer edge: short radial ticks around the circumference read as
    // a ribbon medallion's scalloped rim.
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(2);
    const rimOuter = 32;
    const rimInner = 28;
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * Math.PI * 2;
      doc.line(
        sx + Math.cos(a) * rimInner, sy + Math.sin(a) * rimInner,
        sx + Math.cos(a) * rimOuter, sy + Math.sin(a) * rimOuter,
      );
    }

    // Tinted disc with a solid gold ring border for depth.
    doc.setFillColor(...GOLD_TINT);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(2.5);
    doc.circle(sx, sy, 27, 'FD');

    // Inner ring sets off the centre field.
    doc.setLineWidth(1);
    doc.circle(sx, sy, 22, 'S');

    // Crowning five-point star above the text, built from a filled polygon.
    const starPts = [];
    const starR = 6;
    const starCy = sy - 10;
    for (let i = 0; i < 5; i += 1) {
      const outerA = -Math.PI / 2 + (i / 5) * Math.PI * 2;
      const innerA = outerA + Math.PI / 5;
      starPts.push([sx + Math.cos(outerA) * starR, starCy + Math.sin(outerA) * starR]);
      starPts.push([sx + Math.cos(innerA) * starR * 0.4, starCy + Math.sin(innerA) * starR * 0.4]);
    }
    const starDeltas = starPts.slice(1).map((p, i) => [p[0] - starPts[i][0], p[1] - starPts[i][1]]);
    doc.setFillColor(...GOLD_DEEP);
    doc.setDrawColor(...GOLD_DEEP);
    doc.setLineWidth(0.3);
    doc.lines(starDeltas, starPts[0][0], starPts[0][1], [1, 1], 'F', true);

    // Two text lines centred in the disc with airy all-caps spacing.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...GOLD_DEEP);
    doc.text('CERTIFIED', sx, sy + 4, { align: 'center', charSpace: 1.2 });
    doc.setFontSize(6.5);
    doc.text('COMPLETION', sx, sy + 14, { align: 'center', charSpace: 1 });
  }

  // Signature image + signatory name (bottom-right area).
  const sigCx = W - 150;
  const sigBaseY = H - 78;
  if (c.show_signature !== false && c.signature_data) {
    try {
      doc.addImage(c.signature_data, 'JPEG', sigCx - 60, sigBaseY - 46, 120, 38, undefined, 'FAST');
    } catch { /* skip bad signature */ }
  }
  if (c.show_signature !== false) {
    // Fall back to the academy name so the signature block never reads as an
    // unfinished blank line when no explicit signatory was set.
    const sigName = c.signatory_name || c.academy_name || '';
    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.8);
    doc.line(sigCx - 70, sigBaseY, sigCx + 70, sigBaseY);
    doc.setFont('times', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...DARK);
    if (sigName) doc.text(sigName, sigCx, sigBaseY + 16, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text('AUTHORISED SIGNATORY', sigCx, sigBaseY + 28, { align: 'center', charSpace: 0.6 });
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
  return { doc, filename };
}

// Build a certificate and trigger a download.
export async function downloadCertificate(cert) {
  const { doc, filename } = await buildCertificateDoc(cert);

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

// Build a certificate and return a blob URL the caller can show inline (e.g. in
// an iframe modal or a new tab) without triggering a download. The caller owns
// the URL and should revoke it with URL.revokeObjectURL when done. Returns
// { url, filename }.
export async function previewCertificate(cert) {
  const { doc, filename } = await buildCertificateDoc(cert);
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  return { url, filename };
}
