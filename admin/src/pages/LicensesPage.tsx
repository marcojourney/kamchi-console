import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Download, Plus, Search } from 'lucide-react';
import { adminApi } from '../lib/api';
import { billingLabel, formatDate, planLabel } from '../lib/format';
import type { BindingMode, LicensePlan, LicenseRecord, LicenseStatus } from '../types/license';
import { StatusBadge } from '../components/StatusBadge';

interface LicensesPageProps {
  onSelectLicense: (keyIdHex: string) => void;
  onNavigateCreate: () => void;
}

export function LicensesPage({ onSelectLicense, onNavigateCreate }: LicensesPageProps) {
  const [queryInput, setQueryInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<LicenseStatus | 'all'>('all');
  const [planFilter, setPlanFilter] = useState<LicensePlan | 'all'>('all');
  const [bindingFilter, setBindingFilter] = useState<BindingMode | 'all'>('all');

  const [items, setItems] = useState<LicenseRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchLicenses = useCallback(
    async (opts: { append: boolean; cursor?: string | null }) => {
      if (opts.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const res = await adminApi.listLicenses({
          query: appliedQuery || undefined,
          status: statusFilter,
          plan: planFilter,
          bindingMode: bindingFilter,
          cursor: opts.cursor ?? null,
          limit: 25,
        });
        setItems((prev) => (opts.append ? [...prev, ...res.items] : res.items));
        setNextCursor(res.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load licenses.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [appliedQuery, statusFilter, planFilter, bindingFilter]
  );

  useEffect(() => {
    void fetchLicenses({ append: false, cursor: null });
  }, [fetchLicenses]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAppliedQuery(queryInput.trim());
  }

  async function handleExportCsv() {
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await adminApi.exportLicensesCsv({
        status: statusFilter,
        plan: planFilter,
      });
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kamchi-licenses-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setNotice(`Exported ${res.count} license row(s) with masked keys only.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export CSV.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Issued Keys Log</h1>
          <p className="text-sm text-slate-600 mt-1">
            Search by Key ID, buyer contact, Device Code, or order notes. Full keys are masked.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => void handleExportCsv()}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting...' : 'Export CSV'}
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

      {/* Filters toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 lg:space-y-0 lg:flex lg:items-center lg:gap-3">
        <form onSubmit={handleSearchSubmit} className="flex-1 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Search Key ID, buyer contact, Device Code, or ABA note..."
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
          >
            Search
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as LicenseStatus | 'all')}
            className="px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="revoked">Revoked</option>
          </select>

          <select
            aria-label="Filter by plan"
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value as LicensePlan | 'all')}
            className="px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="all">All Plans</option>
            <option value="pro">Pro</option>
            <option value="business">Business</option>
          </select>

          <select
            aria-label="Filter by binding"
            value={bindingFilter}
            onChange={(e) => setBindingFilter(e.target.value as BindingMode | 'all')}
            className="px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="all">All Bindings</option>
            <option value="bound">Device-Bound</option>
            <option value="unbound">Unbound</option>
          </select>
        </div>
      </div>

      {notice && (
        <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 text-sm">
          {notice}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-red-200 bg-red-50 text-red-900">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-700" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="divide-y divide-slate-100">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="h-14 px-5 py-3 animate-pulse bg-slate-50/40" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-slate-600">
              No issued keys match your current search or filter criteria.
            </p>
            <button
              type="button"
              onClick={onNavigateCreate}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              Issue First License Key
            </button>
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4">Key ID</th>
                    <th className="py-3 px-4">Buyer Contact</th>
                    <th className="py-3 px-4">Plan &amp; Billing</th>
                    <th className="py-3 px-4">Binding</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Expires</th>
                    <th className="py-3 px-4">Masked Key</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {items.map((lic) => (
                    <tr
                      key={lic.keyIdHex}
                      onClick={() => onSelectLicense(lic.keyIdHex)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-800 whitespace-nowrap">
                        {lic.keyIdHex}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900 max-w-[180px] truncate">
                        {lic.buyerContact || <span className="text-slate-400 font-normal">—</span>}
                      </td>
                      <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                        {planLabel(lic.plan)} · {billingLabel(lic.billing)}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                        {lic.bindingMode === 'bound' && lic.deviceCode ? lic.deviceCode : 'Unbound'}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <StatusBadge status={lic.status} />
                      </td>
                      <td className="py-3 px-4 text-slate-700 tabular-nums whitespace-nowrap">
                        {formatDate(lic.expiresAt)}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 whitespace-nowrap">
                        {lic.maskedKey}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-slate-100">
              {items.map((lic) => (
                <button
                  key={lic.keyIdHex}
                  type="button"
                  onClick={() => onSelectLicense(lic.keyIdHex)}
                  className="w-full text-left p-4 hover:bg-slate-50 transition-colors space-y-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs font-semibold text-slate-800">
                      {lic.keyIdHex}
                    </span>
                    <StatusBadge status={lic.status} />
                  </div>
                  <div className="text-sm font-medium text-slate-900 truncate">
                    {lic.buyerContact || 'No buyer contact'}
                  </div>
                  <div className="text-xs text-slate-500 flex items-center justify-between gap-2">
                    <span>
                      {planLabel(lic.plan)} · {billingLabel(lic.billing)} ·{' '}
                      {lic.bindingMode === 'bound' && lic.deviceCode ? lic.deviceCode : 'Unbound'}
                    </span>
                    <span className="tabular-nums">{formatDate(lic.expiresAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {nextCursor && (
          <div className="p-4 border-t border-slate-200 flex justify-center">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void fetchLicenses({ append: true, cursor: nextCursor })}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {loadingMore ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
