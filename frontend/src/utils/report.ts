/**
 * Inspection report PDF (jsPDF + autotable). Includes branding, session metadata, sections,
 * findings with confidence, evidence images (with bounding boxes), review status and notes.
 * Simulated / demo findings are explicitly labelled throughout.
 */
import type { InspectionDetail } from '@/types';
import { mediaUrl } from '@/services/api';
import { CATEGORY_LABEL, DETECTION_MODE_LABEL, REVIEW_LABEL, SOURCE_LABEL } from './labels';
import { fmtClock, fmtDateTime, fmtDuration } from './format';

const NAVY: [number, number, number] = [0, 48, 73];
const CRIMSON: [number, number, number] = [193, 18, 31];
const STEEL: [number, number, number] = [102, 155, 188];
const CREAM: [number, number, number] = [253, 240, 213];
const INK: [number, number, number] = [25, 32, 38];
const MUTED: [number, number, number] = [100, 116, 128];
const CAT_RGB = { crack: [211, 38, 58], dent: [79, 155, 212], corrosion: [175, 145, 26] } as const;

async function loadImage(url: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    const scale = Math.min(1, 900 / bmp.width);
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return { data: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height };
  } catch {
    return null;
  }
}

export async function generateInspectionReport(insp: InspectionDetail): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const simulated = insp.is_demo || insp.detection_mode !== 'ai';
  const dets = insp.detections;

  const header = () => {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 22, 'F');
    doc.setFillColor(...CRIMSON);
    doc.rect(0, 22, W, 1.2, 'F');
    doc.setTextColor(...CREAM);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('AEROSPECTRA', M, 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...STEEL);
    doc.text('DETECT · VISUALIZE · DOCUMENT', M, 16.5);
    doc.setTextColor(...CREAM);
    doc.setFontSize(9);
    doc.text('Aircraft Visual Inspection Report', W - M, 11, { align: 'right' });
    doc.setFontSize(7.5);
    doc.text(insp.id, W - M, 16.5, { align: 'right' });
  };
  const footer = (page: number, total: number) => {
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(
      'AI/simulated detections are POTENTIAL defects for human review — not certified maintenance diagnoses.',
      M,
      H - 8,
    );
    doc.text(`Page ${page} / ${total} · generated ${new Date().toLocaleString()}`, W - M, H - 8, { align: 'right' });
  };

  header();
  let y = 30;
  if (simulated && !insp.is_demo) {
    doc.setFillColor(...CREAM);
    doc.setDrawColor(...CRIMSON);
    doc.roundedRect(M, y, W - 2 * M, 13, 1.5, 1.5, 'FD');
    doc.setTextColor(...CRIMSON);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('NO AI MODEL — NO AUTOMATED FINDINGS', M + 4, y + 5.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...INK);
    doc.text(
      `Detection mode: ${DETECTION_MODE_LABEL[insp.detection_mode]}. Findings listed (if any) were not produced by a trained model.`,
      M + 4,
      y + 10,
    );
    y += 18;
  }

  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Inspection summary', M, y + 2);
  y += 6;

  const ac = insp.aircraft;
  const by = (k: string) => dets.filter((d) => d.review_status === k).length;
  autoTable(doc, {
    startY: y,
    theme: 'plain',
    styles: { fontSize: 8.5, cellPadding: 1.6, textColor: INK },
    columnStyles: { 0: { textColor: MUTED, cellWidth: 38 }, 2: { textColor: MUTED, cellWidth: 38 } },
    body: [
      ['Inspection ID', insp.id, 'Aircraft ID', ac.id],
      ['Inspection date', fmtDateTime(insp.started_at), 'Aircraft model', ac.model],
      ['Duration', fmtDuration(insp.duration_s), 'Registration', ac.registration],
      ['Video source', `${SOURCE_LABEL[insp.source]} (${insp.source_detail})`, 'Operator', ac.operator || '—'],
      ['Detection mode', DETECTION_MODE_LABEL[insp.detection_mode], 'Status', insp.status],
      ['Frames processed', String(insp.frames_processed), 'Recording', insp.recording_url ? 'Available' : 'None'],
    ],
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Sections inspected', M, y + 3);
  doc.setFont('helvetica', 'normal');
  const secs = insp.sections_inspected.length ? insp.sections_inspected.join(', ') : 'Not recorded';
  doc.text(doc.splitTextToSize(secs + (insp.source === 'simulation' ? '  (simulated waypoints)' : ''), W - 2 * M - 38), M + 38, y + 3);
  y += 9;

  const summary = `${dets.length} potential defect(s) recorded: ${dets.filter((d) => d.category === 'crack').length} crack, ${
    dets.filter((d) => d.category === 'dent').length
  } dent, ${dets.filter((d) => d.category === 'corrosion').length} corrosion. Review status: ${by('pending')} pending, ${by('reviewed')} reviewed, ${by('confirmed')} confirmed, ${by(
    'false_positive',
  )} false positive.`;
  doc.setFont('helvetica', 'bold');
  doc.text('Summary', M, y + 3);
  doc.setFont('helvetica', 'normal');
  const lines = doc.splitTextToSize(summary, W - 2 * M - 38);
  doc.text(lines, M + 38, y + 3);
  y += 4 + lines.length * 4;
  if (insp.error) {
    doc.setTextColor(...CRIMSON);
    doc.text(`Note: ${insp.error}`, M + 38, y + 2);
    doc.setTextColor(...INK);
    y += 6;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Potential defects', M, y + 6);
  autoTable(doc, {
    startY: y + 9,
    theme: 'grid',
    headStyles: { fillColor: NAVY, textColor: CREAM, fontSize: 7.5 },
    styles: { fontSize: 7.5, cellPadding: 1.5, lineColor: [220, 226, 230] },
    head: [['Defect ID', 'Category', 'Conf.', 'Video time', 'Section', 'Origin', 'Review status', 'Reviewer']],
    body: dets.length
      ? dets.map((d) => [d.id, CATEGORY_LABEL[d.category], `${Math.round(d.confidence * 100)}%`, fmtClock(d.video_time_s), d.section, d.origin === 'ai' ? 'AI prediction' : 'Simulated', REVIEW_LABEL[d.review_status], d.reviewer ?? '—'])
      : [['—', 'No potential defects recorded', '', '', '', '', '', '']],
    didParseCell: (c) => {
      if (c.section === 'body' && c.column.index === 1 && dets[c.row.index]) {
        c.cell.styles.textColor = [...CAT_RGB[dets[c.row.index].category]] as [number, number, number];
        c.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // evidence pages
  if (dets.length) {
    doc.addPage();
    header();
    let ey = 30;
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('Evidence', M, ey);
    ey += 5;
    const colW = (W - 2 * M - 6) / 2;
    let col = 0;
    for (const d of dets.slice(0, 24)) {
      const img = await loadImage(mediaUrl(d.evidence_url) ?? '');
      const ih = colW * (9 / 16);
      const blockH = ih + 25;
      if (ey + blockH > H - 14) {
        doc.addPage();
        header();
        ey = 30;
        col = 0;
      }
      const x = M + col * (colW + 6);
      if (img) {
        doc.addImage(img.data, 'JPEG', x, ey, colW, ih);
        const rgb = CAT_RGB[d.category];
        doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
        doc.setLineWidth(0.6);
        doc.rect(x + d.bbox.x * colW, ey + d.bbox.y * ih, d.bbox.w * colW, d.bbox.h * ih);
      } else {
        doc.setFillColor(235, 238, 240);
        doc.rect(x, ey, colW, ih, 'F');
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text('Evidence image unavailable', x + colW / 2, ey + ih / 2, { align: 'center' });
      }
      if (d.origin === 'simulated') {
        doc.setFillColor(...CRIMSON);
        doc.rect(x, ey, 16, 4.5, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'bold');
        doc.text('SIMULATED', x + 1.3, ey + 3.2);
      }
      doc.setTextColor(...INK);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text(`${d.id} · ${CATEGORY_LABEL[d.category]} · ${Math.round(d.confidence * 100)}%`, x, ey + ih + 5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(`${d.section} · video ${fmtClock(d.video_time_s)} · ${REVIEW_LABEL[d.review_status]}${d.reviewer ? ` by ${d.reviewer}` : ''}`, x, ey + ih + 9.5);
      doc.setTextColor(...INK);
      const n = doc.splitTextToSize(d.reviewer_notes ? `Notes: ${d.reviewer_notes}` : 'Notes: —', colW);
      doc.text(n.slice(0, 3), x, ey + ih + 14);
      col++;
      if (col === 2) {
        col = 0;
        ey += blockH;
      }
    }
    if (dets.length > 24) {
      doc.setFontSize(8);
      doc.text(`+ ${dets.length - 24} more findings — see Defect Records.`, M, H - 16);
    }
  }

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    footer(p, total);
  }
  doc.save(`AeroSpectra-${insp.id}${insp.is_demo ? '-DEMO' : ''}.pdf`);
}
