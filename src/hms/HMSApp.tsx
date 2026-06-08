import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Patients } from './pages/Patients';
import { Appointments } from './pages/Appointments';
import { OPD } from './pages/OPD';
import { VitalsQueue } from './pages/VitalsQueue';
import { IPD } from './pages/IPD';
import { Lab } from './pages/Lab';
import { Pharmacy } from './pages/Pharmacy';
import { Billing } from './pages/Billing';
import { Staff } from './pages/Staff';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { Suppliers } from './pages/Suppliers';
import { Expenses } from './pages/Expenses';
import { Prescriptions } from './pages/Prescriptions';
import { PrescriptionTemplates } from './pages/PrescriptionTemplates';
import { TokenDisplay } from './pages/TokenDisplay';
import { AuditLogs } from './pages/AuditLogs';
import { Schedule } from './pages/Schedule';
import { BedManagement } from './pages/BedManagement';
import { Approvals } from './pages/Approvals';
import { useAutoNotifications } from './lib/notifications';
import { canAccessApp, hasAnyPermission, hasPermission, roleOrPermission, WORKFLOW_PERMISSIONS, type UserProfile } from '../lib/permissions';
import { Billing as PosBilling } from '../pos/pages/Billing';
import { Medicines as PosMedicines } from '../pos/pages/Medicines';
import { Purchases as PosPurchases } from '../pos/pages/Purchases';
import { PurchaseReturns as PosPurchaseReturns } from '../pos/pages/PurchaseReturns';
import { SalesHistory as PosSalesHistory } from '../pos/pages/SalesHistory';
import { SalesReturns as PosSalesReturns } from '../pos/pages/SalesReturns';
import { Customers as PosCustomers } from '../pos/pages/Customers';
import { Suppliers as PosSuppliers } from '../pos/pages/Suppliers';
import { Expenses as PosExpenses } from '../pos/pages/Expenses';
import { Reports as PosReports } from '../pos/pages/Reports';
import { Users as PosUsers } from '../pos/pages/Users';
import { Settings as PosSettings } from '../pos/pages/Settings';
import { PatientHistory as PosPatientHistory } from '../pos/pages/PatientHistory';

interface Props {
  userRole: string | null;
  userProfile?: UserProfile | null;
  userEmail: string;
  onLoginSuccess: () => void;
  onBack?: () => void;
  onLogout?: () => void;
}

