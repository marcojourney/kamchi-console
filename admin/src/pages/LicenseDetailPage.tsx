import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  CalendarPlus,
  CheckCircle2,
  KeyRound,
  RotateCcw,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { adminApi } from '../lib/api';
import { billingLabel, formatDate, formatDateTime, planLabel } from '../lib/format';
import {
  DEFAULT_MAX_DEVICES,
  type LicensePlan,
  type LicenseRecord,
  type ReissueLicenseResponse,
} from '../types/license';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { KeyRevealCard } from '../components/KeyRevealCard';
import { StatusBadge } from '../components/StatusBadge';

interface LicenseDetailPageProps {
  keyHash: string;
  onBack: () => void;
  onSelectLicense: (keyHash: string) => void;
}

export function LicenseDetailPage({
  keyHash,
  onBack,
  onSelectLicense,
}: LicenseDetailPageProps) {
  const [license, setLicense] = useState<LicenseRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form states for extend & changePlan
  const [customExpiryDate, setCustomExpiryDate] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<LicensePlan>('pro');
  const [maxDevicesInput, setMaxDevicesInput] = useState<number>(2);

  // Confirm dialogs
  const [confirmMode, setConfirmMode] = useState<
    null | 'revoke' | 'resetDevices' | 'reissue'
  >(null);

  // One-time key reveal after reissue
  const [reissuedResult, setReissuedResult] = useState<ReissueLicenseResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getLicense(keyHash);
      setLicense(res.license);
      setSelectedPlan(res.license.plan);
      setMaxDevicesInput(res.license.maxDevices);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load license.');
    } finally {
      setLoading(false);
    }
  }, [keyHash]);

  useEffect(() => {
    setReissuedResult(null);
    setSuccess(null);
    void load();
  }, [load]);

  async function runAction(fn: () => Promise<void>, successMessage: string) {
    setBusyAction(true);
    setError(null);
    setSuccess(null);
    try {
      await fn();
      setSuccess(successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleExtendDays(days: number) {
    await runAction(async () => {
      const res = await adminApi.extendLicense({ keyHash, addDays: days });
      setLicense(res.license);
    }, `Extended license by +${days} days.`);
  }

  async function handleExtendDate(e: React.FormEvent) {
    e.preventDefault();
    if (!customExpiryDate) return;
    const iso = new Date(`${customExpiryDate}T23:59:59.000Z`).toISOString();
    await runAction(async () => {
      const res = await adminApi.extendLicense({ keyHash, newExpiresAt: iso });
      setLicense(res.license);
      setCustomExpiryDate('');
    }, 'Updated expiration date.');
  }

  async function handleSetLifetime() {
    await runAction(async () => {
      const res = await adminApi.extendLicense({ keyHash, newExpiresAt: null });
      setLicense(res.license);
    }, 'Converted license to Lifetime.');
  }

  async function handleChangePlan(e: React.FormEvent) {
    e.preventDefault();
    await runAction(async () => {
      const res = await adminApi.changePlan({
        keyHash,
        plan: selectedPlan,
        maxDevices: maxDevicesInput,
      });
      setLicense(res.license);
    }, `Updated plan to ${planLabel(selectedPlan)} (${maxDevicesInput} max devices).`);
  }

  async function handleReinstate() {
    await runAction(async () => {
      const res = await adminApi.reinstateLicense(keyHash);
      setLicense(res.license);
    }, 'License reinstated to Active status.');
  }

  async function handleRemoveDevice(deviceId: string) {
    await runAction(async () => {
      const res = await adminApi.removeDevice({ keyHash, deviceId });
      setLicense(res.license);
    }, `Removed device ${deviceId}.`);
  }

  async function handleConfirmSubmit(reason: string) {
    if (confirmMode === 'revoke') {
      await runAction(async () => {
        const res = await adminApi.revokeLicense({ keyHash, reason });
        setLicense(res.license);
        setConfirmMode(null);
      }, 'License revoked.');
    } else if (confirmMode === 'resetDevices') {
      await runAction(async () => {
        const res = await adminApi.resetDevices(keyHash);
        setLicense(res.license);
        setConfirmMode(null);
      }, 'All bound devices cleared.');
    } else if (confirmMode === 'reissue') {
      await runAction(async () => {
        const res = await adminApi.reissueLicense({
          keyHash,
          reason: reason || undefined,
        });
        setReissuedResult(res);
        setConfirmMode(null);
        await load();
      }, 'Replacement key issued and old key revoked.');
    }
  }

  if (loading && !license) {
    return <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Licenses
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-red-200 bg-red-50 text-red-900">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-700" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900">
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-700" />
          <div className="text-sm">{success}</div>
        </div>
      )}

      {reissuedResult && (
        <KeyRevealCard
          result={reissuedResult}
          title="Replacement License Key Issued"
          onViewDetail={(newHash) => onSelectLicense(newHash)}
        />
      )}

      {license && (
        <>
          {/* Summary header card */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-xl font-semibold text-slate-900">
                    {license.buyerContact || 'Unnamed Buyer'}
                  </h1>
                  <StatusBadge status={license.status} />
                </div>
                <p className="text-sm text-slate-600">
                  {planLabel(license.plan)} · {billingLabel(license.billing)} ·{' '}
                  <span className="font-mono tabular-nums">
                    {license.devices.length}/{license.maxDevices}
                  </span>{' '}
                  devices bound
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {license.status !== 'active' && (
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void handleReinstate()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Reinstate
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => setConfirmMode('reissue')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg transition-colors whitespace-nowrap"
                >
                  <KeyRound className="w-4 h-4" />
                  Reissue Key
                </button>
                {license.status !== 'revoked' && (
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => setConfirmMode('revoke')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-red-800 bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Ban className="w-4 h-4" />
                    Revoke
                  </button>
                )}
              </div>
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-slate-100 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Key Hash (HMAC-SHA256)</dt>
                <dd className="mt-1 font-mono text-xs text-slate-800 break-all">{license.keyHash}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Issued At</dt>
                <dd className="mt-1 text-slate-900 tabular-nums">{formatDateTime(license.issuedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Expires At</dt>
                <dd className="mt-1 text-slate-900 font-medium tabular-nums">
                  {formatDate(license.expiresAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Notes</dt>
                <dd className="mt-1 text-slate-700">{license.notes || '—'}</dd>
              </div>
            </dl>

            {(license.revokedReason || license.reissuedFromPrefix || license.reissuedToPrefix) && (
              <div className="pt-4 border-t border-slate-100 text-sm space-y-1 text-slate-700">
                {license.revokedReason && (
                  <div>
                    <span className="font-medium text-red-800">Revocation reason:</span>{' '}
                    {license.revokedReason} ({formatDateTime(license.revokedAt)})
                  </div>
                )}
                {license.reissuedFromPrefix && (
                  <div>
                    <span className="font-medium text-slate-700">Reissued from:</span>{' '}
                    <span className="font-mono text-xs">{license.reissuedFromPrefix}</span>
                  </div>
                )}
                {license.reissuedToPrefix && (
                  <div>
                    <span className="font-medium text-slate-700">Superseded by:</span>{' '}
                    <span className="font-mono text-xs">{license.reissuedToPrefix}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions grid: Extend & Change Plan */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2">
                <CalendarPlus className="w-4 h-4 text-teal-700" />
                <h2 className="text-base font-semibold text-slate-900">Extend Expiration</h2>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyAction || license.status === 'revoked' || license.expiresAt === null}
                  onClick={() => void handleExtendDays(30)}
                  className="px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  +30 Days
                </button>
                <button
                  type="button"
                  disabled={busyAction || license.status === 'revoked' || license.expiresAt === null}
                  onClick={() => void handleExtendDays(365)}
                  className="px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  +365 Days
                </button>
                <button
                  type="button"
                  disabled={busyAction || license.status === 'revoked' || license.expiresAt === null}
                  onClick={() => void handleSetLifetime()}
                  className="px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  Set Lifetime
                </button>
              </div>

              <form onSubmit={handleExtendDate} className="flex flex-wrap items-center gap-2 pt-2">
                <input
                  type="date"
                  value={customExpiryDate}
                  onChange={(e) => setCustomExpiryDate(e.target.value)}
                  disabled={busyAction || license.status === 'revoked'}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                <button
                  type="submit"
                  disabled={busyAction || !customExpiryDate || license.status === 'revoked'}
                  className="px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  Set Date
                </button>
              </form>
            </section>

            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <h2 className="text-base font-semibold text-slate-900">Change Plan &amp; Device Limit</h2>
              <form onSubmit={handleChangePlan} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div className="space-y-1">
                  <label htmlFor="detail-plan" className="block text-xs font-medium text-slate-600">
                    Plan
                  </label>
                  <select
                    id="detail-plan"
                    value={selectedPlan}
                    onChange={(e) => {
                      const nextPlan = e.target.value as LicensePlan;
                      setSelectedPlan(nextPlan);
                      setMaxDevicesInput(DEFAULT_MAX_DEVICES[nextPlan]);
                    }}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  >
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="business">Business</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="detail-max-devices" className="block text-xs font-medium text-slate-600">
                    Max Devices
                  </label>
                  <input
                    id="detail-max-devices"
                    type="number"
                    min={1}
                    max={100}
                    value={maxDevicesInput}
                    onChange={(e) => setMaxDevicesInput(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>

                <button
                  type="submit"
                  disabled={busyAction}
                  className="px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  Save Plan
                </button>
              </form>
            </section>
          </div>

          {/* Devices list */}
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-slate-600" />
                <h2 className="text-base font-semibold text-slate-900">
                  Activated Devices ({license.devices.length}/{license.maxDevices})
                </h2>
              </div>
              {license.devices.length > 0 && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => setConfirmMode('resetDevices')}
                  className="px-3.5 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg transition-colors whitespace-nowrap"
                >
                  Reset All Devices
                </button>
              )}
            </div>

            {license.devices.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No devices have activated this license yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {license.devices.map((dev) => (
                  <div
                    key={dev.deviceId}
                    className="px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {dev.label || 'Unnamed Device'}
                      </div>
                      <div className="text-xs text-slate-500 font-mono truncate">
                        ID: {dev.deviceId}
                      </div>
                      <div className="text-xs text-slate-500 tabular-nums">
                        Activated {formatDateTime(dev.activatedAt)} · Last seen{' '}
                        {formatDateTime(dev.lastSeenAt)}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={() => void handleRemoveDevice(dev.deviceId)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors shrink-0 self-start sm:self-center whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <ConfirmDialog
        open={confirmMode === 'revoke'}
        title="Revoke License Key"
        description="Revoking immediately blocks this key from activating new devices or validating in KamChi. Provide a reason for the audit log."
        confirmLabel="Revoke License"
        tone="danger"
        requireReason
        reasonLabel="Revocation reason"
        reasonPlaceholder="e.g. Refunded ABA transfer, chargeback, or abused key"
        busy={busyAction}
        onCancel={() => setConfirmMode(null)}
        onConfirm={(reason) => void handleConfirmSubmit(reason)}
      />

      <ConfirmDialog
        open={confirmMode === 'resetDevices'}
        title="Reset All Bound Devices"
        description="This clears every activated device from this license so the customer can activate on new phones."
        confirmLabel="Reset Devices"
        tone="danger"
        busy={busyAction}
        onCancel={() => setConfirmMode(null)}
        onConfirm={() => void handleConfirmSubmit('')}
      />

      <ConfirmDialog
        open={confirmMode === 'reissue'}
        title="Reissue License Key"
        description="Because plain keys cannot be recovered, this creates a brand-new key for the same buyer, plan, and expiry, and immediately revokes the old key."
        confirmLabel="Reissue New Key"
        tone="primary"
        requireReason={false}
        busy={busyAction}
        onCancel={() => setConfirmMode(null)}
        onConfirm={(reason) => void handleConfirmSubmit(reason)}
      />
    </div>
  );
}
