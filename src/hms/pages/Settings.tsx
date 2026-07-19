import { useState, useEffect } from 'react';
import { collection, doc, getDoc, getDocs, query, runTransaction, setDoc, where } from '../../lib/firestoreCompat';
import { auth, db, registerUser, usernameToEmail } from '../../firebase';
import { nowISO } from '../lib/utils';
import { Building2, Download, Upload, Trash2, AlertTriangle, UserPlus, X, Lock, Eye, EyeOff, Bot, CheckCircle, RefreshCw, Printer } from 'lucide-react';
import { AppUpdater } from '../../components/AppUpdater';
import { ChangePasswordForm } from '../../components/ChangePasswordForm';
import { getGeminiKey, setGeminiKey } from '../lib/translate';
import {
  DEFAULT_PRESCRIPTION_PRINT_SETTINGS,
  getPrescriptionPrintSettings,
  savePrescriptionPrintSettings,
  type PrescriptionPrintSettings,
} from '../lib/prescriptionPrintSettings';
import { deleteAllAppData, dryRunAppDataImport, exportAllAppData, GLOBAL_DATA_COLLECTIONS, restoreAllAppData, summarizeBackup } from '../../lib/dataSync';
import { DEFAULT_NON_ADMIN_DISCOUNT_PERCENT, REQUESTED_USER_PASSWORD, REQUESTED_USERS } from '../../lib/permissions';
import { apiRequest, createIdempotencyKey } from '../../lib/hostingerApi';

const ROLES = ['admin','receptionist','doctor','nurse','pharmacist','lab_technician','cashier'];
type PrintSectionKey = 'name' | 'age' | 'date' | 'clinical' | 'medicines' | 'vitals';
type MirrorStatus = {
  pendingCount: number;
  oldestPendingAt?: string | null;
  lastSuccessAt?: string | null;
  lastRun?: { status?: string; started_at?: string; synced_count?: number; retry_count?: number; error_message?: string } | null;
};

const PRINT_SECTIONS: { key: PrintSectionKey; title: string; hint: string }[] = [
  { key: 'name', title: 'Patient Name', hint: 'Name field on top right' },
  { key: 'age', title: 'Age', hint: 'Age/number field on top center' },
  { key: 'date', title: 'Date', hint: 'Date field on top left' },
  { key: 'clinical', title: 'Complaint / Diagnosis', hint: 'Clinical notes column' },
  { key: 'medicines', title: 'Medicines', hint: 'Main prescription area' },
  { key: 'vitals', title: 'Vitals', hint: 'BP, temperature, weight, oxygen, pulse area' },
];

function F({ label, value, onChange, type = 'text', placeholder = '' }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  );
}

const emptyHospital = { name: 'GMH Suite', address: '', phone: '', email: '', ntn: '', bankAccount: '', footerNote: 'Thank you for choosing our hospital.', consultationFee: '500' };
const emptyUser = { name: '', email: '', password: '', role: 'receptionist' };

