import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, logout } from './firebase';
import { HMSApp } from './hms/HMSApp';
import { GlobalAppNotifications } from './components/GlobalAppNotifications';
import { AppDialogProvider } from './components/AppDialog';
import { DataConnectionBanner } from './components/DataConnectionBanner';
import { ApiConnectionSetup } from './components/ApiConnectionSetup';
import { canAccessApp, type UserProfile } from './lib/permissions';
import { HostingerApiError, loadCurrentProfile, needsRuntimeApiConfiguration } from './lib/hostingerApi';
import { hostingerDocumentStore } from './lib/hostingerDocumentStore';

const PROFILE_CACHE_KEY = 'gmh-suite-current-profile';

function readCachedProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || 'null');
  } catch {
    return null;
  }
}

export default function App() {
  const [user, setUser] = useState<any>(undefined);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [authError, setAuthError] = useState('');
  const [sessionAuthed, setSessionAuthed] = useState(false);

  useEffect(() => {
    if (needsRuntimeApiConfiguration()) {
      setUser(null);
      return;
    }
    const unsub = onAuthStateChanged(auth, async (u) => {
      hostingerDocumentStore.setUserScope(u?.uid || '');
      if (u) {
        setAuthError('');
        setUserEmail(u.email || '');
        try {
          const response = await loadCurrentProfile<UserProfile>();
          const profile = { uid: u.uid, ...response.profile } as UserProfile;
          localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ uid: u.uid, profile }));
          setUserRole(profile.role || 'cashier');
          setUserProfile(profile);
          setSessionAuthed(true);
        } catch (error) {
          const cached = readCachedProfile();
          if (error instanceof HostingerApiError && error.code === 'unavailable' && cached?.uid === u.uid && cached.profile) {
            setUserRole(cached.profile.role || 'cashier');
            setUserProfile(cached.profile);
            setSessionAuthed(true);
            setAuthError('The data service is offline. You can review cached records, but changes are disabled.');
          } else {
            setAuthError(error instanceof Error ? error.message : 'Failed to load your account from the Hostinger data service.');
            await logout();
            setUserProfile(null);
          }
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
      <DataConnectionBanner />
      <GlobalAppNotifications />
      {node}
    </AppDialogProvider>
  );

  if (needsRuntimeApiConfiguration()) {
    return withShell(<ApiConnectionSetup />);
  }

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
