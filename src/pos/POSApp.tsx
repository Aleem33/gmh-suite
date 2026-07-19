import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Billing } from './pages/Billing';
import { Quotations } from './pages/Quotations';
import { Medicines } from './pages/Medicines';
import { Customers } from './pages/Customers';
import { Suppliers } from './pages/Suppliers';
import { Reports } from './pages/Reports';
import { Audit } from './pages/Audit';
import { Users } from './pages/Users';
import { SalesHistory } from './pages/SalesHistory';
import { Expenses } from './pages/Expenses';
import { Settings } from './pages/Settings';
import { Purchases } from './pages/Purchases';
import { SalesReturns } from './pages/SalesReturns';
import { PurchaseReturns } from './pages/PurchaseReturns';
import { PatientHistory } from './pages/PatientHistory';
import { hasAnyPermission, roleOrPermission, type UserProfile } from '../lib/permissions';

interface Props {
  userRole: string | null;
  userProfile?: UserProfile | null;
  onLoginSuccess: () => void;
  onBack?: () => void;
  onLogout?: () => void;
}

export function POSApp({ userRole, userProfile, onLoginSuccess, onBack, onLogout }: Props) {
  if (!userRole) return <Login onLoginSuccess={onLoginSuccess} onBack={onBack} />;

  const r = userRole;
  const isAdmin = r === 'admin';
  const canDashboard = isAdmin || r === 'pharmacist';
  const canBilling = roleOrPermission(r, ['admin', 'cashier'], userProfile, 'pos.billing.create');
  const canQuotations = isAdmin || userProfile?.username === 'haseeb' || roleOrPermission(r, [], userProfile, ['pos.quotations.view', 'pos.quotations.create']);
  const canMedicines = roleOrPermission(r, ['admin', 'pharmacist'], userProfile, ['pos.medicines.view', 'pos.medicines.create']);
  const canPurchases = roleOrPermission(r, ['admin', 'pharmacist'], userProfile, ['pos.purchases.view', 'pos.purchases.create']);
  const canPurchaseReturns = roleOrPermission(r, ['admin', 'pharmacist'], userProfile, 'pos.purchaseReturns.view');
  const canSales = roleOrPermission(r, ['admin', 'cashier', 'pharmacist'], userProfile, 'pos.sales.view');
  const canSaleReturns = roleOrPermission(r, ['admin', 'cashier'], userProfile, 'pos.saleReturns.view');
  const canCustomers = roleOrPermission(r, ['admin'], userProfile, 'pos.customers.view');
  const canSuppliers = roleOrPermission(r, ['admin', 'pharmacist'], userProfile, ['pos.suppliers.view', 'pos.suppliers.create']);
  const canExpenses = roleOrPermission(r, ['admin'], userProfile, ['pos.expenses.view', 'pos.expenses.create']);
  const canReports = roleOrPermission(r, ['admin'], userProfile, 'pos.reports.view');
  const defaultPath =
    canDashboard ? '/' :
    canBilling ? '/billing' :
    canQuotations ? '/quotations' :
    canSales ? '/sales' :
    canCustomers ? '/customers' :
    canMedicines ? '/medicines' :
    canPurchases ? '/purchases' :
    canSuppliers ? '/suppliers' :
    canExpenses ? '/expenses' : '/';

  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Layout role={r} userProfile={userProfile} onLogout={onLogout} />}>
            {canDashboard && <Route index element={<Dashboard />} />}
            {canBilling && <Route path="billing"          element={<Billing userProfile={userProfile} />} />}
            {canQuotations && <Route path="quotations"      element={<Quotations userProfile={userProfile} />} />}
            {canMedicines && <Route path="medicines"        element={<Medicines userProfile={userProfile} />} />}
            {canPurchases && <Route path="purchases"        element={<Purchases userProfile={userProfile} />} />}
            {canPurchaseReturns && <Route path="purchase-returns" element={<PurchaseReturns userProfile={userProfile} readOnly={!hasAnyPermission(userProfile, ['pos.purchaseReturns.create']) && !isAdmin && r !== 'pharmacist'} />} />}
            {canSales && <Route path="sales"           element={<SalesHistory userProfile={userProfile} />} />}
            {canSaleReturns && <Route path="sale-returns"     element={<SalesReturns userProfile={userProfile} readOnly={!hasAnyPermission(userProfile, ['pos.saleReturns.create']) && !isAdmin && r !== 'cashier'} />} />}
            {canCustomers && <Route path="customers"        element={<Customers userProfile={userProfile} />} />}
            {canSuppliers && <Route path="suppliers"        element={<Suppliers userProfile={userProfile} />} />}
            {canExpenses && <Route path="expenses"         element={<Expenses userProfile={userProfile} />} />}
            {canReports && <Route path="reports"          element={<Reports />} />}
            {isAdmin                         && <Route path="audit"            element={<Audit />} />}
            {isAdmin                         && <Route path="users"            element={<Users />} />}
            {isAdmin                         && <Route path="settings"         element={<Settings />} />}
            {(isAdmin || r === 'pharmacist' || r === 'cashier') && <Route path="patient-history" element={<PatientHistory />} />}

            {!canDashboard && <Route index element={<Navigate to={defaultPath} replace />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}
