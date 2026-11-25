import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  ClipboardList,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  LogOut,
  PlusCircle,
  ShieldAlert,
} from 'lucide-react';
import { auth, FIREBASE_PROJECT_ID, googleProvider } from './lib/firebase';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuditLogPage } from './pages/AuditLogPage';
import { CreateLicensePage } from './pages/CreateLicensePage';
import { DashboardPage } from './pages/DashboardPage';
import { LicenseDetailPage } from './pages/LicenseDetailPage';
import { LicensesPage } from './pages/LicensesPage';

type Route =
  | { page: 'dashboard' }
  | { page: 'licenses' }
  | { page: 'detail'; keyHash: string }
  | { page: 'create' }
  | { page: 'audit' };

function AdminShell() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdminClaim, setIsAdminClaim] = useState<boolean | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [route, setRoute] = useState<Route>({ page: 'dashboard' });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthError(null);
      if (!nextUser) {
        setIsAdminClaim(null);
        setAuthLoading(false);
        return;
      }

      try {
        const tokenResult = await nextUser.getIdTokenResult(true);
        setIsAdminClaim(tokenResult.claims.admin === true);
      } catch (err) {
        setIsAdminClaim(false);
        setAuthError(
          err instanceof Error ? err.message : 'Unable to verify admin custom claim.'
        );
      } finally {
        setAuthLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  async function handleSignIn() {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setSigningIn(false);
    }
  }

  async function handleSignOut() {
    await signOut(auth);
    setRoute({ page: 'dashboard' });
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-sm text-slate-600">Checking session...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8 space-y-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-teal-800 font-semibold text-sm">
              <KeyRound className="w-4 h-4" />
              KamChi (កម្ចី)
            </div>
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
              License Admin Console
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Sign in with an authorized Google account carrying the{' '}
              <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                admin=true
              </code>{' '}
              claim to issue and manage KamChi licenses.
            </p>
          </div>

          {authError && (
            <div className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-red-900 text-sm">
              {authError}
            </div>
          )}

          <button
            type="button"
            disabled={signingIn}
            onClick={() => void handleSignIn()}
            className="w-full px-4 py-3 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {signingIn ? 'Signing in...' : 'Sign in with Google'}
          </button>

          <div className="pt-4 border-t border-slate-100 text-xs text-slate-500">
            Project: <span className="font-mono text-slate-700">{FIREBASE_PROJECT_ID}</span>
          </div>
        </div>
      </div>
    );
  }

  if (isAdminClaim === false) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-8 space-y-5">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-red-50 text-red-700 shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h1 className="text-lg font-semibold text-slate-900">Admin Claim Required</h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                Signed in as <span className="font-medium text-slate-900">{user.email}</span>,
                but this account does not have the{' '}
                <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">
                  admin: true
                </code>{' '}
                Firebase Auth custom claim.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-2">
            <div className="font-medium text-slate-900">Grant access from your terminal:</div>
            <pre className="font-mono overflow-x-auto text-slate-800">
              npx tsx scripts/setAdminClaim.ts --email {user.email} --grant
            </pre>
            <div>Then sign out and sign back in to refresh your ID token.</div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'licenses', label: 'Licenses', icon: ListChecks },
    { id: 'create', label: 'Create', icon: PlusCircle },
    { id: 'audit', label: 'Audit Log', icon: ClipboardList },
  ] as const;

  const activeNav =
    route.page === 'detail' ? 'licenses' : route.page;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-60 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-slate-200">
        <div className="h-16 px-5 flex items-center border-b border-slate-200">
          <button
            type="button"
            onClick={() => setRoute({ page: 'dashboard' })}
            className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap"
          >
            KamChi Admin
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setRoute({ page: item.id })}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-teal-50 text-teal-800'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="text-xs text-slate-500 truncate" title={user.email ?? ''}>
            {user.email}
          </div>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 lg:pl-60 flex flex-col min-h-screen pb-16 lg:pb-0">
        {/* Top Bar (compact single row) */}
        <header className="h-14 lg:h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <span className="lg:hidden font-bold text-slate-900 whitespace-nowrap">
              KamChi Admin
            </span>
            <span className="hidden lg:inline text-sm text-slate-500 whitespace-nowrap">
              Project <span className="font-mono text-slate-800">{FIREBASE_PROJECT_ID}</span>
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline text-xs text-slate-600 truncate max-w-[200px]">
              {user.email}
            </span>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="lg:hidden inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto">
          {route.page === 'dashboard' && (
            <DashboardPage
              onNavigateCreate={() => setRoute({ page: 'create' })}
              onNavigateLicenses={() => setRoute({ page: 'licenses' })}
              onSelectLicense={(keyHash) => setRoute({ page: 'detail', keyHash })}
            />
          )}
          {route.page === 'licenses' && (
            <LicensesPage
              onNavigateCreate={() => setRoute({ page: 'create' })}
              onSelectLicense={(keyHash) => setRoute({ page: 'detail', keyHash })}
            />
          )}
          {route.page === 'detail' && (
            <LicenseDetailPage
              keyHash={route.keyHash}
              onBack={() => setRoute({ page: 'licenses' })}
              onSelectLicense={(keyHash) => setRoute({ page: 'detail', keyHash })}
            />
          )}
          {route.page === 'create' && (
            <CreateLicensePage
              onViewDetail={(keyHash) => setRoute({ page: 'detail', keyHash })}
            />
          )}
          {route.page === 'audit' && <AuditLogPage />}
        </main>
      </div>

      {/* Mobile Bottom Nav (compact <= 56px, well under 15% mobile sticky cap) */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-14 bg-white border-t border-slate-200 grid grid-cols-4"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeNav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setRoute({ page: item.id })}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                active ? 'text-teal-700' : 'text-slate-500'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AdminShell />
    </ErrorBoundary>
  );
}
