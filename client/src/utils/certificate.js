// Course-completion certificate PDF generation.
//
// jsPDF is loaded with a dynamic import() so it lands in its own webpack chunk
// — the ~350KB library only downloads when a student actually downloads a
// certificate, keeping it out of the main bundle.

// Draw a landscape A4 "Certificate of Completion" and trigger a download.
// `cert` shape (from GET /portal/courses/:id/certificate):
//   { student_name, course_name, academy_name, lessons_total, completed_at, certificate_id }
export async function downloadCertificate(cert) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const cx = W / 2;

  const INDIGO = [79, 70, 229];
  const DARK = [17, 24, 39];
  const GRAY = [107, 114, 128];
  const LIGHT = [156, 163, 175];

  // Decorative double border.
  doc.setDrawColor(...INDIGO);
  doc.setLineWidth(3);
  doc.rect(24, 24, W - 48, H - 48);
  doc.setLineWidth(1);
  doc.rect(34, 34, W - 68, H - 68);

  // Academy name (header).
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...INDIGO);
  doc.text(cert.academy_name || 'Academy', cx, 92, { align: 'center' });

  // Title.
  doc.setFontSize(36);
  doc.setTextColor(...DARK);
  doc.text('Certificate of Completion', cx, 152, { align: 'center' });

  // Subtitle.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(...GRAY);
  doc.text('This is to certify that', cx, 200, { align: 'center' });

  // Student name (wrapped if long).
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.setTextColor(...DARK);
  const nameLines = doc.splitTextToSize(cert.student_name || 'Student', W - 200);
  doc.text(nameLines, cx, 244, { align: 'center' });
  const afterName = 244 + (nameLines.length - 1) * 32;

  // Completion line.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(...GRAY);
  doc.text('has successfully completed the course', cx, afterName + 36, { align: 'center' });

  // Course name (wrapped if long).
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...INDIGO);
  const courseLines = doc.splitTextToSize(cert.course_name || 'Course', W - 200);
  doc.text(courseLines, cx, afterName + 76, { align: 'center' });
  const afterCourse = afterName + 76 + (courseLines.length - 1) * 24;

  // Date.
  let dateStr = '';
  try {
    dateStr = new Date(cert.completed_at).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { dateStr = ''; }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(...GRAY);
  if (dateStr) doc.text(`Completed on ${dateStr}`, cx, afterCourse + 44, { align: 'center' });

  if (cert.lessons_total) {
    doc.setFontSize(11);
    doc.setTextColor(...LIGHT);
    doc.text(`${cert.lessons_total} lesson${cert.lessons_total === 1 ? '' : 's'} completed`, cx, afterCourse + 64, { align: 'center' });
  }

  // Certificate id footer.
  doc.setFontSize(9);
  doc.setTextColor(...LIGHT);
  doc.text(cert.certificate_id || '', cx, H - 48, { align: 'center' });

  const safe = String(cert.course_name || 'course').replace(/[^\w\d\- ]+/g, '').slice(0, 60).trim();
  doc.save(`Certificate - ${safe || 'course'}.pdf`);
}