export function Settings() {
  const [hospital, setHospital] = useState(emptyHospital);
  const [savingHospital, setSavingHospital] = useState(false);
  const [hospitalMsg, setHospitalMsg] = useState('');
  const [permissionSettings, setPermissionSettings] = useState({ maxNonAdminDiscountPercent: String(DEFAULT_NON_ADMIN_DISCOUNT_PERCENT) });
  const [savingPermissionSettings, setSavingPermissionSettings] = useState(false);
  const [permissionSettingsMsg, setPermissionSettingsMsg] = useState('');

  // Export
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  // Import
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [pendingImport, setPendingImport] = useState<any>(null);
  const [showImportConfirm, setShowImportConfirm] = useState(false);

  // Clear data
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearText, setClearText] = useState('');
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState('');

  const [geminiKey, setGeminiKeyState] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyMsg, setKeyMsg] = useState('');
  const [printSettings, setPrintSettings] = useState<PrescriptionPrintSettings>(DEFAULT_PRESCRIPTION_PRINT_SETTINGS);
  const [printSettingsMsg, setPrintSettingsMsg] = useState('');

  const saveGeminiKey = () => {
    setGeminiKey(geminiKey);
    setKeyMsg('✓ API key saved!');
    setTimeout(() => setKeyMsg(''), 3000);
  };

  const savePrintSettings = () => {
    savePrescriptionPrintSettings(printSettings);
    setPrintSettingsMsg('✓ Prescription print settings saved!');
    setTimeout(() => setPrintSettingsMsg(''), 3000);
  };

  const setPrintSectionOffset = (section: PrintSectionKey, axis: 'offsetX' | 'offsetY', value: string) => {
    setPrintSettings(settings => ({
      ...settings,
      [section]: {
        ...settings[section],
        [axis]: Number(value) || 0,
      },
    }));
  };

  // New user
  const [showUserModal, setShowUserModal] = useState(false);
  const [userForm, setUserForm] = useState(emptyUser);
  const [creatingUser, setCreatingUser] = useState(false);
  const [userMsg, setUserMsg] = useState('');
  const [creatingRequestedUsers, setCreatingRequestedUsers] = useState(false);
  const [requestedUsersMsg, setRequestedUsersMsg] = useState('');
  const [repairPurchases, setRepairPurchases] = useState<any[]>([]);
  const [repairMedicines, setRepairMedicines] = useState<Record<string, any>>({});
  const [selectedRepairIds, setSelectedRepairIds] = useState<string[]>([]);
  const [loadingRepairs, setLoadingRepairs] = useState(false);
  const [applyingRepairs, setApplyingRepairs] = useState(false);
  const [repairMsg, setRepairMsg] = useState('');
  const [mirrorStatus, setMirrorStatus] = useState<MirrorStatus | null>(null);
  const [loadingMirror, setLoadingMirror] = useState(false);
  const [mirrorMsg, setMirrorMsg] = useState('');

  const loadMirrorStatus = async () => {
    setLoadingMirror(true);
    try {
      setMirrorStatus(await apiRequest<MirrorStatus>('/admin/sync'));
      setMirrorMsg('');
    } catch (e: any) {
      setMirrorMsg('Error: ' + (e.message || 'Could not load mirror status'));
    } finally {
      setLoadingMirror(false);
    }
  };

  const retryMirror = async () => {
    setLoadingMirror(true);
    setMirrorMsg('Re-queuing failed mirror events...');
    try {
      const result = await apiRequest<{ queued: number }>('/admin/sync/retry', {
        method: 'POST',
        body: JSON.stringify({ requestedAt: nowISO() }),
        idempotencyKey: createIdempotencyKey('mirror-retry'),
      });
      setMirrorMsg(`${result.queued} event(s) queued for the next five-hour mirror run.`);
      await loadMirrorStatus();
    } catch (e: any) {
      setMirrorMsg('Error: ' + (e.message || 'Could not re-queue mirror events'));
    } finally {
      setLoadingMirror(false);
    }
  };

  useEffect(() => {
    getDoc(doc(db, 'settings', 'hospital')).then(snap => {
      if (snap.exists()) setHospital({ ...emptyHospital, ...snap.data() });
    });
    getDoc(doc(db, 'settings', 'permissions')).then(snap => {
      if (snap.exists()) {
        setPermissionSettings({
          maxNonAdminDiscountPercent: String((snap.data() as any).maxNonAdminDiscountPercent ?? DEFAULT_NON_ADMIN_DISCOUNT_PERCENT),
        });
      }
    });
    setGeminiKeyState(getGeminiKey());
    setPrintSettings(getPrescriptionPrintSettings());
    void loadMirrorStatus();
  }, []);

  const saveHospital = async () => {
    setSavingHospital(true); setHospitalMsg('');
    try {
      await setDoc(doc(db, 'settings', 'hospital'), hospital, { merge: true });
      setHospitalMsg('✓ Saved successfully');
      setTimeout(() => setHospitalMsg(''), 3000);
    } catch (e: any) { setHospitalMsg('Error: ' + e.message); }
    finally { setSavingHospital(false); }
  };

  const savePermissionSettings = async () => {
    setSavingPermissionSettings(true);
    setPermissionSettingsMsg('');
    try {
      const maxNonAdminDiscountPercent = Math.max(0, Math.min(100, Number(permissionSettings.maxNonAdminDiscountPercent) || 0));
      await setDoc(doc(db, 'settings', 'permissions'), {
        maxNonAdminDiscountPercent,
        updatedAt: nowISO(),
      }, { merge: true });
      setPermissionSettings({ maxNonAdminDiscountPercent: String(maxNonAdminDiscountPercent) });
      setPermissionSettingsMsg('Saved successfully');
      setTimeout(() => setPermissionSettingsMsg(''), 3000);
    } catch (e: any) {
      setPermissionSettingsMsg('Error: ' + e.message);
    } finally {
      setSavingPermissionSettings(false);
    }
  };

  const handleExport = async () => {
    setExporting(true); setExportMsg('Reading data...');
    try {
      const backup = await exportAllAppData(setExportMsg);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `gmh-suite-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      setExportMsg('Done: complete HMS + Pharmacy backup downloaded!');
      setTimeout(() => setExportMsg(''), 4000);
    } catch (e: any) { setExportMsg('Error: ' + e.message); }
    finally { setExporting(false); }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (!data.collections) throw new Error('Invalid backup format');
        setImportMsg('Validating backup IDs, counts, relationships, and hashes...');
        const validation = await dryRunAppDataImport(data);
        if (!validation.valid) throw new Error(validation.errors.join('; ') || 'Backup validation failed');
        const warningText = validation.warnings.length ? ` ${validation.warnings.length} relationship warning(s) found.` : '';
        setImportMsg(`Validated ${validation.totalDocuments} records across ${validation.collectionCount} collections.${warningText}`);
        setPendingImport(data); setShowImportConfirm(true);
      } catch (err: any) { setImportMsg('Invalid backup file: ' + err.message); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImport = async () => {
    if (!pendingImport) return;
    setImporting(true); setShowImportConfirm(false); setImportMsg('Importing...');
    try {
      const totalDocs = await restoreAllAppData(pendingImport, setImportMsg);
      setImportMsg(`Done: ${totalDocs} records restored across HMS and Pharmacy.`);
      setTimeout(() => setImportMsg(''), 5000);
    } catch (e: any) { setImportMsg('Error: ' + e.message); }
    finally { setImporting(false); setPendingImport(null); }
  };

  const handleClear = async () => {
    if (clearText !== 'DELETE ALL') return;
    setShowClearConfirm(false);
    setClearing(true);
    setClearMsg('Deleting all HMS and Pharmacy data...');
    try {
      const totalDocs = await deleteAllAppData(setClearMsg);
      setClearText('');
      setClearMsg(`Done: deleted ${totalDocs} records across HMS and Pharmacy.`);
      setTimeout(() => setClearMsg(''), 5000);
    } catch (e: any) { setClearMsg('Error: ' + e.message); }
    finally { setClearing(false); }
  };

  const handleCreateUser = async () => {
    if (!userForm.name || !userForm.email || !userForm.password || !userForm.role) { setUserMsg('All fields required.'); return; }
    setCreatingUser(true); setUserMsg('');
    try {
      const username = userForm.email.trim().toLowerCase().replace(/\s+/g, '.');
      const cred = await registerUser(username, userForm.password);
      await setDoc(doc(db, 'users', cred.user.uid), {
        name: userForm.name,
        username,
        email: usernameToEmail(username),
        role: userForm.role,
        app: 'hms',
        createdAt: nowISO(),
      });
      setUserMsg('✓ User created successfully!');
      setUserForm(emptyUser);
      setTimeout(() => { setUserMsg(''); setShowUserModal(false); }, 2000);
    } catch (e: any) { setUserMsg('Error: ' + (e.message || 'Could not create user')); }
    finally { setCreatingUser(false); }
  };

  const handleCreateRequestedUsers = async () => {
    setCreatingRequestedUsers(true);
    setRequestedUsersMsg('Creating or updating requested users...');
    const results: string[] = [];
    try {
      for (const requestedUser of REQUESTED_USERS) {
        const existingSnap = await getDocs(query(collection(db, 'users'), where('username', '==', requestedUser.username)));
        const userDoc = {
          name: requestedUser.name,
          username: requestedUser.username,
          email: usernameToEmail(requestedUser.username),
          role: requestedUser.role,
          app: 'custom',
          appAccess: requestedUser.appAccess,
          permissions: requestedUser.permissions,
          updatedAt: nowISO(),
        };

        if (!existingSnap.empty) {
          await setDoc(existingSnap.docs[0].ref, userDoc, { merge: true });
          results.push(`${requestedUser.name}: permissions updated`);
          continue;
        }

        try {
          const cred = await registerUser(requestedUser.username, REQUESTED_USER_PASSWORD);
          await setDoc(doc(db, 'users', cred.user.uid), {
            ...userDoc,
            createdAt: nowISO(),
          });
          results.push(`${requestedUser.name}: created`);
        } catch (e: any) {
          if (e?.code === 'auth/email-already-in-use') {
            results.push(`${requestedUser.name}: auth login already exists, but no user document was found`);
          } else {
            throw e;
          }
        }
      }
      setRequestedUsersMsg(results.join(' | '));
    } catch (e: any) {
      setRequestedUsersMsg('Error: ' + (e.message || 'Could not create requested users'));
    } finally {
      setCreatingRequestedUsers(false);
    }
  };

  const getPurchaseUnits = (purchase: any) => {
    const saved = Number(purchase.totalUnitsAdded ?? purchase.unitsAdded);
    if (Number.isFinite(saved) && saved > 0) return saved;
    const unitsPerBox = Number(purchase.unitsPerBox) || 1;
    const boxes = Number(purchase.boxesPurchased ?? purchase.boxes) || 0;
    const loose = Number(purchase.looseUnitsPurchased ?? purchase.looseUnits) || 0;
    return (boxes * unitsPerBox) + loose;
  };

  const loadPurchaseRepairs = async () => {
    setLoadingRepairs(true);
    setRepairMsg('');
    try {
      const [purchaseSnap, medicineSnap] = await Promise.all([
        getDocs(collection(db, 'purchases')),
        getDocs(collection(db, 'medicines')),
      ]);
      const medicineMap = Object.fromEntries(medicineSnap.docs.map(item => [item.id, { id: item.id, ...item.data() }]));
      const unverified = purchaseSnap.docs
        .map(item => ({ id: item.id, ...item.data() } as any))
        .filter(item => !item.stockAppliedAt && !item.stockRepairAppliedAt)
        .sort((a, b) => new Date(b.date || b.createdAt || 0).getTime() - new Date(a.date || a.createdAt || 0).getTime());
      setRepairMedicines(medicineMap);
      setRepairPurchases(unverified);
      setSelectedRepairIds([]);
      setRepairMsg(unverified.length ? `${unverified.length} unverified legacy purchase(s) found.` : 'No unverified legacy purchases found.');
    } catch (e: any) {
      setRepairMsg('Error: ' + (e.message || 'Could not load purchase records'));
    } finally {
      setLoadingRepairs(false);
    }
  };

  const getRepairDisabledReason = (purchase: any) => {
    if (!purchase.medicineId) return 'Missing medicine ID';
    if (!repairMedicines[purchase.medicineId]) return 'Medicine was deleted or is unavailable';
    if (!Number.isFinite(getPurchaseUnits(purchase)) || getPurchaseUnits(purchase) <= 0) return 'Invalid purchase quantity';
    if (purchase.stockAppliedAt || purchase.stockRepairAppliedAt) return 'Stock application is already recorded';
    return '';
  };

  const applyPurchaseRepairs = async () => {
    if (!selectedRepairIds.length) return;
    const confirmed = window.confirm(
      `Add stock for ${selectedRepairIds.length} selected purchase(s)? Only continue for purchases you know did not previously affect stock.`
    );
    if (!confirmed) return;

    setApplyingRepairs(true);
    setRepairMsg('Applying selected repairs...');
    let applied = 0;
    const failures: string[] = [];
    for (const purchaseId of selectedRepairIds) {
      try {
        await runTransaction(db, async tx => {
          const purchaseRef = doc(db, 'purchases', purchaseId);
          const purchaseSnap = await tx.get(purchaseRef);
          if (!purchaseSnap.exists()) throw new Error('Purchase record no longer exists');
          const purchase = purchaseSnap.data();
          if (purchase.stockAppliedAt || purchase.stockRepairAppliedAt) throw new Error('Stock was already applied or repaired');
          if (!purchase.medicineId) throw new Error('Medicine ID is missing');
          const units = getPurchaseUnits(purchase);
          if (!Number.isFinite(units) || units <= 0) throw new Error('Purchase quantity is invalid');

          const medicineRef = doc(db, 'medicines', purchase.medicineId);
          const medicineSnap = await tx.get(medicineRef);
          if (!medicineSnap.exists()) throw new Error('Medicine no longer exists');
          const stockBefore = Number(medicineSnap.data().stock || 0);
          const stockAfter = stockBefore + units;
          const repairedAt = nowISO();
          const repairedBy = auth.currentUser?.uid || 'admin';

          tx.update(medicineRef, { stock: stockAfter, updatedAt: repairedAt });
          tx.update(purchaseRef, {
            stockBefore,
            stockAfter,
            stockRepairBefore: stockBefore,
            stockRepairAfter: stockAfter,
            stockRepairAppliedAt: repairedAt,
            repairedBy,
          });
        });
        applied += 1;
      } catch (e: any) {
        failures.push(`${purchaseId.slice(0, 8)}: ${e.message || 'failed'}`);
      }
    }
    setApplyingRepairs(false);
    await loadPurchaseRepairs();
    setRepairMsg(failures.length
      ? `Applied ${applied} repair(s). Failed: ${failures.join('; ')}`
      : `Applied ${applied} stock repair(s) successfully.`);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Hospital Info */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-5">
          <Building2 className="w-5 h-5 text-blue-600" />
          <h2 className="font-semibold text-gray-900">Hospital Information</h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <F label="Hospital Name" value={hospital.name} onChange={(v: string) => setHospital(h => ({ ...h, name: v }))} />
          <F label="Phone" value={hospital.phone} onChange={(v: string) => setHospital(h => ({ ...h, phone: v }))} placeholder="+92 XXX XXXXXXX" />
          <F label="Email" value={hospital.email} onChange={(v: string) => setHospital(h => ({ ...h, email: v }))} type="email" />
          <F label="NTN / Registration No" value={hospital.ntn} onChange={(v: string) => setHospital(h => ({ ...h, ntn: v }))} />
          <F label="Default Consultation Fee (Rs.)" value={(hospital as any).consultationFee || '500'} onChange={(v: string) => setHospital(h => ({ ...h, consultationFee: v }))} type="number" placeholder="500" />
          <div className="col-span-2">
            <F label="Address" value={hospital.address} onChange={(v: string) => setHospital(h => ({ ...h, address: v }))} />
          </div>
          <div className="col-span-2">
            <F label="Receipt Footer Note" value={hospital.footerNote} onChange={(v: string) => setHospital(h => ({ ...h, footerNote: v }))} />
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button onClick={saveHospital} disabled={savingHospital}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
            {savingHospital ? 'Saving...' : 'Save Changes'}
          </button>
          {hospitalMsg && <span className={`text-sm font-medium ${hospitalMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{hospitalMsg}</span>}
        </div>
      </div>

      {/* Change Password */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-5">
          <Lock className="w-5 h-5 text-blue-600" />
          <h2 className="font-semibold text-gray-900">Change Password</h2>
        </div>
        <ChangePasswordForm />
      </div>

      {/* Firestore Disaster-Recovery Mirror */}
      <div className="bg-white rounded-xl border border-cyan-200 shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <RefreshCw className={`w-5 h-5 text-cyan-700 ${loadingMirror ? 'animate-spin' : ''}`} />
              <h2 className="font-semibold text-gray-900">Firestore Recovery Mirror</h2>
            </div>
            <p className="text-xs text-gray-500 mt-1">MySQL is the live database. Committed changes are copied to Firestore by the five-hour cron worker.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={loadMirrorStatus} disabled={loadingMirror}
              className="px-3 py-2 border border-cyan-200 text-cyan-800 rounded-lg text-sm font-medium hover:bg-cyan-50 disabled:opacity-50">
              Refresh
            </button>
            <button onClick={retryMirror} disabled={loadingMirror}
              className="px-3 py-2 bg-cyan-700 text-white rounded-lg text-sm font-medium hover:bg-cyan-800 disabled:opacity-50">
              Retry Failed
            </button>
          </div>
        </div>
        {mirrorStatus && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            <div className="border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-500">Waiting to mirror</p>
              <p className="text-xl font-semibold text-gray-900 mt-1">{mirrorStatus.pendingCount || 0}</p>
            </div>
            <div className="border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-500">Last successful event</p>
              <p className="text-sm font-semibold text-gray-900 mt-1">{mirrorStatus.lastSuccessAt ? new Date(mirrorStatus.lastSuccessAt).toLocaleString() : 'Not run yet'}</p>
            </div>
            <div className="border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-500">Last worker run</p>
              <p className="text-sm font-semibold text-gray-900 mt-1 capitalize">{mirrorStatus.lastRun?.status || 'Not run yet'}</p>
              {mirrorStatus.lastRun && <p className="text-xs text-gray-500 mt-1">{mirrorStatus.lastRun.synced_count || 0} synced, {mirrorStatus.lastRun.retry_count || 0} queued</p>}
            </div>
          </div>
        )}
        {mirrorMsg && <p className={`text-xs font-medium mt-3 ${mirrorMsg.startsWith('Error') ? 'text-red-600' : 'text-cyan-800'}`}>{mirrorMsg}</p>}
      </div>

      {/* User Management */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-violet-600" />
            <h2 className="font-semibold text-gray-900">Create Staff User</h2>
          </div>
          <button onClick={() => setShowUserModal(true)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700">
            <UserPlus className="w-4 h-4" /> Add User
          </button>
        </div>
        <p className="text-sm text-gray-500">Create login accounts for your staff. Each user will sign in with their email and password.</p>
        <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-violet-900">Requested access users</h3>
              <p className="text-xs text-violet-700 mt-0.5">Creates or updates haseeb, haider, sohail, and danyal with password {REQUESTED_USER_PASSWORD}.</p>
            </div>
            <button onClick={handleCreateRequestedUsers} disabled={creatingRequestedUsers}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-60">
              <UserPlus className="w-4 h-4" /> {creatingRequestedUsers ? 'Working...' : 'Create / Update'}
            </button>
          </div>
          {requestedUsersMsg && <p className={`text-xs mt-3 font-medium ${requestedUsersMsg.startsWith('Error') ? 'text-red-600' : 'text-violet-700'}`}>{requestedUsersMsg}</p>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {ROLES.map(r => (
            <span key={r} className="px-3 py-1 bg-gray-100 text-gray-600 text-xs rounded-full font-medium capitalize">{r.replace('_',' ')}</span>
          ))}
        </div>
      </div>

      {/* Permission Settings */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-5">
          <Lock className="w-5 h-5 text-emerald-600" />
          <h2 className="font-semibold text-gray-900">Permission Settings</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
          <F
            label="Max Non-Admin Discount (%)"
            type="number"
            value={permissionSettings.maxNonAdminDiscountPercent}
            onChange={(v: string) => setPermissionSettings({ maxNonAdminDiscountPercent: v })}
            placeholder="10"
          />
          <button onClick={savePermissionSettings} disabled={savingPermissionSettings}
            className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-60">
            {savingPermissionSettings ? 'Saving...' : 'Save Limit'}
          </button>
        </div>
        {permissionSettingsMsg && <p className={`text-sm mt-3 font-medium ${permissionSettingsMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>{permissionSettingsMsg}</p>}
      </div>

      {/* Purchase Stock Repair */}
      <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <h2 className="font-semibold text-gray-900">Purchase Stock Repair</h2>
            </div>
            <p className="text-xs text-gray-500 mt-1">Review older purchases that do not have a stock-application marker.</p>
          </div>
          <button
            onClick={loadPurchaseRepairs}
            disabled={loadingRepairs || applyingRepairs}
            className="flex items-center justify-center gap-2 px-4 py-2 border border-amber-300 text-amber-800 rounded-lg text-sm font-medium hover:bg-amber-50 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loadingRepairs ? 'animate-spin' : ''}`} /> {loadingRepairs ? 'Loading...' : 'Review Purchases'}
          </button>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          An unverified record is not proof that stock was missed. Select only purchases you know did not increase stock. Each repair is transactional and can be applied only once.
        </div>
        {repairPurchases.length > 0 && (
          <div className="mt-4 max-h-80 overflow-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
            {repairPurchases.map(purchase => {
              const medicine = repairMedicines[purchase.medicineId];
              const disabledReason = getRepairDisabledReason(purchase);
              const checked = selectedRepairIds.includes(purchase.id);
              return (
                <label key={purchase.id} className={`flex items-start gap-3 p-3 ${disabledReason ? 'bg-gray-50 text-gray-400' : 'hover:bg-gray-50 cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={Boolean(disabledReason) || applyingRepairs}
                    onChange={e => setSelectedRepairIds(ids => e.target.checked ? [...ids, purchase.id] : ids.filter(id => id !== purchase.id))}
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-gray-800">{purchase.medicineName || medicine?.name || 'Unknown medicine'}</span>
                      <span className="text-xs text-gray-500">{getPurchaseUnits(purchase)} unit(s)</span>
                      <span className="text-xs text-gray-400">{purchase.date || purchase.createdAt || 'Date unavailable'}</span>
                    </div>
                    <p className="text-xs mt-1 text-gray-500">Current stock: {medicine ? Number(medicine.stock || 0) : 'Unavailable'}{purchase.supplierName ? ` | Supplier: ${purchase.supplierName}` : ''}</p>
                    {disabledReason && <p className="text-xs mt-1 font-medium text-red-500">Cannot repair: {disabledReason}</p>}
                  </div>
                </label>
              );
            })}
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-4">
          {repairPurchases.length > 0 && (
            <button
              onClick={applyPurchaseRepairs}
              disabled={!selectedRepairIds.length || applyingRepairs}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
            >
              {applyingRepairs ? 'Applying...' : `Apply ${selectedRepairIds.length} Selected Repair(s)`}
            </button>
          )}
          {repairMsg && <p className={`text-xs font-medium ${repairMsg.startsWith('Error') || repairMsg.includes('Failed:') ? 'text-red-600' : 'text-gray-600'}`}>{repairMsg}</p>}
        </div>
      </div>

      {/* Backup & Restore */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-5">
          <Download className="w-5 h-5 text-green-600" />
          <h2 className="font-semibold text-gray-900">Backup & Restore</h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-1">Export Backup</h3>
            <p className="text-xs text-gray-500 mb-3">Download all HMS and Pharmacy data as one JSON file.</p>
            <button onClick={handleExport} disabled={exporting}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-60">
              <Download className="w-4 h-4" /> {exporting ? 'Exporting...' : 'Download Backup'}
            </button>
            {exportMsg && <p className={`text-xs mt-2 font-medium ${exportMsg.startsWith('Done') ? 'text-green-600' : 'text-gray-500'}`}>{exportMsg}</p>}
          </div>
          <div className="border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-1">Restore Backup</h3>
            <p className="text-xs text-gray-500 mb-3">Upload a suite backup to restore HMS and Pharmacy data.</p>
            <label className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 cursor-pointer w-fit">
              <Upload className="w-4 h-4" /> Choose File
              <input type="file" accept=".json" className="hidden" onChange={handleFileSelect} />
            </label>
            {importMsg && <p className={`text-xs mt-2 font-medium ${importMsg.startsWith('Done') ? 'text-green-600' : importMsg.startsWith('Error') ? 'text-red-500' : 'text-gray-500'}`}>{importMsg}</p>}
            {pendingImport && <p className="text-xs text-gray-400 mt-2">{summarizeBackup(pendingImport)}</p>}
          </div>
        </div>
      </div>

      {/* Prescription Printing */}
      <div className="bg-white rounded-xl border border-blue-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <Printer className="w-5 h-5 text-blue-600" />
          <h2 className="font-semibold text-gray-900">Prescription Pad Printing</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Prints only the prescription content onto the pre-printed GMH pad. Print one test on plain paper first, then adjust offsets if needed.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <F
            label="Whole Page X Offset (mm)"
            type="number"
            value={String(printSettings.offsetX)}
            onChange={(v: string) => setPrintSettings(s => ({ ...s, offsetX: Number(v) || 0 }))}
          />
          <F
            label="Whole Page Y Offset (mm)"
            type="number"
            value={String(printSettings.offsetY)}
            onChange={(v: string) => setPrintSettings(s => ({ ...s, offsetY: Number(v) || 0 }))}
          />
          <F
            label="Font Scale (%)"
            type="number"
            value={String(printSettings.fontScale)}
            onChange={(v: string) => setPrintSettings(s => ({ ...s, fontScale: Number(v) || 100 }))}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-5">
          {PRINT_SECTIONS.map(section => (
            <div key={section.key} className="border border-gray-100 rounded-xl p-4 bg-gray-50/60">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-gray-800">{section.title}</h3>
                <p className="text-[11px] text-gray-500">{section.hint}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <F
                  label="X Offset (mm)"
                  type="number"
                  value={String(printSettings[section.key].offsetX)}
                  onChange={(v: string) => setPrintSectionOffset(section.key, 'offsetX', v)}
                />
                <F
                  label="Y Offset (mm)"
                  type="number"
                  value={String(printSettings[section.key].offsetY)}
                  onChange={(v: string) => setPrintSectionOffset(section.key, 'offsetY', v)}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button onClick={savePrintSettings}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            <CheckCircle className="w-4 h-4" /> Save Print Settings
          </button>
          <button
            type="button"
            onClick={() => setPrintSettings(DEFAULT_PRESCRIPTION_PRINT_SETTINGS)}
            className="border border-gray-200 text-gray-600 rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Reset Defaults
          </button>
          {printSettingsMsg && <span className="text-sm font-medium text-green-600">{printSettingsMsg}</span>}
        </div>
      </div>

      {/* Gemini API Key - Auto Urdu Transliteration */}
      <div className="bg-white rounded-xl border border-purple-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <Bot className="w-5 h-5 text-purple-600" />
          <h2 className="font-semibold text-gray-900">AI Urdu Auto-Transliteration</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Enter your Gemini API key to automatically transliterate medicine names into Urdu script when writing or printing prescriptions.
          Your key is saved locally on this device only.
        </p>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Gemini API Key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={geminiKey}
                onChange={e => setGeminiKeyState(e.target.value)}
                placeholder="AIza..."
                className="w-full border border-purple-200 rounded-lg px-3 py-2 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
              <button type="button" onClick={() => setShowKey(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <button onClick={saveGeminiKey}
            className="flex items-center gap-2 px-5 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 whitespace-nowrap">
            <CheckCircle className="w-4 h-4" /> Save Key
          </button>
        </div>
        {keyMsg && <p className="text-sm font-medium text-green-600 mt-2">{keyMsg}</p>}
        <p className="text-xs text-gray-400 mt-3">
          Get your key from <span className="text-purple-600 font-medium">Google AI Studio</span> → API Keys
        </p>
      </div>

      {/* App Updates */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <RefreshCw className="w-5 h-5 text-blue-600" />
          <h2 className="font-semibold text-gray-900">App Updates</h2>
        </div>
        <AppUpdater variant="settings" />
      </div>

      {/* Danger Zone */}
      <div className="bg-white rounded-xl border border-red-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <h2 className="font-semibold text-red-600">Danger Zone</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">Permanently delete every MySQL record used by HMS and Pharmacy. Mirrored deletes will also be queued for Firestore. This cannot be undone.</p>
        <p className="text-xs text-gray-400 mb-4">{GLOBAL_DATA_COLLECTIONS.length} collections included. Firebase Authentication accounts are not deleted by the app.</p>
        <button onClick={() => setShowClearConfirm(true)} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">
          <Trash2 className="w-4 h-4" /> Clear All Data
        </button>
        {clearMsg && <p className={`text-sm font-medium mt-3 ${clearMsg.startsWith('Done') ? 'text-green-600' : clearMsg.startsWith('Error') ? 'text-red-500' : 'text-blue-600'}`}>{clearMsg}</p>}
      </div>

      {/* Import Confirm Modal */}
      {showImportConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full">
            <h2 className="font-semibold text-gray-900 mb-2">Confirm Import</h2>
            <p className="text-sm text-gray-500 mb-3">This will add/overwrite HMS and Pharmacy data from the backup file. Existing records with the same ID will be replaced.</p>
            {pendingImport && <p className="text-xs text-gray-500 mb-4 bg-gray-50 rounded-lg p-3">{summarizeBackup(pendingImport)}</p>}
            <div className="flex gap-3">
              <button onClick={() => { setShowImportConfirm(false); setPendingImport(null); }} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleImport} disabled={importing} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700">Import</button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Confirm Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3"><AlertTriangle className="w-5 h-5 text-red-600" /></div>
            <h2 className="font-semibold text-gray-900 text-center mb-1">Delete All Data?</h2>
            <p className="text-sm text-gray-500 text-center mb-4">Type <strong>DELETE ALL</strong> to confirm.</p>
            <input value={clearText} onChange={e => setClearText(e.target.value)} placeholder="DELETE ALL"
              className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-400 text-center font-mono" />
            <div className="flex gap-3">
              <button onClick={() => { setShowClearConfirm(false); setClearText(''); }} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleClear} disabled={clearText !== 'DELETE ALL' || clearing}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm hover:bg-red-700 disabled:opacity-40">
                {clearing ? 'Deleting...' : 'Delete Everything'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New User Modal */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Create New User</h2>
              <button onClick={() => { setShowUserModal(false); setUserMsg(''); setUserForm(emptyUser); }} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              {userMsg && <p className={`text-sm font-medium p-2 rounded-lg ${userMsg.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>{userMsg}</p>}
              <F label="Full Name" value={userForm.name} onChange={(v: string) => setUserForm(f => ({ ...f, name: v }))} />
              <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Username (for login)</label>
              <input type="text" value={userForm.email} onChange={(e) => setUserForm(f => ({ ...f, email: e.target.value.replace(/\s+/g, '.').toLowerCase() }))} placeholder="e.g. dr.ahmed" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
              <p className="text-xs text-gray-400 mt-1">No spaces — use dots (e.g. dr.ahmed, cashier1)</p>
            </div>
              <F label="Password" value={userForm.password} onChange={(v: string) => setUserForm(f => ({ ...f, password: v }))} type="password" placeholder="Min 6 characters" />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                <select value={userForm.role} onChange={e => setUserForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {ROLES.map(r => <option key={r} value={r}>{r.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 p-5 pt-0">
              <button onClick={() => { setShowUserModal(false); setUserForm(emptyUser); setUserMsg(''); }} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleCreateUser} disabled={creatingUser} className="flex-1 bg-violet-600 text-white py-2 rounded-lg text-sm hover:bg-violet-700 disabled:opacity-60">
                {creatingUser ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

