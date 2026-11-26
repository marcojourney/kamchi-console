import { useState } from 'react';
import {
  ClipboardList,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  PlusCircle,
  Settings,
} from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { adminApi } from './lib/api';
import { AuditLogPage } from './pages/AuditLogPage';
import { CreateLicensePage } from './pages/CreateLicensePage';
import { DashboardPage } from './pages/DashboardPage';
import { LicenseDetailPage } from './pages/LicenseDetailPage';
import { LicensesPage } from './pages/LicensesPage';
import { SettingsPage } from './pages/SettingsPage';

type Route =
  | { page: 'dashboard' }
  | { page: 'licenses' }
  | { page: 'detail'; keyIdHex: string }
  | { page: 'create' }
  | { page: 'audit' }
  | { page: 'settings' };

function AdminShell() {
  const [route, setRoute] = useState<Route>({ page: 'dashboard' });
  const [signingStatus, setSigningStatus] = useState(() => adminApi.getSigningKeyStatus());

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'licenses', label: 'Issued Keys', icon: ListChecks },
    { id: 'create', label: 'Issue Key', icon: PlusCircle },
    { id: 'audit', label: 'Audit Log', icon: ClipboardList },
    { id: 'settings', label: 'Key & Backup', icon: Settings },
  ] as const;

  const activeNav = route.page === 'detail' ? 'licenses' : route.page;

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
            KamChi Console
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

        <div className="p-4 border-t border-slate-200 text-xs space-y-1">
          <div className="flex items-center gap-2 font-medium text-slate-700">
            <KeyRound className="w-3.5 h-3.5 shrink-0 text-teal-700" />
            <span>{signingStatus.hasKey ? 'Ed25519 Key Ready' : 'No Signing Key'}</span>
          </div>
          {signingStatus.publicKeyHex && (
            <div className="font-mono text-[11px] text-slate-500 truncate">
              {signingStatus.publicKeyHex.slice(0, 16)}...
            </div>
          )}
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 lg:pl-60 flex flex-col min-h-screen pb-16 lg:pb-0">
        {/* Top Bar */}
        <header className="h-14 lg:h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <span className="lg:hidden font-bold text-slate-900 whitespace-nowrap">
              KamChi Console
            </span>
            <span className="hidden lg:inline text-sm text-slate-500 whitespace-nowrap">
              KamChi (កម្ចី) · Offline Ed25519 License Generator
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setRoute({ page: 'settings' })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
            >
              <KeyRound className="w-3.5 h-3.5 text-teal-700" />
              {signingStatus.hasKey ? 'Signing Key Ready' : 'Set Signing Key'}
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto">
          {route.page === 'dashboard' && (
            <DashboardPage
              onNavigateCreate={() => setRoute({ page: 'create' })}
              onNavigateLicenses={() => setRoute({ page: 'licenses' })}
              onSelectLicense={(keyIdHex) => setRoute({ page: 'detail', keyIdHex })}
              onOpenSigningSettings={() => setRoute({ page: 'settings' })}
            />
          )}
          {route.page === 'licenses' && (
            <LicensesPage
              onNavigateCreate={() => setRoute({ page: 'create' })}
              onSelectLicense={(keyIdHex) => setRoute({ page: 'detail', keyIdHex })}
            />
          )}
          {route.page === 'detail' && (
            <LicenseDetailPage
              keyIdHex={route.keyIdHex}
              onBack={() => setRoute({ page: 'licenses' })}
              onSelectLicense={(keyIdHex) => setRoute({ page: 'detail', keyIdHex })}
            />
          )}
          {route.page === 'create' && (
            <CreateLicensePage
              onViewDetail={(keyIdHex) => setRoute({ page: 'detail', keyIdHex })}
              onOpenSigningSettings={() => setRoute({ page: 'settings' })}
            />
          )}
          {route.page === 'audit' && <AuditLogPage />}
          {route.page === 'settings' && (
            <SettingsPage
              onSigningKeyChanged={() => setSigningStatus(adminApi.getSigningKeyStatus())}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-14 bg-white border-t border-slate-200 grid grid-cols-5"
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
              <span className="truncate max-w-full px-1">{item.label}</span>
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
