import { useEffect, useState } from 'react';
import { collection, doc, increment, onSnapshot, runTransaction, updateDoc } from 'firebase/firestore';
import { CheckCircle, Clock, CreditCard, Receipt, X } from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../../pos/lib/utils';

const nowISO = () => new Date().toISOString();

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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const unsubRequests = onSnapshot(collection(db, 'approvalRequests'), snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      list.sort((a, b) => new Date(b.createdAt || b.reviewedAt || 0).getTime() - new Date(a.createdAt || a.reviewedAt || 0).getTime());
      setRequests(list);
    }, err => handleFirestoreError(err, OperationType.GET, 'approvalRequests'));

    const unsubExpenses = onSnapshot(collection(db, 'expenses'), snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      list.sort((a, b) => new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime());
      setExpenses(list);
    }, err => handleFirestoreError(err, OperationType.GET, 'expenses'));

    return () => { unsubRequests(); unsubExpenses(); };
  }, []);

  const customerPaymentRequests = requests.filter(r => r.type === 'customerPayment');
  const otherRequests = requests.filter(r => r.type !== 'customerPayment');
  const pendingExpenses = expenses.filter(e => (e.status || 'approved') === 'pending');
  const pendingCustomerPayments = customerPaymentRequests.filter(r => r.status === 'pending');
  const pendingOther = otherRequests.filter(r => r.status === 'pending');

  const approveCustomerPayment = async (req: any) => {
    if (req.status !== 'pending') return;
    setBusyId(req.id);
    try {
      await runTransaction(db, async tx => {
        const requestRef = doc(db, 'approvalRequests', req.id);
        const saleRef = doc(db, 'sales', req.saleId);
        const customerRef = doc(db, 'customers', req.customerId);
        const paymentRef = doc(collection(db, 'customerPayments'));

        const requestSnap = await tx.get(requestRef);
        const saleSnap = await tx.get(saleRef);
        if (!requestSnap.exists() || requestSnap.data().status !== 'pending') throw new Error('This request is no longer pending.');
        if (!saleSnap.exists()) throw new Error('Sale record was not found.');

        const sale = saleSnap.data();
        const currentPending = Number(sale.pendingAmount || 0);
        const amount = Math.min(Number(req.amount || 0), currentPending);
        if (amount <= 0) throw new Error('This receipt no longer has a payable pending amount.');

        tx.set(paymentRef, {
          customerId: req.customerId,
          customerName: req.customerName,
          saleId: req.saleId,
          amount,
          note: req.note || '',
          date: nowISO(),
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
          reviewedAt: nowISO(),
        });
      });
      setMessage(`Customer payment approved for ${req.customerName}.`);
      setTimeout(() => setMessage(''), 4000);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `approvalRequests/${req.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const rejectRequest = async (req: any) => {
    if (req.status !== 'pending') return;
    setBusyId(req.id);
    try {
      await updateDoc(doc(db, 'approvalRequests', req.id), {
        status: 'rejected',
        reviewedBy: auth.currentUser?.uid || 'admin',
        reviewedAt: nowISO(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `approvalRequests/${req.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const updateExpenseStatus = async (expense: any, status: 'approved' | 'rejected') => {
    if ((expense.status || 'approved') !== 'pending') return;
    setBusyId(`expense-${expense.id}`);
    try {
      await updateDoc(doc(db, 'expenses', expense.id), {
        status,
        reviewedBy: auth.currentUser?.uid || 'admin',
        reviewedAt: nowISO(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `expenses/${expense.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const RequestActions = ({ request, onApprove }: { request: any; onApprove: () => void }) => (
    <div className="flex gap-2">
      <button
        onClick={onApprove}
        disabled={busyId === request.id || request.status !== 'pending'}
        className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
      >
        <CheckCircle className="w-3.5 h-3.5" /> Approve
      </button>
      <button
        onClick={() => rejectRequest(request)}
        disabled={busyId === request.id || request.status !== 'pending'}
        className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
      >
        <X className="w-3.5 h-3.5" /> Reject
      </button>
    </div>
  );

  return (
    <div className="space-y-4 md:space-y-6">
      {message && (
        <div className="fixed top-4 right-4 z-50 rounded-lg bg-green-600 px-5 py-3 text-white shadow-lg">
          {message}
        </div>
      )}

      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Approvals</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Pending: {pendingCustomerPayments.length} customer payment(s), {pendingExpenses.length} expense(s), {pendingOther.length} other request(s)
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
                  <button onClick={() => updateExpenseStatus(exp, 'approved')} disabled={busyId === `expense-${exp.id}`} className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                    <CheckCircle className="w-3.5 h-3.5" /> Approve
                  </button>
                  <button onClick={() => updateExpenseStatus(exp, 'rejected')} disabled={busyId === `expense-${exp.id}`} className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                    <X className="w-3.5 h-3.5" /> Reject
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
                <RequestActions request={req} onApprove={() => updateDoc(doc(db, 'approvalRequests', req.id), {
                  status: 'approved',
                  reviewedBy: auth.currentUser?.uid || 'admin',
                  reviewedAt: nowISO(),
                })} />
              ) : <p className="text-xs text-gray-400 shrink-0">Reviewed {fmtDate(req.reviewedAt)}</p>}
            </div>
          ))}
          {otherRequests.length === 0 && <div className="p-8 text-center text-gray-500">No other approval requests.</div>}
        </div>
      </section>
    </div>
  );
}
