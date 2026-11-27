import React, { useState, useEffect } from 'react';
import { Tv, Wifi, Cast, X, CheckCircle2, AlertCircle, Smartphone, RefreshCw, ExternalLink } from 'lucide-react';

interface TVCastModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  videoUrl: string;
  poster?: string;
  currentTime?: number;
  onCastConnected?: () => void;
}

interface CastDevice {
  id: string;
  name: string;
  type: 'chromecast' | 'dlna' | 'airplay' | 'smart_tv';
  ip?: string;
}

export default function TVCastModal({
  isOpen,
  onClose,
  title,
  videoUrl,
  poster,
  currentTime = 0,
  onCastConnected,
}: TVCastModalProps) {
  const [devices, setDevices] = useState<CastDevice[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectedDevice, setConnectedDevice] = useState<CastDevice | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      scanDevices();
    } else {
      setConnectedDevice(null);
      setConnectingId(null);
      setErrorMsg(null);
    }
  }, [isOpen]);

  const scanDevices = () => {
    setIsScanning(true);
    setErrorMsg(null);
    setDevices([]);

    setTimeout(() => {
      // Mock discovered smart TV / DLNA / Chromecast devices on local network
      const mockFound: CastDevice[] = [
        { id: 'tv_1', name: 'Living Room Android TV', type: 'chromecast', ip: '192.168.1.105' },
        { id: 'tv_2', name: 'Samsung 4K Smart TV', type: 'dlna', ip: '192.168.1.112' },
        { id: 'tv_3', name: 'Bedroom FireTV Stick', type: 'chromecast', ip: '192.168.1.120' },
      ];
      setDevices(mockFound);
      setIsScanning(false);
    }, 1500);
  };

  const handleConnectDevice = (dev: CastDevice) => {
    setConnectingId(dev.id);
    setErrorMsg(null);
    setTimeout(() => {
      setConnectingId(null);
      setConnectedDevice(dev);
      if (onCastConnected) {
        onCastConnected();
      }
    }, 2000);
  };

  const handleDisconnect = () => {
    setConnectedDevice(null);
  };

  const handleOpenExternal = () => {
    if (videoUrl) {
      window.open(videoUrl, '_blank');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-2xl text-white relative">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 w-9 h-9 rounded-full bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center text-gray-300 hover:text-white transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-yellow-400/10 border border-yellow-500/30 flex items-center justify-center text-yellow-400">
            <Tv size={24} />
          </div>
          <div>
            <h3 className="text-base font-black tracking-tight text-white uppercase">Cast to TV</h3>
            <p className="text-xs text-gray-400 truncate max-w-[260px]">{title}</p>
          </div>
        </div>

        {connectedDevice ? (
          <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-2xl p-4 text-center my-4 space-y-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <p className="text-xs text-emerald-400 font-bold uppercase tracking-wider">Connected to</p>
              <h4 className="text-sm font-black text-white">{connectedDevice.name}</h4>
              <p className="text-[11px] text-gray-400 font-mono mt-0.5">{connectedDevice.ip}</p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleDisconnect}
                className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold text-xs py-2.5 rounded-xl border border-red-500/20 transition-colors cursor-pointer"
              >
                Disconnect
              </button>
              <button
                onClick={onClose}
                className="flex-1 bg-yellow-400 hover:bg-yellow-500 text-black font-black text-xs py-2.5 rounded-xl transition-colors cursor-pointer"
              >
                Close Player View
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Available Devices</span>
              <button
                onClick={scanDevices}
                disabled={isScanning}
                className="flex items-center gap-1.5 text-xs text-yellow-400 hover:text-yellow-300 font-bold transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw size={13} className={isScanning ? 'animate-spin' : ''} />
                <span>{isScanning ? 'Scanning...' : 'Scan Network'}</span>
              </button>
            </div>

            <div className="space-y-2.5 max-h-60 overflow-y-auto mb-4 pr-1">
              {isScanning && devices.length === 0 ? (
                <div className="py-10 text-center space-y-3">
                  <Wifi size={32} className="text-yellow-400 animate-pulse mx-auto" />
                  <p className="text-xs text-gray-400">Searching for Smart TVs, Chromecast & DLNA devices on Wi-Fi...</p>
                </div>
              ) : devices.length === 0 ? (
                <div className="py-8 text-center space-y-2 bg-neutral-950/50 rounded-2xl border border-neutral-800">
                  <AlertCircle size={24} className="text-gray-500 mx-auto" />
                  <p className="text-xs text-gray-400">No Cast devices found on local network.</p>
                  <button
                    onClick={scanDevices}
                    className="text-xs text-yellow-400 font-bold hover:underline mt-1 inline-block cursor-pointer"
                  >
                    Try Again
                  </button>
                </div>
              ) : (
                devices.map((dev) => (
                  <div
                    key={dev.id}
                    className="flex items-center justify-between bg-neutral-950 hover:bg-neutral-800/80 border border-neutral-800 p-3.5 rounded-2xl transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-neutral-900 border border-neutral-700 flex items-center justify-center text-yellow-400">
                        <Cast size={18} />
                      </div>
                      <div>
                        <h4 className="text-xs font-black text-white">{dev.name}</h4>
                        <p className="text-[11px] text-gray-400 font-mono">{dev.ip || 'Connected via Wi-Fi'}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleConnectDevice(dev)}
                      disabled={connectingId !== null}
                      className="bg-yellow-400 hover:bg-yellow-500 text-black font-black text-[11px] px-3.5 py-2 rounded-xl transition-all disabled:opacity-50 cursor-pointer uppercase tracking-wider"
                    >
                      {connectingId === dev.id ? 'Connecting...' : 'Cast'}
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-neutral-800 pt-4 mt-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Smartphone size={15} className="text-yellow-400" />
                <span>Play stream in external player or browser</span>
              </div>
              <button
                onClick={handleOpenExternal}
                className="flex items-center gap-1.5 bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs px-3 py-2 rounded-xl transition-colors cursor-pointer"
              >
                <ExternalLink size={14} />
                <span>Open URL</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
