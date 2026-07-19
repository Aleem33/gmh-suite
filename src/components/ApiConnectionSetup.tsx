import { useState } from 'react';
import { Database, Save } from 'lucide-react';
import { saveRuntimeApiBaseUrl } from '../lib/hostingerApi';

export function ApiConnectionSetup() {
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');

  const save = () => {
    try {
      saveRuntimeApiBaseUrl(address);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enter a valid Hostinger address.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-sm p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
            <Database size={20} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Connect GMH Suite</h1>
            <p className="text-sm text-slate-500">Enter the secure Hostinger subdomain used by the hospital.</p>
          </div>
        </div>
        <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="gmh-api-address">Hostinger subdomain</label>
        <input
          id="gmh-api-address"
          value={address}
          onChange={event => { setAddress(event.target.value); setError(''); }}
          onKeyDown={event => { if (event.key === 'Enter') save(); }}
          placeholder="https://gmh.example.com"
          autoCapitalize="none"
          autoCorrect="off"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          type="button"
          onClick={save}
          disabled={!address.trim()}
          className="mt-4 w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Save size={16} aria-hidden="true" /> Save And Connect
        </button>
      </div>
    </div>
  );
}
