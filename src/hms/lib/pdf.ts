/**
 * GMH Suite - Print Utilities
 * Prescription layout prints onto the pre-printed GMH prescription pad.
 */
import { getPrescriptionPrintSettings } from './prescriptionPrintSettings';


function printHTML(html: string) {
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.id = `__print_frame_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:none;';
  iframe.src = url;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }, 400);
    setTimeout(() => { iframe.remove(); URL.revokeObjectURL(url); }, 5000);
  };
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// PRESCRIPTION
type PrescriptionPrintData = {
  patientName: string;
  patientMRN: string;
  patientAge?: string;
  patientGender?: string;
  doctorName?: string;
  department?: string;
  date: string;
  complaints?: string;
  diagnosis?: string;
  prescriptions: {
    name: string;
    nameUrdu?: string;
    dosage: string;
    dosageUrdu?: string;
    frequency: string;
    frequencyUrdu?: string;
    duration: string;
    durationUrdu?: string;
    instructions?: string;
    instructionsUrdu?: string;
  }[];
  labOrders?: { testName: string }[];
  followUpDate?: string;
  notes?: string;
  vitals?: { bp?: string; temperature?: string; weight?: string; pulse?: string; spo2?: string };
  hospitalName?: string;
  hospitalAddress?: string;
  hospitalPhone?: string;
};

function buildPreprintedPrescriptionHTML(data: PrescriptionPrintData): string {
  const settings = getPrescriptionPrintSettings();
  const scale = Math.max(70, Math.min(130, settings.fontScale || 100)) / 100;
  const rxRows = data.prescriptions.map((p, i) => `
    <div class="pad-med">
      <div class="pad-med-en">${i + 1}. ${esc(p.name)} ${esc(p.dosage)} - ${esc(p.frequency)} - ${esc(p.duration)}${p.instructions ? ` - ${esc(p.instructions)}` : ''}</div>
      ${(p.nameUrdu || p.dosageUrdu || p.frequencyUrdu || p.durationUrdu || p.instructionsUrdu) ? `
        <div class="pad-med-ur">${[p.nameUrdu, p.dosageUrdu, p.frequencyUrdu, p.durationUrdu, p.instructionsUrdu].filter(Boolean).map(esc).join(' - ')}</div>
      ` : ''}
    </div>
  `).join('');

  const complaints = data.complaints ? `<div class="pad-note"><strong>C/O:</strong> ${esc(data.complaints)}</div>` : '';
  const diagnosis = data.diagnosis ? `<div class="pad-note"><strong>Dx:</strong> ${esc(data.diagnosis)}</div>` : '';
  const labOrders = data.labOrders?.length
    ? `<div class="pad-note"><strong>Lab:</strong> ${data.labOrders.map(l => esc(l.testName)).join(', ')}</div>`
    : '';
  const followup = data.followUpDate ? `<div class="pad-note"><strong>F/U:</strong> ${esc(data.followUpDate)}</div>` : '';
  const notes = data.notes ? `<div class="pad-clinical"><strong>Notes</strong><br/>${esc(data.notes)}</div>` : '';

  const clinicalNotes = [complaints, diagnosis, notes].filter(Boolean).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>Prescription Pad Overlay</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&display=swap" rel="stylesheet">
<style>
@page { margin:0; size: A4 portrait; }
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#fff; font-family: Arial, sans-serif; color:#17205f; }
.page { width:210mm; height:297mm; position:relative; overflow:hidden; background:transparent; }
.overlay { position:absolute; inset:0; transform: translate(${settings.offsetX}mm, ${settings.offsetY}mm); transform-origin: top left; }
.patient-name { position:absolute; left:127mm; top:55mm; width:62mm; font-size:${12 * scale}px; font-weight:700; white-space:nowrap; overflow:hidden; text-align:right; }
.patient-age { position:absolute; left:86mm; top:55mm; width:25mm; font-size:${12 * scale}px; font-weight:700; white-space:nowrap; overflow:hidden; text-align:center; }
.patient-date { position:absolute; left:42mm; top:55mm; width:34mm; font-size:${12 * scale}px; font-weight:700; white-space:nowrap; overflow:hidden; text-align:center; }
.clinical-content { position:absolute; left:7mm; top:74mm; width:34mm; min-height:190mm; color:#17205f; }
.rx-content { position:absolute; left:46mm; top:72mm; width:112mm; min-height:194mm; color:#17205f; }
.pad-note, .pad-clinical { font-size:${11.5 * scale}px; line-height:1.35; margin-bottom:4mm; color:#17205f; }
.pad-med { margin-bottom:5mm; page-break-inside:avoid; }
.pad-med-en { font-size:${13 * scale}px; line-height:1.35; font-weight:700; color:#17205f; }
.pad-med-ur { margin-top:1mm; font-family:'Noto Nastaliq Urdu', serif; font-size:${13.5 * scale}px; line-height:1.85; font-weight:700; color:#1a7a1a; direction:rtl; text-align:right; }
.side-val { position:absolute; left:166mm; width:35mm; font-size:${10.5 * scale}px; font-weight:700; color:#17205f; white-space:nowrap; overflow:hidden; }
.bp { top:164mm; } .temp { top:174mm; } .spo2 { top:184mm; } .pulse { top:194mm; }
@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  body { margin:0; padding:0; }
}
</style>
</head>
<body>
<div class="page">
  <div class="overlay">
    <div class="patient-name">${esc(data.patientName)}</div>
    <div class="patient-age">${esc(data.patientAge || '')}</div>
    <div class="patient-date">${esc(data.date)}</div>
    <div class="clinical-content">
      ${clinicalNotes}
    </div>
    <div class="rx-content">
      ${rxRows}
      ${labOrders}
      ${followup}
    </div>
    <div class="side-val bp">${esc(data.vitals?.bp || '')}</div>
    <div class="side-val temp">${esc(data.vitals?.temperature || '')}</div>
    <div class="side-val spo2">${esc(data.vitals?.spo2 || '')}</div>
    <div class="side-val pulse">${esc(data.vitals?.pulse || '')}</div>
  </div>
</div>
</body>
</html>`;
}

