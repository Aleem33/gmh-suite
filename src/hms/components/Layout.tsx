import logoUrl from '../../assets/logo';
import { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, CalendarDays, Stethoscope, BedDouble,
  FlaskConical, Pill, Receipt, UserCog, BarChart3,
  Settings as SettingsIcon, LogOut, Truck,
  TrendingDown, ClipboardList, ChevronLeft, ChevronRight,
  Shield, CalendarCheck, Hotel, Monitor, BookOpen, Activity,
  X, ShoppingCart, PackagePlus, RotateCcw, History,
  Lock, ClipboardCheck, FileText,
} from 'lucide-react';
import { logout } from '../../firebase';
import { cn } from '../lib/utils';
import { TopNavbar } from './TopNavbar';
import { ChangePasswordForm } from '../../components/ChangePasswordForm';
import { canAccessApp, roleOrPermission, WORKFLOW_PERMISSIONS, type UserProfile } from '../../lib/permissions';

const NAV = [
  {
    group: 'Clinical',
    items: [
      { to: '/',                       icon: LayoutDashboard, label: 'Dashboard',         roles: ['admin','receptionist','doctor'], permission: 'hms.dashboard.view' },
      { to: '/patients',               icon: Users,           label: 'Patients',           roles: ['admin','receptionist','doctor','nurse'], permissions: ['hms.reception.view', 'hms.ipd.view'] },
      { to: '/appointments',           icon: CalendarDays,    label: 'Reception',          roles: ['admin','receptionist'], permission: 'hms.reception.view' },
      { to: '/vitals',                 icon: Activity,        label: 'Vitals Queue',       roles: ['admin','receptionist','doctor','nurse'], permission: 'hms.vitals.view' },
      { to: '/token',                  icon: Monitor,         label: 'Token Display',      roles: ['admin','receptionist','doctor','nurse'], permission: 'hms.token.view' },
      { to: '/opd',                    icon: Stethoscope,     label: 'OPD',                roles: ['admin','doctor'], permission: 'hms.opd.view' },
      { to: '/prescriptions',          icon: ClipboardList,   label: 'Prescriptions',      roles: ['admin','doctor'] },
      { to: '/prescription-templates', icon: BookOpen,        label: 'Rx Templates',       roles: ['admin','doctor'] },
      { to: '/ipd',                    icon: BedDouble,       label: 'IPD',                roles: ['admin','receptionist','doctor'], permission: 'hms.ipd.view' },
    ],
  },
  {
    group: 'Services',
    items: [
      { to: '/lab',       icon: FlaskConical, label: 'Laboratory', roles: ['admin','doctor','lab_technician'] },
      { to: '/suppliers', icon: Truck,        label: 'Suppliers',  roles: ['admin','pharmacist'] },
      { to: '/billing',   icon: Receipt,      label: 'Billing',    roles: ['admin','cashier'], permission: 'hms.billing.create' },
    ],
  },
  {
    group: 'Administration',
    items: [
      { to: '/staff',    icon: UserCog,       label: 'Staff',      roles: ['admin'] },
      { to: '/schedule', icon: CalendarCheck, label: 'Schedules',  roles: ['admin'] },
      { to: '/beds',     icon: Hotel,         label: 'Bed Mgmt',   roles: ['admin'] },
      { to: '/approvals', icon: ClipboardCheck,label: 'Approvals',  roles: ['admin'] },
      { to: '/expenses', icon: TrendingDown,  label: 'Expenses',   roles: ['admin'] },
      { to: '/reports',  icon: BarChart3,     label: 'Reports',    roles: ['admin'] },
      { to: '/audit',    icon: Shield,        label: 'Audit Logs', roles: ['admin'] },
      { to: '/settings', icon: SettingsIcon,  label: 'Settings',   roles: ['admin'] },
    ],
  },
];

