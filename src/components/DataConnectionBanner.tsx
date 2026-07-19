import { useEffect, useState } from 'react';
import { CloudOff, Settings } from 'lucide-react';
import { canEditRuntimeApiConfiguration, clearRuntimeApiBaseUrl, getApiConnectivity, subscribeApiConnectivity } from '../lib/hostingerApi';

export function DataConnectionBanner() {
  const [state, setState] = useState(getApiConnectivity);

  useEffect(() => subscribeApiConnectivity((online, message) => setState({ online, message })), []);

  if (state.online) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[10000] flex items-center justify-center gap-2 bg-amber-600 px-3 py-2 text-center text-xs font-semibold text-white shadow-sm">
      <CloudOff size={15} aria-hidden="true" />
      <span>{state.message || 'Cached records are available, but changes are disabled until the server reconnects.'}</span>
      {canEditRuntimeApiConfiguration() && (
        <button type="button" onClick={clearRuntimeApiBaseUrl} title="Change API address" className="ml-1 rounded p-1 hover:bg-white/15">
          <Settings size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