export function printPrescription(data: PrescriptionPrintData) {
  printHTML(buildPreprintedPrescriptionHTML(data));
}

// BILL
export function printBill(data: {
  billNo: string; date: string; patientName: string; patientMRN: string;
  patientAge?: string; patientGender?: string;
  doctorName?: string; department?: string;
  items: { description: string; qty?: number; quantity?: number; unitPrice?: number; rate?: number; total?: number; amount?: number }[];
  subtotal: number; discount?: number; tax?: number; grandTotal?: number; total?: number;
  paidAmount?: number; paid?: number; balance: number; paymentMethod?: string; paymentStatus?: string;
  hospitalName?: string; hospitalAddress?: string; hospitalPhone?: string;
  hospitalFooter?: string;
}) {
  const rows = data.items.map(it => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6">${it.description}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;text-align:center">${it.qty ?? it.quantity ?? 1}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;text-align:right">Rs ${(it.unitPrice ?? it.rate ?? 0).toLocaleString()}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600">Rs ${(it.total ?? it.amount ?? 0).toLocaleString()}</td>
    </tr>`).join('');
  const grandTotal = data.grandTotal ?? data.total ?? 0;
  const paidAmount = data.paidAmount ?? data.paid ?? 0;
  const hospitalName = data.hospitalName || 'GMH SUITE';
  const hospitalLine = [data.hospitalAddress || 'Dhandi Road Kot Sabzal', data.hospitalPhone || '0304-7459201'].filter(Boolean).join(' &nbsp;|&nbsp; ');
  const footer = data.hospitalFooter || 'Thank you for choosing GMH Suite &nbsp;|&nbsp; Not Valid For Court';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Bill #${data.billNo}</title>
<style>
@page{margin:15mm;} *{margin:0;padding:0;box-sizing:border-box;}
body{font-family:Arial,sans-serif;font-size:12px;color:#111;}
.header{text-align:center;border-bottom:2px solid #1a237e;padding-bottom:12px;margin-bottom:16px;}
.clinic{font-size:22px;font-weight:900;color:#1a237e;letter-spacing:-1px;}
.addr{font-size:11px;color:#555;margin-top:3px;}
.bill-meta{display:flex;justify-content:space-between;margin-bottom:14px;font-size:11px;}
.bill-meta .block{background:#f8f9fa;border:1px solid #e9ecef;border-radius:6px;padding:8px 12px;}
table{width:100%;border-collapse:collapse;}
thead th{background:#1a237e;color:#fff;padding:8px 10px;text-align:left;font-size:11px;}
thead th:last-child,thead th:nth-child(3){text-align:right;}
thead th:nth-child(2){text-align:center;}
.totals{margin-top:12px;display:flex;justify-content:flex-end;}
.totals-box{width:220px;}
.tot-row{display:flex;justify-content:space-between;padding:4px 0;font-size:11px;border-bottom:1px solid #f3f4f6;}
.tot-row.grand{font-size:13px;font-weight:700;color:#1a237e;border-bottom:none;border-top:2px solid #1a237e;padding-top:6px;margin-top:4px;}
.paid{background:#ecfdf5;border:1px solid #6ee7b7;border-radius:6px;padding:8px 12px;margin-top:10px;display:flex;justify-content:space-between;font-size:11px;}
.footer{margin-top:20px;text-align:center;font-size:10px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:10px;}
</style></head><body>
<div class="header">
  <div class="clinic">${hospitalName}</div>
  <div class="addr">${hospitalLine}</div>
</div>
<div class="bill-meta">
  <div class="block">
    <div style="font-weight:700;color:#1a237e;margin-bottom:4px">Bill #${data.billNo}</div>
    <div>Date: ${data.date}</div>
    ${data.paymentMethod ? `<div>Payment: ${data.paymentMethod}</div>` : ''}
  </div>
  <div class="block">
    <div style="font-weight:700;margin-bottom:4px">${data.patientName}</div>
    <div>MRN: ${data.patientMRN}</div>
    ${data.patientAge ? `<div>Age: ${data.patientAge}${data.patientGender ? ' / ' + data.patientGender : ''}</div>` : ''}
    ${data.doctorName ? `<div>Dr. ${data.doctorName}</div>` : ''}
  </div>
</div>
<table>
  <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="totals">
  <div class="totals-box">
    <div class="tot-row"><span>Subtotal</span><span>Rs ${data.subtotal.toLocaleString()}</span></div>
    ${data.discount ? `<div class="tot-row"><span>Discount</span><span>- Rs ${data.discount.toLocaleString()}</span></div>` : ''}
    ${data.tax ? `<div class="tot-row"><span>Tax</span><span>Rs ${data.tax.toLocaleString()}</span></div>` : ''}
    <div class="tot-row grand"><span>Grand Total</span><span>Rs ${grandTotal.toLocaleString()}</span></div>
  </div>
</div>
<div class="paid">
  <span>Paid: <strong>Rs ${paidAmount.toLocaleString()}</strong></span>
  <span>Balance: <strong style="color:${data.balance > 0 ? '#dc2626' : '#16a34a'}">Rs ${data.balance.toLocaleString()}</strong></span>
</div>
<div class="footer">${footer}</div>
</body></html>`;
  printHTML(html);
}

// RECEIPT
export function printReceipt(data: {
  receiptNo: string; date: string; paymentMethod: string;
  patientName?: string; patientMRN?: string; amount?: number; description?: string;
  hospitalName?: string; hospitalPhone?: string;
  shopName?: string; shopAddress?: string; shopPhone?: string; cashier?: string;
  items?: { name: string; qty: number; price: number; total: number }[];
  subtotal?: number; discount?: number; total?: number; paid?: number; change?: number;
}) {
  const receiptName = data.shopName || data.hospitalName || 'GMH SUITE';
  const receiptAddress = data.shopAddress || 'Dhandi Road Kot Sabzal';
  const receiptPhone = data.shopPhone || data.hospitalPhone || '0304-7459201';
  const amount = data.amount ?? data.total ?? 0;
  const itemRows = data.items?.map(item => `
<div class="item">
  <span>${item.name} x ${item.qty}</span>
  <span>Rs ${item.total.toLocaleString()}</span>
</div>`).join('') || '';
  const saleDetails = data.items?.length ? `
<div class="divider"></div>
${itemRows}
<div class="divider"></div>
<div class="row"><span>Subtotal</span><span>Rs ${(data.subtotal ?? amount).toLocaleString()}</span></div>
${data.discount ? `<div class="row"><span>Discount</span><span>- Rs ${data.discount.toLocaleString()}</span></div>` : ''}
<div class="row bold"><span>Total</span><span>Rs ${amount.toLocaleString()}</span></div>
${data.cashier ? `<div class="row"><span>Cashier</span><span>${data.cashier}</span></div>` : ''}` : `
<div class="row"><span>Patient</span><span class="bold">${data.patientName || ''}</span></div>
<div class="row"><span>MRN</span><span>${data.patientMRN || ''}</span></div>
<div class="divider"></div>
<div class="row"><span>For</span><span>${data.description || ''}</span></div>
<div class="amount">Rs ${amount.toLocaleString()}</div>`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Receipt</title>
<style>
@page{margin:10mm;size:80mm auto;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:Arial,sans-serif;font-size:11px;color:#111;width:72mm;}
.center{text-align:center;} .bold{font-weight:700;}
.clinic{font-size:16px;font-weight:900;color:#1a237e;letter-spacing:-0.5px;}
.divider{border-top:1px dashed #9ca3af;margin:8px 0;}
.row{display:flex;justify-content:space-between;padding:2px 0;}
.item{display:flex;justify-content:space-between;gap:8px;padding:3px 0;}
.item span:first-child{max-width:46mm;}
.amount{font-size:18px;font-weight:900;color:#1a237e;text-align:center;padding:8px 0;}
.footer{text-align:center;font-size:9px;color:#9ca3af;margin-top:8px;}
</style></head><body>
<div class="center">
  <div class="clinic">${receiptName}</div>
  <div style="font-size:9px;color:#555">${receiptAddress}</div>
  <div style="font-size:9px;color:#555">${receiptPhone}</div>
</div>
<div class="divider"></div>
<div class="center bold" style="font-size:13px;margin-bottom:6px">RECEIPT</div>
<div class="row"><span>Receipt #</span><span class="bold">${data.receiptNo}</span></div>
<div class="row"><span>Date</span><span>${data.date}</span></div>
<div class="row"><span>Method</span><span>${data.paymentMethod}</span></div>
${saleDetails}
<div class="divider"></div>
<div class="footer">Thank you &nbsp;|&nbsp; Not Valid For Court</div>
</body></html>`;
  printHTML(html);
}
