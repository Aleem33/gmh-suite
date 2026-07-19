import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  runTransaction,
  where,
} from '../../lib/firestoreCompat';
import { auth, db } from '../../firebase';

export interface PurchaseReturnInput {
  originalPurchaseId: string;
  boxesReturned: number;
  looseUnitsReturned: number;
  totalUnitsReturned: number;
  reason?: string;
}

export interface SaleReturnItemInput {
  cartItemId: string;
  returnQty: number;
}

export interface SaleReturnInput {
  originalSaleId: string;
  items: SaleReturnItemInput[];
  reason?: string;
}

interface ApprovalContext {
  requestId: string;
  reviewedBy?: string;
}

const nowISO = () => new Date().toISOString();
const numberValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function documentId(value: unknown, label: string) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.includes('/')) throw new Error(`${label} is missing or invalid.`);
  return id;
}

function normalizePurchaseReturnInput(input: PurchaseReturnInput): PurchaseReturnInput {
  const normalized = {
    originalPurchaseId: documentId(input.originalPurchaseId, 'Original purchase ID'),
    boxesReturned: numberValue(input.boxesReturned),
    looseUnitsReturned: numberValue(input.looseUnitsReturned),
    totalUnitsReturned: numberValue(input.totalUnitsReturned),
    reason: typeof input.reason === 'string' ? input.reason : '',
  };
  if (normalized.boxesReturned < 0 || normalized.looseUnitsReturned < 0 || normalized.totalUnitsReturned <= 0) {
    throw new Error('Return quantities are invalid. Enter at least one unit to return.');
  }
  return normalized;
}

function normalizeSaleReturnInput(input: SaleReturnInput): SaleReturnInput {
  const originalSaleId = documentId(input.originalSaleId, 'Original sale ID');
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('Select at least one sale item to return.');
  }

  const seen = new Set<string>();
  const items = input.items.map(item => {
    const cartItemId = documentId(item.cartItemId, 'Sale item ID');
    const returnQty = numberValue(item.returnQty);
    if (returnQty <= 0) throw new Error('Every selected sale item must have a return quantity greater than zero.');
    if (seen.has(cartItemId)) throw new Error('The same sale item appears more than once in this return request.');
    seen.add(cartItemId);
    return { cartItemId, returnQty };
  });

  return {
    originalSaleId,
    items,
    reason: typeof input.reason === 'string' ? input.reason : '',
  };
}

function purchaseRequestKey(input: PurchaseReturnInput) {
  return JSON.stringify([
    input.originalPurchaseId,
    input.boxesReturned,
    input.looseUnitsReturned,
    input.totalUnitsReturned,
    input.reason || '',
  ]);
}

function saleRequestKey(input: SaleReturnInput) {
  const items = [...input.items]
    .sort((a, b) => a.cartItemId.localeCompare(b.cartItemId))
    .map(item => [item.cartItemId, item.returnQty]);
  return JSON.stringify([input.originalSaleId, items, input.reason || '']);
}

function purchaseUnits(purchase: any) {
  const saved = numberValue(purchase.totalUnitsAdded || purchase.unitsAdded);
  if (saved > 0) return saved;
  const unitsPerBox = numberValue(purchase.unitsPerBox, 1) || 1;
  return numberValue(purchase.boxesPurchased ?? purchase.boxes) * unitsPerBox
    + numberValue(purchase.looseUnitsPurchased ?? purchase.looseUnits);
}

async function legacyPurchaseReturnedUnits(originalPurchaseId: string) {
  const snap = await getDocs(query(
    collection(db, 'purchaseReturns'),
    where('originalPurchaseId', '==', originalPurchaseId),
  ));
  return snap.docs.reduce((sum, row) => sum + numberValue(row.data().totalUnitsReturned), 0);
}

async function legacySaleReturnedQuantities(originalSaleId: string) {
  const snap = await getDocs(query(
    collection(db, 'saleReturns'),
    where('originalSaleId', '==', originalSaleId),
  ));
  const totals: Record<string, number> = {};
  snap.docs.forEach(row => {
    (row.data().items || []).forEach((item: any) => {
      if (!item.cartItemId) return;
      totals[item.cartItemId] = (totals[item.cartItemId] || 0) + numberValue(item.returnQty);
    });
  });
  return totals;
}