const PHARMACY_NAV = [
  { to: '/pharmacy/dashboard',        icon: LayoutDashboard, label: 'Dashboard',         roles: ['admin','pharmacist','cashier'], permissions: WORKFLOW_PERMISSIONS.posDashboardView },
  { to: '/pharmacy/orders',           icon: Pill,         label: 'Orders / Dispense', roles: ['admin','pharmacist'] },
  { to: '/pharmacy/billing',          icon: ShoppingCart, label: 'Billing',           roles: ['admin','cashier'], permissions: WORKFLOW_PERMISSIONS.posBillingCreate },
  { to: '/pharmacy/quotations',       icon: FileText,     label: 'Quotations',        roles: ['admin'], permissions: WORKFLOW_PERMISSIONS.posQuotationsView },
  { to: '/pharmacy/patient-history',  icon: ClipboardList,label: 'Patient Rx',        roles: ['admin','pharmacist','cashier'] },
  { to: '/pharmacy/medicines',        icon: Pill,         label: 'Medicines',         roles: ['admin','pharmacist'], permissions: WORKFLOW_PERMISSIONS.posMedicinesView },
  { to: '/pharmacy/purchases',        icon: PackagePlus,  label: 'Purchases',         roles: ['admin','pharmacist'], permissions: WORKFLOW_PERMISSIONS.posPurchasesView },
  { to: '/pharmacy/purchase-returns', icon: RotateCcw,    label: 'Purchase Returns',  roles: ['admin','pharmacist'], permissions: WORKFLOW_PERMISSIONS.posPurchaseReturnsView },
  { to: '/pharmacy/sales',            icon: History,      label: 'Sales History',     roles: ['admin','cashier','pharmacist'], permissions: WORKFLOW_PERMISSIONS.posSalesView },
  { to: '/pharmacy/sale-returns',     icon: RotateCcw,    label: 'Sale Returns',      roles: ['admin','cashier'], permissions: WORKFLOW_PERMISSIONS.posSaleReturnsView },
  { to: '/pharmacy/customers',        icon: Users,        label: 'Customers',         roles: ['admin'], permissions: WORKFLOW_PERMISSIONS.posCustomersView },
  { to: '/pharmacy/suppliers',        icon: Truck,        label: 'Suppliers',         roles: ['admin','pharmacist'], permissions: WORKFLOW_PERMISSIONS.posSuppliersView },
  { to: '/pharmacy/expenses',         icon: Receipt,      label: 'Expenses',          roles: ['admin'], permissions: WORKFLOW_PERMISSIONS.posExpensesView },
  { to: '/pharmacy/reports',          icon: BarChart3,    label: 'Reports',           roles: ['admin'], permissions: WORKFLOW_PERMISSIONS.posReportsView },
  { to: '/pharmacy/audit',            icon: Shield,       label: 'Audit',             roles: ['admin'] },
  { to: '/pharmacy/users',            icon: UserCog,      label: 'Users',             roles: ['admin'] },
  { to: '/pharmacy/settings',         icon: SettingsIcon, label: 'Settings',          roles: ['admin'] },
];

interface Props {
  role: string;
  userProfile?: UserProfile | null;
  userEmail: string;
  onLogout?: () => void;
}

