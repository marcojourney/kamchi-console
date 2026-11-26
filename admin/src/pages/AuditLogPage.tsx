import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { adminApi } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { AuditLogEntry } from '../types/license';

const ACTION_OPTIONS = [
  'all',
  'createLicense',
  'renewLicense',
  'reissueLicense',
  'revokeLicense',
  'reinstateLicense',
  'updateBuyerMeta',
  'generateKeypair',
  'importSigningKey',
  'clearSigningKey',
  'exportLicensesCsv',
  'expireOverdueLicenses',
  'importBackup',
] as const;

export function AuditLogPage() {
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts: { append: boolean; cursor?: string | null }) => {
      if (opts.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await adminApi.listAuditLogs({
          action: actionFilter,
          cursor: opts.cursor ?? null,
          limit: 30,
        });
        setItems((prev) => (opts.append ? [...prev, ...res.items] : res.items));
        setNextCursor(res.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load audit log.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [actionFilter]
  );

  useEffect(() => {
    void load({ append: false, cursor: null });
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Audit Log</h1>
          <p className="text-sm text-slate-600 mt-1">
            Chronological log of signing key setup, key issuances, renewals, and backups.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Filter by action"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt === 'all' ? 'All Actions' : opt}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load({ append: false, cursor: null })}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

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
          <div className="p-10 text-center text-sm text-slate-500">
            No audit log entries recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((entry) => (
              <div
                key={entry.id}
                className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-semibold text-teal-800">
                      {entry.action}
                    </span>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="font-mono text-xs text-slate-600">
                      {entry.targetKeyIdHex}
                    </span>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="text-xs text-slate-600">{entry.actor}</span>
                  </div>
                  <p className="text-sm text-slate-800 break-words">{entry.details}</p>
                </div>
                <div className="text-xs text-slate-500 tabular-nums shrink-0">
                  {formatDateTime(entry.createdAt)}
                </div>
              </div>
            ))}
          </div>
        )}

        {nextCursor && (
          <div className="p-4 border-t border-slate-200 flex justify-center">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void load({ append: true, cursor: nextCursor })}
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
