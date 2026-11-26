import { useState } from 'react';
import { AlertCircle, AlertTriangle, KeyRound, Laptop, ShieldCheck } from 'lucide-react';
import { adminApi } from '../lib/api';
import { normalizeDeviceCode, validateDeviceCode } from '../lib/offlineLicense';
import type {
  BindingMode,
  CreateLicenseResponse,
  LicenseBilling,
  LicensePlan,
} from '../types/license';
import { KeyRevealCard } from '../components/KeyRevealCard';

interface CreateLicensePageProps {
  onViewDetail: (keyIdHex: string) => void;
  onOpenSigningSettings: () => void;
}

type ExpiryMode = 'days' | 'date';

export function CreateLicensePage({
  onViewDetail,
  onOpenSigningSettings,
}: CreateLicensePageProps) {
  const signingStatus = adminApi.getSigningKeyStatus();

  const [plan, setPlan] = useState<LicensePlan>('pro');
  const [billing, setBilling] = useState<LicenseBilling>('yearly');
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>('days');
  const [durationDays, setDurationDays] = useState<number>(365);
  const [customDate, setCustomDate] = useState('');
  const [maxDevices, setMaxDevices] = useState<number>(1);
  const [bindingMode, setBindingMode] = useState<BindingMode>('bound');
  const [deviceCode, setDeviceCode] = useState('');
  const [buyerContact, setBuyerContact] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateLicenseResponse | null>(null);

  function handleBillingChange(nextBilling: LicenseBilling) {
    setBilling(nextBilling);
    if (nextBilling === 'monthly') {
      setDurationDays(30);
    } else if (nextBilling === 'yearly') {
      setDurationDays(365);
    }
  }

  function handleDeviceCodeChange(val: string) {
    setDeviceCode(normalizeDeviceCode(val));
  }

  const deviceValidation =
    bindingMode === 'bound' ? validateDeviceCode(deviceCode) : { valid: true, normalized: '' };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!signingStatus.hasKey) {
      setError('Configure or generate an Ed25519 signing key first.');
      return;
    }

    if (bindingMode === 'bound' && !deviceValidation.valid) {
      setError('Device Code must match ABCDE-FGHIJ (letters A-Z and digits 2-7).');
      return;
    }

    let customExpiresAtMs: number | null | undefined = undefined;
    let resolvedDurationDays: number | undefined = undefined;

    if (billing !== 'lifetime') {
      if (expiryMode === 'date') {
        if (!customDate) {
          setError('Choose a custom expiration date.');
          return;
        }
        customExpiresAtMs = Date.parse(`${customDate}T00:00:00.000Z`);
        if (Number.isNaN(customExpiresAtMs)) {
          setError('Invalid expiration date.');
          return;
        }
      } else {
        resolvedDurationDays = durationDays;
      }
    }

    setSubmitting(true);
    try {
      const res = await adminApi.createLicense({
        plan,
        billing,
        durationDays: resolvedDurationDays,
        customExpiresAtMs,
        maxDevices,
        bindingMode,
        deviceCode: bindingMode === 'bound' ? deviceValidation.normalized : undefined,
        buyerContact: buyerContact.trim(),
        notes: notes.trim(),
      });
      setCreated(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate offline license.');
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setCreated(null);
    setDeviceCode('');
    setBuyerContact('');
    setNotes('');
    setCustomDate('');
    setError(null);
  }

  if (created) {
    return (
      <div className="max-w-3xl space-y-6">
        <KeyRevealCard
          result={created}
          onViewDetail={onViewDetail}
          onCreateAnother={resetForm}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
          Issue Offline License Key
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Sign an Ed25519 <code className="font-mono text-xs">KC1-</code> license key that verifies
          offline inside the KamChi PWA.
        </p>
      </div>

      {!signingStatus.hasKey ? (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-950">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-700" />
            <div className="text-sm">
              <div className="font-semibold">Ed25519 Signing Key Required</div>
              <p className="text-amber-900 mt-0.5">
                Import your private key or generate a new keypair in Signing Key Vault before
                issuing keys.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenSigningSettings}
            className="px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Open Key Vault
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-600">
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
            Signing with public key{' '}
            <span className="font-mono text-slate-900">
              {signingStatus.publicKeyHex?.slice(0, 16)}...
            </span>
          </span>
          <button
            type="button"
            onClick={onOpenSigningSettings}
            className="font-medium text-teal-700 hover:text-teal-800 whitespace-nowrap"
          >
            Manage Key
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-red-200 bg-red-50 text-red-900">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-700" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-6"
      >
        {/* Plan selector */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-800">Plan</label>
          <div className="grid grid-cols-2 gap-3">
            {([
              { id: 'pro', title: 'Pro', hint: 'Plan byte 1' },
              { id: 'business', title: 'Business', hint: 'Plan byte 2' },
            ] as const).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setPlan(option.id)}
                className={`p-3.5 text-left rounded-lg border transition-colors ${
                  plan === option.id
                    ? 'border-teal-700 bg-teal-50/70 text-teal-950'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div className="text-sm font-semibold">{option.title}</div>
                <div className="text-xs text-slate-500 mt-0.5">{option.hint}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Billing cycle */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-800">Billing Cycle</label>
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: 'monthly', label: 'Monthly (30d)' },
              { id: 'yearly', label: 'Yearly (365d)' },
              { id: 'lifetime', label: 'Lifetime' },
            ] as const).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleBillingChange(item.id)}
                className={`px-3 py-2.5 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap ${
                  billing === item.id
                    ? 'border-teal-700 bg-teal-50/70 text-teal-950'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Expiry & Max Devices */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-slate-800">Expiration</label>
              {billing !== 'lifetime' && (
                <div className="inline-flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setExpiryMode('days')}
                    className={`px-2 py-0.5 rounded ${
                      expiryMode === 'days'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Days
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpiryMode('date')}
                    className={`px-2 py-0.5 rounded ${
                      expiryMode === 'date'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Date
                  </button>
                </div>
              )}
            </div>

            {billing === 'lifetime' ? (
              <input
                type="text"
                disabled
                value="No expiration (expiresAtDay = 0)"
                className="w-full px-3 py-2.5 text-sm bg-slate-100 text-slate-500 border border-slate-200 rounded-lg cursor-not-allowed"
              />
            ) : expiryMode === 'days' ? (
              <div className="space-y-2">
                <input
                  type="number"
                  min={1}
                  max={36500}
                  required
                  value={durationDays}
                  onChange={(e) => setDurationDays(Number(e.target.value))}
                  className="w-full px-3 py-2.5 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                <div className="flex flex-wrap gap-1.5">
                  {[30, 90, 180, 365].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDurationDays(d)}
                      className="px-2.5 py-1 text-xs font-mono text-slate-700 bg-slate-100 hover:bg-slate-200 rounded"
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <input
                type="date"
                required
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="create-max-devices" className="block text-sm font-medium text-slate-800">
              Max Devices (1–255)
            </label>
            <input
              id="create-max-devices"
              type="number"
              min={1}
              max={255}
              required
              value={maxDevices}
              onChange={(e) => setMaxDevices(Number(e.target.value))}
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
            <p className="text-xs text-slate-500">Default is 1 device in offline payload.</p>
          </div>
        </div>

        {/* Binding Mode */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-slate-800">Device Binding Mode</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setBindingMode('bound')}
              className={`p-3.5 text-left rounded-lg border transition-colors ${
                bindingMode === 'bound'
                  ? 'border-teal-700 bg-teal-50/70 text-teal-950'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Laptop className="w-4 h-4" />
                Device-Bound
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Locked to buyer&apos;s Device Code (SHA-256)
              </div>
            </button>

            <button
              type="button"
              onClick={() => setBindingMode('unbound')}
              className={`p-3.5 text-left rounded-lg border transition-colors ${
                bindingMode === 'unbound'
                  ? 'border-teal-700 bg-teal-50/70 text-teal-950'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
              }`}
            >
              <div className="text-sm font-semibold">Unbound</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Works on any phone (8 zero bytes)
              </div>
            </button>
          </div>

          {bindingMode === 'bound' && (
            <div className="space-y-1.5 pt-1">
              <label htmlFor="create-device-code" className="block text-xs font-medium text-slate-700">
                Buyer Device Code (from KamChi Settings)
              </label>
              <input
                id="create-device-code"
                type="text"
                required
                value={deviceCode}
                onChange={(e) => handleDeviceCodeChange(e.target.value)}
                placeholder="ABCDE-FGHIJ"
                maxLength={14}
                spellCheck={false}
                className="w-full px-3 py-2.5 text-sm font-mono uppercase tracking-wider border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <p
                className={`text-xs ${
                  deviceCode.length === 0
                    ? 'text-slate-500'
                    : deviceValidation.valid
                      ? 'text-emerald-700'
                      : 'text-red-700'
                }`}
              >
                {deviceCode.length === 0
                  ? 'Format: 5-5 Base32 characters (A-Z, 2-7), e.g. ABCDE-FGHIJ'
                  : deviceValidation.valid
                    ? `Valid Device Code (${deviceValidation.normalized})`
                    : 'Must match XXXXX-XXXXX using A-Z and 2-7 only'}
              </p>
            </div>
          )}
        </div>

        {/* Buyer Contact & Notes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="create-buyer-contact" className="block text-sm font-medium text-slate-800">
              Buyer Contact / Telegram
            </label>
            <input
              id="create-buyer-contact"
              type="text"
              maxLength={200}
              value={buyerContact}
              onChange={(e) => setBuyerContact(e.target.value)}
              placeholder="@telegram or 012 345 678"
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="create-notes" className="block text-sm font-medium text-slate-800">
              Order Ref / Notes
            </label>
            <input
              id="create-notes"
              type="text"
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ABA Ref #123456 - Paid $15"
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
        </div>

        <div className="pt-2 flex items-center justify-end">
          <button
            type="submit"
            disabled={submitting || !signingStatus.hasKey}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <KeyRound className="w-4 h-4" />
            {submitting ? 'Signing Key...' : 'Sign & Generate KC1 Key'}
          </button>
        </div>
      </form>
    </div>
  );
}