export function Layout({ role, userProfile, userEmail, onLogout }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pharmacyOpen, setPharmacyOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const hmsAccess = canAccessApp(userProfile || { role }, 'hms');
  const posAccess = canAccessApp(userProfile || { role }, 'pos');
  const visiblePharmacy = posAccess
    ? PHARMACY_NAV.filter(i => (
      i.to === '/pharmacy/quotations' && userProfile?.username === 'haseeb'
    ) || roleOrPermission(role, i.roles, userProfile, (i as any).permissions || (i as any).permission || []))
    : [];
  const pharmacyActive = location.pathname.startsWith('/pharmacy');

  useEffect(() => {
    if (pharmacyActive) setPharmacyOpen(true);
  }, [pharmacyActive]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      // Don't fire when typing in input/textarea/select
      if (['INPUT','TEXTAREA','SELECT'].includes(tag)) return;

      if (e.ctrlKey || e.metaKey) return;
      switch (e.key) {
        case 'Escape': {
          // Close any open modal by dispatching a custom event
          document.dispatchEvent(new CustomEvent('closeModal'));
          break;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  const NavGroups = ({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) => (
    <>
      {NAV.map(({ group, items }) => {
        const visible = hmsAccess
          ? items.filter(i => (
            i.to === '/ipd' && ['haseeb', 'sohail', 'haider'].includes(userProfile?.username || '')
          ) || roleOrPermission(role, i.roles, userProfile, (i as any).permissions || (i as any).permission || []))
          : [];
        if (!visible.length && !(group === 'Services' && visiblePharmacy.length)) return null;
        return (
          <div key={group}>
            {(!collapsed || mobile) && (
              <p className={cn(
                'px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest',
                mobile ? 'text-slate-400' : 'text-blue-300/60'
              )}>
                {group}
              </p>
            )}
            <div className="space-y-0.5">
              {visible.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to} to={to} end={to === '/'}
                  title={!mobile && collapsed ? label : undefined}
                  onClick={onNavigate}
                  className={({ isActive }) => cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    !mobile && collapsed && 'justify-center px-2',
                    mobile
                      ? isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                      : isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-blue-100/70 hover:text-white hover:bg-white/10'
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {(mobile || !collapsed) && label}
                </NavLink>
              ))}
              {group === 'Services' && visiblePharmacy.length > 0 && (
                <div>
                  <button
                    type="button"
                    title={!mobile && collapsed ? 'Pharmacy' : undefined}
                    onClick={() => {
                      if (!mobile && collapsed) {
                        navigate(visiblePharmacy[0].to);
                        return;
                      }
                      setPharmacyOpen(open => !open);
                    }}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors w-full',
                      !mobile && collapsed && 'justify-center px-2',
                      pharmacyActive
                        ? mobile ? 'bg-blue-50 text-blue-700' : 'bg-blue-600 text-white'
                        : mobile ? 'text-slate-700 hover:bg-slate-100 hover:text-slate-900' : 'text-blue-100/70 hover:text-white hover:bg-white/10'
                    )}
                  >
                    <Pill className="w-4 h-4 shrink-0" />
                    {(mobile || !collapsed) && <span className="flex-1 text-left">Pharmacy</span>}
                    {(mobile || !collapsed) && <ChevronRight className={cn('w-4 h-4 transition-transform', pharmacyOpen && 'rotate-90')} />}
                  </button>
                  {(mobile || !collapsed) && pharmacyOpen && (
                    <div className={cn('mt-1 space-y-0.5', mobile ? 'pl-4' : 'pl-5')}>
                      {visiblePharmacy.map(({ to, icon: Icon, label }) => (
                        <NavLink
                          key={to}
                          to={to}
                          onClick={onNavigate}
                          className={({ isActive }) => cn(
                            'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors',
                            mobile
                              ? isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                              : isActive ? 'bg-white/15 text-white' : 'text-blue-100/60 hover:text-white hover:bg-white/10'
                          )}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          {label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );

  const BottomActions = ({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) => (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => {
          setPasswordModalOpen(true);
          onNavigate?.();
        }}
        title={!mobile && collapsed ? 'Change Password' : undefined}
        className={cn(
          'flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm transition-colors',
          mobile
            ? 'font-medium text-slate-700 hover:bg-slate-100'
            : 'text-blue-100/70 hover:text-white hover:bg-white/10',
          !mobile && collapsed && 'justify-center px-2'
        )}
      >
        <Lock className="w-4 h-4" />
        {(mobile || !collapsed) && 'Change Password'}
      </button>
      <button onClick={onLogout || logout}
        title={!mobile && collapsed ? 'Logout' : undefined}
        className={cn(
          'flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm transition-colors',
          mobile
            ? 'font-medium text-red-600 hover:bg-red-50'
            : 'text-red-300 hover:bg-red-500/20 hover:text-red-200',
          !mobile && collapsed && 'justify-center px-2'
        )}
      >
        <LogOut className="w-4 h-4" />
        {(mobile || !collapsed) && 'Logout'}
      </button>
    </div>
  );

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden hms-shell">

        {drawerOpen && (
          <button
            type="button"
            className="md:hidden fixed inset-0 z-40 bg-black/40 print:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu overlay"
          />
        )}

        <aside
          className={cn(
            'md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[86vw] bg-white flex flex-col shadow-2xl transition-transform duration-300 print:hidden',
            drawerOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <div
            className="flex items-center justify-between px-4 border-b border-slate-100 bg-[#0f2544] shrink-0"
            style={{ paddingTop: 'var(--app-safe-top)', height: 'calc(58px + var(--app-safe-top))' }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <img src={logoUrl} alt="GMH Suite" className="w-8 h-8 object-contain shrink-0" />
              <div className="min-w-0">
                <div className="text-white font-semibold text-sm leading-tight truncate">GMH Suite</div>
                <div className="text-blue-200 text-xs truncate">Management System</div>
              </div>
            </div>
            <button onClick={() => setDrawerOpen(false)} className="p-2 -mr-2 rounded-lg text-blue-100 hover:bg-white/10" aria-label="Close menu">
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
            <NavGroups mobile onNavigate={() => setDrawerOpen(false)} />
          </nav>

          <div
            className="p-3 border-t border-slate-100 shrink-0"
            style={{ paddingBottom: 'calc(var(--app-safe-bottom) + 0.75rem)' }}
          >
            <BottomActions mobile onNavigate={() => setDrawerOpen(false)} />
          </div>
        </aside>

        {/* Sidebar */}
        <aside className={cn(
          'hidden md:flex bg-[#0f2544] flex-col shrink-0 print:hidden transition-all duration-300',
          collapsed ? 'w-16' : 'w-60'
        )}>
          {/* Logo */}
          <div className="flex items-center justify-between px-3 py-4 border-b border-white/10 h-14">
            {!collapsed && (
              <div className="flex items-center gap-2.5 min-w-0">
                <img src={logoUrl} alt="GMH Suite" className="w-8 h-8 object-contain shrink-0" />
                <div className="min-w-0">
                  <div className="text-white font-semibold text-sm leading-tight truncate">GMH Suite</div>
                  <div className="text-blue-300 text-xs truncate">Management System</div>
                </div>
              </div>
            )}
            {collapsed && (
              <img src={logoUrl} alt="GMH Suite" className="w-8 h-8 object-contain mx-auto" />
            )}
            {!collapsed && (
              <button onClick={() => setCollapsed(true)}
                className="p-1.5 text-blue-300/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors shrink-0">
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
          </div>

          {collapsed && (
            <button onClick={() => setCollapsed(false)}
              className="mx-auto mt-2 p-1.5 text-blue-300/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
            <NavGroups />
          </nav>

          {/* Bottom actions */}
          <div className="p-2 border-t border-white/10">
            <BottomActions />
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <TopNavbar userEmail={userEmail} userRole={role} onOpenSidebar={() => setDrawerOpen(true)} />
          <main className="flex-1 overflow-auto">
            <div className="p-4 md:p-6 print:p-0 fade-in">
              <Outlet />
            </div>
          </main>
        </div>
        {passwordModalOpen && (
          <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4 print:hidden">
            <div className="w-full max-w-md rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
              <div className="flex items-center justify-between border-b border-gray-100 p-5">
                <div className="flex items-center gap-2">
                  <Lock className="w-5 h-5 text-blue-600" />
                  <h2 className="font-semibold text-gray-900">Change Password</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setPasswordModalOpen(false)}
                  className="p-1 text-gray-400 hover:text-gray-600"
                  aria-label="Close change password"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5">
                <ChangePasswordForm />
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
