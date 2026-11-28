import jsPDF from 'jspdf';
import { splitIntoGraphemeClusters } from './domain-logic';

export interface PdfTableColumn {
  header: string;
  widthMm: number;
  align?: 'left' | 'right' | 'center';
}

export interface FinancialReportPdfInput {
  churchName: string;
  reportTitle: string;
  periodLabel: string;
  generatedAt: string;
  columns: PdfTableColumn[];
  rows: string[][];
  footerRow?: string[];
  emptyMessage?: string;
  fileName: string;
}

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MARGIN_X_MM = 12;
const CONTENT_WIDTH_MM = A4_WIDTH_MM - MARGIN_X_MM * 2; // 186mm
const FOOTER_Y_MM = 289;
const MAX_BODY_Y_MM = 281;
const PX_PER_MM = 8; // 1680 x 2376 px (~203 DPI) for crisp Gujarati & tabular text
const PT_TO_MM = 0.352778;

const PDF_FONT_FAMILY =
  '"Noto Sans Gujarati", "Shruti", "Kohinoor Gujarati", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function fontSpec(weight: 400 | 600 | 700, sizePt: number): string {
  const sizeMm = (sizePt * PT_TO_MM).toFixed(3);
  return `${weight} ${sizeMm}px ${PDF_FONT_FAMILY}`;
}

async function ensureGujaratiFontsLoaded(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;

  try {
    const fontLoads = Promise.allSettled([
      document.fonts.load('400 14px "Noto Sans Gujarati"'),
      document.fonts.load('600 14px "Noto Sans Gujarati"'),
      document.fonts.load('700 14px "Noto Sans Gujarati"'),
      document.fonts.ready,
    ]);
    await Promise.race([
      fontLoads,
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch {
    // Graceful fallback to OS Gujarati/sans fonts if font loading throws
  }
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  rawText: string,
  maxWidthMm: number
): string[] {
  const text = (rawText ?? '').toString().trim();
  if (!text) return [''];

  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidthMm) {
        currentLine = candidate;
        continue;
      }

      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }

      if (ctx.measureText(word).width <= maxWidthMm) {
        currentLine = word;
      } else {
        // Wrap overly long tokens by grapheme cluster so Gujarati matras/conjuncts never break
        const clusters = splitIntoGraphemeClusters(word);
        let chunk = '';
        for (const cluster of clusters) {
          const nextChunk = chunk + cluster;
          if (chunk && ctx.measureText(nextChunk).width > maxWidthMm) {
            lines.push(chunk);
            chunk = cluster;
          } else {
            chunk = nextChunk;
          }
        }
        currentLine = chunk;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines.length > 0 ? lines : [''];
}

function createA4PageCanvas(): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(A4_WIDTH_MM * PX_PER_MM);
  canvas.height = Math.round(A4_HEIGHT_MM * PX_PER_MM);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas context for PDF generation.');
  }

  ctx.scale(PX_PER_MM, PX_PER_MM);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, A4_WIDTH_MM, A4_HEIGHT_MM);
  ctx.textBaseline = 'middle';

  return { canvas, ctx };
}

function drawFirstPageBanner(
  ctx: CanvasRenderingContext2D,
  input: FinancialReportPdfInput
): number {
  const bannerHeight = 33;
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, A4_WIDTH_MM, bannerHeight);

  // Church Name (supports Gujarati + long titles gracefully)
  ctx.fillStyle = '#ffffff';
  ctx.font = fontSpec(700, 14);
  const titleLines = wrapTextLines(ctx, input.churchName, CONTENT_WIDTH_MM).slice(0, 2);
  let titleY = titleLines.length > 1 ? 8.5 : 10.5;
  for (const line of titleLines) {
    ctx.textAlign = 'left';
    ctx.fillText(line, MARGIN_X_MM, titleY);
    titleY += 5.2;
  }

  // Report Subtitle
  ctx.fillStyle = '#cbd5e1';
  ctx.font = fontSpec(600, 9.5);
  ctx.textAlign = 'left';
  ctx.fillText(`Financial Report: ${input.reportTitle}`, MARGIN_X_MM, titleLines.length > 1 ? 19.5 : 18);

  // Period (left) & Timestamp (right)
  ctx.fillStyle = '#cbd5e1';
  ctx.font = fontSpec(400, 8.5);
  ctx.textAlign = 'left';
  ctx.fillText(`Period: ${input.periodLabel}`, MARGIN_X_MM, 26.2);

  ctx.fillStyle = '#94a3b8';
  ctx.font = fontSpec(400, 7.5);
  ctx.textAlign = 'right';
  ctx.fillText(`Generated: ${input.generatedAt} (IST)`, A4_WIDTH_MM - MARGIN_X_MM, 26.2);

  return bannerHeight + 6; // startY = 39mm
}

