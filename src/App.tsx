import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db, logout } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { AppSelector } from './landing/AppSelector';
import { HMSApp } from './hms/HMSApp';
import { POSApp } from './pos/POSApp';
import { GlobalAppNotifications } from './components/GlobalAppNotifications';
import { AppDialogProvider } from './components/AppDialog';
import { canAccessApp, type UserProfile } from './lib/permissions';

type AppMode = 'hms' | 'pos' | null;
const FIRST_ADMIN_EMAIL = 'admin@gmh-suite.internal';

export default function App() {
  const [appMode, setAppMode]       = useState<AppMode>(null);
  const [user, setUser]             = useState<any>(undefined);   // undefined = still loading
  const [userRole, setUserRole]     = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userEmail, setUserEmail]   = useState('');
  const [authError, setAuthError]   = useState('');

  // sessionAuthed: did the user explicitly log in during THIS app session?
  // Starts false every launch, so always shows AppSelector → Login → App.
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
              await setDoc(doc(db, 'users', u.uid), {
                name: 'Administrator',
                username: 'admin',
                email: FIRST_ADMIN_EMAIL,
                role: 'admin',
                app: 'all',
                appAccess: ['hms', 'pos'],
                permissions: {},
                createdAt: new Date().toISOString(),
              });
              setUserRole('admin');
              setUserProfile({
                uid: u.uid,
                name: 'Administrator',
                username: 'admin',
                email: FIRST_ADMIN_EMAIL,
                role: 'admin',
                app: 'all',
                appAccess: ['hms', 'pos'],
                permissions: {},
              });
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
        // Only go back to selector if we're not in the middle of switching apps
        // (handleSwitchApp / handleSelectApp manage appMode themselves)
        setSessionAuthed(false);
        return;
      }
      setUser(u);
    });
    return () => unsub();
  }, []);

  // Called when user picks an app from the selector
  const handleSelectApp = async (mode: AppMode) => {
    setSessionAuthed(false);
    setAppMode(mode);
    // Sign out any persisted Firebase session silently (don't let
    // onAuthStateChanged reset appMode — we set it right after)
    if (auth.currentUser) {
      await logout();
      // Re-set appMode in case onAuthStateChanged reset it to null
      setAppMode(mode);
    }
  };

  // Called by HMS / POS login page after successful Firebase login
  const handleLoginSuccess = () => {
    setSessionAuthed(true);
  };

  // Called by the Switch App button inside HMS or POS
  const handleSwitchApp = async (targetMode: AppMode) => {
    await logout();
    setSessionAuthed(false);
    setAppMode(targetMode);     // go straight to target app's login
  };

  // Plain logout — go all the way back to AppSelector
  const handleLogout = async () => {
    await logout();
    setSessionAuthed(false);
    setAppMode(null);
  };

  // ── Loading (Firebase resolving persisted auth) ─────────────────────────────
  const withShell = (node: ReactNode) => (
    <AppDialogProvider>
      <GlobalAppNotifications />
      {node}
    </AppDialogProvider>
  );

  if (user === undefined) {
    return (
      withShell(<div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm font-medium">Loading GMH Suite...</p>
        </div>
      </div>)
    );
  }

  // ── Step 1: App Selection ───────────────────────────────────────────────────
  if (!appMode) {
    return withShell(<AppSelector onSelect={handleSelectApp} authError={authError} />);
  }

  // ── Step 2: Login for selected app (sessionAuthed not yet set) ─────────────
  if (!sessionAuthed) {
    if (appMode === 'hms') {
      return withShell(<HMSApp
        userRole={null}
        userEmail=""
        onSwitchApp={handleSwitchApp}
        onLoginSuccess={handleLoginSuccess}
        onBack={() => setAppMode(null)}
      />);
    }
    return withShell(<POSApp
      userRole={null}
      onSwitchApp={handleSwitchApp}
      onLoginSuccess={handleLoginSuccess}
      onBack={() => setAppMode(null)}
    />);
  }

  // ── Step 3: Inside the app ──────────────────────────────────────────────────
  if (appMode === 'hms') {
    if (userProfile && !canAccessApp(userProfile, 'hms')) {
      return withShell(<div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 max-w-sm text-center">
          <h1 className="font-semibold text-slate-900 mb-2">Hospital access is not enabled</h1>
          <p className="text-sm text-slate-500 mb-4">Please switch to an app assigned to your account.</p>
          <button onClick={() => setAppMode(null)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">Choose App</button>
        </div>
      </div>);
    }
    return withShell(<HMSApp
      userRole={userRole}
      userProfile={userProfile}
      userEmail={userEmail}
      onSwitchApp={handleSwitchApp}
      onLoginSuccess={handleLoginSuccess}
      onLogout={handleLogout}
    />);
  }
  if (userProfile && !canAccessApp(userProfile, 'pos')) {
    return withShell(<div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 max-w-sm text-center">
        <h1 className="font-semibold text-slate-900 mb-2">Pharmacy POS access is not enabled</h1>
        <p className="text-sm text-slate-500 mb-4">Please switch to an app assigned to your account.</p>
        <button onClick={() => setAppMode(null)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">Choose App</button>
      </div>
    </div>);
  }
  return withShell(<POSApp
    userRole={userRole}
    userProfile={userProfile}
    onSwitchApp={handleSwitchApp}
    onLoginSuccess={handleLoginSuccess}
    onLogout={handleLogout}
  />);
}
