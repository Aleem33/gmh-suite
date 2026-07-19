import {
  previewOrSharePdf,
  printHtmlOrShare,
  shouldUsePharmacyPdfPreview,
} from './nativeUtils';
import {
  buildPharmacyBillHtml,
  buildPharmacyQuotationHtml,
  PHARMACY_DOCUMENT_PRINT_FRAME,
  type HospitalPrintProfile,
  type PharmacyDocumentKind,
} from './printTemplates';

export interface PharmacyDocumentPrintOptions {
  kind: PharmacyDocumentKind;
  record: any;
  hospitalProfile?: HospitalPrintProfile;
  title?: string;
  filename?: string;
}

export async function printPharmacyDocument({
  kind,
  record,
  hospitalProfile,
  title = kind === 'quotation' ? 'Pharmacy Quotation' : 'Pharmacy Bill',
  filename = kind === 'quotation' ? 'pharmacy-quotation.pdf' : 'pharmacy-bill.pdf',
}: PharmacyDocumentPrintOptions): Promise<void> {
  if (shouldUsePharmacyPdfPreview()) {
    const { buildPharmacyDocumentPdf } = await import('./pharmacyDocumentPdf');
    const pdf = buildPharmacyDocumentPdf(record, kind, hospitalProfile, title);
    await previewOrSharePdf(pdf.output('blob'), filename, title);
    return;
  }

  const html = kind === 'quotation'
    ? buildPharmacyQuotationHtml(record, title, hospitalProfile)
    : buildPharmacyBillHtml(record, title, hospitalProfile);
  await printHtmlOrShare(html, filename.replace(/\.pdf$/i, '.html'), title, PHARMACY_DOCUMENT_PRINT_FRAME);
}
