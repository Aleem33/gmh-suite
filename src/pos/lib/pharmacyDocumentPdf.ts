import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCurrency } from './utils';
import {
  buildPharmacyDocumentModel,
  type HospitalPrintProfile,
  type PharmacyDocumentKind,
  type PharmacyDocumentModel,
} from './printTemplates';

const PAGE_WIDTH = 110;
const PAGE_HEIGHT = 190;
const PAGE_MARGIN = 5;
const CONTENT_WIDTH = 100;
const PAGE_NUMBER_Y = 187;

type SummaryRow = {
  label: string;
  value: string;
  emphasis?: 'total' | 'pending';
};

const pdfCurrency = (value: number) => formatCurrency(value).replace(/\u00a0/g, ' ');

function splitText(doc: jsPDF, text: string, width: number): string[] {
  if (!text) return [];
  const lines = doc.splitTextToSize(text, width);
  return Array.isArray(lines) ? lines.map(String) : [String(lines)];
}

function drawHeader(doc: jsPDF, model: PharmacyDocumentModel, title: string) {
  const brandWidth = 62;
  const boxX = 71;
  const boxWidth = 34;
  let brandY = 8;

  doc.setTextColor(17, 24, 39);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  const nameLines = splitText(doc, model.businessName, brandWidth);
  doc.text(nameLines, PAGE_MARGIN, brandY);
  brandY += nameLines.length * 4.8;

  doc.setTextColor(37, 99, 235);
  doc.setFontSize(8);
  doc.text(model.documentLabel.toUpperCase(), PAGE_MARGIN, brandY);
  brandY += 3.5;

  doc.setTextColor(75, 85, 99);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  const contactLines = [
    model.businessAddress,
    model.businessPhone ? `Phone: ${model.businessPhone}` : '',
    model.businessEmail ? `Email: ${model.businessEmail}` : '',
  ].flatMap(line => splitText(doc, line, brandWidth));
  if (contactLines.length) {
    doc.text(contactLines, PAGE_MARGIN, brandY);
    brandY += contactLines.length * 2.9;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(17, 24, 39);
  const titleLines = splitText(doc, title.toUpperCase(), boxWidth - 4);
  const boxHeight = Math.max(20, 5 + titleLines.length * 3.5 + 10.5);
  doc.setDrawColor(209, 213, 219);
  doc.rect(boxX, PAGE_MARGIN, boxWidth, boxHeight);
  doc.text(titleLines, boxX + boxWidth - 2, PAGE_MARGIN + 4, { align: 'right' });

  const metaY = PAGE_MARGIN + 5 + titleLines.length * 3.5;
  doc.setFontSize(6.2);
  const metaRows = [
    [model.referenceLabel, model.referenceValue],
    ['Date', model.dateText],
    ['Type', model.customerType],
  ];
  metaRows.forEach(([label, value], index) => {
    const y = metaY + index * 3.4;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(107, 114, 128);
    doc.text(label, boxX + 2, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(17, 24, 39);
    const valueLines = splitText(doc, value, 19);
    doc.text(valueLines[0] || '-', boxX + boxWidth - 2, y, { align: 'right' });
  });

  const headerBottom = Math.max(brandY, PAGE_MARGIN + boxHeight) + 1.5;
  doc.setDrawColor(17, 24, 39);
  doc.setLineWidth(0.45);
  doc.line(PAGE_MARGIN, headerBottom, PAGE_WIDTH - PAGE_MARGIN, headerBottom);
  return headerBottom + 2;
}

function drawDetails(doc: jsPDF, model: PharmacyDocumentModel, startY: number) {
  const gap = 2;
  const panelWidth = (CONTENT_WIDTH - gap) / 2;
  const textWidth = panelWidth - 4;
  const leftLines = [
    model.customerName,
    model.customerPhone ? `Phone: ${model.customerPhone}` : '',
    model.patientMRN ? `MRN: ${model.patientMRN}` : '',
    model.admissionId ? `Admission: ${model.admissionId}` : '',
    model.locationDetails,
  ].filter(Boolean).flatMap(line => splitText(doc, line, textWidth));
  const status = model.isQuotation ? 'Estimate' : (model.pendingAmount > 0 ? 'Pending' : 'Paid');
  const rightLines = [
    `Items: ${model.items.length}`,
    `Status: ${status}`,
    model.isQuotation && model.notes ? `Notes: ${model.notes}` : '',
    model.isQuotation ? 'Stock is not reserved.' : (model.isBackdated ? 'Entered as previous-date bill' : ''),
  ].filter(Boolean).flatMap(line => splitText(doc, line, textWidth));
  const panelHeight = Math.max(16, 6.5 + Math.max(leftLines.length, rightLines.length) * 3);

  const drawPanel = (x: number, heading: string, lines: string[], emphasizeFirst: boolean) => {
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.2);
    doc.rect(x, startY, panelWidth, panelHeight);
    doc.setTextColor(107, 114, 128);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.text(heading.toUpperCase(), x + 2, startY + 3.5);
    lines.forEach((line, index) => {
      doc.setFont('helvetica', emphasizeFirst && index === 0 ? 'bold' : 'normal');
      doc.setTextColor(index === 0 && emphasizeFirst ? 17 : 75, index === 0 && emphasizeFirst ? 24 : 85, index === 0 && emphasizeFirst ? 39 : 99);
      doc.setFontSize(index === 0 && emphasizeFirst ? 7 : 6.3);
      doc.text(line, x + 2, startY + 7 + index * 3);
    });
  };

  drawPanel(PAGE_MARGIN, model.isQuotation ? 'Quotation For' : 'Bill To', leftLines, true);
  drawPanel(PAGE_MARGIN + panelWidth + gap, model.isQuotation ? 'Estimate' : 'Payment', rightLines, false);
  return startY + panelHeight + 2;
}

function summaryRows(model: PharmacyDocumentModel): SummaryRow[] {
  const rows: SummaryRow[] = [{ label: 'Subtotal', value: pdfCurrency(model.grossSubtotal) }];
  if (model.totalItemDiscounts > 0) {
    rows.push({ label: 'Item Discounts', value: `-${pdfCurrency(model.totalItemDiscounts)}` });
  }
  if (model.orderDiscountAmount > 0) {
    const percent = model.orderDiscountPercent ? ` (${model.orderDiscountPercent}%)` : '';
    rows.push({ label: `Order Discount${percent}`, value: `-${pdfCurrency(model.orderDiscountAmount)}` });
  }
  rows.push({ label: 'Net Total', value: pdfCurrency(model.netTotal), emphasis: 'total' });
  if (!model.isQuotation && model.pendingAmount > 0) {
    rows.push({ label: 'Paid', value: pdfCurrency(model.paidAmount) });
    rows.push({ label: 'Pending', value: pdfCurrency(model.pendingAmount), emphasis: 'pending' });
  }
  return rows;
}

function drawClosing(doc: jsPDF, model: PharmacyDocumentModel, tableEndY: number) {
  const rows = summaryRows(model);
  const rowHeight = 5;
  const summaryHeight = rows.length * rowHeight;
  const closingHeight = summaryHeight + 17;
  let startY = tableEndY + 3;
  if (startY + closingHeight > PAGE_HEIGHT - 8) {
    doc.addPage([PAGE_WIDTH, PAGE_HEIGHT], 'portrait');
    startY = 8;
  }

  const summaryX = 53;
  const summaryWidth = 52;
  rows.forEach((row, index) => {
    const y = startY + index * rowHeight;
    if (row.emphasis === 'total') {
      doc.setFillColor(17, 24, 39);
      doc.rect(summaryX, y, summaryWidth, rowHeight, 'F');
      doc.setTextColor(255, 255, 255);
    } else if (row.emphasis === 'pending') {
      doc.setFillColor(254, 242, 242);
      doc.rect(summaryX, y, summaryWidth, rowHeight, 'F');
      doc.setTextColor(153, 27, 27);
    } else {
      doc.setTextColor(17, 24, 39);
    }
    doc.setDrawColor(209, 213, 219);
    doc.setLineWidth(0.2);
    doc.rect(summaryX, y, summaryWidth, rowHeight);
    doc.setFont('helvetica', row.emphasis ? 'bold' : 'normal');
    doc.setFontSize(row.emphasis === 'total' ? 7.5 : 6.5);
    doc.text(row.label, summaryX + 2, y + 3.3);
    doc.text(row.value, summaryX + summaryWidth - 2, y + 3.3, { align: 'right' });
  });

  const footerY = startY + summaryHeight + 5;
  doc.setFont('helvetica', model.businessFooter ? 'bold' : 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(75, 85, 99);
  const footerLines = splitText(doc, model.businessFooter, 58);
  if (footerLines.length) doc.text(footerLines, PAGE_MARGIN, footerY);

  doc.setDrawColor(17, 24, 39);
  doc.line(71, footerY + 5, 105, footerY + 5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(17, 24, 39);
  doc.text('Authorized Signature', 88, footerY + 8, { align: 'center' });
}

function addPageNumbers(doc: jsPDF) {
  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.5);
    doc.setTextColor(107, 114, 128);
    doc.text(`${page}/${totalPages}`, PAGE_WIDTH / 2, PAGE_NUMBER_Y, { align: 'center' });
  }
}

export function buildPharmacyDocumentPdf(
  record: any,
  kind: PharmacyDocumentKind,
  hospitalProfile: HospitalPrintProfile | undefined,
  title: string
) {
  const model = buildPharmacyDocumentModel(record, kind, hospitalProfile);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [PAGE_WIDTH, PAGE_HEIGHT],
    compress: true,
  });
  doc.setProperties({
    title,
    subject: model.documentLabel,
    author: model.businessName,
    creator: 'GMH Suite',
  });

  const detailsEndY = drawDetails(doc, model, drawHeader(doc, model, title));
  autoTable(doc, {
    startY: detailsEndY,
    margin: { top: PAGE_MARGIN, right: PAGE_MARGIN, bottom: 8, left: PAGE_MARGIN },
    tableWidth: CONTENT_WIDTH,
    showHead: 'everyPage',
    pageBreak: 'auto',
    rowPageBreak: 'avoid',
    theme: 'grid',
    head: [['#', 'Item', 'Type', 'Qty', 'Unit Price', 'Discount', 'Line Total']],
    body: model.items.map(item => [
      item.serial,
      item.category ? `${item.name}\n${item.category}` : item.name,
      item.type,
      item.quantity,
      pdfCurrency(item.unitPrice),
      item.itemDiscount > 0 ? pdfCurrency(item.itemDiscount) : '-',
      pdfCurrency(item.lineTotal),
    ]),
    styles: {
      font: 'helvetica',
      fontSize: 6.2,
      textColor: [17, 24, 39],
      lineColor: [209, 213, 219],
      lineWidth: 0.2,
      cellPadding: 1,
      overflow: 'linebreak',
      valign: 'top',
    },
    headStyles: {
      fillColor: [243, 244, 246],
      textColor: [17, 24, 39],
      fontStyle: 'bold',
      fontSize: 6,
      lineColor: [156, 163, 175],
      halign: 'left',
    },
    columnStyles: {
      0: { cellWidth: 5, halign: 'center' },
      1: { cellWidth: 31 },
      2: { cellWidth: 9 },
      3: { cellWidth: 8, halign: 'right' },
      4: { cellWidth: 16, halign: 'right' },
      5: { cellWidth: 15, halign: 'right' },
      6: { cellWidth: 16, halign: 'right' },
    },
  });

  const tableEndY = Number((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || detailsEndY);
  drawClosing(doc, model, tableEndY);
  addPageNumbers(doc);
  return doc;
}