function drawContinuationHeader(
  ctx: CanvasRenderingContext2D,
  input: FinancialReportPdfInput
): number {
  ctx.fillStyle = '#1e293b';
  ctx.font = fontSpec(700, 9.5);
  ctx.textAlign = 'left';
  ctx.fillText(input.churchName, MARGIN_X_MM, 10.5);

  ctx.fillStyle = '#64748b';
  ctx.font = fontSpec(400, 8);
  ctx.textAlign = 'right';
  ctx.fillText(`${input.reportTitle}  •  ${input.periodLabel}`, A4_WIDTH_MM - MARGIN_X_MM, 10.5);

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 0.25;
  ctx.beginPath();
  ctx.moveTo(MARGIN_X_MM, 14.5);
  ctx.lineTo(A4_WIDTH_MM - MARGIN_X_MM, 14.5);
  ctx.stroke();

  return 18;
}

function normalizeColumnWidths(columns: PdfTableColumn[]): PdfTableColumn[] {
  const total = columns.reduce((sum, c) => sum + c.widthMm, 0);
  if (Math.abs(total - CONTENT_WIDTH_MM) < 0.01 || total <= 0) {
    return columns;
  }
  const scale = CONTENT_WIDTH_MM / total;
  return columns.map((c) => ({ ...c, widthMm: c.widthMm * scale }));
}

function drawTableRow(
  ctx: CanvasRenderingContext2D,
  columns: PdfTableColumn[],
  cells: string[],
  y: number,
  options: {
    bgColor: string;
    textColor: string;
    borderColor?: string;
    weight: 400 | 600 | 700;
    fontSizePt: number;
  }
): number {
  const cellPaddingX = 2.2;
  const cellPaddingY = 2.1;
  const lineHeightMm = options.fontSizePt * PT_TO_MM * 1.45;

  ctx.font = fontSpec(options.weight, options.fontSizePt);

  const wrappedPerCol = columns.map((col, idx) =>
    wrapTextLines(ctx, cells[idx] ?? '', Math.max(4, col.widthMm - cellPaddingX * 2))
  );

  const maxLines = Math.max(1, ...wrappedPerCol.map((lines) => lines.length));
  const rowHeight = maxLines * lineHeightMm + cellPaddingY * 2;

  ctx.fillStyle = options.bgColor;
  ctx.fillRect(MARGIN_X_MM, y, CONTENT_WIDTH_MM, rowHeight);

  if (options.borderColor) {
    ctx.strokeStyle = options.borderColor;
    ctx.lineWidth = 0.2;
    ctx.beginPath();
    ctx.moveTo(MARGIN_X_MM, y + rowHeight);
    ctx.lineTo(MARGIN_X_MM + CONTENT_WIDTH_MM, y + rowHeight);
    ctx.stroke();
  }

  ctx.fillStyle = options.textColor;
  ctx.font = fontSpec(options.weight, options.fontSizePt);

  let colX = MARGIN_X_MM;
  columns.forEach((col, idx) => {
    const lines = wrappedPerCol[idx];
    const align = col.align || 'left';
    const textStartY = y + cellPaddingY + lineHeightMm / 2;

    lines.forEach((line, lineIdx) => {
      const lineY = textStartY + lineIdx * lineHeightMm;
      if (align === 'right') {
        ctx.textAlign = 'right';
        ctx.fillText(line, colX + col.widthMm - cellPaddingX, lineY);
      } else if (align === 'center') {
        ctx.textAlign = 'center';
        ctx.fillText(line, colX + col.widthMm / 2, lineY);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(line, colX + cellPaddingX, lineY);
      }
    });

    colX += col.widthMm;
  });

  return rowHeight;
}

