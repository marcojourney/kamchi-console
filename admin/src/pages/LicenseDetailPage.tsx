import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  CalendarPlus,
  CheckCircle2,
  KeyRound,
  RotateCcw,
  Save,
} from 'lucide-react';
import { adminApi } from '../lib/api';
import { billingLabel, formatDate, formatDateTime, planLabel } from '../lib/format';
import { normalizeDeviceCode, validateDeviceCode } from '../lib/offlineLicense';
import type {
  BindingMode,
  LicenseBilling,
  LicensePlan,
  LicenseRecord,
  ReissueLicenseResponse,
} from '../types/license';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { KeyRevealCard } from '../components/KeyRevealCard';
import { StatusBadge } from '../components/StatusBadge';

interface LicenseDetailPageProps {
  keyIdHex: string;
  onBack: () => void;
  onSelectLicense: (keyIdHex: string) => void;
}

export function LicenseDetailPage({
  keyIdHex,
  onBack,
  onSelectLicense,
}: LicenseDetailPageProps) {
  const [license, setLicense] = useState<LicenseRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Editable buyer metadata
  const [buyerContactInput, setBuyerContactInput] = useState('');
  const [notesInput, setNotesInput] = useState('');

  // Renew state
  const [renewBilling, setRenewBilling] = useState<LicenseBilling>('yearly');
  const [renewDays, setRenewDays] = useState<number>(365);

  // Reissue for new phone state
  const [reissuePlan, setReissuePlan] = useState<LicensePlan>('pro');
  const [reissueBinding, setReissueBinding] = useState<BindingMode>('bound');
  const [reissueDeviceCode, setReissueDeviceCode] = useState('');

  // Confirm dialogs
  const [confirmMode, setConfirmMode] = useState<null | 'revoke' | 'reissue'>(null);

  // One-time reveal after renew or reissue
  const [revealedKey, setRevealedKey] = useState<ReissueLicenseResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getLicense(keyIdHex);
      setLicense(res.license);
      setBuyerContactInput(res.license.buyerContact);
      setNotesInput(res.license.notes);
      setRenewBilling(res.license.billing);
      setRenewDays(res.license.billing === 'monthly' ? 30 : 365);
      setReissuePlan(res.license.plan);
      setReissueBinding(res.license.bindingMode);
      setReissueDeviceCode(res.license.deviceCode ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load license.');
    } finally {
      setLoading(false);
    }
  }, [keyIdHex]);

  useEffect(() => {
    setRevealedKey(null);
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

  async function handleSaveMeta(e: React.FormEvent) {
    e.preventDefault();
    await runAction(async () => {
      const res = await adminApi.updateBuyerMeta({
        keyIdHex,
        buyerContact: buyerContactInput,
        notes: notesInput,
      });
      setLicense(res.license);
    }, 'Updated buyer contact and notes.');
  }

  async function handleRenew(e: React.FormEvent) {
    e.preventDefault();
    await runAction(async () => {
      const res = await adminApi.renewLicense({
        keyIdHex,
        billing: renewBilling,
        durationDays: renewBilling === 'lifetime' ? undefined : renewDays,
      });
      setRevealedKey(res);
      await load();
    }, `Renewed license and generated replacement KC1 key (${renewBilling}).`);
  }

  async function handleReinstate() {
    await runAction(async () => {
      const res = await adminApi.reinstateLicense(keyIdHex);
      setLicense(res.license);
    }, 'Marked license active in the local log.');
  }

  async function handleConfirmSubmit(reason: string) {
    if (confirmMode === 'revoke') {
      await runAction(async () => {
        const res = await adminApi.revokeLicense({ keyIdHex, reason });
        setLicense(res.license);
        setConfirmMode(null);
      }, 'Marked license as revoked in the log.');
    } else if (confirmMode === 'reissue') {
      if (reissueBinding === 'bound' && !validateDeviceCode(reissueDeviceCode).valid) {
        setError('Device Code must match ABCDE-FGHIJ (A-Z, 2-7).');
        setConfirmMode(null);
        return;
      }
      await runAction(async () => {
        const res = await adminApi.reissueLicense({
          keyIdHex,
          plan: reissuePlan,
          bindingMode: reissueBinding,
          deviceCode: reissueBinding === 'bound' ? reissueDeviceCode : undefined,
          reason: reason || undefined,
        });
        setRevealedKey(res);
        setConfirmMode(null);
        await load();
      }, 'Reissued new offline KC1 key for customer.');
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
          Back to Issued Keys
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

      {revealedKey && (
        <KeyRevealCard
          result={revealedKey}
          title="New Replacement KC1 Key"
          onViewDetail={(newId) => onSelectLicense(newId)}
        />
      )}

      {license && (
        <>
          {/* Summary header */}
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
                  Key ID <span className="font-mono text-slate-900">{license.keyIdHex}</span> ·{' '}
                  {planLabel(license.plan)} · {billingLabel(license.billing)} ·{' '}
                  {license.bindingMode === 'bound' && license.deviceCode
                    ? `Bound to ${license.deviceCode}`
                    : 'Unbound'}
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
                    Mark Active
                  </button>
                )}
                {license.status !== 'revoked' && (
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => setConfirmMode('revoke')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-red-800 bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Ban className="w-4 h-4" />
                    Mark Revoked
                  </button>
                )}
              </div>
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-slate-100 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Masked Key</dt>
                <dd className="mt-1 font-mono text-xs text-slate-800 break-all">{license.maskedKey}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Issued (Day {license.issuedAtDay})</dt>
                <dd className="mt-1 text-slate-900 tabular-nums">{formatDateTime(license.issuedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">
                  Expires ({license.expiresAtDay === 0 ? 'Lifetime' : `Day ${license.expiresAtDay}`})
                </dt>
                <dd className="mt-1 text-slate-900 font-medium tabular-nums">
                  {formatDate(license.expiresAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Device Hash (8B Hex)</dt>
                <dd className="mt-1 font-mono text-xs text-slate-700 break-all">
                  {license.deviceCodeHashHex}
                </dd>
              </div>
            </dl>

            {(license.revokedReason || license.reissuedFromKeyId || license.reissuedToKeyId) && (
              <div className="pt-4 border-t border-slate-100 text-sm space-y-1 text-slate-700">
                {license.revokedReason && (
                  <div>
                    <span className="font-medium text-red-800">Log note:</span>{' '}
                    {license.revokedReason} ({formatDateTime(license.revokedAt)})
                  </div>
                )}
                {license.reissuedFromKeyId && (
                  <div>
                    <span className="font-medium text-slate-700">Replaced key:</span>{' '}
                    <button
                      type="button"
                      onClick={() => onSelectLicense(license.reissuedFromKeyId!)}
                      className="font-mono text-xs text-teal-700 underline"
                    >
                      {license.reissuedFromKeyId}
                    </button>
                  </div>
                )}
                {license.reissuedToKeyId && (
                  <div>
                    <span className="font-medium text-slate-700">Superseded by:</span>{' '}
                    <button
                      type="button"
                      onClick={() => onSelectLicense(license.reissuedToKeyId!)}
                      className="font-mono text-xs text-teal-700 underline"
                    >
                      {license.reissuedToKeyId}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Renew & Reissue for new phone */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2">
                <CalendarPlus className="w-4 h-4 text-teal-700" />
                <h2 className="text-base font-semibold text-slate-900">Renew License</h2>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Signs a fresh <code className="font-mono">KC1-</code> key starting today for the
                same buyer and device binding.
              </p>

              <form onSubmit={(e) => void handleRenew(e)} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="renew-billing" className="block text-xs font-medium text-slate-600">
                      Billing
                    </label>
                    <select
                      id="renew-billing"
                      value={renewBilling}
                      onChange={(e) => {
                        const b = e.target.value as LicenseBilling;
                        setRenewBilling(b);
                        if (b === 'monthly') setRenewDays(30);
                        else if (b === 'yearly') setRenewDays(365);
                      }}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                      <option value="lifetime">Lifetime</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="renew-days" className="block text-xs font-medium text-slate-600">
                      Duration (Days)
                    </label>
                    <input
                      id="renew-days"
                      type="number"
                      min={1}
                      max={36500}
                      disabled={renewBilling === 'lifetime'}
                      value={renewBilling === 'lifetime' ? 0 : renewDays}
                      onChange={(e) => setRenewDays(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={busyAction}
                  className="px-4 py-2.5 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  Generate Renewed KC1 Key
                </button>
              </form>
            </section>

            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-teal-700" />
                <h2 className="text-base font-semibold text-slate-900">
                  Reissue for New Phone / Lost Key
                </h2>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Keep the remaining expiration date and issue a replacement key bound to the
                customer&apos;s new Device Code (or Unbound).
              </p>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="reissue-plan" className="block text-xs font-medium text-slate-600">
                      Plan
                    </label>
                    <select
                      id="reissue-plan"
                      value={reissuePlan}
                      onChange={(e) => setReissuePlan(e.target.value as LicensePlan)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="pro">Pro</option>
                      <option value="business">Business</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="reissue-binding" className="block text-xs font-medium text-slate-600">
                      Binding
                    </label>
                    <select
                      id="reissue-binding"
                      value={reissueBinding}
                      onChange={(e) => setReissueBinding(e.target.value as BindingMode)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="bound">Device-Bound</option>
                      <option value="unbound">Unbound</option>
                    </select>
                  </div>
                </div>

                {reissueBinding === 'bound' && (
                  <div className="space-y-1">
                    <label htmlFor="reissue-device-code" className="block text-xs font-medium text-slate-600">
                      New Device Code
                    </label>
                    <input
                      id="reissue-device-code"
                      type="text"
                      value={reissueDeviceCode}
                      onChange={(e) => setReissueDeviceCode(normalizeDeviceCode(e.target.value))}
                      placeholder="ABCDE-FGHIJ"
                      maxLength={14}
                      className="w-full px-3 py-2 text-sm font-mono uppercase border border-slate-300 rounded-lg"
                    />
                  </div>
                )}

                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => setConfirmMode('reissue')}
                  className="px-4 py-2.5 text-sm font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg transition-colors whitespace-nowrap"
                >
                  Reissue Replacement Key
                </button>
              </div>
            </section>
          </div>

          {/* Edit buyer contact & notes */}
          <form
            onSubmit={(e) => void handleSaveMeta(e)}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <h2 className="text-base font-semibold text-slate-900">Buyer Details &amp; Notes</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label htmlFor="edit-buyer" className="block text-xs font-medium text-slate-600">
                  Buyer Contact / Telegram
                </label>
                <input
                  id="edit-buyer"
                  type="text"
                  maxLength={200}
                  value={buyerContactInput}
                  onChange={(e) => setBuyerContactInput(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="edit-notes" className="block text-xs font-medium text-slate-600">
                  Notes
                </label>
                <input
                  id="edit-notes"
                  type="text"
                  maxLength={1000}
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busyAction}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
              >
                <Save className="w-4 h-4" />
                Save Notes
              </button>
            </div>
          </form>
        </>
      )}

      <ConfirmDialog
        open={confirmMode === 'revoke'}
        title="Mark License Revoked in Log"
        description="Marks this license revoked in your admin log so you know not to renew or support it. (Note: offline KC1 keys do not phone home and stay valid on the customer's device until their expiration date.)"
        confirmLabel="Mark Revoked"
        tone="danger"
        requireReason
        reasonLabel="Reason"
        reasonPlaceholder="e.g. Refunded ABA transfer or moved to new phone"
        busy={busyAction}
        onCancel={() => setConfirmMode(null)}
        onConfirm={(reason) => void handleConfirmSubmit(reason)}
      />

      <ConfirmDialog
        open={confirmMode === 'reissue'}
        title="Reissue Replacement KC1 Key"
        description="Generates a new signed KC1 key preserving the existing expiration date and marks this log record as superseded."
        confirmLabel="Issue Replacement Key"
        tone="primary"
        requireReason={false}
        reasonLabel="Note (optional)"
        reasonPlaceholder="e.g. Buyer switched to new phone"
        busy={busyAction}
        onCancel={() => setConfirmMode(null)}
        onConfirm={(reason) => void handleConfirmSubmit(reason)}
      />
    </div>
  );
}
