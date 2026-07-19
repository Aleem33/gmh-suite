import { useEffect, useRef, useState } from 'react';
import { collection, doc, increment, onSnapshot, runTransaction, updateDoc } from '../../lib/firestoreCompat';
import { CheckCircle, Clock, CreditCard, LoaderCircle, Receipt, RotateCcw, ShoppingCart, X } from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../../pos/lib/utils';
import { processPurchaseReturn, processSaleReturn } from '../../pos/lib/returnProcessing';

const nowISO = () => new Date().toISOString();

type ApprovalAction = 'approve' | 'reject';
type BusyAction = { targetId: string; action: ApprovalAction };
type ActionFeedback = { tone: 'success' | 'error'; text: string; targetId?: string };

function statusBadge(status: string = 'pending') {
  const map: Record<string, string> = {
    approved: 'bg-green-100 text-green-700',
    pending: 'bg-yellow-100 text-yellow-700',
    rejected: 'bg-red-100 text-red-700',
  };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${map[status] || map.pending}`}>{status}</span>;
}

function fmtDate(value?: string) {
  return value ? new Date(value).toLocaleString('en-PK') : 'N/A';
}

export function Approvals() {
  const [requests, setRequests] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const actionRunningRef = useRef(false);

  useEffect(() => {
    const unsubRequests = onSnapshot(collection(db, 'approvalRequests'), snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      list.sort((a, b) => new Date(b.createdAt || b.reviewedAt || 0).getTime() - new Date(a.createdAt || a.reviewedAt || 0).getTime());
      setRequests(list);
    }, err => setFeedback({ tone: 'error', text: handleFirestoreError(err, OperationType.GET, 'approvalRequests') }));

    const unsubExpenses = onSnapshot(collection(db, 'expenses'), snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      list.sort((a, b) => new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime());
      setExpenses(list);
    }, err => setFeedback({ tone: 'error', text: handleFirestoreError(err, OperationType.GET, 'expenses') }));

    return () => { unsubRequests(); unsubExpenses(); };
  }, []);

  const customerPaymentRequests = requests.filter(r => r.type === 'customerPayment');
  const purchaseReturnRequests = requests.filter(r => r.type === 'purchaseReturn');
  const saleReturnRequests = requests.filter(r => r.type === 'saleReturn');
  const otherRequests = requests.filter(r => !['customerPayment', 'purchaseReturn', 'saleReturn'].includes(r.type));
  const pendingExpenses = expenses.filter(e => (e.status || 'approved') === 'pending');
  const pendingCustomerPayments = customerPaymentRequests.filter(r => r.status === 'pending');
  const pendingPurchaseReturns = purchaseReturnRequests.filter(r => r.status === 'pending');
  const pendingSaleReturns = saleReturnRequests.filter(r => r.status === 'pending');
  const pendingOther = otherRequests.filter(r => r.status === 'pending');

  const runApprovalAction = async (
    targetId: string,
    action: ApprovalAction,
    successText: string,
    task: () => Promise<unknown>,
    context = `approvalRequests/${targetId}`,
  ) => {
    if (actionRunningRef.current) return false;
    actionRunningRef.current = true;
    setBusyAction({ targetId, action });
    setFeedback(null);
    try {
      await task();
      setFeedback({ tone: 'success', text: successText, targetId });
      return true;
    } catch (error) {
      console.error(`[Approvals] ${action} failed for ${context}:`, error);
      setFeedback({
        tone: 'error',
        text: handleFirestoreError(error, OperationType.UPDATE, context),
        targetId,
      });
      return false;
    } finally {
      actionRunningRef.current = false;
      setBusyAction(null);
    }
  };

  const approveCustomerPayment = async (req: any) => {
    if (req.status !== 'pending') return;
    await runApprovalAction(req.id, 'approve', `Customer payment approved for ${req.customerName}.`, async () => {
      await runTransaction(db, async tx => {
        const requestRef = doc(db, 'approvalRequests', req.id);
        const paymentRef = doc(collection(db, 'customerPayments'));
        const requestSnap = await tx.get(requestRef);
        if (!requestSnap.exists() || requestSnap.data().status !== 'pending') {
          throw new Error('This customer payment request is no longer pending.');
        }

        const request = requestSnap.data();
        if (!request.saleId || !request.customerId) throw new Error('This payment request is missing its sale or customer link.');
        const saleRef = doc(db, 'sales', request.saleId);
        const customerRef = doc(db, 'customers', request.customerId);
        const saleSnap = await tx.get(saleRef);
        const customerSnap = await tx.get(customerRef);
        if (!saleSnap.exists()) throw new Error('The linked sale record was not found.');
        if (!customerSnap.exists()) throw new Error('The linked customer record was not found.');

        const sale = saleSnap.data();
        const currentPending = Number(sale.pendingAmount || 0);
        const amount = Math.min(Number(request.amount || 0), currentPending);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error('This receipt no longer has a payable pending amount.');
        }

        const reviewedAt = nowISO();
        tx.set(paymentRef, {
          customerId: request.customerId,
          customerName: request.customerName || customerSnap.data().name || '',
          saleId: request.saleId,
          amount,
          note: request.note || '',
          date: reviewedAt,
          approvalRequestId: req.id,
          approvedBy: auth.currentUser?.uid || 'admin',
        });
        tx.update(saleRef, {
          pendingAmount: Math.max(0, currentPending - amount),
          amountPaid: Math.min(Number(sale.total || 0), Number(sale.amountPaid || 0) + amount),
        });
        tx.update(customerRef, { creditBalance: increment(-amount) });
        tx.update(requestRef, {
          status: 'approved',
          approvedAmount: amount,
          reviewedBy: auth.currentUser?.uid || 'admin',
          reviewedAt,
        });
      });
    });
  };

  const rejectRequest = async (req: any) => {
    if (req.status !== 'pending') return;
    await runApprovalAction(req.id, 'reject', 'Request rejected.', async () => {
      await runTransaction(db, async tx => {
        const requestRef = doc(db, 'approvalRequests', req.id);
        const requestSnap = await tx.get(requestRef);
        if (!requestSnap.exists() || requestSnap.data().status !== 'pending') {
          throw new Error('This request is no longer pending.');
        }
        tx.update(requestRef, {
          status: 'rejected',
          reviewedBy: auth.currentUser?.uid || 'admin',
          reviewedAt: nowISO(),
        });
      });
    });
  };

  const approvePurchaseReturn = async (req: any) => {
    if (req.status !== 'pending') return;
    await runApprovalAction(req.id, 'approve', `Purchase return approved for ${req.medicineName || 'medicine'}.`, () => (
      processPurchaseReturn({
        originalPurchaseId: req.originalPurchaseId,
        boxesReturned: Number(req.boxesReturned || 0),
        looseUnitsReturned: Number(req.looseUnitsReturned || 0),
        totalUnitsReturned: Number(req.totalUnitsReturned || 0),
        reason: req.reason || '',
      }, { requestId: req.id, reviewedBy: auth.currentUser?.uid || 'admin' })
    ));
  };

  const approveSaleReturn = async (req: any) => {
    if (req.status !== 'pending') return;
    await runApprovalAction(req.id, 'approve', `Sale return approved${req.customerName ? ` for ${req.customerName}` : ''}.`, () => (
      processSaleReturn({
        originalSaleId: req.originalSaleId,
        items: (req.items || []).map((item: any) => ({ cartItemId: item.cartItemId, returnQty: Number(item.returnQty || 0) })),
        reason: req.reason || '',
      }, { requestId: req.id, reviewedBy: auth.currentUser?.uid || 'admin' })
    ));
  };

  const updateExpenseStatus = async (expense: any, status: 'approved' | 'rejected') => {
    if ((expense.status || 'approved') !== 'pending') return;
    const targetId = `expense-${expense.id}`;
    await runApprovalAction(targetId, status === 'approved' ? 'approve' : 'reject', `Expense ${status}.`, () => (
      updateDoc(doc(db, 'expenses', expense.id), {
        status,
        reviewedBy: auth.currentUser?.uid || 'admin',
        reviewedAt: nowISO(),
      })
    ), `expenses/${expense.id}`);
  };

  const approveOtherRequest = async (req: any) => {
    if (req.status !== 'pending') return;
    await runApprovalAction(req.id, 'approve', 'Request approved.', async () => {
      await runTransaction(db, async tx => {
        const requestRef = doc(db, 'approvalRequests', req.id);
        const requestSnap = await tx.get(requestRef);
        if (!requestSnap.exists() || requestSnap.data().status !== 'pending') {
          throw new Error('This request is no longer pending.');
        }
        tx.update(requestRef, {
          status: 'approved',
          reviewedBy: auth.currentUser?.uid || 'admin',
          reviewedAt: nowISO(),
        });
      });
    });
  };

  const RequestActions = ({ request, onApprove }: { request: any; onApprove: () => Promise<unknown> }) => {
    const isApproving = busyAction?.targetId === request.id && busyAction.action === 'approve';
    const isRejecting = busyAction?.targetId === request.id && busyAction.action === 'reject';
    const disabled = Boolean(busyAction) || request.status !== 'pending';
    return (
      <div className="shrink-0">
        <div className="flex gap-2">
          <button
            onClick={() => void onApprove()}
            disabled={disabled}
            className="inline-flex min-w-[92px] items-center justify-center gap-1.5 rounded-md bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {isApproving ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
            {isApproving ? 'Approving...' : 'Approve'}
          </button>
          <button
            onClick={() => void rejectRequest(request)}
            disabled={disabled}
            className="inline-flex min-w-[82px] items-center justify-center gap-1.5 rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isRejecting ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
            {isRejecting ? 'Rejecting...' : 'Reject'}
          </button>
        </div>
        {feedback?.tone === 'error' && feedback.targetId === request.id && (
          <p className="mt-2 max-w-sm text-xs font-medium text-red-600">{feedback.text}</p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {feedback && (
        <div className={`fixed top-4 right-4 z-50 flex max-w-md items-start gap-3 rounded-lg px-5 py-3 text-white shadow-lg ${feedback.tone === 'error' ? 'bg-red-600' : 'bg-green-600'}`}>
          <p className="text-sm font-medium">{feedback.text}</p>
          <button onClick={() => setFeedback(null)} className="mt-0.5 shrink-0 text-white/80 hover:text-white" aria-label="Dismiss message">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Approvals</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Pending: {pendingCustomerPayments.length} customer payment(s), {pendingPurchaseReturns.length} purchase return(s), {pendingSaleReturns.length} sale return(s), {pendingExpenses.length} expense(s), {pendingOther.length} other request(s)
        </p>
      </div>

      <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2"><CreditCard className="w-4 h-4 text-blue-600" /> Customer Payment Requests</h2>
          {statusBadge(`${pendingCustomerPayments.length} pending`)}
        </div>
        <div className="divide-y divide-gray-100">
          {customerPaymentRequests.map(req => (
            <div key={req.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900">{req.customerName}</p>
                  {statusBadge(req.status)}
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  {formatCurrency(Number(req.amount || 0))} requested by {req.requestedByName || 'Employee'}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Receipt {req.saleId?.slice(0, 10)}... · pending before request {formatCurrency(Number(req.previousPendingAmount || 0))} · {fmtDate(req.createdAt)}
                </p>
                {req.note && <p className="text-xs text-gray-500 italic mt-1">{req.note}</p>}
              </div>
              {req.status === 'pending' ? <RequestActions request={req} onApprove={() => approveCustomerPayment(req)} /> : (
                <p className="text-xs text-gray-400 shrink-0">Reviewed {fmtDate(req.reviewedAt)}</p>
              )}
            </div>
          ))}
          {customerPaymentRequests.length === 0 && <div className="p-8 text-center text-gray-500">No customer payment requests.</div>}
        </div>
      </section>

      <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-purple-600" /> Purchase Return Requests</h2>
          {statusBadge(`${pendingPurchaseReturns.length} pending`)}
        </div>
        <div className="divide-y divide-gray-100">
          {purchaseReturnRequests.map(req => (
            <div key={req.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900">{req.medicineName || 'Unknown medicine'}</p>
                  {statusBadge(req.status)}
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  {Number(req.totalUnitsReturned || 0)} unit(s) to {req.supplierName || 'Unknown supplier'} · estimated refund {formatCurrency(Number(req.estimatedRefundAmount || 0))}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Requested by {req.requestedByName || req.requestedBy || 'Employee'} · {fmtDate(req.createdAt)}
                </p>
                {req.reason && <p className="text-xs text-gray-500 italic mt-1">Reason: {req.reason}</p>}
              </div>
              {req.status === 'pending' ? <RequestActions request={req} onApprove={() => approvePurchaseReturn(req)} /> : (
                <p className="text-xs text-gray-400 shrink-0">Reviewed {fmtDate(req.reviewedAt)}</p>
              )}
            </div>
          ))}
          {purchaseReturnRequests.length === 0 && <div className="p-8 text-center text-gray-500">No purchase return requests.</div>}
        </div>
      </section>

      <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2"><RotateCcw className="w-4 h-4 text-rose-600" /> Sale Return Requests</h2>
          {statusBadge(`${pendingSaleReturns.length} pending`)}
        </div>
        <div className="divide-y divide-gray-100">
          {saleReturnRequests.map(req => (
            <div key={req.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900">{req.customerName || `Sale ${req.originalSaleId?.slice(0, 10) || ''}`}</p>
                  {statusBadge(req.status)}
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  {(req.items || []).map((item: any) => `${item.name}: ${Number(item.returnQty || 0)}`).join(', ') || 'No items'}
                </p>
                <p className="text-sm text-gray-600 mt-1">Estimated refund {formatCurrency(Number(req.estimatedRefundAmount || 0))}</p>
                <p className="text-xs text-gray-400 mt-1">
                  Requested by {req.requestedByName || req.requestedBy || 'Employee'} · {fmtDate(req.createdAt)}
                </p>
                {req.reason && <p className="text-xs text-gray-500 italic mt-1">Reason: {req.reason}</p>}
              </div>
              {req.status === 'pending' ? <RequestActions request={req} onApprove={() => approveSaleReturn(req)} /> : (
                <p className="text-xs text-gray-400 shrink-0">Reviewed {fmtDate(req.reviewedAt)}</p>
              )}
            </div>
          ))}
          {saleReturnRequests.length === 0 && <div className="p-8 text-center text-gray-500">No sale return requests.</div>}
        </div>
      </section>

      <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2"><Receipt className="w-4 h-4 text-orange-600" /> Expense Requests</h2>
          {statusBadge(`${pendingExpenses.length} pending`)}
        </div>
        <div className="divide-y divide-gray-100">
          {expenses.map(exp => (
            <div key={exp.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900">{exp.description}</p>
                  {statusBadge(exp.status || 'approved')}
                </div>
                <p className="text-sm text-gray-600 mt-1">{formatCurrency(Number(exp.amount || 0))} · {exp.category || 'Expense'}</p>
                <p className="text-xs text-gray-400 mt-1"><Clock className="w-3 h-3 inline mr-1" />{exp.date || fmtDate(exp.createdAt)}</p>
              </div>
              {(exp.status || 'approved') === 'pending' ? (
                <div className="flex gap-2">
                  <button onClick={() => void updateExpenseStatus(exp, 'approved')} disabled={Boolean(busyAction)} className="inline-flex min-w-[92px] items-center justify-center gap-1.5 rounded-md bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                    {busyAction?.targetId === `expense-${exp.id}` && busyAction.action === 'approve' ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                    {busyAction?.targetId === `expense-${exp.id}` && busyAction.action === 'approve' ? 'Approving...' : 'Approve'}
                  </button>
                  <button onClick={() => void updateExpenseStatus(exp, 'rejected')} disabled={Boolean(busyAction)} className="inline-flex min-w-[82px] items-center justify-center gap-1.5 rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                    {busyAction?.targetId === `expense-${exp.id}` && busyAction.action === 'reject' ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                    {busyAction?.targetId === `expense-${exp.id}` && busyAction.action === 'reject' ? 'Rejecting...' : 'Reject'}
                  </button>
                </div>
              ) : <p className="text-xs text-gray-400 shrink-0">Reviewed {fmtDate(exp.reviewedAt)}</p>}
            </div>
          ))}
          {expenses.length === 0 && <div className="p-8 text-center text-gray-500">No expense requests.</div>}
        </div>
      </section>

      <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Other Approval Requests</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {otherRequests.map(req => (
            <div key={req.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900">{req.title || req.type || 'Approval Request'}</p>
                  {statusBadge(req.status)}
                </div>
                <p className="text-xs text-gray-400 mt-1">Requested by {req.requestedByName || req.requestedBy || 'Employee'} · {fmtDate(req.createdAt)}</p>
              </div>
              {req.status === 'pending' ? (
                <RequestActions request={req} onApprove={() => approveOtherRequest(req)} />
              ) : <p className="text-xs text-gray-400 shrink-0">Reviewed {fmtDate(req.reviewedAt)}</p>}
            </div>
          ))}
          {otherRequests.length === 0 && <div className="p-8 text-center text-gray-500">No other approval requests.</div>}
        </div>
      </section>
    </div>
  );
}
