import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase';

export const GLOBAL_DATA_COLLECTIONS = [
  'settings',
  'plans',
  'counters',
  'schedules',
  'users',
  'patients',
  'appointments',
  'consultations',
  'prescriptionTemplates',
  'admissions',
  'wards',
  'rooms',
  'beds',
  'bedTreatments',
  'labOrders',
  'labTests',
  'bills',
  'payments',
  'staff',
  'medicines',
  'suppliers',
  'purchases',
  'posPurchases',
  'purchaseReturns',
  'sales',
  'saleReturns',
  'posSales',
  'customers',
  'customerPayments',
  'expenses',
  'posExpenses',
  'pharmacyOrders',
  'auditLogs',
  'notifications',
];

export type BackupFile = {
  exportedAt: string;
  version: string;
  scope: 'gmh-suite';
  collections: Record<string, any[]>;
};

type ProgressFn = (message: string) => void;

function getRestoreCollections(collections: Record<string, any[]>) {
  const known = GLOBAL_DATA_COLLECTIONS.filter(name => collections[name]);
  const extra = Object.keys(collections).filter(name => !GLOBAL_DATA_COLLECTIONS.includes(name));
  return [...known, ...extra];
}

async function commitInChunks<T>(
  docs: T[],
  writeChunk: (batch: ReturnType<typeof writeBatch>, item: T) => void,
) {
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(db);
    docs.slice(i, i + 400).forEach(item => writeChunk(batch, item));
    await batch.commit();
  }
}

function getResetCollections() {
  return [
    ...GLOBAL_DATA_COLLECTIONS.filter(name => name !== 'users'),
    'users',
  ];
}

export async function exportAllAppData(onProgress?: ProgressFn): Promise<BackupFile> {
  const backup: BackupFile = {
    exportedAt: new Date().toISOString(),
    version: '2.0',
    scope: 'gmh-suite',
    collections: {},
  };

  for (const collectionName of GLOBAL_DATA_COLLECTIONS) {
    onProgress?.(`Exporting ${collectionName}...`);
    const snap = await getDocs(collection(db, collectionName));
    backup.collections[collectionName] = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  }

  return backup;
}

export async function restoreAllAppData(backup: BackupFile, onProgress?: ProgressFn) {
  if (!backup?.collections || typeof backup.collections !== 'object') {
    throw new Error('Invalid backup file.');
  }

  let totalDocs = 0;
  for (const collectionName of getRestoreCollections(backup.collections)) {
    const docs = backup.collections[collectionName] || [];
    if (!docs.length) continue;

    onProgress?.(`Importing ${collectionName} (${docs.length} records)...`);
    await commitInChunks(docs, (batch, docData: any) => {
      const { _id, ...data } = docData;
      if (!_id) return;
      batch.set(doc(db, collectionName, _id), data);
    });
    totalDocs += docs.length;
  }

  return totalDocs;
}

export async function deleteAllAppData(onProgress?: ProgressFn) {
  let totalDocs = 0;
  const currentUserId = auth.currentUser?.uid || '';

  for (const collectionName of getResetCollections()) {
    onProgress?.(`Deleting ${collectionName}...`);
    try {
      const snap = await getDocs(collection(db, collectionName));
      const docs = collectionName === 'users' && currentUserId
        ? snap.docs.filter(document => document.id !== currentUserId)
        : snap.docs;
      if (!docs.length) continue;

      await commitInChunks(docs, (batch, document) => batch.delete(document.ref));
      totalDocs += docs.length;
    } catch (error: any) {
      throw new Error(`Failed while deleting ${collectionName}: ${error?.message || 'Unknown error'}`);
    }
  }

  return totalDocs;
}

export function summarizeBackup(backup: Pick<BackupFile, 'collections'>) {
  if (!backup?.collections) return 'No records found.';
  const summary = getRestoreCollections(backup.collections)
    .filter(name => backup.collections[name]?.length > 0)
    .map(name => `${backup.collections[name].length} ${name}`)
    .join(', ');
  return summary || 'No records found.';
}