export function HMSApp({ userRole, userProfile, userEmail, onLoginSuccess, onBack, onLogout }: Props) {
  useAutoNotifications();

  if (!userRole) return <Login onLoginSuccess={onLoginSuccess} onBack={onBack} />;

  const r = userRole;
  const isAdmin = r === 'admin';
  const hmsAccess = canAccessApp(userProfile || { role: r }, 'hms');
  const posAccess = canAccessApp(userProfile || { role: r }, 'pos');
  const clinical = ['admin', 'receptionist', 'doctor', 'nurse'];
  const dashboardRoles = ['admin', 'receptionist', 'doctor'];
  const canDashboard = hmsAccess && roleOrPermission(r, dashboardRoles, userProfile, 'hms.dashboard.view');
  const canPatients = hmsAccess && roleOrPermission(r, clinical, userProfile, ['hms.reception.view', 'hms.ipd.view']);
  const canReception = hmsAccess && roleOrPermission(r, ['admin', 'receptionist'], userProfile, WORKFLOW_PERMISSIONS.hmsReception);
  const canVitals = hmsAccess && roleOrPermission(r, ['admin','receptionist','doctor','nurse'], userProfile, WORKFLOW_PERMISSIONS.hmsVitals);
  const canToken = hmsAccess && roleOrPermission(r, ['admin','receptionist','doctor','nurse'], userProfile, WORKFLOW_PERMISSIONS.hmsToken);
  const canOpd = hmsAccess && roleOrPermission(r, ['admin','doctor'], userProfile, 'hms.opd.view');
  const canIpd = hmsAccess && roleOrPermission(r, ['admin','receptionist','doctor'], userProfile, WORKFLOW_PERMISSIONS.hmsIpd);
  const canBilling = hmsAccess && roleOrPermission(r, ['admin','cashier'], userProfile, WORKFLOW_PERMISSIONS.hmsBillingCreate);
  const canCreateOnlyBilling = hasPermission(userProfile, 'hms.billing.create') && !['admin', 'cashier'].includes(r);
  const canPharmacyOrders = posAccess && (isAdmin || r === 'pharmacist');
  const canPosDashboard = posAccess && (isAdmin || r === 'pharmacist');
  const canPosBilling = posAccess && roleOrPermission(r, ['admin', 'cashier'], userProfile, WORKFLOW_PERMISSIONS.posBillingCreate);
  const canPosMedicines = posAccess && roleOrPermission(r, ['admin', 'pharmacist'], userProfile, WORKFLOW_PERMISSIONS.posMedicinesView);
  const canPosPurchases = posAccess && roleOrPermission(r, ['admin', 'pharmacist'], userProfile, WORKFLOW_PERMISSIONS.posPurchasesView);
  const canPosPurchaseReturns = posAccess && roleOrPermission(r, ['admin', 'pharmacist'], userProfile, WORKFLOW_PERMISSIONS.posPurchaseReturnsView);
  const canPosSales = posAccess && roleOrPermission(r, ['admin', 'cashier', 'pharmacist'], userProfile, WORKFLOW_PERMISSIONS.posSalesView);
  const canPosSaleReturns = posAccess && roleOrPermission(r, ['admin', 'cashier'], userProfile, WORKFLOW_PERMISSIONS.posSaleReturnsView);
  const canPosCustomers = posAccess && roleOrPermission(r, ['admin'], userProfile, WORKFLOW_PERMISSIONS.posCustomersView);
  const canPosSuppliers = posAccess && roleOrPermission(r, ['admin', 'pharmacist'], userProfile, WORKFLOW_PERMISSIONS.posSuppliersView);
  const canPosExpenses = posAccess && roleOrPermission(r, ['admin'], userProfile, WORKFLOW_PERMISSIONS.posExpensesView);
  const canPosReports = posAccess && roleOrPermission(r, ['admin'], userProfile, WORKFLOW_PERMISSIONS.posReportsView);
  const canPosPatientHistory = posAccess && (isAdmin || r === 'pharmacist' || r === 'cashier');
  const canAnyPharmacy =
    canPharmacyOrders || canPosDashboard || canPosBilling || canPosMedicines || canPosPurchases ||
    canPosPurchaseReturns || canPosSales || canPosSaleReturns || canPosCustomers || canPosSuppliers ||
    canPosExpenses || canPosReports || canPosPatientHistory || isAdmin;
  const defaultPharmacyPath =
    canPharmacyOrders ? '/pharmacy/orders' :
    canPosBilling ? '/pharmacy/billing' :
    canPosSales ? '/pharmacy/sales' :
    canPosCustomers ? '/pharmacy/customers' :
    canPosMedicines ? '/pharmacy/medicines' :
    canPosPurchases ? '/pharmacy/purchases' :
    canPosSuppliers ? '/pharmacy/suppliers' :
    canPosExpenses ? '/pharmacy/expenses' :
    canPosReports ? '/pharmacy/reports' : '/';
  const defaultPath =
    r === 'pharmacist'     ? defaultPharmacyPath :
    r === 'lab_technician' && hmsAccess ? '/lab' :
    r === 'cashier' && canBilling ? '/billing' :
    r === 'nurse'          ? '/vitals'   :
    canDashboard           ? '/'         :
    canReception           ? '/appointments' :
    canVitals              ? '/vitals'   :
    canIpd                 ? '/ipd'      :
    canBilling             ? '/billing'  :
    canAnyPharmacy         ? defaultPharmacyPath : '/';

  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Layout role={r} userProfile={userProfile} userEmail={userEmail} onLogout={onLogout} />}>
            {canDashboard && <Route index element={<Dashboard />} />}
            {canPatients && <Route path="patients"     element={<Patients />} />}
            {canReception && <Route path="appointments" element={<Appointments />} />}
            {canVitals && <Route path="vitals" element={<VitalsQueue />} />}
            {canOpd && <Route path="opd"          element={<OPD />} />}
            {canIpd && <Route path="ipd"          element={<IPD />} />}
            {canToken && <Route path="token"        element={<TokenDisplay />} />}
            {['admin','doctor'].includes(r)                         && <Route path="prescriptions"         element={<Prescriptions />} />}
            {['admin','doctor'].includes(r)                         && <Route path="prescription-templates" element={<PrescriptionTemplates />} />}
            {hmsAccess && ['admin','doctor','lab_technician'].includes(r) && <Route path="lab"             element={<Lab />} />}
            {canPharmacyOrders && <Route path="pharmacy/orders" element={<Pharmacy />} />}
            {canPosBilling && <Route path="pharmacy/billing" element={<PosBilling userProfile={userProfile} />} />}
            {canPosPatientHistory && <Route path="pharmacy/patient-history" element={<PosPatientHistory />} />}
            {canPosMedicines && <Route path="pharmacy/medicines" element={<PosMedicines userProfile={userProfile} />} />}
            {canPosPurchases && <Route path="pharmacy/purchases" element={<PosPurchases userProfile={userProfile} />} />}
            {canPosPurchaseReturns && <Route path="pharmacy/purchase-returns" element={<PosPurchaseReturns readOnly={!hasAnyPermission(userProfile, ['pos.purchaseReturns.create']) && !isAdmin && r !== 'pharmacist'} />} />}
            {canPosSales && <Route path="pharmacy/sales" element={<PosSalesHistory userProfile={userProfile} />} />}
            {canPosSaleReturns && <Route path="pharmacy/sale-returns" element={<PosSalesReturns readOnly={!hasAnyPermission(userProfile, ['pos.saleReturns.create']) && !isAdmin && r !== 'cashier'} />} />}
            {canPosCustomers && <Route path="pharmacy/customers" element={<PosCustomers userProfile={userProfile} />} />}
            {canPosSuppliers && <Route path="pharmacy/suppliers" element={<PosSuppliers userProfile={userProfile} />} />}
            {canPosExpenses && <Route path="pharmacy/expenses" element={<PosExpenses userProfile={userProfile} />} />}
            {canPosReports && <Route path="pharmacy/reports" element={<PosReports />} />}
            {isAdmin && <Route path="pharmacy/users" element={<PosUsers />} />}
            {isAdmin && <Route path="pharmacy/settings" element={<PosSettings />} />}
            {canAnyPharmacy && <Route path="pharmacy" element={<Navigate to={defaultPharmacyPath} replace />} />}
            {hmsAccess && ['admin','pharmacist'].includes(r) && <Route path="suppliers"             element={<Suppliers />} />}
            {canBilling                                             && <Route path="billing"               element={<Billing userProfile={userProfile} createOnly={canCreateOnlyBilling} />} />}
            {isAdmin && <Route path="staff"    element={<Staff />} />}
            {isAdmin && <Route path="schedule" element={<Schedule />} />}
            {isAdmin && <Route path="beds"     element={<BedManagement />} />}
            {isAdmin && <Route path="approvals" element={<Approvals />} />}
            {isAdmin && <Route path="expenses" element={<Expenses />} />}
            {isAdmin && <Route path="reports"  element={<Reports />} />}
            {isAdmin && <Route path="audit"    element={<AuditLogs />} />}
            {isAdmin && <Route path="settings" element={<Settings />} />}
            {!canDashboard && <Route index element={<Navigate to={defaultPath} replace />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}
