import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, onSnapshot, updateDoc } from '../../lib/firestoreCompat';
import { Check, Edit2, FileText, Printer, Search, Trash2, X } from 'lucide-react';
import { format } from 'date-fns';
import { auth, db, getNextQuotationNo, handleFirestoreError, nowISO, OperationType } from '../../firebase';
import { hasPermission, isAdminProfile, type UserProfile } from '../../lib/permissions';
import { formatCurrency } from '../lib/utils';
import { printPharmacyDocument } from '../lib/pharmacyPrint';
import {
  EMPTY_HOSPITAL_PRINT_PROFILE,
  type HospitalPrintProfile,
} from '../lib/printTemplates';

interface Props {
  userProfile?: UserProfile | null;
}

type QuoteItem = {
  cartItemId: string;
  medicineId: string;
  name: string;
  category: string;
  sellType: 'unit' | 'box';
  price: number;
  originalPrice: number;
  quantity: number;
  unitsPerBox: number;
  total: number;
};

export function Quotations({ userProfile }: Props) {
  const [medicines, setMedicines] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [quotations, setQuotations] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [customerType, setCustomerType] = useState<'customer' | 'hospital'>('customer');
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [orderDiscount, setOrderDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [quoteDate, setQuoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [hospitalPrintProfile, setHospitalPrintProfile] = useState<HospitalPrintProfile>(EMPTY_HOSPITAL_PRINT_PROFILE);

  const isAdmin = isAdminProfile(userProfile);
  const isHaseeb = userProfile?.username === 'haseeb';
  const canWrite = isAdmin || isHaseeb || hasPermission(userProfile, 'pos.quotations.create');

  useEffect(() => {
    const unsubMeds = onSnapshot(collection(db, 'medicines'), snap => {
      setMedicines(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.GET, 'medicines'));
    const unsubCustomers = onSnapshot(collection(db, 'customers'), snap => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.GET, 'customers'));
    const unsubQuotes = onSnapshot(collection(db, 'quotations'), snap => {
      setQuotations(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => (b.createdAt || b.date || '') > (a.createdAt || a.date || '') ? 1 : -1));
    }, err => handleFirestoreError(err, OperationType.GET, 'quotations'));
    const unsubHospital = onSnapshot(doc(db, 'settings', 'hospital'), snap => {
      setHospitalPrintProfile(snap.exists()
        ? { ...EMPTY_HOSPITAL_PRINT_PROFILE, ...(snap.data() as HospitalPrintProfile) }
        : EMPTY_HOSPITAL_PRINT_PROFILE);
    }, err => handleFirestoreError(err, OperationType.GET, 'settings/hospital'));
    return () => { unsubMeds(); unsubCustomers(); unsubQuotes(); unsubHospital(); };
  }, []);

  const filteredMedicines = useMemo(() => {
    const term = search.trim().toLowerCase();
    return medicines
      .filter(m => !term || String(m.name || '').toLowerCase().includes(term) || String(m.batchNo || '').toLowerCase().includes(term))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [medicines, search]);

  const filteredCustomers = customers
    .filter(c => String(c.name || '').toLowerCase().includes(customerSearch.toLowerCase()) || String(c.phone || '').includes(customerSearch))
    .slice(0, 8);

  const grossSubtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const orderDiscountAmount = grossSubtotal * (Math.max(0, Math.min(100, orderDiscount)) / 100);
  const grandTotal = Math.max(0, grossSubtotal - orderDiscountAmount);

  const resetForm = () => {
    setCustomerType('customer');
    setCustomerSearch('');
    setSelectedCustomer(null);
    setItems([]);
    setOrderDiscount(0);
    setNotes('');
    setQuoteDate(new Date().toISOString().slice(0, 10));
    setEditing(null);
    setError('');
  };

  const addItem = (medicine: any, sellType: 'unit' | 'box') => {
    if (!canWrite) return;
    const unitsPerBox = Math.max(1, Number(medicine.unitsPerBox) || 1);
    const price = Number(sellType === 'box' ? (medicine.retailPrice || medicine.price) : (medicine.unitPrice || medicine.price)) || 0;
    const cartItemId = `${medicine.id}-${sellType}`;
    setItems(prev => {
      const existing = prev.find(item => item.cartItemId === cartItemId);
      if (existing) return prev.map(item => item.cartItemId === cartItemId ? { ...item, quantity: item.quantity + 1, total: (item.quantity + 1) * item.price } : item);
      return [...prev, {
        cartItemId,
        medicineId: medicine.id,
        name: medicine.name,
        category: medicine.category || medicine.form || 'Medicine',
        sellType,
        price,
        originalPrice: price,
        quantity: 1,
        unitsPerBox,
        total: price,
      }];
    });
  };

  const updateItem = (cartItemId: string, changes: Partial<QuoteItem>) => {
    setItems(prev => prev.map(item => {
      if (item.cartItemId !== cartItemId) return item;
      const next = { ...item, ...changes };
      next.quantity = Math.max(1, Math.floor(Number(next.quantity) || 1));
      next.price = Math.max(0, Number(next.price) || 0);
      next.total = next.quantity * next.price;
      return next;
    }));
  };

  const saveQuotation = async () => {
    if (!canWrite || saving) return;
    if (!items.length) { setError('Add at least one item.'); return; }
    setSaving(true);
    setError('');
    try {
      const quotationNo = editing?.quotationNo || await getNextQuotationNo();
      const savedAt = nowISO();
      const data: any = {
        quotationNo,
        items,
        grossSubtotal,
        totalItemDiscounts: 0,
        subtotal: grossSubtotal,
        orderDiscount: orderDiscountAmount,
        orderDiscountPercent: orderDiscount,
        discount: orderDiscountAmount,
        total: grandTotal,
        amountPaid: 0,
        pendingAmount: 0,
        customerType,
        customerName: selectedCustomer?.name || customerSearch.trim() || (customerType === 'hospital' ? 'Hospital' : ''),
        customerId: selectedCustomer?.id || '',
        customerPhone: selectedCustomer?.phone || '',
        notes: notes.trim(),
        date: new Date(`${quoteDate}T${new Date().toTimeString().slice(0, 8)}`).toISOString(),
        updatedAt: savedAt,
        updatedBy: auth.currentUser?.uid || '',
        status: 'open',
      };
      if (editing) {
        await updateDoc(doc(db, 'quotations', editing.id), data);
        const printable = { ...editing, ...data };
        await printPharmacyDocument({
          kind: 'quotation',
          record: printable,
          hospitalProfile: hospitalPrintProfile,
          title: 'Pharmacy Quotation',
          filename: `${quotationNo}.pdf`,
        });
      } else {
        const ref = await addDoc(collection(db, 'quotations'), {
          ...data,
          createdAt: savedAt,
          createdBy: auth.currentUser?.uid || '',
        });
        await printPharmacyDocument({
          kind: 'quotation',
          record: { ...data, id: ref.id },
          hospitalProfile: hospitalPrintProfile,
          title: 'Pharmacy Quotation',
          filename: `${quotationNo}.pdf`,
        });
      }
      resetForm();
    } catch (err: any) {
      setError(err?.message || handleFirestoreError(err, OperationType.CREATE, 'quotations'));
    } finally {
      setSaving(false);
    }
  };

  const editQuotation = (quote: any) => {
    setEditing(quote);
    setCustomerType(quote.customerType === 'hospital' ? 'hospital' : 'customer');
    setCustomerSearch(quote.customerName || '');
    setSelectedCustomer(quote.customerId ? customers.find(c => c.id === quote.customerId) || null : null);
    setItems(Array.isArray(quote.items) ? quote.items : []);
    setOrderDiscount(Number(quote.orderDiscountPercent || 0));
    setNotes(quote.notes || '');
    setQuoteDate(String(quote.date || new Date().toISOString()).slice(0, 10));
  };

  const printQuotation = (quote: any) => {
    void printPharmacyDocument({
      kind: 'quotation',
      record: quote,
      hospitalProfile: hospitalPrintProfile,
      title: 'Pharmacy Quotation',
      filename: `${quote.quotationNo || 'quotation'}.pdf`,
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pharmacy Quotations</h1>
          <p className="text-sm text-gray-500">Create estimates from inventory without changing stock.</p>
        </div>
        {editing && <button onClick={resetForm} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"><X className="w-4 h-4" /> Cancel Edit</button>}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search medicines by name or batch..." className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid max-h-[640px] grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredMedicines.map(med => (
              <div key={med.id} className="rounded-lg border border-gray-200 p-3">
                <div className="min-h-[72px]">
                  <h3 className="line-clamp-2 text-sm font-bold text-gray-900">{med.name}</h3>
                  <p className="mt-1 text-xs text-gray-400">{med.form || med.category || 'Medicine'} | Batch {med.batchNo || '-'}</p>
                  <p className={`mt-1 text-xs font-semibold ${Number(med.stock || 0) <= 0 ? 'text-red-600' : 'text-blue-700'}`}>
                    Stock {Number(med.stock || 0)}{Number(med.stock || 0) <= 0 ? ' | Out of stock' : ''}
                  </p>
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => addItem(med, 'unit')} disabled={!canWrite} className="flex-1 rounded-md border border-green-100 bg-green-50 px-2 py-2 text-xs font-bold text-green-700 disabled:opacity-50">Unit {formatCurrency(Number(med.unitPrice || med.price || 0))}</button>
                  <button onClick={() => addItem(med, 'box')} disabled={!canWrite || Number(med.unitsPerBox || 1) <= 1} className="flex-1 rounded-md border border-blue-100 bg-blue-50 px-2 py-2 text-xs font-bold text-blue-700 disabled:opacity-50">Box {formatCurrency(Number(med.retailPrice || med.price || 0))}</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 bg-gray-50 p-4">
            <h2 className="font-bold text-gray-900">{editing ? `Edit ${editing.quotationNo}` : 'New Quotation'}</h2>
          </div>
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setCustomerType('customer')} className={`rounded-lg px-3 py-2 text-sm font-semibold ${customerType === 'customer' ? 'bg-blue-100 text-blue-700' : 'bg-gray-50 text-gray-500'}`}>Customer</button>
              <button onClick={() => setCustomerType('hospital')} className={`rounded-lg px-3 py-2 text-sm font-semibold ${customerType === 'hospital' ? 'bg-blue-100 text-blue-700' : 'bg-gray-50 text-gray-500'}`}>Hospital</button>
            </div>
            <input type="date" value={quoteDate} onChange={e => setQuoteDate(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            <div>
              <input value={customerSearch} onChange={e => { setCustomerSearch(e.target.value); setSelectedCustomer(null); }} placeholder="Customer / hospital name" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              {customerSearch && !selectedCustomer && filteredCustomers.length > 0 && (
                <div className="mt-1 rounded-lg border border-gray-200 bg-white shadow-sm">
                  {filteredCustomers.map(customer => (
                    <button key={customer.id} onClick={() => { setSelectedCustomer(customer); setCustomerSearch(customer.name); }} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-blue-50">
                      <span>{customer.name}</span><span className="text-xs text-gray-400">{customer.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto">
              {items.length === 0 ? <p className="rounded-lg bg-gray-50 py-8 text-center text-sm text-gray-400">No items added</p> : items.map(item => (
                <div key={item.cartItemId} className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-2 flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{item.name}</p>
                      <p className="text-xs text-gray-400">{item.sellType} | original {formatCurrency(item.originalPrice)}</p>
                    </div>
                    <button onClick={() => setItems(prev => prev.filter(i => i.cartItemId !== item.cartItemId))} className="text-red-500"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input type="number" min="1" value={item.quantity} onChange={e => updateItem(item.cartItemId, { quantity: Number(e.target.value) })} className="rounded-md border border-gray-200 px-2 py-1.5 text-sm" />
                    <input type="number" min="0" value={item.price} onChange={e => updateItem(item.cartItemId, { price: Number(e.target.value) })} className="rounded-md border border-gray-200 px-2 py-1.5 text-sm" />
                    <div className="rounded-md bg-gray-50 px-2 py-1.5 text-right text-sm font-bold">{formatCurrency(item.total)}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2 border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-500">Order Discount %</span>
                <input type="number" min="0" max="100" value={orderDiscount} onChange={e => setOrderDiscount(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="w-24 rounded-md border border-gray-200 px-2 py-1.5 text-right text-sm" />
              </div>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes" rows={2} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(grossSubtotal)}</span></div>
                <div className="flex justify-between"><span>Discount</span><span>-{formatCurrency(orderDiscountAmount)}</span></div>
                <div className="flex justify-between border-t border-gray-200 pt-2 text-lg font-bold"><span>Total</span><span>{formatCurrency(grandTotal)}</span></div>
              </div>
              <button onClick={saveQuotation} disabled={!canWrite || saving || items.length === 0} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                <Check className="h-4 w-4" /> {saving ? 'Saving...' : 'Save & Print Quotation'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-4">
          <h2 className="font-bold text-gray-900">Saved Quotations</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="px-4 py-3">Quote</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Date</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {quotations.map(quote => (
                <tr key={quote.id}>
                  <td className="px-4 py-3 font-mono text-xs text-blue-700">{quote.quotationNo || quote.id.slice(0, 8)}</td>
                  <td className="px-4 py-3">{quote.customerName || quote.customerType || '-'}</td>
                  <td className="px-4 py-3 text-gray-500">{quote.date ? format(new Date(quote.date), 'dd/MM/yyyy') : '-'}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatCurrency(Number(quote.total || 0))}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => printQuotation(quote)} className="rounded-md p-2 text-gray-500 hover:bg-gray-100" title="Print"><Printer className="h-4 w-4" /></button>
                      {canWrite && <button onClick={() => editQuotation(quote)} className="rounded-md p-2 text-blue-600 hover:bg-blue-50" title="Edit"><Edit2 className="h-4 w-4" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {quotations.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400"><FileText className="mx-auto mb-2 h-8 w-8 opacity-30" />No quotations yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
