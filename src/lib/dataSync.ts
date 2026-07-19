import { apiRequest, createIdempotencyKey } from './hostingerApi';

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
  'quotations',
  'customers',
  'customerPayments',
  'approvalRequests',
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

export async function exportAllAppData(onProgress?: ProgressFn): Promise<BackupFile> {
  onProgress?.('Exporting MySQL data...');
  return apiRequest<BackupFile>('/admin/backup');
}

export async function restoreAllAppData(backup: BackupFile, onProgress?: ProgressFn) {
  if (!backup?.collections || typeof backup.collections !== 'object') {
    throw new Error('Invalid backup file.');
  }

  onProgress?.('Validating and importing into MySQL...');
  const response = await apiRequest<{ importedDocuments: number }>('/admin/import', {
    method: 'POST',
    body: JSON.stringify({ backup, replace: false }),
    idempotencyKey: createIdempotencyKey('backup-import'),
  });
  return response.importedDocuments;
}

export async function dryRunAppDataImport(backup: BackupFile) {
  return apiRequest<{
    valid: boolean;
    totalDocuments: number;
    collectionCount: number;
    errors: string[];
    warnings: string[];
    manifest: Record<string, any>;
  }>('/admin/import/dry-run', {
    method: 'POST',
    body: JSON.stringify(backup),
  });
}

export async function deleteAllAppData(onProgress?: ProgressFn) {
  onProgress?.('Resetting MySQL application data...');
  const response = await apiRequest<{ deletedDocuments: number }>('/admin/reset', {
    method: 'POST',
    body: JSON.stringify({ confirm: 'RESET_GMH_DATA' }),
    idempotencyKey: createIdempotencyKey('backup-reset'),
  });
  return response.deletedDocuments;
}

export function summarizeBackup(backup: Pick<BackupFile, 'collections'>) {
  if (!backup?.collections) return 'No records found.';
  const summary = getRestoreCollections(backup.collections)
    .filter(name => name === 'quotations' || backup.collections[name]?.length > 0)
    .map(name => `${backup.collections[name].length} ${name}`)
    .join(', ');
  return summary || 'No records found.';
}
