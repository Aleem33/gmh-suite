import { format } from 'date-fns';
import { formatCurrency } from './utils';

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatDateTime = (value: unknown) => {
  try {
    return value ? format(new Date(String(value)), 'dd/MM/yyyy HH:mm') : format(new Date(), 'dd/MM/yyyy HH:mm');
  } catch {
    return String(value || '');
  }
};

export function buildPharmacyReceiptHtml(receipt: any, title = 'Receipt') {
  const items = Array.isArray(receipt?.items) ? receipt.items : [];
  const orderDiscountPercent = Number(receipt?.orderDiscountPercent || 0);
  const pendingAmount = Number(receipt?.pendingAmount || 0);
  const rows = items.map((item: any) => `
    <tr>
      <td>
        <div class="item-name">${escapeHtml(item.name)}</div>
        <div class="muted">${item.sellType === 'box' ? 'Box' : 'Unit'} @ ${escapeHtml(formatCurrency(Number(item.price || 0)))}</div>
        ${Number(item.itemDiscount || 0) > 0 ? `<div class="muted">Disc: -${escapeHtml(formatCurrency(Number(item.itemDiscount || 0)))}</div>` : ''}
      </td>
      <td class="center">${escapeHtml(item.quantity)}</td>
      <td class="right">${escapeHtml(formatCurrency(Number(item.total || 0)))}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: "Courier New", monospace; font-size: 11px; line-height: 1.25; }
    @page { size: 80mm auto; margin: 4mm 3mm; }
    .receipt { width: 74mm; max-width: 74mm; margin: 0 auto; }
    .center { text-align: center; }
    .right { text-align: right; }
    .muted { color: #333; font-size: 10px; overflow-wrap: anywhere; }
    h1 { font-size: 18px; margin: 0 0 3px; text-align: center; }
    .meta { text-align: center; margin-bottom: 8px; }
    .badge { display: inline-block; border: 1px solid #000; padding: 1px 6px; margin-top: 4px; font-weight: 700; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 3px 0; vertical-align: top; overflow-wrap: anywhere; }
    th:nth-child(1), td:nth-child(1) { width: 48mm; }
    th:nth-child(2), td:nth-child(2) { width: 9mm; }
    th:nth-child(3), td:nth-child(3) { width: 17mm; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    thead tr { border-bottom: 1px dashed #000; }
    tbody tr { border-bottom: 1px dashed #999; }
    .totals { border-top: 1px dashed #000; margin-top: 8px; padding-top: 6px; }
    .line { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
    .grand { border-top: 1px solid #000; margin-top: 5px; padding-top: 5px; font-size: 14px; font-weight: 700; }
    .footer { text-align: center; margin-top: 18px; font-size: 10px; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .receipt { margin: 0 auto; }
    }
  </style>
</head>
<body>
  <main class="receipt">
    <h1>GMH Suite Pharmacy</h1>
    <div class="meta">
      <div>${escapeHtml(title)}</div>
      <div>${escapeHtml(formatDateTime(receipt?.date))}</div>
      ${receipt?.quotationNo ? `<div>Quote: ${escapeHtml(receipt.quotationNo)}</div>` : ''}
      ${receipt?.id ? `<div>ID: ${escapeHtml(String(receipt.id).slice(0, 8))}</div>` : ''}
      <div class="badge">${escapeHtml(receipt?.customerType || 'customer')}</div>
      ${receipt?.customerName ? `<div>Customer: ${escapeHtml(receipt.customerName)}</div>` : ''}
    </div>
    <table>
      <thead>
        <tr><th class="left">Item</th><th class="center">Qty</th><th class="right">Total</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <section class="totals">
      <div class="line"><span>Subtotal:</span><span>${escapeHtml(formatCurrency(Number(receipt?.grossSubtotal || 0)))}</span></div>
      ${Number(receipt?.totalItemDiscounts || 0) > 0 ? `<div class="line"><span>Item Discounts:</span><span>-${escapeHtml(formatCurrency(Number(receipt.totalItemDiscounts || 0)))}</span></div>` : ''}
      ${Number(receipt?.orderDiscount || 0) > 0 ? `<div class="line"><span>Order Discount${orderDiscountPercent ? ` (${orderDiscountPercent}%)` : ''}:</span><span>-${escapeHtml(formatCurrency(Number(receipt.orderDiscount || 0)))}</span></div>` : ''}
      <div class="line grand"><span>Total:</span><span>${escapeHtml(formatCurrency(Number(receipt?.total || 0)))}</span></div>
      ${pendingAmount > 0 ? `
        <div class="line"><span>Paid:</span><span>${escapeHtml(formatCurrency(Number(receipt?.amountPaid || 0)))}</span></div>
        <div class="line grand"><span>Pending:</span><span>${escapeHtml(formatCurrency(pendingAmount))}</span></div>
      ` : ''}
    </section>
    <div class="footer">
      <div>Thank you for your visit!</div>
      <div>Get Well Soon</div>
    </div>
  </main>
</body>
</html>`;
}

export interface HospitalPrintProfile {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  footerNote?: string;
}

export const EMPTY_HOSPITAL_PRINT_PROFILE: HospitalPrintProfile = {
  name: '',
  address: '',
  phone: '',
  email: '',
  footerNote: '',
};

export const PHARMACY_DOCUMENT_PRINT_FRAME = {
  width: '110mm',
  height: '190mm',
} as const;

export type PharmacyDocumentKind = 'bill' | 'quotation';

export interface PharmacyDocumentItemModel {
  serial: number;
  name: string;
  category: string;
  type: 'Box' | 'Unit';
  quantity: number;
  unitPrice: number;
  itemDiscount: number;
  lineTotal: number;
}

export interface PharmacyDocumentModel {
  kind: PharmacyDocumentKind;
  isQuotation: boolean;
  documentLabel: string;
  referenceLabel: string;
  referenceValue: string;
  dateText: string;
  customerType: string;
  items: PharmacyDocumentItemModel[];
  grossSubtotal: number;
  totalItemDiscounts: number;
  orderDiscountAmount: number;
  orderDiscountPercent: number;
  netTotal: number;
  pendingAmount: number;
  paidAmount: number;
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  businessEmail: string;
  businessFooter: string;
  customerName: string;
  customerPhone: string;
  patientMRN: string;
  admissionId: string;
  locationDetails: string;
  notes: string;
  isBackdated: boolean;
}

export function buildPharmacyDocumentModel(
  receipt: any,
  kind: PharmacyDocumentKind,
  hospitalProfile?: HospitalPrintProfile
): PharmacyDocumentModel {
  const isQuotation = kind === 'quotation';
  const documentLabel = isQuotation ? 'Pharmacy Quotation' : 'Pharmacy Bill';
  const referenceLabel = isQuotation ? 'Quotation No' : 'Bill ID';
  const referenceValue = String(isQuotation
    ? (receipt?.quotationNo || (receipt?.id ? String(receipt.id).slice(0, 10) : '-'))
    : (receipt?.id ? String(receipt.id).slice(0, 10) : '-'));
  const rawItems = Array.isArray(receipt?.items) ? receipt.items : [];
  const items = rawItems.map((item: any, index: number): PharmacyDocumentItemModel => {
    const quantity = Number(item?.quantity || 0);
    const unitPrice = Number(item?.price || 0);
    const itemDiscount = Number(item?.itemDiscount || 0);
    const lineTotal = item?.total != null
      ? Number(item.total || 0)
      : Math.max(0, quantity * unitPrice - itemDiscount);
    return {
      serial: index + 1,
      name: String(item?.name || ''),
      category: String(item?.category || ''),
      type: item?.sellType === 'box' ? 'Box' : 'Unit',
      quantity,
      unitPrice,
      itemDiscount,
      lineTotal,
    };
  });
  const itemDiscountsFromRows = items.reduce((sum, item) => sum + item.itemDiscount, 0);
  const grossFromRows = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const netFromRows = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const totalItemDiscounts = receipt?.totalItemDiscounts != null
    ? Number(receipt.totalItemDiscounts || 0)
    : itemDiscountsFromRows;
  const grossSubtotal = receipt?.grossSubtotal != null
    ? Number(receipt.grossSubtotal || 0)
    : (grossFromRows || Number(receipt?.subtotal || 0) + totalItemDiscounts);
  const subtotalAfterItemDiscounts = receipt?.subtotal != null
    ? Number(receipt.subtotal || 0)
    : (netFromRows || Math.max(0, grossSubtotal - totalItemDiscounts));
  const orderDiscountAmount = receipt?.orderDiscount != null
    ? Number(receipt.orderDiscount || 0)
    : Math.max(0, Number(receipt?.discount || 0) - totalItemDiscounts);
  const netTotal = receipt?.total != null
    ? Number(receipt.total || 0)
    : Math.max(0, subtotalAfterItemDiscounts - orderDiscountAmount);
  const pendingAmount = receipt?.pendingAmount != null ? Number(receipt.pendingAmount || 0) : 0;
  const paidAmount = receipt?.amountPaid != null
    ? Number(receipt.amountPaid || 0)
    : Math.max(0, netTotal - pendingAmount);
  const hasHospitalProfile = hospitalProfile !== undefined;
  const businessName = String(
    (hasHospitalProfile ? hospitalProfile?.name : (receipt?.shopName || receipt?.hospitalName)) || 'GMH Suite Pharmacy'
  ).trim();
  const businessAddress = String(
    hasHospitalProfile ? (hospitalProfile?.address || '') : (receipt?.shopAddress || receipt?.hospitalAddress || '')
  ).trim();
  const businessPhone = String(
    hasHospitalProfile ? (hospitalProfile?.phone || '') : (receipt?.shopPhone || receipt?.hospitalPhone || '')
  ).trim();
  const businessEmail = String(
    hasHospitalProfile ? (hospitalProfile?.email || '') : (receipt?.shopEmail || receipt?.hospitalEmail || '')
  ).trim();
  const businessFooter = String(
    hasHospitalProfile ? (hospitalProfile?.footerNote || '') : (receipt?.shopFooter || receipt?.hospitalFooter || '')
  ).trim();
  const customerName = String(
    receipt?.customerName || receipt?.patientName || (receipt?.customerType === 'hospital' ? 'Hospital Patient' : 'Walk-in Customer')
  );
  const patientMRN = String(receipt?.patientMRN || receipt?.mrn || '');
  const admissionId = String(receipt?.admissionId || receipt?.admissionNo || '');
  const wardName = String(receipt?.wardName || receipt?.ward || '');
  const bedNo = String(receipt?.bedNo || receipt?.bed || '');

  return {
    kind,
    isQuotation,
    documentLabel,
    referenceLabel,
    referenceValue,
    dateText: formatDateTime(receipt?.date),
    customerType: String(receipt?.customerType || 'customer'),
    items,
    grossSubtotal,
    totalItemDiscounts,
    orderDiscountAmount,
    orderDiscountPercent: Number(receipt?.orderDiscountPercent || 0),
    netTotal,
    pendingAmount,
    paidAmount,
    businessName,
    businessAddress,
    businessPhone,
    businessEmail,
    businessFooter,
    customerName,
    customerPhone: String(receipt?.customerPhone || ''),
    patientMRN,
    admissionId,
    locationDetails: [wardName, bedNo ? `Bed ${bedNo}` : ''].filter(Boolean).join(' | '),
    notes: String(receipt?.notes || ''),
    isBackdated: Boolean(receipt?.isBackdated),
  };
}

function buildPharmacyDocumentHtml(
  receipt: any,
  title: string,
  hospitalProfile: HospitalPrintProfile | undefined,
  kind: PharmacyDocumentKind
) {
  const model = buildPharmacyDocumentModel(receipt, kind, hospitalProfile);
  const {
    isQuotation, documentLabel, referenceLabel, referenceValue, dateText, customerType, items,
    grossSubtotal, totalItemDiscounts, orderDiscountAmount, orderDiscountPercent, netTotal,
    pendingAmount, paidAmount, businessName, businessAddress, businessPhone, businessEmail,
    businessFooter, customerName, customerPhone, patientMRN, admissionId, locationDetails,
    notes, isBackdated,
  } = model;
  const rows = items.map(item => {
    return `
      <tr>
        <td class="center">${item.serial}</td>
        <td>
          <div class="item-name">${escapeHtml(item.name)}</div>
          ${item.category ? `<div class="muted">${escapeHtml(item.category)}</div>` : ''}
        </td>
        <td>${escapeHtml(item.type)}</td>
        <td class="right">${escapeHtml(item.quantity)}</td>
        <td class="right">${escapeHtml(formatCurrency(item.unitPrice))}</td>
        <td class="right">${item.itemDiscount > 0 ? escapeHtml(formatCurrency(item.itemDiscount)) : '-'}</td>
        <td class="right">${escapeHtml(formatCurrency(item.lineTotal))}</td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 9px; line-height: 1.25; }
    @page { size: 110mm 190mm; margin: 5mm; }
    .bill { width: 100mm; max-width: 100mm; margin: 0 auto; }
    .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 4mm; border-bottom: 1.5px solid #111827; padding-bottom: 4px; margin-bottom: 5px; break-inside: avoid; page-break-inside: avoid; }
    .brand { min-width: 0; flex: 1 1 auto; overflow-wrap: anywhere; }
    .brand h1 { margin: 0; font-size: 15px; line-height: 1.1; letter-spacing: 0; }
    .brand .subtitle { margin-top: 1px; font-size: 8.5px; font-weight: 700; color: #2563eb; text-transform: uppercase; }
    .muted { color: #4b5563; font-size: 8px; }
    .invoice-box { flex: 0 0 34mm; border: 1px solid #d1d5db; border-radius: 3px; padding: 4px; }
    .invoice-title { font-size: 11px; font-weight: 800; text-align: right; margin-bottom: 3px; text-transform: uppercase; }
    .row { display: flex; justify-content: space-between; gap: 6px; margin: 1px 0; }
    .label { color: #6b7280; }
    .value { font-weight: 700; text-align: right; }
    .details { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 5px; break-inside: avoid; page-break-inside: avoid; }
    .panel { border: 1px solid #e5e7eb; border-radius: 3px; padding: 4px; min-height: 15mm; overflow-wrap: anywhere; }
    .panel-title { margin-bottom: 2px; font-size: 8px; color: #6b7280; text-transform: uppercase; font-weight: 800; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th { background: #f3f4f6; border: 1px solid #9ca3af; padding: 3px 2px; text-align: left; font-size: 7.5px; line-height: 1.15; text-transform: uppercase; overflow-wrap: anywhere; }
    td { border: 1px solid #d1d5db; padding: 3px 2px; vertical-align: top; font-size: 8px; line-height: 1.2; overflow-wrap: anywhere; }
    th:nth-child(1), td:nth-child(1) { width: 5mm; }
    th:nth-child(2), td:nth-child(2) { width: 31mm; }
    th:nth-child(3), td:nth-child(3) { width: 9mm; }
    th:nth-child(4), td:nth-child(4) { width: 8mm; }
    th:nth-child(5), td:nth-child(5) { width: 16mm; }
    th:nth-child(6), td:nth-child(6) { width: 15mm; }
    th:nth-child(7), td:nth-child(7) { width: 16mm; }
    .center { text-align: center; }
    .right { text-align: right; }
    .item-name { font-weight: 700; }
    .closing { break-inside: avoid; page-break-inside: avoid; }
    .summary-wrap { display: flex; justify-content: flex-end; margin-top: 6px; }
    .summary { width: 52mm; border: 1px solid #d1d5db; border-radius: 3px; overflow: hidden; }
    .summary .row { margin: 0; padding: 3px 5px; border-bottom: 1px solid #e5e7eb; }
    .summary .row:last-child { border-bottom: 0; }
    .summary .total { background: #111827; color: #fff; font-size: 11px; font-weight: 800; }
    .summary .pending { background: #fef2f2; color: #991b1b; font-weight: 800; }
    .footer { margin-top: 7px; display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; color: #4b5563; font-size: 8px; }
    .footer > div:first-child { max-width: 58mm; overflow-wrap: anywhere; }
    .sign { width: 34mm; padding-top: 8mm; border-bottom: 1px solid #111827; text-align: center; color: #111827; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .bill { margin: 0 auto; }
    }
  </style>
</head>
<body>
  <main class="bill">
    <header class="top">
      <section class="brand">
        <h1>${escapeHtml(businessName)}</h1>
        <div class="subtitle">${escapeHtml(documentLabel)}</div>
        ${businessAddress ? `<div class="muted">${escapeHtml(businessAddress)}</div>` : ''}
        ${businessPhone ? `<div class="muted">Phone: ${escapeHtml(businessPhone)}</div>` : ''}
        ${businessEmail ? `<div class="muted">Email: ${escapeHtml(businessEmail)}</div>` : ''}
      </section>
      <section class="invoice-box">
        <div class="invoice-title">${escapeHtml(title)}</div>
        <div class="row"><span class="label">${escapeHtml(referenceLabel)}</span><span class="value">${escapeHtml(referenceValue)}</span></div>
        <div class="row"><span class="label">Date</span><span class="value">${escapeHtml(dateText)}</span></div>
        <div class="row"><span class="label">Type</span><span class="value">${escapeHtml(customerType)}</span></div>
      </section>
    </header>

    <section class="details">
      <div class="panel">
        <div class="panel-title">${isQuotation ? 'Quotation For' : 'Bill To'}</div>
        <div><strong>${escapeHtml(customerName)}</strong></div>
        ${customerPhone ? `<div class="muted">Phone: ${escapeHtml(customerPhone)}</div>` : ''}
        ${patientMRN ? `<div class="muted">MRN: ${escapeHtml(patientMRN)}</div>` : ''}
        ${admissionId ? `<div class="muted">Admission: ${escapeHtml(admissionId)}</div>` : ''}
        ${locationDetails ? `<div class="muted">${escapeHtml(locationDetails)}</div>` : ''}
      </div>
      <div class="panel">
        <div class="panel-title">${isQuotation ? 'Estimate' : 'Payment'}</div>
        <div class="row"><span class="label">Items</span><span class="value">${items.length}</span></div>
        <div class="row"><span class="label">Status</span><span class="value">${isQuotation ? 'Estimate' : (pendingAmount > 0 ? 'Pending' : 'Paid')}</span></div>
        ${isQuotation && notes ? `<div class="muted"><strong>Notes:</strong> ${escapeHtml(notes)}</div>` : ''}
        ${isQuotation ? '<div class="muted">Stock is not reserved.</div>' : (isBackdated ? '<div class="muted">Entered as previous-date bill</div>' : '')}
      </div>
    </section>

    <table>
      <thead>
        <tr>
          <th class="center">#</th>
          <th>Item</th>
          <th>Type</th>
          <th class="right">Qty</th>
          <th class="right">Unit Price</th>
          <th class="right">Discount</th>
          <th class="right">Line Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <section class="closing">
      <section class="summary-wrap">
        <div class="summary">
          <div class="row"><span>Subtotal</span><strong>${escapeHtml(formatCurrency(grossSubtotal))}</strong></div>
          ${totalItemDiscounts > 0 ? `<div class="row"><span>Item Discounts</span><strong>-${escapeHtml(formatCurrency(totalItemDiscounts))}</strong></div>` : ''}
          ${orderDiscountAmount > 0 ? `<div class="row"><span>Order Discount${orderDiscountPercent ? ` (${orderDiscountPercent}%)` : ''}</span><strong>-${escapeHtml(formatCurrency(orderDiscountAmount))}</strong></div>` : ''}
          <div class="row total"><span>Net Total</span><span>${escapeHtml(formatCurrency(netTotal))}</span></div>
          ${!isQuotation && pendingAmount > 0 ? `
            <div class="row"><span>Paid</span><strong>${escapeHtml(formatCurrency(paidAmount))}</strong></div>
            <div class="row pending"><span>Pending</span><span>${escapeHtml(formatCurrency(pendingAmount))}</span></div>
          ` : ''}
        </div>
      </section>

      <footer class="footer">
        <div>${businessFooter ? `<strong>${escapeHtml(businessFooter)}</strong>` : ''}</div>
        <div class="sign">Authorized Signature</div>
      </footer>
    </section>
  </main>
</body>
</html>`;
}

export function buildPharmacyBillHtml(
  receipt: any,
  title = 'Pharmacy Bill',
  hospitalProfile?: HospitalPrintProfile
) {
  return buildPharmacyDocumentHtml(receipt, title, hospitalProfile, 'bill');
}

export function buildPharmacyQuotationHtml(
  quotation: any,
  title = 'Pharmacy Quotation',
  hospitalProfile?: HospitalPrintProfile
) {
  return buildPharmacyDocumentHtml(quotation, title, hospitalProfile, 'quotation');
}
