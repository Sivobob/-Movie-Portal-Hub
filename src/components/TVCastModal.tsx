import React, { useState, useEffect, useRef } from 'react';
import { X, Tv, Wifi, CheckCircle2, RefreshCw, ShieldCheck, Play, Pause } from 'lucide-react';
import { LIVE_BACKEND_URL } from '../utils/apiConfig';

interface TVCastModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  videoUrl: string;
  poster?: string;
  currentTime?: number;
  onCastConnected?: () => void;
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
  const [isSearching, setIsSearching] = useState(false);
  const [castConnected, setCastConnected] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState<string | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // PresentationConnection reference for browser-based Cast
  const connectionRef = useRef<any>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isRemotePlaying, setIsRemotePlaying] = useState(true);
  const [, setRemoteCurrentTime] = useState(0);
  const [, setRemoteDuration] = useState(0);

  // Helper to resolve a public HTTPS video stream URL for TV receivers
  const getCastTargetUrl = (sourceUrl: string): string => {
    if (!sourceUrl) return '';
    let target = sourceUrl.trim();
    if (target.startsWith('/') || target.includes('127.0.0.1') || target.includes('localhost')) {
      const queryIdx = target.indexOf('?');
      const query = queryIdx >= 0 ? target.substring(queryIdx) : '';
      return `${LIVE_BACKEND_URL}/api/stream${query}`;
    }
    return target;
  };

  useEffect(() => {
    if (!isOpen) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (connectionRef.current) {
        try {
          connectionRef.current.close();
        } catch {}
        connectionRef.current = null;
      }
      try {
        const bridge = (window as any).AndroidPlayerBridge;
        if (bridge && typeof bridge.stopCastDiscovery === 'function') {
          bridge.stopCastDiscovery();
        }
      } catch {}

      setCastConnected(false);
      setConnectedDevice(null);
      setDiscoveredDevices([]);
      setIsSearching(false);
      setErrorMessage(null);
    } else {
      startDeviceDiscovery();
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isOpen]);

  const startDeviceDiscovery = async () => {
    setIsSearching(true);
    setDiscoveredDevices([]);
    setErrorMessage(null);

    const bridge = (window as any).AndroidPlayerBridge;

    // 1. Native Android Google Cast SDK via AndroidPlayerBridge
    if (bridge && typeof bridge.startCastDiscovery === 'function') {
      try {
        bridge.startCastDiscovery();
      } catch (err) {
        console.warn('Native Cast discovery start notice:', err);
      }

      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }

      const pollRealCastState = () => {
        try {
          if (typeof bridge.getDiscoveredCastDevices === 'function') {
            const rawDevices = bridge.getDiscoveredCastDevices();
            if (rawDevices) {
              const parsed = JSON.parse(rawDevices);
              if (Array.isArray(parsed)) {
                setDiscoveredDevices(parsed);
              }
            }
          }

          if (typeof bridge.getCastSessionStatus === 'function') {
            const rawStatus = bridge.getCastSessionStatus();
            if (rawStatus) {
              const status = JSON.parse(rawStatus);
              if (status.connected) {
                setCastConnected(true);
                setConnectedDevice(status.deviceName || 'Chromecast');
                setIsRemotePlaying(status.isPlaying !== false);
                if (typeof status.currentTime === 'number') setRemoteCurrentTime(status.currentTime);
                if (typeof status.duration === 'number') setRemoteDuration(status.duration);
                if (onCastConnected) onCastConnected();
              } else if (status.state === 'error' && status.errorMessage) {
                setErrorMessage(status.errorMessage);
                setIsSearching(false);
              }
            }
          }
        } catch (e) {
          console.warn('Cast polling notice:', e);
        }
      };

      pollRealCastState();
      pollIntervalRef.current = setInterval(pollRealCastState, 800);

      // Give real mDNS/Wi-Fi multicast discovery 3 seconds to populate
      setTimeout(() => {
        setIsSearching(false);
      }, 3000);
      return;
    }

    // 2. Web Browser standard Presentation API (Chrome desktop / mobile Cast sender)
    try {
      if ('PresentationRequest' in window && videoUrl) {
        const presentationTargetUrl = getCastTargetUrl(videoUrl);
        const request = new (window as any).PresentationRequest([presentationTargetUrl]);

        if (request.getAvailability) {
          try {
            const availability = await request.getAvailability();
            const updateAvailability = () => {
              if (availability.value) {
                setDiscoveredDevices([
                  {
                    id: 'web-google-cast-receiver',
                    name: 'Chromecast / Google TV Display',
                    type: 'Google Cast',
                  },
                ]);
              } else {
                setDiscoveredDevices([]);
              }
            };
            updateAvailability();
            availability.onchange = updateAvailability;
          } catch (availErr) {
            console.warn('Presentation availability check notice:', availErr);
          }
        }
      }
    } catch (e) {
      console.warn('PresentationRequest setup notice:', e);
    } finally {
      setTimeout(() => {
        setIsSearching(false);
      }, 1800);
    }
  };

  const handleConnectDevice = async (device: { id: string; name: string; type: string }) => {
    setIsSearching(true);
    setErrorMessage(null);

    const targetUrl = getCastTargetUrl(videoUrl);
    const bridge = (window as any).AndroidPlayerBridge;

    // 1. Native Android Google Cast SDK connection
    if (bridge && typeof bridge.connectToCastDevice === 'function') {
      try {
        bridge.connectToCastDevice(
          device.id,
          targetUrl,
          title || 'Movie Portal',
          poster || '',
          currentTime || 0
        );
      } catch (err: any) {
        setErrorMessage('Failed to trigger Cast connection: ' + (err.message || 'Unknown error'));
        setIsSearching(false);
      }
      return;
    }

    // 2. Web browser Presentation API connection
    try {
      if ('PresentationRequest' in window && targetUrl) {
        const request = new (window as any).PresentationRequest([targetUrl]);
        const connection = await request.start();
        connectionRef.current = connection;

        connection.onclose = () => {
          setCastConnected(false);
          setConnectedDevice(null);
          connectionRef.current = null;
        };

        connection.onterminate = () => {
          setCastConnected(false);
          setConnectedDevice(null);
          connectionRef.current = null;
        };

        setCastConnected(true);
        setConnectedDevice(device.name);
        setIsSearching(false);
        if (onCastConnected) onCastConnected();
        return;
      }
    } catch (err: any) {
      console.warn('Presentation connection prompt notice:', err);
      setErrorMessage('Cast prompt dismissed or unavailable on this browser.');
      setIsSearching(false);
    }
  };

  const handleDisconnect = () => {
    const bridge = (window as any).AndroidPlayerBridge;
    if (bridge && typeof bridge.disconnectCast === 'function') {
      try {
        bridge.disconnectCast();
      } catch {}
    }

    if (connectionRef.current) {
      try {
        connectionRef.current.close();
      } catch {}
      connectionRef.current = null;
    }
    setCastConnected(false);
    setConnectedDevice(null);
  };

  const handleRemotePlayPause = () => {
    const nextState = !isRemotePlaying;
    setIsRemotePlaying(nextState);

    const bridge = (window as any).AndroidPlayerBridge;
    if (bridge) {
      try {
        if (nextState) {
          bridge.castPlay?.();
        } else {
          bridge.castPause?.();
        }
      } catch {}
    }

    if (connectionRef.current && typeof connectionRef.current.send === 'function') {
      try {
        connectionRef.current.send(JSON.stringify({ type: nextState ? 'PLAY' : 'PAUSE' }));
      } catch {}
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
      <div 
        className="bg-neutral-900 border border-neutral-800 rounded-3xl max-w-md w-full p-6 shadow-2xl relative my-auto text-white overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 bg-neutral-800/80 hover:bg-neutral-700 text-gray-300 hover:text-white p-2 rounded-full transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-yellow-400 text-black flex items-center justify-center font-black shadow-lg shadow-yellow-400/20 flex-shrink-0">
            <Tv size={26} />
          </div>
          <div>
            <span className="bg-yellow-400/20 text-yellow-400 text-[10px] font-black px-2 py-0.5 rounded-full uppercase border border-yellow-400/30">
              Google Cast & Smart TV
            </span>
            <h3 className="text-xl font-black text-white tracking-tight uppercase mt-0.5">
              Movie Cast
            </h3>
          </div>
        </div>

        {/* Currently Playing Title Banner */}
        <div className="bg-neutral-950 border border-neutral-800/80 p-3 rounded-xl mb-4 flex items-center justify-between">
          <div className="truncate pr-2">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider block font-semibold">Casting Media</span>
            <span className="text-xs font-bold text-yellow-400 truncate block">{title}</span>
          </div>
          {castConnected ? (
            <span className="bg-green-500/20 text-green-400 text-[10px] font-bold px-2.5 py-1 rounded-full border border-green-500/30 flex items-center gap-1 flex-shrink-0 animate-pulse">
              <Wifi size={12} /> Connected
            </span>
          ) : (
            <span className="bg-neutral-800 text-gray-400 text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0">
              Searching Wi-Fi
            </span>
          )}
        </div>

        {/* Connected TV & Remote Controls */}
        {castConnected ? (
          <div className="bg-neutral-950 border border-green-500/40 p-4 rounded-2xl mb-4 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-green-400 font-bold text-sm">
                <CheckCircle2 size={20} className="text-green-400" />
                <span>Playing on {connectedDevice}</span>
              </div>
              <span className="text-[10px] bg-green-950 text-green-300 px-2 py-0.5 rounded border border-green-800 font-mono">1080p Direct</span>
            </div>

            <p className="text-xs text-gray-400 leading-relaxed">
              Your video is streaming securely to the connected TV. Control playback from your phone below.
            </p>

            {/* Remote Playback Controls */}
            <div className="flex items-center justify-center gap-4 pt-2">
              <button
                type="button"
                onClick={handleRemotePlayPause}
                className="w-12 h-12 rounded-full bg-yellow-400 hover:bg-yellow-300 text-black flex items-center justify-center shadow-lg transition-transform active:scale-95 cursor-pointer"
              >
                {isRemotePlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
              </button>
            </div>

            <button
              type="button"
              onClick={handleDisconnect}
              className="w-full mt-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs py-2.5 rounded-xl transition-all cursor-pointer shadow uppercase tracking-wider"
            >
              Disconnect / Stop Casting
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-4 text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-yellow-400/10 text-yellow-400 mb-3 border border-yellow-400/20">
                <Wifi size={28} className={isSearching ? 'animate-ping text-yellow-400' : 'text-yellow-400'} />
              </div>
              <h4 className="text-sm font-bold text-white uppercase tracking-wide">
                Discovering Chromecast Devices
              </h4>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                Make sure your Android phone and Chromecast-compatible TV are connected to the same Wi-Fi network.
              </p>

              <div className="flex items-center gap-2 mt-4">
                <button
                  type="button"
                  onClick={startDeviceDiscovery}
                  disabled={isSearching}
                  className="flex-grow bg-yellow-400 hover:bg-yellow-500 text-black font-black text-xs py-3 px-4 rounded-xl shadow transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 uppercase tracking-wider"
                >
                  {isSearching ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      <span>Scanning Wi-Fi...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw size={16} />
                      <span>Refresh Device List</span>
                    </>
                  )}
                </button>
              </div>

              {errorMessage && (
                <div className="mt-3 p-2.5 bg-amber-950/40 border border-amber-800/60 rounded-xl text-[11px] text-amber-300 leading-relaxed">
                  {errorMessage}
                </div>
              )}

              {discoveredDevices.length > 0 ? (
                <div className="mt-4 space-y-2 text-left">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider block">Available TVs on Same Wi-Fi:</span>
                  {discoveredDevices.map((dev) => (
                    <button
                      key={dev.id}
                      type="button"
                      onClick={() => handleConnectDevice(dev)}
                      className="w-full bg-neutral-900 hover:bg-yellow-400 hover:text-black text-white text-xs font-bold p-3 rounded-xl border border-neutral-800 transition-all flex items-center justify-between cursor-pointer group shadow"
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <Tv size={16} className="text-yellow-400 group-hover:text-black flex-shrink-0" />
                        <div className="text-left truncate">
                          <span className="block truncate">{dev.name}</span>
                          <span className="text-[9px] text-gray-500 group-hover:text-black/80 font-normal">{dev.type} • Ready to Cast</span>
                        </div>
                      </div>
                      <span className="text-[10px] bg-yellow-400/20 text-yellow-400 group-hover:bg-black group-hover:text-yellow-400 px-2 py-1 rounded uppercase font-black flex-shrink-0">Connect</span>
                    </button>
                  ))}
                </div>
              ) : !isSearching && (
                <div className="mt-4 p-4 border border-dashed border-neutral-800 rounded-xl text-center text-gray-500 text-xs">
                  No devices found. Ensure your TV and phone share the same Wi-Fi network.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer Note */}
        <div className="mt-4 pt-3 border-t border-neutral-800/80 flex items-center justify-between text-[11px] text-gray-400">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold">
            <ShieldCheck size={14} /> Google Cast SDK Ready
          </div>
          <span className="text-gray-500 font-mono text-[10px]">Wi-Fi Local Network</span>
        </div>
      </div>
    </div>
  );
}
