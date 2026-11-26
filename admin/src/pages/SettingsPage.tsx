import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, KeyRound, Trash2, Upload } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { localLicenseStore } from '../lib/localLicenseStore';

export function SettingsPage() {
  const [pepper, setPepper] = useState(() => localLicenseStore.getPepper());
  const [showPepper, setShowPepper] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleSavePepper(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      localLicenseStore.setPepper(pepper);
      setSuccess('Local HMAC-SHA256 pepper saved in this browser.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save pepper.');
    }
  }

  function handleExportBackup() {
    setError(null);
    setSuccess(null);
    const json = localLicenseStore.exportBackupJson();
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kamchi-licenses-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSuccess('Downloaded JSON backup of all licenses and audit logs.');
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
      setSuccess(`Imported ${res.licenseCount} license(s) and ${res.auditCount} audit log entries.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid backup JSON file.');
    }
  }

  function handleClearData() {
    localLicenseStore.clearAllLocalData();
    setConfirmClear(false);
    setError(null);
    setSuccess('Cleared all local licenses and audit logs from this browser.');
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Local Storage &amp; Backup</h1>
        <p className="text-sm text-slate-600 mt-1">
          Licenses and audit logs are saved locally in this browser. Export a JSON backup regularly
          or before switching devices.
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

      {/* Pepper config */}
      <form
        onSubmit={handleSavePepper}
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
      >
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-teal-700" />
          <h2 className="text-base font-semibold text-slate-900">HMAC-SHA256 Pepper</h2>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">
          Keys are hashed with <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">HMAC-SHA256(normalizedKey, pepper)</code>.
          If your KamChi mobile app verifies keys against a specific pepper, paste that same value here.
        </p>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="local-pepper-input" className="text-xs font-medium text-slate-600">
              Local Pepper (min 16 characters)
            </label>
            <button
              type="button"
              onClick={() => setShowPepper((v) => !v)}
              className="text-xs font-medium text-teal-700 hover:text-teal-800"
            >
              {showPepper ? 'Hide' : 'Show'}
            </button>
          </div>
          <input
            id="local-pepper-input"
            type={showPepper ? 'text' : 'password'}
            value={pepper}
            onChange={(e) => setPepper(e.target.value)}
            minLength={16}
            required
            className="w-full px-3 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="px-4 py-2.5 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap"
          >
            Save Pepper
          </button>
        </div>
      </form>

      {/* Backup & Restore */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Backup &amp; Restore</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Download a JSON snapshot of your local licenses and audit history, or restore a backup
          when moving to another browser or phone.
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
        <h2 className="text-base font-semibold text-slate-900">Clear Browser Data</h2>
        <p className="text-sm text-slate-600">
          Remove all licenses and audit logs stored in this browser&apos;s <code className="font-mono text-xs">localStorage</code>.
        </p>
        <button
          type="button"
          onClick={() => setConfirmClear(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg transition-colors whitespace-nowrap"
        >
          <Trash2 className="w-4 h-4" />
          Clear All Local Data
        </button>
      </section>

      <ConfirmDialog
        open={confirmClear}
        title="Clear All Local Browser Data"
        description="This permanently deletes all license hashes and audit logs from this browser. Export a JSON backup first if you still need them."
        confirmLabel="Clear Data"
        tone="danger"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => handleClearData()}
      />
    </div>
  );
}
