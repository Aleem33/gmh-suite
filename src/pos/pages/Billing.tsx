import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, onSnapshot, addDoc, doc, getDoc, increment, runTransaction } from '../../lib/firestoreCompat';
import { printPharmacyDocument } from '../lib/pharmacyPrint';
import {
  EMPTY_HOSPITAL_PRINT_PROFILE,
  type HospitalPrintProfile,
} from '../lib/printTemplates';
import { db, auth, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import {
  Search, Plus, Minus, Trash2, Printer, ShoppingCart, Tag,
  User, UserCheck, UserX, ChevronDown, Percent, DollarSign,
  UserPlus, Check, X, Pill, ClipboardList, CheckCircle,
} from 'lucide-react';
import { DEFAULT_NON_ADMIN_DISCOUNT_PERCENT, hasPermission, isAdminProfile, type UserProfile } from '../../lib/permissions';

interface BillingProps {
  userProfile?: UserProfile | null;
}

export function Billing({ userProfile }: BillingProps) {
  const [searchParams] = useSearchParams();
  const [medicines, setMedicines]       = useState<any[]>([]);
  const [customers, setCustomers]       = useState<any[]>([]);
  const [search, setSearch]             = useState('');
  const [cart, setCart]                 = useState<any[]>([]);
  const [orderDiscount, setOrderDiscount] = useState(0);
  const [customerType, setCustomerType] = useState<'customer' | 'hospital'>('customer');
  const [lastReceipt, setLastReceipt]   = useState<any>(null);
  const [hospitalPrintProfile, setHospitalPrintProfile] = useState<HospitalPrintProfile>(EMPTY_HOSPITAL_PRINT_PROFILE);
  const [showPrintAlert, setShowPrintAlert] = useState(false);
  const [stockError, setStockError]     = useState('');
  const [pharmacyOrders, setPharmacyOrders] = useState<any[]>([]);
  const [activePharmacyOrder, setActivePharmacyOrder] = useState<any | null>(null);
  const [showRxModal, setShowRxModal] = useState(false);
  const [rxSearch, setRxSearch] = useState('');
  const [maxNonAdminDiscountPercent, setMaxNonAdminDiscountPercent] = useState(DEFAULT_NON_ADMIN_DISCOUNT_PERCENT);
  const todayInput = new Date().toISOString().slice(0, 10);
  const [adminSaleDate, setAdminSaleDate] = useState(todayInput);

  // Mobile: which tab is active
  const [mobileTab, setMobileTab] = useState<'medicines' | 'cart'>('medicines');

  // Customer selection
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [customerSearch, setCustomerSearch]     = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const customerDropdownRef = useRef<HTMLDivElement>(null);

  // Create new customer inline
  const [showCreateForm, setShowCreateForm]   = useState(false);
  const [newCustName, setNewCustName]         = useState('');
  const [newCustPhone, setNewCustPhone]       = useState('');
  const [savingCustomer, setSavingCustomer]   = useState(false);

  // Partial payment
  const [amountPaid, setAmountPaid] = useState<number | ''>('');

  useEffect(() => {
    const unsub1 = onSnapshot(collection(db, 'medicines'), snap => {
      setMedicines(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.GET, 'medicines'));
    const unsub2 = onSnapshot(collection(db, 'customers'), snap => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.GET, 'customers'));
    const unsub3 = onSnapshot(collection(db, 'pharmacyOrders'), snap => {
      setPharmacyOrders(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((o: any) => o.status === 'pending')
          .sort((a: any, b: any) => (b.createdAt > a.createdAt ? 1 : -1))
      );
    }, err => handleFirestoreError(err, OperationType.GET, 'pharmacyOrders'));
    const unsub4 = onSnapshot(doc(db, 'settings', 'hospital'), snap => {
      setHospitalPrintProfile(snap.exists()
        ? { ...EMPTY_HOSPITAL_PRINT_PROFILE, ...(snap.data() as HospitalPrintProfile) }
        : EMPTY_HOSPITAL_PRINT_PROFILE);
    }, err => handleFirestoreError(err, OperationType.GET, 'settings/hospital'));
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, []);

  useEffect(() => {
    getDoc(doc(db, 'settings', 'permissions')).then(snap => {
      if (snap.exists()) {
        const next = Number((snap.data() as any).maxNonAdminDiscountPercent);
        if (Number.isFinite(next)) setMaxNonAdminDiscountPercent(Math.max(0, Math.min(100, next)));
      }
    }).catch(err => handleFirestoreError(err, OperationType.GET, 'settings/permissions'));
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(e.target as Node))
        setShowCustomerDropdown(false);
    };
    // mousedown for desktop, touchstart for Android WebView
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, []);

  useEffect(() => {
    const customerId = searchParams.get('customerId');
    if (!customerId || selectedCustomer?.id === customerId) return;

    const customer = customers.find(c => c.id === customerId);
    if (!customer) return;

    setSelectedCustomer(customer);
    setCustomerType('customer');
    setCustomerSearch('');
    setShowCustomerDropdown(false);
    setShowCreateForm(false);
    setMobileTab('cart');
  }, [customers, searchParams, selectedCustomer?.id]);

  const filteredMedicines = medicines.filter(m =>
    m.stock > 0 && (
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      (m.batchNo || '').toLowerCase().includes(search.toLowerCase())
    )
  );

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (c.phone || '').includes(customerSearch)
  ).slice(0, 8);

  const isAdmin = isAdminProfile(userProfile);
  const isHaseeb = userProfile?.username === 'haseeb';
  const hasBillingDiscount = hasPermission(userProfile, 'pos.billing.discount');
  const canCreateCustomers = isAdmin || isHaseeb || hasPermission(userProfile, 'pos.customers.create');
  const getAllowedDiscountPercentFor = (type: 'customer' | 'hospital') => {
    if (isAdmin) return 100;
    if (isHaseeb && type === 'hospital') return 100;
    return hasBillingDiscount ? maxNonAdminDiscountPercent : 0;
  };
  const allowedDiscountPercent = getAllowedDiscountPercentFor(customerType);
  const discountCapApplies = allowedDiscountPercent < 100;
  const discountCapLabel = `${allowedDiscountPercent}%`;

  const discountPercentFor = (type: 'rs' | 'pct', value: number, qty: number, price: number) => {
    const lineTotal = qty * price;
    if (!lineTotal || !value) return 0;
    return type === 'pct' ? value : (value / lineTotal) * 100;
  };

  const rejectOverDiscountCap = (pct: number) => {
    if (!discountCapApplies || pct <= allowedDiscountPercent) return false;
    setStockError(`Discount limit is ${discountCapLabel} for this sale type.`);
    setTimeout(() => setStockError(''), 4000);
    return true;
  };

  const handleCreateCustomer = async () => {
    if (!canCreateCustomers) return;
    if (!newCustName.trim()) return;
    setSavingCustomer(true);
    try {
      const docRef = await addDoc(collection(db, 'customers'), {
        name: newCustName.trim(), phone: newCustPhone.trim(),
        creditBalance: 0, createdAt: new Date().toISOString(),
      });
      setSelectedCustomer({ id: docRef.id, name: newCustName.trim(), phone: newCustPhone.trim(), creditBalance: 0 });
      setShowCreateForm(false); setNewCustName(''); setNewCustPhone('');
      setCustomerSearch(''); setShowCustomerDropdown(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'customers');
    } finally { setSavingCustomer(false); }
  };

  const addToCart = (med: any, sellType: 'box' | 'unit') => {
    if (activePharmacyOrder) {
      setStockError('Finish or clear the loaded pharmacy order before adding manual items.');
      setTimeout(() => setStockError(''), 4000);
      return;
    }
    setCart(prev => {
      const cartItemId = `${med.id}-${sellType}`;
      const existing   = prev.find(item => item.cartItemId === cartItemId);
      const price      = sellType === 'box' ? (med.retailPrice || med.price) : (med.unitPrice || med.price);
      const unitsToAdd = sellType === 'box' ? (med.unitsPerBox || 1) : 1;
      const currentUnitsInCart = prev
        .filter(i => i.medicineId === med.id)
        .reduce((sum, i) => sum + (i.quantity * (i.sellType === 'box' ? i.unitsPerBox : 1)), 0);
      if (currentUnitsInCart + unitsToAdd > med.stock) {
        setStockError('Not enough stock available for ' + med.name + '!');
        setTimeout(() => setStockError(''), 3500);
        return prev;
      }
      if (existing) {
        return prev.map(item => {
          if (item.cartItemId !== cartItemId) return item;
          const newQ = item.quantity + 1;
          const disc = computeItemDiscountRs(item.discountType, item.discountValue, newQ, item.price);
          return { ...item, quantity: newQ, itemDiscount: disc, total: Math.max(0, newQ * item.price - disc) };
        });
      }
      return [...prev, {
        cartItemId, medicineId: med.id, name: med.name, sellType, price,
        category: med.category || 'Medicine',
        costPrice: med.costPrice || 0, quantity: 1,
        discountType: 'rs' as 'rs' | 'pct', discountValue: 0, itemDiscount: 0,
        total: price, unitsPerBox: med.unitsPerBox || 1,
      }];
    });
    // Auto-switch to cart tab on mobile after adding
    setMobileTab('cart');
  };

  function computeItemDiscountRs(type: 'rs' | 'pct', value: number, qty: number, price: number): number {
    if (!value) return 0;
    const maxDiscount = qty * price;
    if (type === 'pct') return Math.min(maxDiscount, (value / 100) * maxDiscount);
    return Math.min(maxDiscount, Math.max(0, value));
  }

  const clampDiscountsForSaleType = (nextType: 'customer' | 'hospital') => {
    const nextLimit = getAllowedDiscountPercentFor(nextType);
    if (nextLimit >= 100) return;

    setOrderDiscount(prev => Math.min(prev, nextLimit));
    setCart(prev => prev.map(item => {
      const pct = discountPercentFor(item.discountType, item.discountValue, item.quantity, item.price);
      if (pct <= nextLimit) return item;

      const lineTotal = item.quantity * item.price;
      const discountValue = item.discountType === 'pct'
        ? nextLimit
        : (lineTotal * nextLimit) / 100;
      const itemDiscount = computeItemDiscountRs(item.discountType, discountValue, item.quantity, item.price);

      return {
        ...item,
        discountValue,
        itemDiscount,
        total: Math.max(0, lineTotal - itemDiscount),
      };
    }));
  };

  const handleCustomerTypeChange = (nextType: 'customer' | 'hospital') => {
    if (activePharmacyOrder && nextType !== 'hospital') {
      setStockError('A loaded pharmacy order must be completed as a Hospital sale.');
      setTimeout(() => setStockError(''), 4000);
      return;
    }
    setCustomerType(nextType);
    clampDiscountsForSaleType(nextType);
  };

  const updateQuantity = (cartItemId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.cartItemId !== cartItemId) return item;
      if (item.linkedOrderItem) return item;
      const med = medicines.find(m => m.id === item.medicineId);
      if (!med) return item;
      const newQ = Math.max(1, item.quantity + delta);
      const otherUnits = prev
        .filter(i => i.medicineId === med.id && i.cartItemId !== cartItemId)
        .reduce((sum, i) => sum + (i.quantity * (i.sellType === 'box' ? i.unitsPerBox : 1)), 0);
      if (otherUnits + newQ * (item.sellType === 'box' ? item.unitsPerBox : 1) > med.stock) return item;
      const disc = computeItemDiscountRs(item.discountType, item.discountValue, newQ, item.price);
      return { ...item, quantity: newQ, itemDiscount: disc, total: Math.max(0, newQ * item.price - disc) };
    }));
  };

  const updateItemDiscount = (cartItemId: string, type: 'rs' | 'pct', value: number) => {
    setCart(prev => prev.map(item => {
      if (item.cartItemId !== cartItemId) return item;
      if (rejectOverDiscountCap(discountPercentFor(type, value, item.quantity, item.price))) return item;
      const disc = computeItemDiscountRs(type, value, item.quantity, item.price);
      return { ...item, discountType: type, discountValue: value, itemDiscount: disc, total: Math.max(0, item.quantity * item.price - disc) };
    }));
  };

  const removeFromCart = (cartItemId: string) =>
    setCart(prev => prev.filter(item => item.cartItemId !== cartItemId || item.linkedOrderItem));

  const grossSubtotal        = cart.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const totalItemDiscounts   = cart.reduce((sum, item) => sum + (item.itemDiscount || 0), 0);
  const subtotalAfterItemDisc = cart.reduce((sum, item) => sum + item.total, 0);
  const orderDiscountAmount  = subtotalAfterItemDisc * (orderDiscount / 100);
  const grandTotal           = Math.max(0, subtotalAfterItemDisc - orderDiscountAmount);
  const effectiveAmountPaid  = amountPaid === '' ? grandTotal : Math.min(Number(amountPaid), grandTotal);
  const pendingAmount        = Math.max(0, grandTotal - effectiveAmountPaid);

  const handlePrint = (receipt = lastReceipt) => {
    if (!receipt) return;
    if (window !== window.top) {
      setShowPrintAlert(true); setTimeout(() => setShowPrintAlert(false), 5000);
    } else {
      void printPharmacyDocument({
        kind: 'bill',
        record: receipt,
        hospitalProfile: hospitalPrintProfile,
        title: 'Pharmacy Bill',
        filename: 'pharmacy-bill.pdf',
      });
    }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'p') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (lastReceipt) {
        handlePrint(lastReceipt);
      } else {
        setStockError('Complete checkout first, then the pharmacy bill will print in the 110 x 190 mm format.');
        setTimeout(() => setStockError(''), 4500);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [lastReceipt, hospitalPrintProfile]);

  const getOrderItems = (order: any) => Array.isArray(order.items) && order.items.length
    ? order.items
    : (order.prescriptions || []);

  const findOrderMedicine = (item: any) => {
    if (item.medicineId) {
      const exactId = medicines.find(medicine => medicine.id === item.medicineId);
      if (exactId) return exactId;
    }
    const itemName = String(item.name || '').toLowerCase().trim();
    if (!itemName) return null;
    return medicines.find(medicine => String(medicine.name || '').toLowerCase().trim() === itemName)
      || medicines.find(medicine => {
        const medicineName = String(medicine.name || '').toLowerCase().trim();
        return medicineName.includes(itemName) || itemName.includes(medicineName);
      })
      || null;
  };

  const loadPrescription = (order: any) => {
    if (activePharmacyOrder || cart.length > 0) {
      setStockError('Checkout or clear the current cart before loading another pharmacy order.');
      setTimeout(() => setStockError(''), 4500);
      return;
    }
    const newItems: any[] = [];
    const unavailable: string[] = [];
    for (const rx of getOrderItems(order)) {
      const med = findOrderMedicine(rx);
      const sellType: 'unit' | 'box' = rx.sellType === 'box' ? 'box' : 'unit';
      const quantity = Math.max(1, Math.floor(Number(rx.quantity || 1)));
      const unitsPerBox = Math.max(1, Number(med?.unitsPerBox) || Number(rx.unitsPerBox) || 1);
      const unitsNeeded = quantity * (sellType === 'box' ? unitsPerBox : 1);
      if (!med || Number(med.stock || 0) < unitsNeeded) {
        unavailable.push(`${rx.name || 'Unknown item'} (${unitsNeeded} unit(s) needed)`);
        continue;
      }
      const cartItemId = `${med.id}-${sellType}`;
      const price = Number(sellType === 'box' ? (med.retailPrice || med.price) : (med.unitPrice || med.price)) || 0;
      const existing = newItems.find(item => item.cartItemId === cartItemId);
      if (existing) {
        existing.quantity += quantity;
        existing.requestedQuantity += quantity;
        existing.total = existing.quantity * existing.price;
        continue;
      }
      newItems.push({
        cartItemId,
        medicineId: med.id,
        name: med.name,
        category: med.category || 'Medicine',
        sellType,
        price,
        costPrice: med.costPrice || 0,
        quantity,
        requestedQuantity: quantity,
        linkedOrderItem: true,
        discountType: 'rs' as 'rs' | 'pct',
        discountValue: 0,
        itemDiscount: 0,
        total: price * quantity,
        unitsPerBox,
        rxNote: `${rx.dosage || ''} ${rx.frequency || ''} ${rx.duration || ''}`.trim(),
      });
    }
    if (order.fulfillmentMode === 'billing' && unavailable.length > 0) {
      setStockError(`Cannot load this IPD order: ${unavailable.join(', ')}.`);
      setTimeout(() => setStockError(''), 6000);
      return;
    }
    if (!newItems.length) {
      setStockError('No requested items can currently be loaded from pharmacy stock.');
      setTimeout(() => setStockError(''), 4500);
      return;
    }
    setCart(newItems);
    setActivePharmacyOrder(order);
    setCustomerType('hospital');
    setSelectedCustomer(null);
    setCustomerSearch('');
    setOrderDiscount(0);
    setAmountPaid('');
    setShowRxModal(false);
    setMobileTab('cart');
  };

  const clearLoadedOrder = () => {
    setCart([]);
    setActivePharmacyOrder(null);
    setOrderDiscount(0);
    setAmountPaid('');
    setSelectedCustomer(null);
    setCustomerSearch('');
    setMobileTab('medicines');
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (rejectOverDiscountCap(orderDiscount)) return;
    if (cart.some(item => rejectOverDiscountCap(discountPercentFor(item.discountType, item.discountValue, item.quantity, item.price)))) return;
    try {
      const checkoutAt = new Date().toISOString();
      const saleDate = isAdmin
        ? new Date(`${adminSaleDate || todayInput}T${new Date().toTimeString().slice(0, 8)}`).toISOString()
        : checkoutAt;
      const isBackdated = saleDate.slice(0, 10) !== checkoutAt.slice(0, 10);
      const saleData: any = {
        items: cart.map(item => ({ ...item })), grossSubtotal, totalItemDiscounts,
        subtotal: subtotalAfterItemDisc, orderDiscount: orderDiscountAmount,
        orderDiscountPercent: orderDiscount,
        discount: orderDiscountAmount + totalItemDiscounts, total: grandTotal,
        amountPaid: effectiveAmountPaid, pendingAmount,
        date: saleDate, createdAt: checkoutAt, enteredBy: auth.currentUser?.uid || '',
        isBackdated, customerType,
        cashierId: auth.currentUser?.uid,
      };
      if (selectedCustomer) {
        saleData.customerId    = selectedCustomer.id;
        saleData.customerName  = selectedCustomer.name;
        saleData.customerPhone = selectedCustomer.phone || '';
      }
      if (activePharmacyOrder) {
        saleData.pharmacyOrderId = activePharmacyOrder.id;
        saleData.linkedPharmacyOrderId = activePharmacyOrder.id;
        saleData.source = activePharmacyOrder.source || 'pharmacy_order';
        saleData.fulfillmentMode = 'billing';
        saleData.admissionId = activePharmacyOrder.admissionId || '';
        saleData.patientId = activePharmacyOrder.patientId || '';
        saleData.patientName = activePharmacyOrder.patientName || '';
        saleData.patientMRN = activePharmacyOrder.patientMRN || '';
        saleData.wardId = activePharmacyOrder.wardId || '';
        saleData.wardName = activePharmacyOrder.wardName || '';
        saleData.bedId = activePharmacyOrder.bedId || '';
        saleData.bedNo = activePharmacyOrder.bedNo || '';
        saleData.customerName = activePharmacyOrder.patientName || saleData.customerName || 'Hospital Patient';
        delete saleData.customerId;
        delete saleData.customerPhone;
      }
      const saleRef = doc(collection(db, 'sales'));
      await runTransaction(db, async (tx) => {
        let currentOrder: any = null;
        let orderRef: ReturnType<typeof doc> | null = null;
        let treatmentRef: ReturnType<typeof doc> | null = null;
        if (activePharmacyOrder) {
          orderRef = doc(db, 'pharmacyOrders', activePharmacyOrder.id);
          const orderSnap = await tx.get(orderRef);
          if (!orderSnap.exists() || orderSnap.data().status !== 'pending') {
            throw new Error('This pharmacy order is no longer pending. Clear the cart and reload it.');
          }
          currentOrder = orderSnap.data();
          if (currentOrder.bedTreatmentId) {
            treatmentRef = doc(db, 'bedTreatments', currentOrder.bedTreatmentId);
            const treatmentSnap = await tx.get(treatmentRef);
            if (!treatmentSnap.exists() || treatmentSnap.data().fulfillmentStatus !== 'pending') {
              throw new Error('The linked IPD care entry is no longer pending.');
            }
          }
          if (currentOrder.fulfillmentMode === 'billing') {
            for (const expected of getOrderItems(currentOrder)) {
              const sellType = expected.sellType === 'box' ? 'box' : 'unit';
              const expectedQuantity = Math.max(1, Math.floor(Number(expected.quantity || 1)));
              const loaded = cart.find(item => item.medicineId === expected.medicineId && item.sellType === sellType);
              if (!loaded || Number(loaded.quantity) !== expectedQuantity) {
                throw new Error(`Loaded quantity for ${expected.name || 'an IPD item'} no longer matches the pharmacy order.`);
              }
            }
          }
        }
        const requestedStock = new Map<string, { name: string; unitsToDeduct: number }>();
        for (const item of cart) {
          const unitsToDeduct = item.quantity * (item.sellType === 'box' ? item.unitsPerBox : 1);
          const existing = requestedStock.get(item.medicineId);
          requestedStock.set(item.medicineId, {
            name: item.name,
            unitsToDeduct: (existing?.unitsToDeduct || 0) + unitsToDeduct,
          });
        }
        const stockUpdates: { medRef: ReturnType<typeof doc>; unitsToDeduct: number }[] = [];
        for (const [medicineId, requested] of requestedStock) {
          const medRef = doc(db, 'medicines', medicineId);
          const medSnap = await tx.get(medRef);
          if (!medSnap.exists()) throw new Error(`Medicine not found: ${requested.name}`);

          const currentStock = Number(medSnap.data().stock || 0);
          if (currentStock < requested.unitsToDeduct) {
            throw new Error(`Not enough stock for ${requested.name}. Available: ${currentStock}, needed: ${requested.unitsToDeduct}.`);
          }
          stockUpdates.push({ medRef, unitsToDeduct: requested.unitsToDeduct });
        }

        stockUpdates.forEach(({ medRef, unitsToDeduct }) => {
          tx.update(medRef, { stock: increment(-unitsToDeduct) });
        });
        tx.set(saleRef, saleData);
        if (selectedCustomer && !activePharmacyOrder && pendingAmount > 0) {
          tx.update(doc(db, 'customers', selectedCustomer.id), { creditBalance: increment(pendingAmount) });
        }
        if (orderRef) {
          const fulfilledAt = new Date().toISOString();
          tx.update(orderRef, {
            status: 'dispensed',
            dispensedAt: fulfilledAt,
            dispensedBy: auth.currentUser?.uid || '',
            saleId: saleRef.id,
          });
          if (treatmentRef) {
            tx.update(treatmentRef, {
              fulfillmentStatus: 'fulfilled',
              fulfilledAt,
              fulfilledBy: auth.currentUser?.uid || '',
              saleId: saleRef.id,
            });
          }
        }
      });
      const receipt = { ...saleData, id: saleRef.id };
      setLastReceipt(receipt);
      setCart([]); setOrderDiscount(0); setAmountPaid('');
      setActivePharmacyOrder(null);
      setSelectedCustomer(null); setCustomerSearch('');
      setAdminSaleDate(todayInput);
      setMobileTab('medicines');
      setTimeout(() => handlePrint(receipt), 500);
    } catch (error: any) {
      setStockError(error?.message || handleFirestoreError(error, OperationType.CREATE, 'sales'));
      setTimeout(() => setStockError(''), 5000);
    }
  };

  const formatStock = (stock: number, unitsPerBox: number) => {
    if (!unitsPerBox || unitsPerBox <= 1) return `${stock} Units`;
    const boxes = Math.floor(stock / unitsPerBox);
    const loose = stock % unitsPerBox;
    if (boxes > 0 && loose > 0) return `${boxes} Box, ${loose} Loose`;
    if (boxes > 0) return `${boxes} Box`;
    return `${loose} Loose`;
  };

  // ── Shared panel components ───────────────────────────────────────────────

  const MedicinesPanel = () => (
    <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-4 border-b border-gray-100">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search medicines by name or batch..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
            />
          </div>
          <button
            onClick={() => { setShowRxModal(true); setRxSearch(''); }}
            className="relative flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 shrink-0"
          >
            <ClipboardList className="w-4 h-4" />
            Load Rx
            {pharmacyOrders.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {pharmacyOrders.length > 9 ? '9+' : pharmacyOrders.length}
              </span>
            )}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filteredMedicines.map(med => (
            <div key={med.id} className="p-3 rounded-xl border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all bg-white flex flex-col">
              <div className="flex-1">
                <h3 className="font-bold text-gray-900 line-clamp-2 text-sm leading-tight">{med.name}</h3>
                <p className="text-[11px] text-gray-400 mt-0.5">{med.form} • {med.batchNo}</p>
                <p className="text-[11px] font-semibold text-blue-600 mt-1">{formatStock(med.stock, med.unitsPerBox)}</p>
                {med.costPrice > 0 && (
                  <div className="mt-1.5 inline-flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-md px-1.5 py-0.5">
                    <Tag className="w-2.5 h-2.5 text-amber-500 shrink-0" />
                    <span className="text-[10px] font-semibold text-amber-700 leading-none">Cost {formatCurrency(med.costPrice)}</span>
                  </div>
                )}
              </div>
              <div className="mt-2.5 flex flex-col gap-1.5">
                {med.unitsPerBox > 1 ? (
                  <div className="flex gap-1.5">
                    <button onClick={() => addToCart(med, 'box')}
                      className="flex-1 bg-blue-50 text-blue-700 py-1.5 rounded-md text-[11px] font-bold hover:bg-blue-100 border border-blue-100 text-center leading-snug">
                      + Box<br /><span className="font-normal text-[10px]">{formatCurrency(med.retailPrice || med.price)}</span>
                    </button>
                    <button onClick={() => addToCart(med, 'unit')}
                      className="flex-1 bg-green-50 text-green-700 py-1.5 rounded-md text-[11px] font-bold hover:bg-green-100 border border-green-100 text-center leading-snug">
                      + Unit<br /><span className="font-normal text-[10px]">{formatCurrency(med.unitPrice || med.price)}</span>
                    </button>
                  </div>
                ) : (
                  <button onClick={() => addToCart(med, 'box')}
                    className="w-full bg-blue-50 text-blue-700 py-2 rounded-md text-xs font-bold hover:bg-blue-100 border border-blue-100">
                    Add — {formatCurrency(med.retailPrice || med.price)}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const CartPanel = () => (
    <div className="flex-1 md:w-96 md:flex-none bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col">
      {/* Cart header */}
      <div className="p-4 border-b border-gray-100 bg-gray-50 space-y-3">
        <h2 className="text-lg font-bold text-gray-900 hidden md:block">Current Sale</h2>

        {/* Sale type toggle */}
        <div className="flex bg-white rounded-lg p-1 border border-gray-200">
          <button onClick={() => handleCustomerTypeChange('customer')} disabled={Boolean(activePharmacyOrder)}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors disabled:opacity-40 ${customerType === 'customer' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
            Customer
          </button>
          <button onClick={() => handleCustomerTypeChange('hospital')}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${customerType === 'hospital' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
            Hospital
          </button>
        </div>

        {isAdmin && (
          <div className="bg-white border border-gray-200 rounded-lg px-3 py-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Sale Date</label>
            <input
              type="date"
              value={adminSaleDate}
              onChange={e => setAdminSaleDate(e.target.value || todayInput)}
              className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {adminSaleDate !== todayInput && (
              <p className="text-[11px] text-amber-600 mt-1">This sale will appear in reports for the selected date.</p>
            )}
          </div>
        )}

        {/* Customer selection */}
        <div ref={customerDropdownRef} className={`relative ${activePharmacyOrder ? 'pointer-events-none opacity-50' : ''}`}>
          <div className="flex items-center gap-1.5 mb-1">
            <User className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs font-medium text-gray-500">
              Customer <span className="text-gray-400 font-normal">(optional)</span>
            </span>
            {selectedCustomer && (
              <button onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); setShowCreateForm(false); }}
                className="ml-auto text-xs text-red-500 hover:text-red-700 flex items-center gap-0.5">
                <UserX className="w-3 h-3" /> Remove
              </button>
            )}
          </div>

          {selectedCustomer ? (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <UserCheck className="w-4 h-4 text-blue-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-blue-800 truncate">{selectedCustomer.name}</p>
                {selectedCustomer.phone && <p className="text-xs text-blue-500">{selectedCustomer.phone}</p>}
                {(selectedCustomer.creditBalance || 0) > 0 && (
                  <p className="text-xs text-red-600 font-medium mt-0.5">Outstanding: {formatCurrency(selectedCustomer.creditBalance)}</p>
                )}
              </div>
            </div>
          ) : canCreateCustomers && showCreateForm ? (
            <div className="border border-blue-300 bg-blue-50 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-blue-700 flex items-center gap-1">
                  <UserPlus className="w-3.5 h-3.5" /> New Customer
                </span>
                <button onClick={() => { setShowCreateForm(false); setNewCustName(''); setNewCustPhone(''); }}
                  className="text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
              </div>
              <input type="text" placeholder="Full name *" value={newCustName}
                onChange={e => setNewCustName(e.target.value)} autoFocus
                className="w-full px-2.5 py-1.5 border border-blue-200 rounded-md text-xs focus:outline-none focus:border-blue-400 bg-white" />
              <input type="text" placeholder="Phone number (optional)" value={newCustPhone}
                onChange={e => setNewCustPhone(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateCustomer(); }}
                className="w-full px-2.5 py-1.5 border border-blue-200 rounded-md text-xs focus:outline-none focus:border-blue-400 bg-white" />
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setShowCreateForm(false); setNewCustName(''); setNewCustPhone(''); }}
                  className="flex-1 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-md hover:bg-gray-100">Cancel</button>
                <button onClick={handleCreateCustomer} disabled={!newCustName.trim() || savingCustomer}
                  className="flex-1 py-1.5 text-xs font-bold bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1">
                  {savingCustomer ? <span className="animate-pulse">Saving…</span> : <><Check className="w-3 h-3" /> Save & Select</>}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Search customer by name/phone…" value={customerSearch}
                  onChange={e => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); }}
                  onFocus={() => setShowCustomerDropdown(true)}
                  className="w-full pl-8 pr-8 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
              {showCustomerDropdown && (customerSearch.length > 0 || filteredCustomers.length > 0) && (
                <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-40 mt-1 max-h-52 overflow-y-auto">
                  {filteredCustomers.map(c => (
                    <button key={c.id}
                      onPointerDown={e => { e.preventDefault(); setSelectedCustomer(c); setCustomerSearch(''); setShowCustomerDropdown(false); }}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{c.name}</p>
                        {c.phone && <p className="text-xs text-gray-400">{c.phone}</p>}
                      </div>
                      {c.creditBalance > 0 && <span className="text-xs text-red-600 font-medium shrink-0">Due {formatCurrency(c.creditBalance)}</span>}
                    </button>
                  ))}
                  {canCreateCustomers && <button onPointerDown={e => { e.preventDefault(); setNewCustName(customerSearch); setShowCreateForm(true); setShowCustomerDropdown(false); }}
                    className="w-full text-left px-3 py-2.5 hover:bg-green-50 flex items-center gap-2 text-green-700 border-t border-gray-100 bg-green-50/50">
                    <UserPlus className="w-4 h-4 shrink-0" />
                    <div>
                      <p className="text-xs font-bold">{customerSearch.trim() ? `Create "${customerSearch.trim()}"` : 'Create new customer'}</p>
                      <p className="text-[10px] text-gray-400">Add to customer list & select</p>
                    </div>
                  </button>}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {activePharmacyOrder && (
        <div className="mx-3 mt-3 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
          <ClipboardList className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-blue-900">Loaded pharmacy order</p>
            <p className="text-xs text-blue-700 truncate">{activePharmacyOrder.patientName || 'Hospital patient'}{activePharmacyOrder.patientMRN ? ` | ${activePharmacyOrder.patientMRN}` : ''}</p>
          </div>
          <button onClick={clearLoadedOrder} className="text-xs font-semibold text-red-600 hover:text-red-700 shrink-0">Clear</button>
        </div>
      )}

      {/* Cart items */}
      <div className="flex-1 overflow-auto p-3 space-y-2">
        {cart.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 py-12">
            <ShoppingCart className="w-12 h-12 mb-2 opacity-20" />
            <p className="text-sm">Cart is empty</p>
            <button onClick={() => setMobileTab('medicines')}
              className="mt-3 text-xs text-blue-600 underline md:hidden">
              Browse medicines →
            </button>
          </div>
        ) : cart.map(item => (
          <div key={item.cartItemId} className="p-3 border border-gray-100 rounded-lg bg-white hover:border-gray-200 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm truncate">{item.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${item.sellType === 'box' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                    {item.sellType}
                  </span>
                  <span className="text-[10px] text-gray-400">{formatCurrency(item.price)} each</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="font-bold text-sm text-gray-900 whitespace-nowrap">{formatCurrency(item.total)}</span>
                {!item.linkedOrderItem && (
                  <button onClick={() => removeFromCart(item.cartItemId)} className="p-1 text-red-400 hover:bg-red-50 rounded" title="Remove item">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            {/* Qty */}
            {item.linkedOrderItem ? (
              <div className="w-fit rounded-md border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">Requested quantity: {item.quantity}</div>
            ) : (
              <div className="flex items-center border border-gray-200 rounded-md bg-gray-50 w-fit">
                <button onClick={() => updateQuantity(item.cartItemId, -1)} className="px-2 py-1.5 hover:bg-gray-200 text-gray-600 rounded-l-md">
                  <Minus className="w-3 h-3" />
                </button>
                <span className="w-8 text-center text-sm font-semibold">{item.quantity}</span>
                <button onClick={() => updateQuantity(item.cartItemId, 1)} className="px-2 py-1.5 hover:bg-gray-200 text-gray-600 rounded-r-md">
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            )}
            {/* Discount */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <div className="flex items-center bg-gray-100 rounded-md p-0.5 shrink-0">
                  <button onClick={() => updateItemDiscount(item.cartItemId, 'rs', item.discountType === 'pct' ? 0 : item.discountValue)}
                    className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${item.discountType === 'rs' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                    <DollarSign className="w-2.5 h-2.5" />Rs
                  </button>
                  <button onClick={() => updateItemDiscount(item.cartItemId, 'pct', item.discountType === 'rs' ? 0 : item.discountValue)}
                    className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${item.discountType === 'pct' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                    <Percent className="w-2.5 h-2.5" />%
                  </button>
                </div>
                <Tag className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[11px] text-gray-500 shrink-0">{item.discountType === 'pct' ? 'Disc %' : 'Disc Rs.'}</span>
                <input type="number" min="0" step={item.discountType === 'pct' ? '0.1' : '1'}
                  max={item.discountType === 'pct' ? '100' : undefined}
                  value={item.discountValue || ''} placeholder="0"
                  onChange={e => updateItemDiscount(item.cartItemId, item.discountType, parseFloat(e.target.value) || 0)}
                  className="flex-1 min-w-0 text-right text-xs p-1 border border-orange-200 rounded focus:outline-none focus:border-orange-400 bg-orange-50" />
              </div>
              {item.itemDiscount > 0 && (
                <div className="flex justify-between items-center text-[11px] text-orange-600">
                  <span>{item.discountType === 'pct' ? `${item.discountValue}% = -${formatCurrency(item.itemDiscount)}` : `-${formatCurrency(item.itemDiscount)} discount`}</span>
                  <span className="text-gray-500">Net: {formatCurrency(item.total)}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Totals + Checkout */}
      <div className="p-4 border-t border-gray-100 bg-gray-50 space-y-2">
        <div className="flex justify-between text-sm text-gray-600">
          <span>Subtotal</span><span>{formatCurrency(grossSubtotal)}</span>
        </div>
        {totalItemDiscounts > 0 && (
          <div className="flex justify-between text-sm text-orange-600">
            <span>Item Discounts</span><span>-{formatCurrency(totalItemDiscounts)}</span>
          </div>
        )}
        <div className="flex justify-between items-center text-sm text-gray-600">
          <span>Order Discount</span>
          <div className="flex items-center gap-1">
            <input type="number" min="0" max="100" value={orderDiscount || ''} placeholder="0"
              onChange={e => {
                const next = Number(e.target.value);
                if (rejectOverDiscountCap(next)) return;
                setOrderDiscount(next);
              }}
              className="w-14 p-1 text-right border border-gray-200 rounded focus:outline-none focus:border-blue-400 text-sm bg-white" />
            <span className="text-gray-400">%</span>
          </div>
        </div>
        {orderDiscountAmount > 0 && (
          <div className="flex justify-between text-sm text-red-500">
            <span>Order Discount Amount</span><span>-{formatCurrency(orderDiscountAmount)}</span>
          </div>
        )}
        <div className="pt-2 border-t border-gray-200 flex justify-between items-center">
          <span className="font-bold text-gray-900">Total</span>
          <span className="text-2xl font-bold text-blue-600">{formatCurrency(grandTotal)}</span>
        </div>
        <div className="border border-dashed border-gray-300 rounded-lg p-3 space-y-2 bg-white">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Payment</p>
          <div className="flex justify-between items-center text-sm text-gray-600">
            <span>Amount Paid (Rs)</span>
            <input type="number" min="0" step="1" value={amountPaid}
              placeholder={formatCurrency(grandTotal)}
              onChange={e => setAmountPaid(e.target.value === '' ? '' : parseFloat(e.target.value))}
              className="w-28 p-1.5 text-right border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 text-sm font-medium bg-gray-50" />
          </div>
          {pendingAmount > 0 ? (
            <div className="flex justify-between items-center text-sm font-bold text-red-700 bg-red-50 px-3 py-2 rounded-lg border border-red-100">
              <span>Pending Amount</span><span>{formatCurrency(pendingAmount)}</span>
            </div>
          ) : amountPaid !== '' ? (
            <div className="text-xs text-green-700 bg-green-50 px-3 py-2 rounded-lg">✓ Fully Paid</div>
          ) : null}
          {pendingAmount > 0 && selectedCustomer && (
            <p className="text-xs text-orange-600 bg-orange-50 px-2 py-1.5 rounded">
              {formatCurrency(pendingAmount)} will be added to <strong>{selectedCustomer.name}'s</strong> outstanding balance.
            </p>
          )}
          {pendingAmount > 0 && !selectedCustomer && (
            <p className="text-xs text-gray-400 italic">Select a customer above to track this pending amount.</p>
          )}
        </div>
        <button onClick={handleCheckout} disabled={cart.length === 0}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed mt-1">
          <Printer className="w-5 h-5" /> Checkout & Print
        </button>
      </div>
    </div>
  );

  return (
    <>
      {showPrintAlert && (
        <div className="fixed top-4 right-4 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg z-50">
          <p className="font-medium">Printing is blocked in this preview.</p>
          <p className="text-sm opacity-90">Press Ctrl+P / Cmd+P to print.</p>
        </div>
      )}
      {stockError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span className="font-medium">{stockError}</span>
        </div>
      )}

      {showRxModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="font-bold text-gray-900 text-lg">Pending Prescriptions</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {pharmacyOrders.length} prescription{pharmacyOrders.length !== 1 ? 's' : ''} waiting - select one to load into cart
                </p>
              </div>
              <button onClick={() => setShowRxModal(false)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg" aria-label="Close prescriptions">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 border-b border-gray-100">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={rxSearch}
                  onChange={e => setRxSearch(e.target.value)}
                  placeholder="Search by patient name or MRN..."
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {pharmacyOrders.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">No pending prescriptions</p>
                  <p className="text-xs mt-1">Doctors send prescriptions from the Hospital OPD</p>
                </div>
              ) : (
                pharmacyOrders
                  .filter(o => !rxSearch ||
                    o.patientName?.toLowerCase().includes(rxSearch.toLowerCase()) ||
                    o.patientMRN?.includes(rxSearch))
                  .map(order => {
                    const orderItems = getOrderItems(order);
                    const availability = orderItems.map((item: any) => {
                      const medicine = findOrderMedicine(item);
                      const quantity = Math.max(1, Math.floor(Number(item.quantity || 1)));
                      const unitsPerBox = Math.max(1, Number(medicine?.unitsPerBox) || Number(item.unitsPerBox) || 1);
                      const unitsNeeded = quantity * (item.sellType === 'box' ? unitsPerBox : 1);
                      return { item, medicine, unitsNeeded, inStock: Boolean(medicine) && Number(medicine.stock || 0) >= unitsNeeded };
                    });
                    const matchCount = availability.filter(item => item.inStock).length;
                    const canLoad = order.fulfillmentMode === 'billing' ? matchCount === orderItems.length && orderItems.length > 0 : matchCount > 0;
                    return (
                      <div key={order.id} className="border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-900">{order.patientName}</span>
                              <span className="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{order.patientMRN}</span>
                              {order.patientAge && <span className="text-xs text-gray-500">{order.patientAge}y - {order.patientGender}</span>}
                              {order.fulfillmentMode === 'billing' && <span className="text-[10px] font-bold uppercase text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">IPD</span>}
                            </div>
                            {order.doctorName && <p className="text-xs text-gray-500 mt-0.5">Dr. {order.doctorName} - {order.department}</p>}
                            {order.admissionId && <p className="text-xs text-gray-500 mt-0.5">{order.wardName || 'IPD'}{order.bedNo ? ` | Bed ${order.bedNo}` : ''}</p>}
                            {order.diagnosis && <p className="text-xs text-blue-600 mt-1 font-medium">Dx: {order.diagnosis}</p>}
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {availability.map(({ item, inStock }, i: number) => {
                                return (
                                  <span key={i} className={`text-xs px-2 py-0.5 rounded-full font-medium ${inStock ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-400 line-through'}`}>
                                    {item.name}{item.quantity ? ` x ${item.quantity} ${item.sellType || 'unit'}` : ''}
                                  </span>
                                );
                              })}
                            </div>
                            <p className="text-[11px] text-gray-400 mt-1.5">
                              {matchCount} of {orderItems.length} medicines available in the requested quantity
                            </p>
                          </div>
                          <button
                            onClick={() => loadPrescription(order)}
                            disabled={!canLoad || Boolean(activePharmacyOrder) || cart.length > 0}
                            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                          >
                            <CheckCircle className="w-4 h-4" />
                            Load
                          </button>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── DESKTOP LAYOUT: side-by-side ── */}
      <div className="hidden md:flex h-full gap-6 print:hidden">
        {MedicinesPanel()}
        <div className="w-96 flex flex-col">
          {CartPanel()}
        </div>
      </div>

      {/* ── MOBILE LAYOUT: tab switcher ── */}
      <div className="flex md:hidden flex-col h-full print:hidden">
        {/* Tab bar */}
        <div className="flex bg-white rounded-xl shadow-sm border border-gray-100 mb-3 p-1 gap-1 shrink-0">
          <button
            onClick={() => setMobileTab('medicines')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors ${mobileTab === 'medicines' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            <Pill className="w-4 h-4" /> Medicines
          </button>
          <button
            onClick={() => setMobileTab('cart')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors ${mobileTab === 'cart' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            <ShoppingCart className="w-4 h-4" />
            Cart
            {cart.length > 0 && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${mobileTab === 'cart' ? 'bg-white text-blue-600' : 'bg-blue-600 text-white'}`}>
                {cart.length}
              </span>
            )}
          </button>
        </div>

        {/* Both panels stay mounted — only visibility toggled — so search input never loses focus */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className={mobileTab === 'medicines' ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>
            {MedicinesPanel()}
          </div>
          <div className={mobileTab === 'cart' ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>
            {CartPanel()}
          </div>
        </div>
      </div>
    </>
  );
}
