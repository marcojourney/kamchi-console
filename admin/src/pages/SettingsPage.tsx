import { useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  KeyRound,
  Lock,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { adminApi } from '../lib/api';
import { localLicenseStore } from '../lib/localLicenseStore';
import { derivePublicKeyFromPrivateHex } from '../lib/offlineLicense';

interface SettingsPageProps {
  onSigningKeyChanged: () => void;
}

export function SettingsPage({ onSigningKeyChanged }: SettingsPageProps) {
  const [vaultStatus, setVaultStatus] = useState(() => adminApi.getSigningKeyStatus());

  // Import existing Ed25519 private key
  const [privateKeyInput, setPrivateKeyInput] = useState('');
  const [showPrivateInput, setShowPrivateInput] = useState(false);
  const [persistInBrowser, setPersistInBrowser] = useState(true);
  const [previewPublicKey, setPreviewPublicKey] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // One-time generated keypair reveal
  const [generatedPair, setGeneratedPair] = useState<{
    privateKeyHex: string;
    publicKeyHex: string;
  } | null>(null);
  const [copiedField, setCopiedField] = useState<null | 'priv' | 'pub' | 'activePub'>(null);

  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClearData, setConfirmClearData] = useState(false);
  const [confirmClearKey, setConfirmClearKey] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function refreshStatus() {
    setVaultStatus(adminApi.getSigningKeyStatus());
    onSigningKeyChanged();
  }

  async function handlePrivateInputChange(val: string) {
    setPrivateKeyInput(val);
    setPreviewError(null);
    const trimmed = val.trim();
    if (!trimmed) {
      setPreviewPublicKey(null);
      return;
    }
    if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      setPreviewPublicKey(null);
      setPreviewError('Private key must be exactly 64 hex characters (32 bytes).');
      return;
    }
    try {
      const derived = await derivePublicKeyFromPrivateHex(trimmed);
      setPreviewPublicKey(derived.publicKeyHex);
    } catch (err) {
      setPreviewPublicKey(null);
      setPreviewError(err instanceof Error ? err.message : 'Invalid Ed25519 private key.');
    }
  }

  async function handleImportKey(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      const res = await adminApi.importSigningKey(privateKeyInput, persistInBrowser);
      setPrivateKeyInput('');
      setPreviewPublicKey(null);
      setGeneratedPair(null);
      refreshStatus();
      setSuccess(`Signing key loaded. Public key fingerprint: ${res.publicKeyHex}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import signing key.');
    }
  }

  async function handleGenerateKeypair() {
    setError(null);
    setSuccess(null);
    try {
      const pair = await adminApi.generateNewSigningKeypair(persistInBrowser);
      setGeneratedPair(pair);
      refreshStatus();
      setSuccess(
        'Generated a new Ed25519 keypair and loaded it as your active signing key. Save the private key safely and copy LICENSE_PUBLIC_KEY_HEX into KamChi.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate Ed25519 keypair.');
    }
  }

  async function copyHex(text: string, which: 'priv' | 'pub' | 'activePub') {
    await navigator.clipboard.writeText(text);
    setCopiedField(which);
    setTimeout(() => setCopiedField(null), 2000);
  }

  function handleClearKey() {
    adminApi.clearSigningKey();
    setGeneratedPair(null);
    setConfirmClearKey(false);
    refreshStatus();
    setSuccess('Signing key cleared from this browser.');
  }

  function handleExportBackup() {
    setError(null);
    setSuccess(null);
    const json = localLicenseStore.exportBackupJson();
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kamchi-offline-licenses-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSuccess('Downloaded JSON backup of issued license logs and audit history (private key excluded).');
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);
    setSuccess(null);
    try {
      const text = await file.text();
      const res = localLicenseStore.importBackupJson(text);
      setSuccess(`Imported ${res.licenseCount} license record(s) and ${res.auditCount} audit log entries.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid backup JSON file.');
    }
  }

  function handleClearData() {
    localLicenseStore.clearAllLicenseRecords();
    setConfirmClearData(false);
    setError(null);
    setSuccess('Cleared all license logs and audit entries from this browser.');
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
          Signing Key Vault &amp; Backup
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Manage your Ed25519 signing key for offline <code className="font-mono text-xs">KC1-</code>{' '}
          keys and back up your issued license history.
        </p>
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

      {/* Active Signing Key Status */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-teal-700" />
            <h2 className="text-base font-semibold text-slate-900">Active Signing Key</h2>
          </div>
          {vaultStatus.hasKey ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 whitespace-nowrap">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Loaded ({vaultStatus.persistedInBrowser ? 'Saved in browser' : 'Session only'})
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-md border border-amber-200 bg-amber-50 text-amber-800 whitespace-nowrap">
              <AlertTriangle className="w-3.5 h-3.5" />
              Not Configured
            </span>
          )}
        </div>

        {vaultStatus.hasKey && vaultStatus.publicKeyHex ? (
          <div className="space-y-3">
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
              <div className="text-xs font-medium text-slate-600">
                Active Public Key (<code className="font-mono">LICENSE_PUBLIC_KEY_HEX</code>)
              </div>
              <div className="font-mono text-xs text-slate-900 break-all select-all">
                {vaultStatus.publicKeyHex}
              </div>
              <div className="text-xs text-slate-500">
                Confirm this 64-char hex matches <code className="font-mono">src/config/license.ts</code> in the KamChi PWA.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void copyHex(vaultStatus.publicKeyHex!, 'activePub')}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
              >
                {copiedField === 'activePub' ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedField === 'activePub' ? 'Copied Public Key' : 'Copy Public Key Hex'}
              </button>

              <button
                type="button"
                onClick={() => setConfirmClearKey(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg transition-colors whitespace-nowrap"
              >
                <Lock className="w-3.5 h-3.5" />
                Remove Signing Key from Browser
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-600">
            Import your existing 64-character hex Ed25519 private key below, or generate a new keypair.
            Private keys are never hardcoded in source code.
          </p>
        )}
      </section>

      {/* Import Private Key */}
      <form
        onSubmit={(e) => void handleImportKey(e)}
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
      >
        <h2 className="text-base font-semibold text-slate-900">Import Ed25519 Private Key</h2>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="ed25519-priv-input" className="text-xs font-medium text-slate-600">
              Private Key Hex (64 hex characters / 32 bytes)
            </label>
            <button
              type="button"
              onClick={() => setShowPrivateInput((v) => !v)}
              className="text-xs font-medium text-teal-700 hover:text-teal-800"
            >
              {showPrivateInput ? 'Hide' : 'Show'}
            </button>
          </div>
          <input
            id="ed25519-priv-input"
            type={showPrivateInput ? 'text' : 'password'}
            value={privateKeyInput}
            onChange={(e) => void handlePrivateInputChange(e.target.value)}
            placeholder="Paste 64-char hex Ed25519 private key..."
            autoComplete="off"
            spellCheck={false}
            className="w-full px-3 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
          {previewError && <p className="text-xs text-red-700">{previewError}</p>}
          {previewPublicKey && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1">
              <div className="font-medium">Derived Public Key Fingerprint:</div>
              <div className="font-mono break-all">{previewPublicKey}</div>
            </div>
          )}
        </div>

        <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={persistInBrowser}
            onChange={(e) => setPersistInBrowser(e.target.checked)}
            className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
          />
          <span>Remember signing key in this browser&apos;s local storage</span>
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={() => void handleGenerateKeypair()}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg transition-colors whitespace-nowrap"
          >
            <Sparkles className="w-4 h-4" />
            Generate Ed25519 Keypair
          </button>

          <button
            type="submit"
            disabled={!previewPublicKey}
            className="px-4 py-2.5 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            Load Private Key
          </button>
        </div>
      </form>

      {/* Newly Generated Keypair One-Time Reveal */}
      {generatedPair && (
        <section className="bg-slate-900 text-white rounded-xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm leading-relaxed text-slate-200">
              <span className="font-semibold text-white">One-Time Keypair Export.</span> Store the
              Private Key in a password manager (never commit it to git), and paste{' '}
              <code className="font-mono text-xs text-emerald-300">LICENSE_PUBLIC_KEY_HEX</code>{' '}
              into KamChi&apos;s <code className="font-mono text-xs">src/config/license.ts</code>.
            </div>
          </div>

          <div className="space-y-3">
            <div className="p-3.5 rounded-lg bg-slate-800 border border-slate-700 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400">Private Key (64-char hex — KEEP SECRET)</span>
                <button
                  type="button"
                  onClick={() => void copyHex(generatedPair.privateKeyHex, 'priv')}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-300 hover:text-teal-200"
                >
                  {copiedField === 'priv' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedField === 'priv' ? 'Copied' : 'Copy Private'}
                </button>
              </div>
              <div className="font-mono text-xs break-all select-all text-amber-200">
                {generatedPair.privateKeyHex}
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-800 border border-slate-700 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400">
                  Public Key (<code className="font-mono">LICENSE_PUBLIC_KEY_HEX</code>)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void copyHex(
                      `export const LICENSE_PUBLIC_KEY_HEX = '${generatedPair.publicKeyHex}';`,
                      'pub'
                    )
                  }
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300 hover:text-emerald-200"
                >
                  {copiedField === 'pub' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedField === 'pub' ? 'Copied TS Line' : 'Copy for license.ts'}
                </button>
              </div>
              <div className="font-mono text-xs break-all select-all text-emerald-300">
                export const LICENSE_PUBLIC_KEY_HEX = &apos;{generatedPair.publicKeyHex}&apos;;
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Backup & Restore */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Issued Keys Backup &amp; Restore</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Export a JSON backup of your issued license metadata and audit logs (private signing keys
          are excluded for safety).
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExportBackup}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            Export JSON Backup
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <Upload className="w-4 h-4" />
            Import JSON Backup
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={(e) => void handleImportFile(e)}
            className="hidden"
          />
        </div>
      </section>

      {/* Danger zone */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Clear Issued License Log</h2>
        <p className="text-sm text-slate-600">
          Remove issued license metadata and audit logs from this browser&apos;s{' '}
          <code className="font-mono text-xs">localStorage</code> (does not remove your signing key).
        </p>
        <button
          type="button"
          onClick={() => setConfirmClearData(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg transition-colors whitespace-nowrap"
        >
          <Trash2 className="w-4 h-4" />
          Clear License Log
        </button>
      </section>

      <ConfirmDialog
        open={confirmClearKey}
        title="Remove Signing Key from Browser"
        description="Make sure you have saved your 64-char Ed25519 private key externally before removing it from this browser."
        confirmLabel="Remove Key"
        tone="danger"
        onCancel={() => setConfirmClearKey(false)}
        onConfirm={handleClearKey}
      />

      <ConfirmDialog
        open={confirmClearData}
        title="Clear Issued License Log"
        description="This deletes all recorded license metadata and audit history from this browser. Export a JSON backup first if needed."
        confirmLabel="Clear Log"
        tone="danger"
        onCancel={() => setConfirmClearData(false)}
        onConfirm={handleClearData}
      />
    </div>
  );
}