export async function processPurchaseReturn(input: PurchaseReturnInput, approval?: ApprovalContext) {
  const approvalRequestId = approval ? documentId(approval.requestId, 'Approval request ID') : null;
  const requestRef = approvalRequestId ? doc(db, 'approvalRequests', approvalRequestId) : null;
  let effectiveInput: PurchaseReturnInput;
  if (requestRef) {
    const requestSnap = await getDoc(requestRef);
    if (!requestSnap.exists() || requestSnap.data().status !== 'pending' || requestSnap.data().type !== 'purchaseReturn') {
      throw new Error('This purchase return request is no longer pending.');
    }
    const request = requestSnap.data();
    effectiveInput = normalizePurchaseReturnInput({
      originalPurchaseId: request.originalPurchaseId,
      boxesReturned: numberValue(request.boxesReturned),
      looseUnitsReturned: numberValue(request.looseUnitsReturned),
      totalUnitsReturned: numberValue(request.totalUnitsReturned),
      reason: request.reason || '',
    });
  } else {
    effectiveInput = normalizePurchaseReturnInput(input);
  }
  const initialRequestKey = purchaseRequestKey(effectiveInput);
  const legacyReturned = await legacyPurchaseReturnedUnits(effectiveInput.originalPurchaseId);
  const returnRef = approvalRequestId
    ? doc(db, 'purchaseReturns', `approval-${approvalRequestId}`)
    : doc(collection(db, 'purchaseReturns'));

  const savedReturn = await runTransaction(db, async tx => {
    if (requestRef) {
      const requestSnap = await tx.get(requestRef);
      if (!requestSnap.exists() || requestSnap.data().status !== 'pending' || requestSnap.data().type !== 'purchaseReturn') {
        throw new Error('This approval request is no longer pending.');
      }
      const request = requestSnap.data();
      const currentRequestInput = normalizePurchaseReturnInput({
        originalPurchaseId: request.originalPurchaseId,
        boxesReturned: numberValue(request.boxesReturned),
        looseUnitsReturned: numberValue(request.looseUnitsReturned),
        totalUnitsReturned: numberValue(request.totalUnitsReturned),
        reason: request.reason || '',
      });
      if (purchaseRequestKey(currentRequestInput) !== initialRequestKey) {
        throw new Error('This purchase return request changed while it was being reviewed. Refresh the page and review it again.');
      }
      effectiveInput = currentRequestInput;

      const existingReturnSnap = await tx.get(returnRef);
      if (existingReturnSnap.exists()) {
        throw new Error('A purchase return has already been created for this approval request. Refresh the approvals page.');
      }
    }

    const purchaseRef = doc(db, 'purchases', effectiveInput.originalPurchaseId);
    const purchaseSnap = await tx.get(purchaseRef);
    if (!purchaseSnap.exists()) throw new Error('The original purchase record was not found.');
    const purchase = purchaseSnap.data();
    const medicineId = documentId(purchase.medicineId, 'Purchase medicine ID');

    const medicineRef = doc(db, 'medicines', medicineId);
    const medicineSnap = await tx.get(medicineRef);
    if (!medicineSnap.exists()) throw new Error('The linked medicine was not found.');

    const totalPurchased = purchaseUnits(purchase);
    const aggregateReturned = Math.max(numberValue(purchase.returnedUnits), legacyReturned);
    const requestedUnits = numberValue(effectiveInput.totalUnitsReturned);
    const currentStock = numberValue(medicineSnap.data().stock);
    const unitsPerBox = numberValue(purchase.unitsPerBox, 1) || 1;
    if (requestedUnits <= 0) throw new Error('Return quantity must be greater than zero.');
    const componentUnits = numberValue(effectiveInput.boxesReturned) * unitsPerBox
      + numberValue(effectiveInput.looseUnitsReturned);
    if (Math.abs(componentUnits - requestedUnits) > 0.000001) {
      throw new Error('The purchase return quantity details are inconsistent. Reject this request and submit a new one.');
    }
    if (aggregateReturned + requestedUnits > totalPurchased) {
      throw new Error(`Only ${Math.max(0, totalPurchased - aggregateReturned)} purchased units remain returnable.`);
    }
    if (requestedUnits > currentStock) {
      throw new Error(`Only ${currentStock} units are currently in stock.`);
    }

    const costPrice = numberValue(purchase.costPrice ?? purchase.costPerBox);
    const costPricePerUnit = numberValue(purchase.costPricePerUnit)
      || (unitsPerBox > 0 ? costPrice / unitsPerBox : costPrice);
    const date = nowISO();
    const returnData = {
      originalPurchaseId: effectiveInput.originalPurchaseId,
      medicineId,
      medicineName: purchase.medicineName || medicineSnap.data().name || '',
      supplierId: purchase.supplierId || null,
      supplierName: purchase.supplierName || 'N/A',
      boxesReturned: numberValue(effectiveInput.boxesReturned),
      looseUnitsReturned: numberValue(effectiveInput.looseUnitsReturned),
      totalUnitsReturned: requestedUnits,
      costPrice,
      costPricePerUnit,
      refundAmount: requestedUnits * costPricePerUnit,
      reason: effectiveInput.reason || '',
      date,
      processedBy: approval?.reviewedBy || auth.currentUser?.uid || 'unknown',
      unitsPerBox,
      ...(approvalRequestId ? { approvalRequestId: approvalRequestId } : {}),
    };

    tx.set(returnRef, returnData);
    tx.update(medicineRef, {
      stock: increment(-requestedUnits),
      updatedAt: date,
    });
    tx.update(purchaseRef, {
      returnedUnits: aggregateReturned + requestedUnits,
      lastReturnedAt: date,
    });
    if (requestRef) {
      tx.update(requestRef, {
        status: 'approved',
        returnId: returnRef.id,
        approvedUnits: requestedUnits,
        approvedRefundAmount: returnData.refundAmount,
        reviewedBy: approval?.reviewedBy || auth.currentUser?.uid || 'admin',
        reviewedAt: date,
      });
    }
    return returnData;
  });

  return { ...savedReturn, id: returnRef.id };
}

