import React, { useState } from 'react';
import { useAppUpdate } from '../hooks/useAppUpdate';
import { Download, X, AlertCircle } from 'lucide-react';

export default function UpdateNotification() {
  const { updateAvailable } = useAppUpdate();
  const [dismissed, setDismissed] = useState(false);

  if (!updateAvailable || dismissed) return null;

  const handleUpdate = () => {
    if (typeof window !== 'undefined' && updateAvailable?.apkUrl) {
      window.location.href = updateAvailable.apkUrl;
    }
  };

  return (
    <div className="fixed top-4 left-4 right-4 z-[9999] animate-in fade-in slide-in-from-top-4 duration-300">
      <div className="bg-neutral-900 border-2 border-yellow-400 rounded-2xl shadow-2xl p-4 text-white">
        <div className="flex items-start gap-4">
          <div className="bg-yellow-400/10 p-2 rounded-xl text-yellow-400">
            <AlertCircle size={24} />
          </div>
          
          <div className="flex-grow">
            <h3 className="text-sm font-black uppercase tracking-tight">New Update Available</h3>
            <p className="text-xs text-gray-400 mt-1">
              Version {updateAvailable.latestVersion} is now available. Install it for the latest features and fixes.
            </p>
            {updateAvailable.releaseNotes && (
              <p className="text-[10px] text-yellow-400/70 mt-1 italic italic">
                "{updateAvailable.releaseNotes}"
              </p>
            )}
            
            <div className="flex gap-3 mt-4">
              <button
                onClick={handleUpdate}
                className="bg-yellow-400 hover:bg-yellow-500 text-black text-[10px] font-black px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95"
              >
                <Download size={14} />
                UPDATE NOW
              </button>
              
              {!updateAvailable.isMandatory && (
                <button
                  onClick={() => setDismissed(true)}
                  className="text-gray-400 hover:text-white text-[10px] font-bold px-2 py-2 transition-colors"
                >
                  LATER
                </button>
              )}
            </div>
          </div>

          {!updateAvailable.isMandatory && (
            <button 
              onClick={() => setDismissed(true)}
              className="text-gray-500 hover:text-white p-1 transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
