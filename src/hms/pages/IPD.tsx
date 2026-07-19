import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, doc, runTransaction } from '../../lib/firestoreCompat';
import { db, auth, getNextBillNo } from '../../firebase';
import { formatDate, today, nowISO } from '../lib/utils';
import { logAudit } from '../lib/audit';
import { Plus, Search, X, BedDouble, LogOut, Eye, Pill, FileText, Activity, ChevronDown, ChevronUp, ShoppingCart, Trash2, CheckCircle, AlertTriangle } from 'lucide-react';
import { differenceInDays } from 'date-fns';
import { cn } from '../lib/utils';
import { useAppDialog } from '../../components/AppDialog';

const TREATMENT_TYPES = ['Medication', 'Surgery / Operation', 'Procedure', 'Lab Test', 'Vitals', 'Nursing Note', 'Doctor Note'];

interface PharmacyTreatmentItem {
  medicineId: string;
  name: string;
  category: string;
  stock: number;
  unitsPerBox: number;
  sellType: 'unit' | 'box';
  quantity: number;
}

export function IPD() {
  const { alert } = useAppDialog();
  const [admissions, setAdmissions] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [wards, setWards] = useState<any[]>([]);
  const [beds, setBeds] = useState<any[]>([]);
  const [treatments, setTreatments] = useState<any[]>([]);
  const [medicines, setMedicines] = useState<any[]>([]);
  const [pharmacyOrders, setPharmacyOrders] = useState<any[]>([]);

  const [tab, setTab] = useState<'current' | 'discharged'>('current');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showDischarge, setShowDischarge] = useState<any | null>(null);
  const [viewAdmission, setViewAdmission] = useState<any | null>(null);
  const [showTreatmentModal, setShowTreatmentModal] = useState<any | null>(null); // admission doc
  const [expandedAdmission, setExpandedAdmission] = useState<string | null>(null);

  const [form, setForm] = useState({ patientId: '', patientName: '', patientMRN: '', patientAge: '', patientGender: '', doctorId: '', doctorName: '', wardId: '', wardName: '', bedId: '', bedNo: '', dailyRate: '2000', admissionDate: today(), diagnosis: '', notes: '', referredBy: '' });
  const [patientSearch, setPatientSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dischargeSummary, setDischargeSummary] = useState('');
  const [dischargeDate, setDischargeDate] = useState(today());

  // Treatment form
  const [treatForm, setTreatForm] = useState({ type: 'Medication', description: '', date: today(), time: '08:00' });
  const [pharmacyItems, setPharmacyItems] = useState<PharmacyTreatmentItem[]>([]);
  const [medicineSearch, setMedicineSearch] = useState('');

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'admissions'), snap => setAdmissions(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => b.admissionDate > a.admissionDate ? 1 : -1)));
    const u2 = onSnapshot(collection(db, 'patients'), snap => setPatients(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u3 = onSnapshot(collection(db, 'staff'), snap => setStaff(snap.docs.filter(d => d.data().role === 'doctor').map(d => ({ id: d.id, ...d.data() }))));
    const u4 = onSnapshot(collection(db, 'wards'), snap => setWards(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u5 = onSnapshot(collection(db, 'beds'), snap => setBeds(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u6 = onSnapshot(collection(db, 'bedTreatments'), snap => setTreatments(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u7 = onSnapshot(collection(db, 'medicines'), snap => setMedicines(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''))));
    const u8 = onSnapshot(collection(db, 'pharmacyOrders'), snap => setPharmacyOrders(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); u8(); };
  }, []);

  const filtered = admissions.filter(a => {
    const matchTab = tab === 'current' ? a.status === 'admitted' : a.status === 'discharged';
    const matchSearch = !search || a.patientName?.toLowerCase().includes(search.toLowerCase()) || a.patientMRN?.includes(search);
    return matchTab && matchSearch;
  });

  const filteredPatients = patients.filter(p => !patientSearch || p.name?.toLowerCase().includes(patientSearch.toLowerCase()) || p.mrn?.includes(patientSearch)).slice(0, 5);

  // Available beds (not occupied)
  const occupiedBedIds = admissions.filter(a => a.status === 'admitted').map(a => a.bedId).filter(Boolean);
  const availableBeds = beds.filter(b => !occupiedBedIds.includes(b.id));
  const wardBeds = form.wardId ? availableBeds.filter(b => b.wardId === form.wardId) : availableBeds;

  const handleSave = async () => {
    if (!form.patientId || !form.wardId) { setError('Patient and ward are required.'); return; }
    if (form.bedId) {
      const bedTaken = admissions.find(a => a.status === 'admitted' && a.bedId === form.bedId);
      if (bedTaken) { setError('This bed is already occupied.'); return; }
    }
    setSaving(true); setError('');
    try {
      const ref = doc(collection(db, 'admissions'));
      await runTransaction(db, async tx => {
        if (form.bedId) {
          const bedRef = doc(db, 'beds', form.bedId);
          const bedSnapshot = await tx.get(bedRef);
          if (!bedSnapshot.exists() || bedSnapshot.data().status === 'occupied') {
            throw new Error('This bed is no longer available. Select another bed.');
          }
          tx.update(bedRef, { status: 'occupied', updatedAt: nowISO() });
        }
        tx.set(ref, { ...form, dailyRate: Number(form.dailyRate), status: 'admitted', createdAt: nowISO() });
      });
      await logAudit('create', 'admission', ref.id, `${form.patientName} → ${form.wardName} Bed ${form.bedNo}`);
      setShowModal(false);
      setForm({ patientId: '', patientName: '', patientMRN: '', patientAge: '', patientGender: '', doctorId: '', doctorName: '', wardId: '', wardName: '', bedId: '', bedNo: '', dailyRate: '2000', admissionDate: today(), diagnosis: '', notes: '', referredBy: '' });
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleDischarge = async () => {
    if (!showDischarge) return;
    const pendingPharmacyOrders = pharmacyOrders.filter(order =>
      order.admissionId === showDischarge.id &&
      order.fulfillmentMode === 'billing' &&
      order.status === 'pending'
    );
    if (pendingPharmacyOrders.length > 0) {
      await alert(
        `${pendingPharmacyOrders.length} IPD pharmacy order(s) are still pending. Complete them in Pharmacy Billing or cancel them from the care log before discharge.`,
        'Pending Pharmacy Orders'
      );
      return;
    }
    setSaving(true);
    try {
      const days = differenceInDays(new Date(dischargeDate), new Date(showDischarge.admissionDate)) || 1;
      const totalCharges = days * (showDischarge.dailyRate || 0);
      const billNo = await getNextBillNo();

      // Build bill items including extra treatments
      const admTreatments = treatments.filter(t => t.admissionId === showDischarge.id && t.type === 'Medication');
      const extraItems = admTreatments.length > 0 ? [{
        description: `Medications & Treatments (${admTreatments.length} entries)`,
        category: 'Medicine', quantity: 1, rate: 0, amount: 0,
      }] : [];

      const billRef = doc(collection(db, 'bills'));
      await runTransaction(db, async tx => {
        const admissionRef = doc(db, 'admissions', showDischarge.id);
        const admissionSnapshot = await tx.get(admissionRef);
        if (!admissionSnapshot.exists() || admissionSnapshot.data().status !== 'admitted') {
          throw new Error('This admission is no longer active.');
        }
        let bedRef: ReturnType<typeof doc> | null = null;
        if (showDischarge.bedId) {
          bedRef = doc(db, 'beds', showDischarge.bedId);
          await tx.get(bedRef);
        }
        tx.set(billRef, {
        billNo, patientId: showDischarge.patientId, patientName: showDischarge.patientName, patientMRN: showDischarge.patientMRN,
        date: dischargeDate,
        items: [
          { description: `IPD — ${showDischarge.wardName || showDischarge.ward} Bed ${showDischarge.bedNo}`, category: 'IPD Charges', quantity: days, rate: showDischarge.dailyRate || 0, amount: totalCharges },
          ...extraItems,
        ],
        subtotal: totalCharges, discount: 0, total: totalCharges, paid: 0, balance: totalCharges,
        paymentStatus: 'pending', paymentMethod: 'Cash', cashierId: auth.currentUser?.uid || '',
        notes: `Auto-generated on discharge. ${showDischarge.admissionDate} → ${dischargeDate}`, createdAt: nowISO(),
        });
        tx.update(admissionRef, { status: 'discharged', dischargeDate, dischargeSummary, totalCharges, updatedAt: nowISO() });
        if (bedRef) tx.update(bedRef, { status: 'available', updatedAt: nowISO() });
      });
      await logAudit('update', 'admission', showDischarge.id, `${showDischarge.patientName} discharged`);

      setShowDischarge(null); setDischargeSummary(''); setDischargeDate(today());
    } catch (e: any) { await alert('Discharge failed: ' + (e.message || 'Unknown error'), 'Discharge Failed'); }
    finally { setSaving(false); }
  };

  const isPharmacyTreatment = treatForm.type === 'Medication' || treatForm.type === 'Surgery / Operation';
  const requestedUnits = (item: PharmacyTreatmentItem) => item.quantity * (item.sellType === 'box' ? item.unitsPerBox : 1);
  const filteredMedicines = medicines.filter(medicine => {
    if (Number(medicine.stock || 0) <= 0) return false;
    const term = medicineSearch.trim().toLowerCase();
    return !term ||
      medicine.name?.toLowerCase().includes(term) ||
      medicine.category?.toLowerCase().includes(term) ||
      medicine.batchNo?.toLowerCase().includes(term);
  });

  const addPharmacyItem = (medicine: any) => {
    if (pharmacyItems.some(item => item.medicineId === medicine.id)) return;
    setPharmacyItems(items => [...items, {
      medicineId: medicine.id,
      name: medicine.name,
      category: medicine.category || 'Other',
      stock: Number(medicine.stock || 0),
      unitsPerBox: Math.max(1, Number(medicine.unitsPerBox) || 1),
      sellType: 'unit',
      quantity: 1,
    }]);
  };

  const updatePharmacyItem = (medicineId: string, changes: Partial<PharmacyTreatmentItem>) => {
    setPharmacyItems(items => items.map(item => item.medicineId === medicineId ? { ...item, ...changes } : item));
  };

  const closeTreatmentModal = () => {
    setShowTreatmentModal(null);
    setPharmacyItems([]);
    setMedicineSearch('');
    setTreatForm({ type: 'Medication', description: '', date: today(), time: '08:00' });
  };

  const handleAddTreatment = async () => {
    if (!showTreatmentModal) return;
    if (!isPharmacyTreatment && !treatForm.description.trim()) return;
    if (isPharmacyTreatment && !pharmacyItems.length) {
      await alert('Select at least one in-stock pharmacy item.', 'No Items Selected');
      return;
    }
    const invalidItem = pharmacyItems.find(item => !Number.isInteger(item.quantity) || item.quantity <= 0 || requestedUnits(item) > item.stock);
    if (isPharmacyTreatment && invalidItem) {
      await alert(
        `${invalidItem.name} needs a valid quantity within available stock (${invalidItem.stock} unit(s)).`,
        'Invalid Quantity'
      );
      return;
    }
    setSaving(true);
    try {
      const createdAt = nowISO();
      if (isPharmacyTreatment) {
        const treatmentRef = doc(collection(db, 'bedTreatments'));
        const pharmacyOrderRef = doc(collection(db, 'pharmacyOrders'));
        const source = treatForm.type === 'Medication' ? 'ipd_medication' : 'ipd_surgery';
        const orderItems = pharmacyItems.map(item => ({
          medicineId: item.medicineId,
          name: item.name,
          category: item.category,
          sellType: item.sellType,
          quantity: item.quantity,
          requestedUnits: requestedUnits(item),
          unitsPerBox: item.unitsPerBox,
          stockAtRequest: item.stock,
        }));
        const itemSummary = orderItems.map(item => `${item.name} x ${item.quantity} ${item.sellType}`).join(', ');

        await runTransaction(db, async tx => {
          tx.set(treatmentRef, {
            ...treatForm,
            description: treatForm.description.trim() || itemSummary,
            admissionId: showTreatmentModal.id,
            patientId: showTreatmentModal.patientId,
            patientName: showTreatmentModal.patientName,
            patientMRN: showTreatmentModal.patientMRN || '',
            wardId: showTreatmentModal.wardId || '',
            wardName: showTreatmentModal.wardName || '',
            bedId: showTreatmentModal.bedId || '',
            bedNo: showTreatmentModal.bedNo || '',
            pharmacyOrderId: pharmacyOrderRef.id,
            pharmacyItems: orderItems,
            source,
            fulfillmentStatus: 'pending',
            addedBy: auth.currentUser?.email || 'staff',
            addedByUid: auth.currentUser?.uid || '',
            createdAt,
          });
          tx.set(pharmacyOrderRef, {
            source,
            fulfillmentMode: 'billing',
            status: 'pending',
            admissionId: showTreatmentModal.id,
            patientId: showTreatmentModal.patientId,
            patientName: showTreatmentModal.patientName,
            patientMRN: showTreatmentModal.patientMRN || '',
            wardId: showTreatmentModal.wardId || '',
            wardName: showTreatmentModal.wardName || '',
            bedId: showTreatmentModal.bedId || '',
            bedNo: showTreatmentModal.bedNo || '',
            bedTreatmentId: treatmentRef.id,
            items: orderItems,
            prescriptions: orderItems,
            notes: treatForm.description.trim(),
            requestedBy: auth.currentUser?.uid || '',
            requestedByName: auth.currentUser?.email || 'IPD staff',
            requestedAt: createdAt,
            createdAt,
          });
        });
        closeTreatmentModal();
      } else {
        await addDoc(collection(db, 'bedTreatments'), {
          ...treatForm, admissionId: showTreatmentModal.id,
          patientId: showTreatmentModal.patientId, patientName: showTreatmentModal.patientName,
          wardName: showTreatmentModal.wardName, bedNo: showTreatmentModal.bedNo,
          addedBy: auth.currentUser?.email || 'staff', createdAt,
        });
        setTreatForm({ type: 'Medication', description: '', date: today(), time: '08:00' });
      }
    } catch (e: any) { await alert(e.message || 'Treatment could not be added.', 'Treatment Failed'); }
    finally { setSaving(false); }
  };

  const handleCancelPharmacyOrder = async (treatment: any) => {
    if (!treatment.pharmacyOrderId || treatment.fulfillmentStatus !== 'pending') return;
    setSaving(true);
    try {
      await runTransaction(db, async tx => {
        const orderRef = doc(db, 'pharmacyOrders', treatment.pharmacyOrderId);
        const treatmentRef = doc(db, 'bedTreatments', treatment.id);
        const [orderSnap, treatmentSnap] = await Promise.all([tx.get(orderRef), tx.get(treatmentRef)]);
        if (!orderSnap.exists() || orderSnap.data().status !== 'pending') throw new Error('This pharmacy order is no longer pending.');
        if (!treatmentSnap.exists() || treatmentSnap.data().fulfillmentStatus !== 'pending') throw new Error('This care entry is no longer pending.');
        const cancelledAt = nowISO();
        tx.update(orderRef, { status: 'cancelled', cancelledAt, cancelledBy: auth.currentUser?.uid || '' });
        tx.update(treatmentRef, { fulfillmentStatus: 'cancelled', cancelledAt, cancelledBy: auth.currentUser?.uid || '' });
      });
    } catch (e: any) {
      await alert(e.message || 'The pharmacy order could not be cancelled.', 'Cancellation Failed');
    } finally {
      setSaving(false);
    }
  };

  const f = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));
  const currentCount = admissions.filter(a => a.status === 'admitted').length;

  const wardSummary = wards.map(w => ({
    ...w,
    total: beds.filter(b => b.wardId === w.id).length,
    occupied: admissions.filter(a => a.status === 'admitted' && a.wardId === w.id).length,
  })).filter(w => w.total > 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">IPD — Inpatient</h1>
          <p className="text-sm text-gray-500">{currentCount} patients admitted · {availableBeds.length} beds available</p>
        </div>
        <button onClick={() => { setForm({ patientId: '', patientName: '', patientMRN: '', patientAge: '', patientGender: '', doctorId: '', doctorName: '', wardId: '', wardName: '', bedId: '', bedNo: '', dailyRate: '2000', admissionDate: today(), diagnosis: '', notes: '', referredBy: '' }); setError(''); setShowModal(true); }}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700">
          <Plus className="w-4 h-4" /> Admit Patient
        </button>
      </div>

      {/* Ward summary */}
      {tab === 'current' && wardSummary.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {wardSummary.slice(0, 4).map(w => (
            <div key={w.id} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <BedDouble className="w-4 h-4 text-blue-400" />
                <span className="text-xs text-gray-500 truncate">{w.name}</span>
              </div>
              <div className="text-2xl font-bold text-gray-900">{w.occupied}<span className="text-sm font-normal text-gray-400">/{w.total}</span></div>
              <div className="text-xs text-gray-400">beds occupied</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4">
        <div className="flex bg-white border border-gray-200 rounded-lg p-1 gap-1">
          {(['current','discharged'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded-md text-sm font-medium ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>
              {t === 'current' ? 'Currently Admitted' : 'Discharged'}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient..."
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {/* Admissions Table + expandable treatment row */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['Patient','Ward / Bed','Doctor','Admitted',tab === 'current' ? 'Days' : 'Discharged','Rate','Treatments','Actions'].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-gray-400">No records found</td></tr>
            ) : filtered.map(a => {
              const days = differenceInDays(new Date(a.dischargeDate || new Date()), new Date(a.admissionDate)) || 1;
              const admTreatments = treatments.filter(t => t.admissionId === a.id);
              const expanded = expandedAdmission === a.id;
              return (
                <React.Fragment key={a.id}>
                  <tr className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">{a.patientName}</div>
                      <div className="text-xs text-gray-400">{a.patientMRN} · {a.patientAge}y {a.patientGender}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-700">{a.wardName || a.ward}</div>
                      <div className="text-xs text-gray-400">{a.bedNo ? `Bed ${a.bedNo}` : '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{a.doctorName || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDate(a.admissionDate)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {tab === 'current' ? <span className="bg-orange-50 text-orange-700 text-xs px-2 py-0.5 rounded-full font-medium">{days}d</span> : formatDate(a.dischargeDate)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">Rs.{a.dailyRate?.toLocaleString()}/day</td>
                    <td className="px-4 py-3">
                      <button onClick={() => setExpandedAdmission(expanded ? null : a.id)}
                        className={cn('flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg',
                          admTreatments.length > 0 ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
                        {admTreatments.length} entries {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {tab === 'current' && (
                          <>
                            <button onClick={() => setShowTreatmentModal(a)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="Add Treatment">
                              <Pill className="w-4 h-4" />
                            </button>
                            <button onClick={() => { setShowDischarge(a); setDischargeDate(today()); }} className="flex items-center gap-1 text-xs bg-red-50 text-red-600 hover:bg-red-100 px-2 py-1 rounded-lg font-medium">
                              <LogOut className="w-3 h-3" /> Discharge
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={8} className="bg-blue-50/40 px-6 py-3 border-b border-blue-100">
                        <div className="text-xs font-semibold text-blue-700 mb-2">Treatment / Care Log — {a.patientName}</div>
                        {admTreatments.length === 0 ? (
                          <p className="text-xs text-gray-400">No entries yet.</p>
                        ) : (
                          <div className="space-y-1.5 max-h-60 overflow-y-auto">
                            {admTreatments.sort((x: any, y: any) => (y.createdAt > x.createdAt ? 1 : -1)).map((t: any) => {
                              const linkedOrder = t.pharmacyOrderId ? pharmacyOrders.find(order => order.id === t.pharmacyOrderId) : null;
                              const fulfillmentStatus = t.fulfillmentStatus || linkedOrder?.status;
                              return <div key={t.id} className="flex items-start gap-3 bg-white rounded-lg px-3 py-2 border border-blue-100">
                                <span className={cn('text-xs font-semibold px-2 py-0.5 rounded shrink-0',
                                  t.type === 'Medication' ? 'bg-green-100 text-green-700' :
                                  t.type === 'Surgery / Operation' ? 'bg-rose-100 text-rose-700' :
                                  t.type === 'Procedure' ? 'bg-purple-100 text-purple-700' :
                                  t.type === 'Vitals' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600')}>
                                  {t.type}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm text-gray-800">{t.description}</p>
                                    {fulfillmentStatus && (
                                      <span className={cn('text-[10px] font-bold uppercase px-2 py-0.5 rounded-full',
                                        fulfillmentStatus === 'fulfilled' || fulfillmentStatus === 'dispensed' ? 'bg-green-100 text-green-700' :
                                        fulfillmentStatus === 'cancelled' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-700')}>
                                        {fulfillmentStatus === 'pending' ? 'Awaiting Billing' : fulfillmentStatus}
                                      </span>
                                    )}
                                  </div>
                                  {Array.isArray(t.pharmacyItems) && t.pharmacyItems.length > 0 && (
                                    <p className="text-xs text-gray-500 mt-1">
                                      {t.pharmacyItems.map((item: any) => `${item.name}: ${item.quantity} ${item.sellType}${item.quantity === 1 ? '' : 's'}`).join(' | ')}
                                    </p>
                                  )}
                                  <p className="text-xs text-gray-400 mt-0.5">{t.date} {t.time} · {t.addedBy}</p>
                                  {t.saleId && <p className="text-xs text-green-600 mt-1">Fulfilled by sale {t.saleId.slice(0, 10)}</p>}
                                </div>
                                {tab === 'current' && fulfillmentStatus === 'pending' && t.pharmacyOrderId && (
                                  <button
                                    onClick={() => handleCancelPharmacyOrder(t)}
                                    disabled={saving}
                                    className="p-1.5 text-red-500 hover:bg-red-50 rounded-md disabled:opacity-50"
                                    title="Cancel pharmacy order"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>;
                            })}
                          </div>
                        )}
                        {tab === 'current' && (
                          <button onClick={() => setShowTreatmentModal(a)} className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 font-medium hover:text-blue-700">
                            <Plus className="w-3.5 h-3.5" /> Add entry
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Admit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-lg my-4">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Admit Patient</h2>
              <button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
              {/* Patient select */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Patient *</label>
                {form.patientId ? (
                  <div className="flex items-center gap-2 border border-green-200 bg-green-50 rounded-lg px-3 py-2">
                    <span className="text-sm font-medium text-green-800 flex-1">{form.patientName} ({form.patientMRN})</span>
                    <button onClick={() => setForm(p => ({ ...p, patientId: '', patientName: '', patientMRN: '' }))}><X className="w-3.5 h-3.5 text-green-600" /></button>
                  </div>
                ) : (
                  <div className="relative">
                    <input value={patientSearch} onChange={e => setPatientSearch(e.target.value)} placeholder="Search patient..."
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    {patientSearch && filteredPatients.length > 0 && (
                      <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 mt-1">
                        {filteredPatients.map(p => (
                          <button key={p.id} onClick={() => { setForm(pr => ({ ...pr, patientId: p.id, patientName: p.name, patientMRN: p.mrn, patientAge: String(p.age), patientGender: p.gender })); setPatientSearch(''); }}
                            className="w-full text-left px-3 py-2.5 hover:bg-blue-50 text-sm border-b last:border-0">
                            <span className="font-medium">{p.name}</span> <span className="text-xs text-gray-400">({p.mrn})</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Ward *</label>
                  <select value={form.wardId} onChange={e => { const w = wards.find(w => w.id === e.target.value); setForm(p => ({ ...p, wardId: w?.id || '', wardName: w?.name || '', bedId: '', bedNo: '' })); }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— Select Ward —</option>
                    {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Bed</label>
                  <select value={form.bedId} onChange={e => { const b = beds.find(b => b.id === e.target.value); setForm(p => ({ ...p, bedId: b?.id || '', bedNo: b?.bedNo || '', dailyRate: String(b?.dailyRate || '2000') })); }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— Select Bed —</option>
                    {wardBeds.map(b => <option key={b.id} value={b.id}>Bed {b.bedNo} ({b.type})</option>)}
                  </select>
                  {form.wardId && wardBeds.length === 0 && <p className="text-xs text-red-500 mt-1">No available beds in this ward</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Doctor</label>
                  <select value={form.doctorId} onChange={e => { const d = staff.find(s => s.id === e.target.value); setForm(p => ({ ...p, doctorId: d?.id || '', doctorName: d?.name || '' })); }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— Select —</option>
                    {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Admission Date</label>
                  <input type="date" value={form.admissionDate} onChange={e => f('admissionDate', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Daily Rate (Rs.)</label>
                  <input type="number" value={form.dailyRate} onChange={e => f('dailyRate', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Referred By</label>
                  <input value={form.referredBy} onChange={e => f('referredBy', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Admission Diagnosis</label>
                  <textarea value={form.diagnosis} onChange={e => f('diagnosis', e.target.value)} rows={2}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm disabled:opacity-60">{saving ? 'Saving...' : 'Admit Patient'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Treatment/Care Log Modal */}
      {showTreatmentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-3xl my-4">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="font-semibold text-gray-900">Add Treatment Entry</h2>
                <p className="text-xs text-gray-400 mt-0.5">{showTreatmentModal.patientName} · Bed {showTreatmentModal.bedNo}</p>
              </div>
              <button onClick={closeTreatmentModal}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                  <select value={treatForm.type} onChange={e => setTreatForm(f => ({ ...f, type: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {TREATMENT_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                  <input type="date" value={treatForm.date} onChange={e => setTreatForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Time</label>
                  <input type="time" value={treatForm.time} onChange={e => setTreatForm(f => ({ ...f, time: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{isPharmacyTreatment ? 'Notes (optional)' : 'Description / Details *'}</label>
                <textarea value={treatForm.description} onChange={e => setTreatForm(f => ({ ...f, description: e.target.value }))} rows={3}
                  placeholder="e.g. Tab Paracetamol 500mg — 1 tablet BD after meals"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {isPharmacyTreatment && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    <ShoppingCart className="w-4 h-4 shrink-0" />
                    Selected items will be sent to Pharmacy Billing. Stock changes only when Billing checkout is completed.
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Pharmacy inventory</label>
                    <div className="relative mb-2">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        value={medicineSearch}
                        onChange={e => setMedicineSearch(e.target.value)}
                        placeholder="Filter medicines or items..."
                        className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="border border-gray-200 rounded-lg max-h-44 overflow-y-auto divide-y divide-gray-100">
                      {filteredMedicines.map(medicine => {
                        const selected = pharmacyItems.some(item => item.medicineId === medicine.id);
                        return (
                          <div key={medicine.id} className="flex items-center gap-3 px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-800 truncate">{medicine.name}</p>
                              <p className="text-xs text-gray-400">{medicine.category || 'Other'} | Stock: {Number(medicine.stock || 0)} unit(s)</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => addPharmacyItem(medicine)}
                              disabled={selected}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md disabled:text-green-600 disabled:bg-green-50"
                              title={selected ? 'Item selected' : 'Add item'}
                            >
                              {selected ? <CheckCircle className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                            </button>
                          </div>
                        );
                      })}
                      {filteredMedicines.length === 0 && <p className="px-3 py-6 text-center text-sm text-gray-400">No in-stock items found.</p>}
                    </div>
                  </div>
                  {pharmacyItems.length > 0 && (
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                      {pharmacyItems.map(item => {
                        const units = requestedUnits(item);
                        const overStock = units > item.stock;
                        return (
                          <div key={item.medicineId} className="grid grid-cols-[minmax(0,1fr)_95px_90px_32px] gap-2 items-center px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                              <p className={`text-xs ${overStock ? 'text-red-600 font-medium' : 'text-gray-400'}`}>{units} unit(s) requested | {item.stock} available</p>
                            </div>
                            <select
                              value={item.sellType}
                              onChange={e => updatePharmacyItem(item.medicineId, { sellType: e.target.value as 'unit' | 'box' })}
                              className="border border-gray-200 rounded-md px-2 py-1.5 text-xs"
                            >
                              <option value="unit">Unit</option>
                              <option value="box" disabled={item.unitsPerBox <= 1 || item.stock < item.unitsPerBox}>Box</option>
                            </select>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={item.quantity}
                              onChange={e => updatePharmacyItem(item.medicineId, { quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                              className={`w-full border rounded-md px-2 py-1.5 text-xs ${overStock ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                              aria-label={`Quantity for ${item.name}`}
                            />
                            <button
                              type="button"
                              onClick={() => setPharmacyItems(items => items.filter(selected => selected.medicineId !== item.medicineId))}
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded-md"
                              title="Remove item"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {/* Recent entries */}
              {treatments.filter(t => t.admissionId === showTreatmentModal.id).slice(0, 3).map((t: any) => (
                <div key={t.id} className="text-xs bg-gray-50 rounded-lg px-3 py-2 flex items-center gap-2">
                  <span className="font-semibold text-gray-600">{t.type}</span>
                  <span className="text-gray-500 truncate">{t.description}</span>
                  <span className="text-gray-300 shrink-0">{t.date} {t.time}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={closeTreatmentModal} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Close</button>
              <button onClick={handleAddTreatment} disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm disabled:opacity-60">
                {saving ? 'Saving...' : isPharmacyTreatment ? 'Send to Pharmacy' : 'Add Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Discharge Modal */}
      {showDischarge && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Discharge Patient</h2>
              <button onClick={() => setShowDischarge(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-orange-50 border border-orange-100 rounded-lg p-3">
                <div className="font-medium text-orange-800">{showDischarge.patientName}</div>
                <div className="text-sm text-orange-600">{showDischarge.wardName} · Bed {showDischarge.bedNo}</div>
                <div className="text-sm text-orange-600">Admitted: {formatDate(showDischarge.admissionDate)}</div>
              </div>
              {pharmacyOrders.some(order => order.admissionId === showDischarge.id && order.fulfillmentMode === 'billing' && order.status === 'pending') && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Complete or cancel all pending IPD pharmacy orders before discharging this patient.
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Discharge Date</label>
                <input type="date" value={dischargeDate} onChange={e => setDischargeDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Discharge Summary</label>
                <textarea value={dischargeSummary} onChange={e => setDischargeSummary(e.target.value)} rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-blue-600 font-medium">IPD Bill (auto):</span>
                  <span className="text-blue-800 font-bold">Rs. {((differenceInDays(new Date(dischargeDate), new Date(showDischarge.admissionDate)) || 1) * (showDischarge.dailyRate || 0)).toLocaleString()}</span>
                </div>
                <div className="text-xs text-blue-500 mt-0.5">{differenceInDays(new Date(dischargeDate), new Date(showDischarge.admissionDate)) || 1} days × Rs.{showDischarge.dailyRate}/day</div>
                <p className="text-xs text-blue-400 mt-1 border-t border-blue-100 pt-1">✓ Bill created automatically · Bed will be freed</p>
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowDischarge(null)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleDischarge} disabled={saving || pharmacyOrders.some(order => order.admissionId === showDischarge.id && order.fulfillmentMode === 'billing' && order.status === 'pending')} className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm disabled:opacity-60">{saving ? '...' : 'Confirm Discharge'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
