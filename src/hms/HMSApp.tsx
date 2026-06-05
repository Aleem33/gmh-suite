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
import { useAutoNotifications } from './lib/notifications';
import { hasPermission, roleOrPermission, type UserProfile } from '../lib/permissions';

interface Props {
  userRole: string | null;
  userProfile?: UserProfile | null;
  userEmail: string;
  onSwitchApp: (mode: 'hms' | 'pos') => void;
  onLoginSuccess: () => void;
  onBack?: () => void;
  onLogout?: () => void;
}

export function HMSApp({ userRole, userProfile, userEmail, onSwitchApp, onLoginSuccess, onBack, onLogout }: Props) {
  useAutoNotifications();

  if (!userRole) return <Login onLoginSuccess={onLoginSuccess} onBack={onBack} />;

  const r = userRole;
  const isAdmin = r === 'admin';
  const clinical = ['admin', 'receptionist', 'doctor', 'nurse'];
  const dashboardRoles = ['admin', 'receptionist', 'doctor'];
  const canDashboard = roleOrPermission(r, dashboardRoles, userProfile, 'hms.dashboard.view');
  const canPatients = roleOrPermission(r, clinical, userProfile, ['hms.reception.view', 'hms.ipd.view']);
  const canReception = roleOrPermission(r, ['admin', 'receptionist'], userProfile, 'hms.reception.view');
  const canVitals = roleOrPermission(r, ['admin','receptionist','doctor','nurse'], userProfile, 'hms.vitals.view');
  const canToken = roleOrPermission(r, ['admin','receptionist','doctor','nurse'], userProfile, 'hms.token.view');
  const canOpd = roleOrPermission(r, ['admin','doctor'], userProfile, 'hms.opd.view');
  const canIpd = roleOrPermission(r, ['admin','receptionist','doctor'], userProfile, 'hms.ipd.view');
  const canBilling = roleOrPermission(r, ['admin','cashier'], userProfile, 'hms.billing.create');
  const canCreateOnlyBilling = hasPermission(userProfile, 'hms.billing.create') && !['admin', 'cashier'].includes(r);
  const defaultPath =
    r === 'pharmacist'     ? '/pharmacy' :
    r === 'lab_technician' ? '/lab'      :
    r === 'cashier'        ? '/billing'  :
    r === 'nurse'          ? '/vitals'   :
    canDashboard           ? '/'         :
    canReception           ? '/appointments' :
    canVitals              ? '/vitals'   :
    canIpd                 ? '/ipd'      :
    canBilling             ? '/billing'  : '/';

  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Layout role={r} userProfile={userProfile} userEmail={userEmail} onSwitchApp={onSwitchApp} onLogout={onLogout} />}>
            {canDashboard && <Route index element={<Dashboard />} />}
            {canPatients && <Route path="patients"     element={<Patients />} />}
            {canReception && <Route path="appointments" element={<Appointments />} />}
            {canVitals && <Route path="vitals" element={<VitalsQueue />} />}
            {canOpd && <Route path="opd"          element={<OPD />} />}
            {canIpd && <Route path="ipd"          element={<IPD />} />}
            {canToken && <Route path="token"        element={<TokenDisplay />} />}
            {['admin','doctor'].includes(r)                         && <Route path="prescriptions"         element={<Prescriptions />} />}
            {['admin','doctor'].includes(r)                         && <Route path="prescription-templates" element={<PrescriptionTemplates />} />}
            {['admin','doctor','lab_technician'].includes(r)        && <Route path="lab"                   element={<Lab />} />}
            {['admin','pharmacist'].includes(r)                     && <Route path="pharmacy"              element={<Pharmacy />} />}
            {['admin','pharmacist'].includes(r)                     && <Route path="suppliers"             element={<Suppliers />} />}
            {canBilling                                             && <Route path="billing"               element={<Billing userProfile={userProfile} createOnly={canCreateOnlyBilling} />} />}
            {isAdmin && <Route path="staff"    element={<Staff />} />}
            {isAdmin && <Route path="schedule" element={<Schedule />} />}
            {isAdmin && <Route path="beds"     element={<BedManagement />} />}
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
