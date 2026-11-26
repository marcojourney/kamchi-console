import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, ArrowRight, Plus, RefreshCw } from 'lucide-react';
import { adminApi } from '../lib/api';
import { billingLabel, daysUntil, formatDate, formatDateTime, planLabel } from '../lib/format';
import type { DashboardSummary } from '../types/license';
import { StatusBadge } from '../components/StatusBadge';

interface DashboardPageProps {
  onNavigateCreate: () => void;
  onSelectLicense: (keyIdHex: string) => void;
  onNavigateLicenses: () => void;
  onOpenSigningSettings: () => void;
}

export function DashboardPage({
  onNavigateCreate,
  onSelectLicense,
  onNavigateLicenses,
  onOpenSigningSettings,
}: DashboardPageProps) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const signingStatus = adminApi.getSigningKeyStatus();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApi.getDashboardSummary();
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !summary) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Overview</h1>
          <p className="text-sm text-slate-600 mt-1">
            KamChi offline Ed25519 license summary, expiring keys, and recent issuances.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={onNavigateCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Issue Key
          </button>
        </div>
      </div>

      {!signingStatus.hasKey && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-950">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-700" />
            <div className="text-sm">
              <span className="font-semibold">Signing key not loaded yet.</span> Import your
              Ed25519 private key or generate a new keypair to start issuing offline{' '}
              <code className="font-mono text-xs">KC1-</code> licenses.
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenSigningSettings}
            className="px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Configure Signing Key
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-red-200 bg-red-50 text-red-900">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-700" />
          <div className="text-sm leading-relaxed">{error}</div>
        </div>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-medium text-slate-500">Total Issued</div>
              <div className="mt-2 text-3xl font-semibold text-slate-900 tabular-nums font-mono">
                {summary.total}
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Pro {summary.byPlan.pro} · Business {summary.byPlan.business}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-medium text-slate-500">Active</div>
              <div className="mt-2 text-3xl font-semibold text-emerald-700 tabular-nums font-mono">
                {summary.byStatus.active}
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Bound {summary.byBinding.bound} · Unbound {summary.byBinding.unbound}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-medium text-slate-500">Expiring in 14 Days</div>
              <div className="mt-2 text-3xl font-semibold text-amber-700 tabular-nums font-mono">
                {summary.expiringNext14Days.length}
              </div>
              <div className="mt-2 text-xs text-slate-500">Active keys nearing renewal</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-medium text-slate-500">Expired / Superseded</div>
              <div className="mt-2 text-3xl font-semibold text-slate-900 tabular-nums font-mono">
                {summary.byStatus.expired + summary.byStatus.revoked}
              </div>
              <div className="mt-2 text-xs text-slate-500">
                {summary.byStatus.expired} expired · {summary.byStatus.revoked} revoked
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">Expiring in Next 14 Days</h2>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  {summary.expiringNext14Days.length} keys
                </span>
              </div>

              {summary.expiringNext14Days.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No active licenses expire within the next 14 days.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {summary.expiringNext14Days.map((lic) => {
                    const left = daysUntil(lic.expiresAt);
                    return (
                      <button
                        key={lic.keyIdHex}
                        type="button"
                        onClick={() => onSelectLicense(lic.keyIdHex)}
                        className="w-full text-left px-5 py-3.5 hover:bg-slate-50 transition-colors flex items-center justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-medium text-slate-700">
                              {lic.keyIdHex}
                            </span>
                            <span className="text-sm font-medium text-slate-900 truncate">
                              {lic.buyerContact || 'No contact'}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {planLabel(lic.plan)} · {billingLabel(lic.billing)} · Expires{' '}
                            {formatDate(lic.expiresAt)}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs font-mono tabular-nums font-medium text-amber-700">
                            {left !== null ? `${left}d left` : ''}
                          </span>
                          <StatusBadge status={lic.status} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">Recently Issued Keys</h2>
                <button
                  type="button"
                  onClick={onNavigateLicenses}
                  className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800 whitespace-nowrap"
                >
                  View all
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {summary.recentLicenses.length === 0 ? (
                <div className="p-8 text-center space-y-3">
                  <p className="text-sm text-slate-500">No offline keys issued yet.</p>
                  <button
                    type="button"
                    onClick={onNavigateCreate}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" />
                    Issue First Key
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {summary.recentLicenses.map((lic) => (
                    <button
                      key={lic.keyIdHex}
                      type="button"
                      onClick={() => onSelectLicense(lic.keyIdHex)}
                      className="w-full text-left px-5 py-3.5 hover:bg-slate-50 transition-colors flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-slate-800">
                            {lic.keyIdHex}
                          </span>
                          <span className="text-sm font-medium text-slate-900 truncate">
                            {lic.buyerContact || 'No buyer contact'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate">
                          {planLabel(lic.plan)} · {billingLabel(lic.billing)} ·{' '}
                          {lic.bindingMode === 'bound' && lic.deviceCode
                            ? lic.deviceCode
                            : 'Unbound'}
                        </div>
                      </div>
                      <div className="text-xs text-slate-500 tabular-nums shrink-0">
                        {formatDateTime(lic.issuedAt)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
