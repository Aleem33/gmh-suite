export type AppAccess = 'hms' | 'pos';

export type PermissionMap = Record<string, boolean>;

export interface UserProfile {
  uid?: string;
  name?: string;
  username?: string;
  email?: string;
  role?: string;
  app?: string;
  appAccess?: AppAccess[];
  permissions?: PermissionMap;
}

export const DEFAULT_NON_ADMIN_DISCOUNT_PERCENT = 10;
export const REQUESTED_USER_PASSWORD = 'GMH@12345';

const hmsCorePermissions = [
  'hms.dashboard.view',
  'hms.reception.view',
  'hms.vitals.view',
  'hms.token.view',
  'hms.ipd.view',
];

const hmsBillingCreatePermissions = [
  ...hmsCorePermissions,
  'hms.billing.create',
];

export function permissionRecord(keys: string[]): PermissionMap {
  return keys.reduce<PermissionMap>((acc, key) => {
    acc[key] = true;
    return acc;
  }, {});
}

export const REQUESTED_USERS = [
  {
    name: 'Haseeb',
    username: 'haseeb',
    role: 'custom',
    appAccess: ['hms', 'pos'] as AppAccess[],
    permissions: permissionRecord([
      ...hmsBillingCreatePermissions,
      'pos.billing.create',
      'pos.billing.discount',
      'pos.purchases.view',
      'pos.purchases.create',
      'pos.purchaseReturns.view',
      'pos.sales.view',
      'pos.saleReturns.view',
      'pos.medicines.view',
      'pos.medicines.create',
      'pos.customers.view',
      'pos.suppliers.view',
      'pos.suppliers.create',
      'pos.expenses.view',
      'pos.expenses.create',
      'pos.reports.view',
    ]),
  },
  {
    name: 'Haider',
    username: 'haider',
    role: 'custom',
    appAccess: ['hms'] as AppAccess[],
    permissions: permissionRecord(hmsBillingCreatePermissions),
  },
  {
    name: 'Sohail',
    username: 'sohail',
    role: 'custom',
    appAccess: ['hms'] as AppAccess[],
    permissions: permissionRecord(hmsBillingCreatePermissions),
  },
  {
    name: 'Danyal',
    username: 'danyal',
    role: 'custom',
    appAccess: ['hms', 'pos'] as AppAccess[],
    permissions: permissionRecord([
      ...hmsCorePermissions,
      'pos.billing.create',
      'pos.sales.view',
      'pos.customers.view',
      'pos.expenses.view',
      'pos.expenses.create',
    ]),
  },
];

export const WORKFLOW_PERMISSIONS = {
  hmsReception: ['hms.reception.view'],
  hmsVitals: ['hms.vitals.view'],
  hmsToken: ['hms.token.view'],
  hmsIpd: ['hms.ipd.view'],
  hmsBillingCreate: ['hms.billing.create'],
  posBillingCreate: ['pos.billing.create'],
  posPurchasesCreate: ['pos.purchases.create'],
  posPurchasesView: ['pos.purchases.view', 'pos.purchases.create'],
  posPurchaseReturnsView: ['pos.purchaseReturns.view'],
  posSalesView: ['pos.sales.view'],
  posSaleReturnsView: ['pos.saleReturns.view'],
  posMedicinesView: ['pos.medicines.view', 'pos.medicines.create'],
  posMedicinesCreate: ['pos.medicines.create'],
  posCustomersView: ['pos.customers.view'],
  posSuppliersView: ['pos.suppliers.view', 'pos.suppliers.create'],
  posSuppliersCreate: ['pos.suppliers.create'],
  posExpensesView: ['pos.expenses.view', 'pos.expenses.create'],
  posExpensesCreate: ['pos.expenses.create'],
  posReportsView: ['pos.reports.view'],
} as const;

export type WorkflowPermissionKey = keyof typeof WORKFLOW_PERMISSIONS;

export function isAdminProfile(profile?: UserProfile | null): boolean {
  return profile?.role === 'admin';
}

export function hasPermission(profile: UserProfile | null | undefined, permission: string): boolean {
  if (!profile) return false;
  if (isAdminProfile(profile)) return true;
  return profile.permissions?.[permission] === true;
}

export function hasAnyPermission(profile: UserProfile | null | undefined, permissions: readonly string[]): boolean {
  return permissions.some(permission => hasPermission(profile, permission));
}

export function hasWorkflowPermission(profile: UserProfile | null | undefined, workflow: WorkflowPermissionKey): boolean {
  return hasAnyPermission(profile, [...WORKFLOW_PERMISSIONS[workflow]]);
}

export function canAccessApp(profile: UserProfile | null | undefined, app: AppAccess): boolean {
  if (!profile) return false;
  if (isAdminProfile(profile)) return true;
  if (profile.appAccess?.length) return profile.appAccess.includes(app);
  if (profile.app === 'all' || profile.app === app) return true;
  if (app === 'hms') return ['receptionist', 'doctor', 'nurse', 'lab_technician', 'cashier', 'pharmacist'].includes(profile.role || '');
  if (app === 'pos') return ['cashier', 'pharmacist'].includes(profile.role || '');
  return false;
}

export function roleOrPermission(
  role: string | null | undefined,
  roles: string[],
  profile: UserProfile | null | undefined,
  permissions: string | readonly string[] = [],
): boolean {
  if (role === 'admin') return true;
  if (role && roles.includes(role)) return true;
  const keys = Array.isArray(permissions) ? permissions : [permissions];
  return keys.filter(Boolean).some(key => hasPermission(profile, key));
}