export async function processSaleReturn(input: SaleReturnInput, approval?: ApprovalContext) {
  const approvalRequestId = approval ? documentId(approval.requestId, 'Approval request ID') : null;
  const requestRef = approvalRequestId ? doc(db, 'approvalRequests', approvalRequestId) : null;
  let effectiveInput: SaleReturnInput;
  if (requestRef) {
    const requestSnap = await getDoc(requestRef);
    if (!requestSnap.exists() || requestSnap.data().status !== 'pending' || requestSnap.data().type !== 'saleReturn') {
      throw new Error('This sale return request is no longer pending.');
    }
    const request = requestSnap.data();
    effectiveInput = normalizeSaleReturnInput({
      originalSaleId: request.originalSaleId,
      items: (request.items || []).map((item: any) => ({
        cartItemId: item.cartItemId,
        returnQty: numberValue(item.returnQty),
      })),
      reason: request.reason || '',
    });
  } else {
    effectiveInput = normalizeSaleReturnInput(input);
  }
  const initialRequestKey = saleRequestKey(effectiveInput);
  const legacyReturned = await legacySaleReturnedQuantities(effectiveInput.originalSaleId);
  const returnRef = approvalRequestId
    ? doc(db, 'saleReturns', `approval-${approvalRequestId}`)
    : doc(collection(db, 'saleReturns'));

  const savedReturn = await runTransaction(db, async tx => {
    if (requestRef) {
      const requestSnap = await tx.get(requestRef);
      if (!requestSnap.exists() || requestSnap.data().status !== 'pending' || requestSnap.data().type !== 'saleReturn') {
        throw new Error('This approval request is no longer pending.');
      }
      const request = requestSnap.data();
      const currentRequestInput = normalizeSaleReturnInput({
        originalSaleId: request.originalSaleId,
        items: (request.items || []).map((item: any) => ({
          cartItemId: item.cartItemId,
          returnQty: numberValue(item.returnQty),
        })),
        reason: request.reason || '',
      });
      if (saleRequestKey(currentRequestInput) !== initialRequestKey) {
        throw new Error('This sale return request changed while it was being reviewed. Refresh the page and review it again.');
      }
      effectiveInput = currentRequestInput;

      const existingReturnSnap = await tx.get(returnRef);
      if (existingReturnSnap.exists()) {
        throw new Error('A sale return has already been created for this approval request. Refresh the approvals page.');
      }
    }

    const saleRef = doc(db, 'sales', effectiveInput.originalSaleId);
    const saleSnap = await tx.get(saleRef);
    if (!saleSnap.exists()) throw new Error('The original sale record was not found.');
    const sale = saleSnap.data();
    if (!Array.isArray(sale.items)) throw new Error('The original sale does not contain a valid item snapshot.');
    const saleItems = sale.items;
    const persistedReturned = sale.returnedQuantities && typeof sale.returnedQuantities === 'object' && !Array.isArray(sale.returnedQuantities)
      ? sale.returnedQuantities
      : {};
    const returnedQuantities: Record<string, number> = { ...legacyReturned, ...persistedReturned };

    const requested = effectiveInput.items
      .map(request => ({ ...request, returnQty: numberValue(request.returnQty) }))
      .filter(request => request.returnQty > 0);
    if (!requested.length) throw new Error('Select at least one item to return.');

    const medicineRefs = new Map<string, ReturnType<typeof doc>>();
    requested.forEach(request => {
      const saleItem = saleItems.find((item: any) => item.cartItemId === request.cartItemId);
      if (!saleItem) throw new Error('A selected sale item no longer exists.');
      const medicineId = documentId(saleItem.medicineId, `Medicine ID for ${saleItem.name || 'sale item'}`);
      medicineRefs.set(medicineId, doc(db, 'medicines', medicineId));
    });
    const medicineSnapshots = new Map<string, any>();
    for (const [medicineId, medicineRef] of medicineRefs) {
      const medicineSnap = await tx.get(medicineRef);
      if (!medicineSnap.exists()) throw new Error('A linked medicine was not found.');
      medicineSnapshots.set(medicineId, medicineSnap);
    }

    const customerRef = sale.customerId
      ? doc(db, 'customers', documentId(sale.customerId, 'Sale customer ID'))
      : null;
    let customerBalance: number | null = null;
    if (customerRef) {
      const customerSnap = await tx.get(customerRef);
      if (customerSnap.exists()) customerBalance = numberValue(customerSnap.data().creditBalance);
    }

    const orderDiscountRatio = numberValue(sale.subtotal) > 0
      ? numberValue(sale.total) / numberValue(sale.subtotal)
      : 1;
    const stockDeltas = new Map<string, number>();
    const items = requested.map(request => {
      const saleItem = saleItems.find((item: any) => item.cartItemId === request.cartItemId);
      const alreadyReturned = Math.max(
        numberValue(returnedQuantities[request.cartItemId]),
        numberValue(legacyReturned[request.cartItemId]),
      );
      const soldQty = numberValue(saleItem.quantity);
      if (alreadyReturned + request.returnQty > soldQty) {
        throw new Error(`Only ${Math.max(0, soldQty - alreadyReturned)} of ${saleItem.name} remain returnable.`);
      }
      returnedQuantities[request.cartItemId] = alreadyReturned + request.returnQty;

      const effectiveUnitPrice = soldQty > 0
        ? (numberValue(saleItem.total) / soldQty) * orderDiscountRatio
        : 0;
      const unitsPerBox = numberValue(saleItem.unitsPerBox, 1) || 1;
      const restoredUnits = request.returnQty * (saleItem.sellType === 'box' ? unitsPerBox : 1);
      const medicineId = documentId(saleItem.medicineId, `Medicine ID for ${saleItem.name || 'sale item'}`);
      stockDeltas.set(medicineId, (stockDeltas.get(medicineId) || 0) + restoredUnits);
      return {
        cartItemId: saleItem.cartItemId,
        medicineId,
        name: saleItem.name || 'Unknown item',
        sellType: saleItem.sellType || 'unit',
        price: numberValue(saleItem.price),
        returnQty: request.returnQty,
        unitsPerBox,
        refundAmount: effectiveUnitPrice * request.returnQty,
      };
    });

    const totalRefund = items.reduce((sum, item) => sum + item.refundAmount, 0);
    const currentPending = numberValue(sale.pendingAmount);
    const currentPaid = sale.amountPaid == null
      ? Math.max(0, numberValue(sale.total) - currentPending)
      : numberValue(sale.amountPaid);
    const pendingReduction = Math.min(currentPending, totalRefund);
    const refundableAmount = Math.max(0, totalRefund - pendingReduction);
    const date = nowISO();
    const returnData = {
      originalSaleId: effectiveInput.originalSaleId,
      originalDate: sale.date || '',
      customerId: sale.customerId || '',
      customerName: sale.customerName || '',
      items,
      totalRefund,
      pendingReduction,
      refundableAmount,
      reason: effectiveInput.reason || '',
      date,
      processedBy: approval?.reviewedBy || auth.currentUser?.uid || 'unknown',
      ...(approvalRequestId ? { approvalRequestId: approvalRequestId } : {}),
    };

    tx.set(returnRef, returnData);
    stockDeltas.forEach((units, medicineId) => {
      const medicineRef = medicineRefs.get(medicineId)!;
      tx.update(medicineRef, { stock: increment(units), updatedAt: date });
    });
    tx.update(saleRef, {
      pendingAmount: Math.max(0, currentPending - pendingReduction),
      amountPaid: Math.max(0, currentPaid - refundableAmount),
      returnedAmount: increment(totalRefund),
      returnedQuantities,
      lastReturnedAt: date,
    });
    if (customerRef && customerBalance != null && pendingReduction > 0) {
      tx.update(customerRef, { creditBalance: Math.max(0, customerBalance - pendingReduction) });
    }
    if (requestRef) {
      tx.update(requestRef, {
        status: 'approved',
        returnId: returnRef.id,
        approvedRefundAmount: totalRefund,
        reviewedBy: approval?.reviewedBy || auth.currentUser?.uid || 'admin',
        reviewedAt: date,
      });
    }
    return returnData;
  });

  return { ...savedReturn, id: returnRef.id };
}
