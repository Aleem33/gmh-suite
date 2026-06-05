import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db, logout } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { HMSApp } from './hms/HMSApp';
import { GlobalAppNotifications } from './components/GlobalAppNotifications';
import { AppDialogProvider } from './components/AppDialog';
import { canAccessApp, type UserProfile } from './lib/permissions';

const FIRST_ADMIN_EMAIL = 'admin@gmh-suite.internal';

export default function App() {
  const [user, setUser] = useState<any>(undefined);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [authError, setAuthError] = useState('');
  const [sessionAuthed, setSessionAuthed] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setAuthError('');
      if (u) {
        setUserEmail(u.email || '');
        try {
          const snap = await getDoc(doc(db, 'users', u.uid));
          if (!snap.exists()) {
            if ((u.email || '').toLowerCase() === FIRST_ADMIN_EMAIL) {
              const adminProfile: UserProfile = {
                uid: u.uid,
                name: 'Administrator',
                username: 'admin',
                email: FIRST_ADMIN_EMAIL,
                role: 'admin',
                app: 'all',
                appAccess: ['hms', 'pos'],
                permissions: {},
              };
              await setDoc(doc(db, 'users', u.uid), {
                ...adminProfile,
                createdAt: new Date().toISOString(),
              });
              setUserRole('admin');
              setUserProfile(adminProfile);
            } else {
              setAuthError('Your account has not been configured yet. Please contact your administrator.');
              await logout();
              setUserRole(null);
              setUserProfile(null);
              setUserEmail('');
            }
          } else {
            const profile = { uid: u.uid, ...snap.data() } as UserProfile;
            setUserRole(profile.role || 'cashier');
            setUserProfile(profile);
          }
        } catch {
          setAuthError('Failed to load your account. Make sure the first admin user is configured in Firestore.');
          await logout();
          setUserProfile(null);
        }
      } else {
        setUserRole(null);
        setUserProfile(null);
        setUserEmail('');
        setUser(null);
        setSessionAuthed(false);
        return;
      }
      setUser(u);
    });
    return () => unsub();
  }, []);

  const handleLoginSuccess = () => {
    setSessionAuthed(true);
  };

  const handleLogout = async () => {
    await logout();
    setSessionAuthed(false);
  };

  const withShell = (node: ReactNode) => (
    <AppDialogProvider>
      <GlobalAppNotifications />
      {node}
    </AppDialogProvider>
  );

  if (user === undefined) {
    return withShell(
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm font-medium">Loading GMH Suite...</p>
        </div>
      </div>
    );
  }

  if (!sessionAuthed) {
    return withShell(
      <>
        {authError && (
          <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
            {authError}
          </div>
        )}
        <HMSApp
          userRole={null}
          userEmail=""
          onLoginSuccess={handleLoginSuccess}
        />
      </>
    );
  }

  if (userProfile && !canAccessApp(userProfile, 'hms') && !canAccessApp(userProfile, 'pos')) {
    return withShell(
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 max-w-sm text-center">
          <h1 className="font-semibold text-slate-900 mb-2">Access is not enabled</h1>
          <p className="text-sm text-slate-500 mb-4">Please contact your administrator.</p>
          <button onClick={handleLogout} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">Back to Login</button>
        </div>
      </div>
    );
  }

  return withShell(
    <HMSApp
      userRole={userRole}
      userProfile={userProfile}
      userEmail={userEmail}
      onLoginSuccess={handleLoginSuccess}
      onLogout={handleLogout}
    />
  );
}
