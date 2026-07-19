import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from '../../lib/firestoreCompat';
import { format } from 'date-fns';
import {
  Boxes,
  PackagePlus,
  Pill,
  RotateCcw,
  Search,
  ShoppingCart,
  TrendingDown,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';

type AuditTab = 'sales' | 'purchases' | 'saleReturns' | 'purchaseReturns';

function formatDate(value: string | undefined) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return format(date, 'MMM dd, yyyy HH:mm');
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getPurchaseCost(purchase: any) {
  const savedTotal = asNumber(purchase.totalCost);
  if (savedTotal > 0) return savedTotal;
  const unitsPerBox = asNumber(purchase.unitsPerBox, 1) || 1;
  const boxes = asNumber(purchase.boxesPurchased ?? purchase.boxes);
  const loose = asNumber(purchase.looseUnitsPurchased ?? purchase.looseUnits);
  const costPerBox = asNumber(purchase.costPrice ?? purchase.costPerBox);
  const costPerUnit = asNumber(purchase.costPricePerUnit) || (unitsPerBox > 0 ? costPerBox / unitsPerBox : costPerBox);
  return (boxes * costPerBox) + (loose * costPerUnit);
}

function getPurchaseUnits(purchase: any) {
  const savedUnits = asNumber(purchase.totalUnitsAdded);
  if (savedUnits > 0) return savedUnits;
  const unitsPerBox = asNumber(purchase.unitsPerBox, 1) || 1;
  const boxes = asNumber(purchase.boxesPurchased ?? purchase.boxes);
  const loose = asNumber(purchase.looseUnitsPurchased ?? purchase.looseUnits);
  return (boxes * unitsPerBox) + loose;
}

function getSaleItemUnits(item: any) {
  const quantity = asNumber(item.quantity);
  const unitsPerBox = asNumber(item.unitsPerBox, 1) || 1;
  return quantity * (item.sellType === 'box' ? unitsPerBox : 1);
}

function getReturnItemUnits(item: any) {
  const quantity = asNumber(item.returnQty);
  const unitsPerBox = asNumber(item.unitsPerBox, 1) || 1;
  return quantity * (item.sellType === 'box' ? unitsPerBox : 1);
}

function getSaleLineTotal(item: any) {
  const savedTotal = asNumber(item.total);
  if (savedTotal > 0) return savedTotal;
  return asNumber(item.quantity) * asNumber(item.price);
}

function formatUnits(units: number, unitsPerBox?: number) {
  const upb = unitsPerBox || 1;
  if (upb <= 1) return `${units} units`;
  const boxes = Math.floor(units / upb);
  const loose = units % upb;
  if (boxes > 0 && loose > 0) return `${boxes} box, ${loose} loose`;
  if (boxes > 0) return `${boxes} box`;
  return `${loose} loose`;
}

export function Audit() {
  const [medicines, setMedicines] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [saleReturns, setSaleReturns] = useState<any[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<any[]>([]);
  const [medicineSearch, setMedicineSearch] = useState('');
  const [selectedMedicineId, setSelectedMedicineId] = useState('');
  const [activeTab, setActiveTab] = useState<AuditTab>('sales');

  useEffect(() => {
    const unsubMedicines = onSnapshot(
      collection(db, 'medicines'),
      snap => setMedicines(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => handleFirestoreError(err, OperationType.GET, 'medicines')
    );
    const unsubSales = onSnapshot(
      collection(db, 'sales'),
      snap => setSales(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => handleFirestoreError(err, OperationType.GET, 'sales')
    );
    const unsubPurchases = onSnapshot(
      collection(db, 'purchases'),
      snap => setPurchases(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => handleFirestoreError(err, OperationType.GET, 'purchases')
    );
    const unsubSaleReturns = onSnapshot(
      collection(db, 'saleReturns'),
      snap => setSaleReturns(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => handleFirestoreError(err, OperationType.GET, 'saleReturns')
    );
    const unsubPurchaseReturns = onSnapshot(
      collection(db, 'purchaseReturns'),
      snap => setPurchaseReturns(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => handleFirestoreError(err, OperationType.GET, 'purchaseReturns')
    );

    return () => {
      unsubMedicines();
      unsubSales();
      unsubPurchases();
      unsubSaleReturns();
      unsubPurchaseReturns();
    };
  }, []);

  const selectedMedicine = useMemo(
    () => medicines.find(med => med.id === selectedMedicineId) || null,
    [medicines, selectedMedicineId]
  );

  const alphabeticalMedicines = useMemo(
    () => [...medicines].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [medicines]
  );

  const filteredMedicines = useMemo(() => {
    const q = medicineSearch.trim().toLowerCase();
    return alphabeticalMedicines
      .filter(med =>
        !q ||
        med.name?.toLowerCase().includes(q) ||
        med.batchNo?.toLowerCase().includes(q) ||
        med.form?.toLowerCase().includes(q) ||
        med.category?.toLowerCase().includes(q)
      );
  }, [alphabeticalMedicines, medicineSearch]);

  useEffect(() => {
    if (selectedMedicineId && medicines.some(med => med.id === selectedMedicineId)) return;
    if (alphabeticalMedicines.length > 0) {
      setSelectedMedicineId(alphabeticalMedicines[0].id);
    }
  }, [alphabeticalMedicines, medicines, selectedMedicineId]);

  const auditData = useMemo(() => {
    if (!selectedMedicine) {
      return {
        saleRows: [],
        purchaseRows: [],
        saleReturnRows: [],
        purchaseReturnRows: [],
        totals: {
          soldUnits: 0,
          soldValue: 0,
          purchasedUnits: 0,
          purchaseCost: 0,
          saleReturnUnits: 0,
          saleReturnValue: 0,
          purchaseReturnUnits: 0,
          purchaseReturnValue: 0,
          initialStock: 0,
          netMovement: 0,
        },
      };
    }

    const medicineId = selectedMedicine.id;
    const saleRows = sales.flatMap((sale) =>
      (sale.items || [])
        .filter((item: any) => item.medicineId === medicineId)
        .map((item: any) => ({
          id: `${sale.id}-${item.cartItemId || item.name}`,
          sale,
          item,
          date: sale.date,
          units: getSaleItemUnits(item),
          lineTotal: getSaleLineTotal(item),
        }))
    ).sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

    const purchaseRows = purchases
      .filter(purchase => purchase.medicineId === medicineId)
      .map(purchase => ({
        ...purchase,
        units: getPurchaseUnits(purchase),
        totalCostValue: getPurchaseCost(purchase),
      }))
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

    const saleReturnRows = saleReturns.flatMap((saleReturn) =>
      (saleReturn.items || [])
        .filter((item: any) => item.medicineId === medicineId)
        .map((item: any) => ({
          id: `${saleReturn.id}-${item.cartItemId || item.name}`,
          saleReturn,
          item,
          date: saleReturn.date,
          units: getReturnItemUnits(item),
          refundAmount: asNumber(item.refundAmount),
        }))
    ).sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

    const purchaseReturnRows = purchaseReturns
      .filter(purchaseReturn => purchaseReturn.medicineId === medicineId)
      .map(purchaseReturn => ({
        ...purchaseReturn,
        units: asNumber(purchaseReturn.totalUnitsReturned),
        refundAmountValue: asNumber(purchaseReturn.refundAmount),
      }))
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

    const soldUnits = saleRows.reduce((sum, row) => sum + row.units, 0);
    const soldValue = saleRows.reduce((sum, row) => sum + row.lineTotal, 0);
    const purchasedUnits = purchaseRows.reduce((sum, row) => sum + row.units, 0);
    const purchaseCost = purchaseRows.reduce((sum, row) => sum + row.totalCostValue, 0);
    const saleReturnUnits = saleReturnRows.reduce((sum, row) => sum + row.units, 0);
    const saleReturnValue = saleReturnRows.reduce((sum, row) => sum + row.refundAmount, 0);
    const purchaseReturnUnits = purchaseReturnRows.reduce((sum, row) => sum + row.units, 0);
    const purchaseReturnValue = purchaseReturnRows.reduce((sum, row) => sum + row.refundAmountValue, 0);
    const netMovement = purchasedUnits - soldUnits + saleReturnUnits - purchaseReturnUnits;
    const initialStock = asNumber(selectedMedicine.stock) - netMovement;

    return {
      saleRows,
      purchaseRows,
      saleReturnRows,
      purchaseReturnRows,
      totals: {
        soldUnits,
        soldValue,
        purchasedUnits,
        purchaseCost,
        saleReturnUnits,
        saleReturnValue,
        purchaseReturnUnits,
        purchaseReturnValue,
        initialStock,
        netMovement,
      },
    };
  }, [selectedMedicine, sales, purchases, saleReturns, purchaseReturns]);

  const tabs = [
    { id: 'sales' as const, label: 'Sales', count: auditData.saleRows.length, icon: ShoppingCart },
    { id: 'purchases' as const, label: 'Purchases', count: auditData.purchaseRows.length, icon: PackagePlus },
    { id: 'saleReturns' as const, label: 'Sale Returns', count: auditData.saleReturnRows.length, icon: RotateCcw },
    { id: 'purchaseReturns' as const, label: 'Purchase Returns', count: auditData.purchaseReturnRows.length, icon: RotateCcw },
  ];

  const selectMedicine = (medicine: any) => {
    setSelectedMedicineId(medicine.id);
    setActiveTab('sales');
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Audit</h1>
        <p className="text-sm text-gray-500">Select any medicine from the alphabetical list to review sales, purchases, and returns.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-4 md:gap-6 items-start">
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-gray-900">Medicines</h2>
                <p className="text-xs text-gray-500">{filteredMedicines.length} of {medicines.length} shown</p>
              </div>
              <Pill className="w-5 h-5 text-blue-600" />
            </div>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={medicineSearch}
                onChange={event => setMedicineSearch(event.target.value)}
                placeholder="Optional filter..."
                className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="max-h-[68vh] overflow-y-auto divide-y divide-gray-100">
            {filteredMedicines.map(medicine => {
              const selected = medicine.id === selectedMedicineId;
              return (
                <button
                  key={medicine.id}
                  type="button"
                  onClick={() => selectMedicine(medicine)}
                  className={`w-full text-left px-4 py-3 transition-colors ${
                    selected ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`font-semibold truncate ${selected ? 'text-blue-800' : 'text-gray-900'}`}>{medicine.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {medicine.form || medicine.category || 'Medicine'}
                        {medicine.batchNo ? ` - Batch ${medicine.batchNo}` : ''}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold shrink-0 ${selected ? 'text-blue-700' : 'text-gray-500'}`}>
                      {formatUnits(asNumber(medicine.stock), asNumber(medicine.unitsPerBox, 1))}
                    </span>
                  </div>
                </button>
              );
            })}
            {filteredMedicines.length === 0 && (
              <div className="p-8 text-center text-sm text-gray-500">
                <Pill className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                No medicines match this filter.
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-4 md:space-y-6">
          {!selectedMedicine ? (
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-10 text-center text-gray-500">
              <Pill className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="font-medium text-gray-700">Choose a medicine from the list to start the audit.</p>
            </div>
          ) : (
            <>
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selectedMedicine.name}</h2>
                <p className="text-sm text-gray-500">
                  {selectedMedicine.form || 'Medicine'} {selectedMedicine.batchNo ? `- Batch ${selectedMedicine.batchNo}` : ''}
                  {selectedMedicine.expiryDate ? ` - Exp ${formatDate(selectedMedicine.expiryDate).slice(0, 12)}` : ''}
                </p>
              </div>
              <div className="text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 w-fit">
                Current stock: {formatUnits(asNumber(selectedMedicine.stock), asNumber(selectedMedicine.unitsPerBox, 1))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {[
              { label: 'Initial Stock', value: formatUnits(auditData.totals.initialStock, asNumber(selectedMedicine.unitsPerBox, 1)), sub: 'Added from Medicines page', icon: Pill, tone: 'text-indigo-700 bg-indigo-50' },
              { label: 'Purchased', value: `${auditData.totals.purchasedUnits} units`, sub: formatCurrency(auditData.totals.purchaseCost), icon: PackagePlus, tone: 'text-blue-700 bg-blue-50' },
              { label: 'Sold', value: `${auditData.totals.soldUnits} units`, sub: formatCurrency(auditData.totals.soldValue), icon: ShoppingCart, tone: 'text-emerald-700 bg-emerald-50' },
              { label: 'Sale Returns', value: `${auditData.totals.saleReturnUnits} units`, sub: formatCurrency(auditData.totals.saleReturnValue), icon: RotateCcw, tone: 'text-orange-700 bg-orange-50' },
              { label: 'Purchase Returns', value: `${auditData.totals.purchaseReturnUnits} units`, sub: formatCurrency(auditData.totals.purchaseReturnValue), icon: TrendingDown, tone: 'text-red-700 bg-red-50' },
              { label: 'Net Movement', value: `${auditData.totals.netMovement} units`, sub: 'Purchases - sales + sale returns - purchase returns', icon: Boxes, tone: 'text-slate-700 bg-slate-50' },
            ].map(({ label, value, sub, icon: Icon, tone }) => (
              <div key={label} className="bg-white border border-gray-100 rounded-xl shadow-sm p-3 md:p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-gray-500">{label}</p>
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${tone}`}>
                    <Icon className="w-4 h-4" />
                  </span>
                </div>
                <p className="text-lg font-bold text-gray-900 mt-2">{value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
              </div>
            ))}
          </div>

          <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <div className="border-b border-gray-100 overflow-x-auto">
              <div className="flex min-w-max">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
                      activeTab === tab.id
                        ? 'border-blue-600 text-blue-700 bg-blue-50'
                        : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                    <span className="rounded-full bg-white border border-gray-200 px-2 py-0.5 text-xs text-gray-500">{tab.count}</span>
                  </button>
                ))}
              </div>
            </div>

            {activeTab === 'sales' && (
              <AuditTable
                emptyIcon={ShoppingCart}
                emptyText="No sales found for this medicine."
                headers={['Date', 'Sale ID', 'Customer', 'Quantity', 'Sell Type', 'Unit Price', 'Line Total', 'Amount Paid', 'Pending', 'Status']}
                rows={auditData.saleRows.map(row => {
                  const pendingAmount = asNumber(row.sale.pendingAmount);
                  const isPending = pendingAmount > 0;
                  return [
                    formatDate(row.sale.date),
                    <span className="font-mono text-xs">{row.sale.id.slice(0, 12)}...</span>,
                    row.sale.customerName || row.sale.customerType || 'Walk-in',
                    `${asNumber(row.item.quantity)} (${row.units} units)`,
                    row.item.sellType || '-',
                    formatCurrency(asNumber(row.item.price)),
                    formatCurrency(row.lineTotal),
                    formatCurrency(asNumber(row.sale.amountPaid)),
                    formatCurrency(pendingAmount),
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${isPending ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                      {isPending ? 'Pending' : 'Paid'}
                    </span>,
                  ];
                })}
              />
            )}

            {activeTab === 'purchases' && (
              <AuditTable
                emptyIcon={PackagePlus}
                emptyText="No purchases found for this medicine."
                headers={['Date', 'Supplier', 'Batch', 'Units Added', 'Cost', 'Total Cost']}
                rows={auditData.purchaseRows.map(row => [
                  formatDate(row.date),
                  row.supplierName || 'N/A',
                  row.batchNo || '-',
                  `${row.units} units`,
                  formatCurrency(asNumber(row.costPrice ?? row.costPerBox)),
                  formatCurrency(row.totalCostValue),
                ])}
              />
            )}

            {activeTab === 'saleReturns' && (
              <AuditTable
                emptyIcon={RotateCcw}
                emptyText="No sale returns found for this medicine."
                headers={['Date', 'Original Sale', 'Quantity Returned', 'Refund Amount', 'Reason']}
                rows={auditData.saleReturnRows.map(row => [
                  formatDate(row.saleReturn.date),
                  <span className="font-mono text-xs">{row.saleReturn.originalSaleId?.slice(0, 12) || 'N/A'}...</span>,
                  `${asNumber(row.item.returnQty)} (${row.units} units)`,
                  formatCurrency(row.refundAmount),
                  row.saleReturn.reason || '-',
                ])}
              />
            )}

            {activeTab === 'purchaseReturns' && (
              <AuditTable
                emptyIcon={RotateCcw}
                emptyText="No purchase returns found for this medicine."
                headers={['Date', 'Supplier', 'Units Returned', 'Refund Amount', 'Reason']}
                rows={auditData.purchaseReturnRows.map(row => [
                  formatDate(row.date),
                  row.supplierName || 'N/A',
                  `${row.units} units`,
                  formatCurrency(row.refundAmountValue),
                  row.reason || '-',
                ])}
              />
            )}
          </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AuditTable({
  emptyIcon: EmptyIcon,
  emptyText,
  headers,
  rows,
}: {
  emptyIcon: React.ComponentType<{ className?: string }>;
  emptyText: string;
  headers: string[];
  rows: React.ReactNode[][];
}) {
  if (rows.length === 0) {
    return (
      <div className="p-10 text-center text-gray-500">
        <EmptyIcon className="w-10 h-10 text-gray-300 mx-auto mb-2" />
        {emptyText}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-gray-50 text-gray-500 text-sm border-b border-gray-100">
            {headers.map(header => (
              <th key={header} className="p-4 font-medium whitespace-nowrap">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="hover:bg-gray-50">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="p-4 text-sm text-gray-700 whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
