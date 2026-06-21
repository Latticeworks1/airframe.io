/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

interface SyncLoaderProps {
  isLoading: boolean;
}

export function SyncLoader({ isLoading }: SyncLoaderProps) {
  if (!isLoading) return null;

  return (
    <div className="absolute inset-0 z-50 bg-slate-950 flex flex-col items-center justify-center font-mono text-slate-100 animate-fadeIn">
      <div className="relative flex flex-col items-center max-w-sm w-full px-6 text-center">
        {/* Spinning combat flight systems HUD loader */}
        <div className="w-12 h-12 rounded-full border-2 border-slate-800 border-t-amber-500 animate-spin mb-6"></div>
        <h1 className="text-sm font-bold tracking-[0.25em] text-amber-500 uppercase mb-2">
          Airframe Link
        </h1>
        <p className="text-[9px] text-slate-500 uppercase tracking-widest animate-pulse">
          Syncing pilot profile...
        </p>
      </div>
    </div>
  );
}