function measureRowHeight(
  ctx: CanvasRenderingContext2D,
  columns: PdfTableColumn[],
  cells: string[],
  weight: 400 | 600 | 700,
  fontSizePt: number
): number {
  const cellPaddingX = 2.2;
  const cellPaddingY = 2.1;
  const lineHeightMm = fontSizePt * PT_TO_MM * 1.45;
  ctx.font = fontSpec(weight, fontSizePt);

  let maxLines = 1;
  columns.forEach((col, idx) => {
    const lines = wrapTextLines(
      ctx,
      cells[idx] ?? '',
      Math.max(4, col.widthMm - cellPaddingX * 2)
    );
    if (lines.length > maxLines) {
      maxLines = lines.length;
    }
  });

  return maxLines * lineHeightMm + cellPaddingY * 2;
}

/**
 * Generates and directly downloads a multi-page A4 PDF using browser-native Canvas 2D
 * OpenType shaping with Noto Sans Gujarati so Gujarati script, matras, conjuncts, and
 * mixed English/INR figures render crisply and accurately.
 */
export async function exportFinancialReportPdf(
  input: FinancialReportPdfInput
): Promise<void> {
  await ensureGujaratiFontsLoaded();

  const columns = normalizeColumnWidths(input.columns);
  const pages: Array<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> = [];

  let currentPage = createA4PageCanvas();
  pages.push(currentPage);
  let y = drawFirstPageBanner(currentPage.ctx, input);

  const drawHeaderOnCurrentPage = () => {
    const h = drawTableRow(
      currentPage.ctx,
      columns,
      columns.map((c) => c.header),
      y,
      {
        bgColor: '#0f172a',
        textColor: '#ffffff',
        weight: 700,
        fontSizePt: 8.2,
      }
    );
    y += h;
  };

  drawHeaderOnCurrentPage();

  if (input.rows.length === 0) {
    const emptyText =
      input.emptyMessage || 'No records found for the selected financial year and filters.';
    const rowH = 12;
    currentPage.ctx.fillStyle = '#f8fafc';
    currentPage.ctx.fillRect(MARGIN_X_MM, y, CONTENT_WIDTH_MM, rowH);
    currentPage.ctx.fillStyle = '#64748b';
    currentPage.ctx.font = fontSpec(400, 8.5);
    currentPage.ctx.textAlign = 'center';
    currentPage.ctx.fillText(emptyText, A4_WIDTH_MM / 2, y + rowH / 2);
    y += rowH;
  } else {
    input.rows.forEach((row, index) => {
      const estimatedH = measureRowHeight(currentPage.ctx, columns, row, 400, 8);
      if (y + estimatedH > MAX_BODY_Y_MM) {
        currentPage = createA4PageCanvas();
        pages.push(currentPage);
        y = drawContinuationHeader(currentPage.ctx, input);
        drawHeaderOnCurrentPage();
      }

      const drawnH = drawTableRow(currentPage.ctx, columns, row, y, {
        bgColor: index % 2 === 1 ? '#f8fafc' : '#ffffff',
        textColor: '#1e293b',
        borderColor: '#e2e8f0',
        weight: 400,
        fontSizePt: 8,
      });
      y += drawnH;
    });
  }

  if (input.footerRow && input.footerRow.length > 0) {
    const footerH = measureRowHeight(currentPage.ctx, columns, input.footerRow, 700, 8.2);
    if (y + footerH > MAX_BODY_Y_MM) {
      currentPage = createA4PageCanvas();
      pages.push(currentPage);
      y = drawContinuationHeader(currentPage.ctx, input);
      drawHeaderOnCurrentPage();
    }

    drawTableRow(currentPage.ctx, columns, input.footerRow, y, {
      bgColor: '#f1f5f9',
      textColor: '#0f172a',
      borderColor: '#cbd5e1',
      weight: 700,
      fontSizePt: 8.2,
    });
  }

  // Stamp page numbers onto every page and assemble PDF
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const totalPages = pages.length;
  pages.forEach((page, idx) => {
    page.ctx.fillStyle = '#64748b';
    page.ctx.font = fontSpec(400, 7.8);
    page.ctx.textAlign = 'left';
    page.ctx.fillText(
      `Page ${idx + 1} of ${totalPages}  •  Confidential Church Financial Record`,
      MARGIN_X_MM,
      FOOTER_Y_MM
    );

    if (idx > 0) {
      doc.addPage('a4', 'portrait');
    }
    const imgData = page.canvas.toDataURL('image/jpeg', 0.94);
    doc.addImage(imgData, 'JPEG', 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM, undefined, 'FAST');
  });

  doc.save(input.fileName);
}
