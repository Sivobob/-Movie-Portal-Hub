import React, { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import TVCastModal from './TVCastModal';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  X,
  RefreshCw,
  AlertCircle,
  Film,
  Tv,
  Settings,
  SkipBack,
  SkipForward,
  RotateCcw,
  RotateCw,
  Check,
  ExternalLink,
  Download,
  Music,
  Captions,
  Radio
} from 'lucide-react';
import { useDownloads } from '../hooks/useDownloads';
import { buildApiUrl } from '../utils/apiConfig';


interface VideoPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  videoUrl: string;
  videoQualities?: Record<string, string>; // { '480p': '...', '720p': '...', '1080p': '...', '4K': '...' }
  category?: string;
  posterUrl?: string;
  onNextEpisode?: () => void;
  onPrevEpisode?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
  initialDuration?: number;
  onRequestDownload?: (movie: any) => void;
}

export default function VideoPlayerModal({
  isOpen,
  onClose,
  title,
  videoUrl,
  videoQualities = {},
  category,
  posterUrl,
  onNextEpisode,
  onPrevEpisode,
  hasNext,
  hasPrev,
  initialDuration = 0,
  onRequestDownload,
}: VideoPlayerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration);
  const [bufferedTime, setBufferedTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showTVCastModal, setShowTVCastModal] = useState(false);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showSubtitlesMenu, setShowSubtitlesMenu] = useState(false);
  const [selectedAudio, setSelectedAudio] = useState('Default (Stereo)');
  const [selectedSubtitle, setSelectedSubtitle] = useState('Off');
  const [error, setError] = useState<string | null>(null);
  const [playableUrl, setPlayableUrl] = useState<string>('');
  const [retryCount, setRetryCount] = useState(0);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [customServerInput, setCustomServerInput] = useState(() => {
    return (typeof window !== 'undefined' && localStorage.getItem('movie_portal_backend_url')) || '';
  });

  const { startDownload } = useDownloads();
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadSize, setDownloadSize] = useState<string | null>(null);

  const [showControls, setShowControls] = useState(true);
  const autoHideTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clearAutoHideTimer = () => {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
  };

  const scheduleAutoHideTimer = () => {
    clearAutoHideTimer();
    if (isPlaying) {
      autoHideTimerRef.current = setTimeout(() => {
        setShowControls(false);
        setShowQualityMenu(false);
        setShowSpeedMenu(false);
        setShowAudioMenu(false);
        setShowSubtitlesMenu(false);
      }, 5000); // 5 seconds
    }
  };

  const showControlsWithTimer = () => {
    setShowControls(true);
    scheduleAutoHideTimer();
  };

  const hideControlsImmediately = () => {
    clearAutoHideTimer();
    setShowControls(false);
    setShowQualityMenu(false);
    setShowSpeedMenu(false);
    setShowAudioMenu(false);
    setShowSubtitlesMenu(false);
  };

  const toggleControlsVisibility = () => {
    setShowControls((prev) => {
      if (prev) {
        clearAutoHideTimer();
        setShowQualityMenu(false);
        setShowSpeedMenu(false);
        setShowAudioMenu(false);
        setShowSubtitlesMenu(false);
        return false;
      } else {
        scheduleAutoHideTimer();
        return true;
      }
    });
  };

  const handleUserActivity = () => {
    if (showControls && isPlaying) {
      scheduleAutoHideTimer();
    }
  };

  const resetAutoHideTimer = () => {
    showControlsWithTimer();
  };

  useEffect(() => {
    if (isOpen) {
      showControlsWithTimer();
    }
    return () => {
      clearAutoHideTimer();
    };
  }, [isOpen, isPlaying]);

  const [doubleTapFeedback, setDoubleTapFeedback] = useState<{ side: 'left' | 'right'; text: string } | null>(null);
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTapTimeRef = useRef<number>(0);

  const handleViewportClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const now = Date.now();
    const timeDiff = now - lastTapTimeRef.current;
    lastTapTimeRef.current = now;

    if (timeDiff < 280) {
      // Double Tap detected (Netflix style seek)
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = null;
      }
      
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const isRight = clickX > rect.width / 2;

      if (isRight) {
        handleSkip(10);
        setDoubleTapFeedback({ side: 'right', text: '+10s' });
      } else {
        handleSkip(-10);
        setDoubleTapFeedback({ side: 'left', text: '-10s' });
      }

      setTimeout(() => {
        setDoubleTapFeedback(null);
      }, 700);
    } else {
      // Single Tap (Toggle controls visibility: show on 1st tap, hide on 2nd tap)
      clickTimeoutRef.current = setTimeout(() => {
        toggleControlsVisibility();
      }, 280);
    }
  };

  // Quality State
  const availableQualities = Object.keys(videoQualities)
    .filter((k) => typeof videoQualities[k] === 'string' && videoQualities[k].trim().length > 0)
    .sort((a, b) => {
      const qA = parseInt(a) || 0;
      const qB = parseInt(b) || 0;
      return qB - qA; // Higher first
    });

  const [currentQuality, setCurrentQuality] = useState<string>(() => {
    if (availableQualities.length > 0) return availableQualities[0];
    return 'Default';
  });

  // Sync quality whenever movie or qualities change
  useEffect(() => {
    if (availableQualities.length > 0) {
      if (!availableQualities.includes(currentQuality)) {
        setCurrentQuality(availableQualities[0]);
      }
    } else {
      setCurrentQuality('Default');
    }
  }, [videoUrl, availableQualities.join(',')]);

  // Identify stream type
  const isYouTube = /youtube\.com|youtu\.be/i.test(videoUrl);

  // Resolve Playable URL (Direct or via Proxy)
  useEffect(() => {
    if (!isOpen || (!videoUrl && availableQualities.length === 0)) return;

    setError(null);
    setIsLoading(true);

    const activeUrl = (videoQualities && videoQualities[currentQuality]) || videoUrl;
    if (!activeUrl || !activeUrl.trim()) {
      setIsLoading(false);
      return;
    }

    const trimmed = activeUrl.trim();
    const isTelegram = /t\.me|telegram\.me/i.test(trimmed);

    if (isTelegram) {
      const retryParam = retryCount > 0 ? `&retry=${Date.now()}` : '';
      setPlayableUrl(buildApiUrl(`/api/stream?url=${encodeURIComponent(trimmed)}${retryParam}`));
    } else {
      setPlayableUrl(trimmed);
    }
  }, [isOpen, videoUrl, currentQuality, retryCount]);

  // Handle Quality Switch
  const handleQualityChange = (quality: string) => {
    if (quality === currentQuality) return;
    
    // Save current playback state
    const time = videoRef.current?.currentTime || 0;
    const wasPlaying = isPlaying;

    setCurrentQuality(quality);
    setShowQualityMenu(false);
    setIsLoading(true);

    // After state updates, the useEffect will trigger playableUrl change
    // We need to seek back once metadata is loaded
    const onLoaded = () => {
      if (videoRef.current) {
        videoRef.current.currentTime = time;
        if (wasPlaying) videoRef.current.play().catch(() => {});
      }
      videoRef.current?.removeEventListener('loadedmetadata', onLoaded);
    };

    videoRef.current?.addEventListener('loadedmetadata', onLoaded);
  };

  const hlsRef = useRef<Hls | null>(null);

  // Video event listeners and Autoplay (with HLS support)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isYouTube || !playableUrl) return;

    let hlsInstance: Hls | null = null;
    const isHlsUrl = /\.m3u8/i.test(playableUrl);

    if (isHlsUrl && Hls.isSupported()) {
      hlsInstance = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });
      hlsRef.current = hlsInstance;
      hlsInstance.loadSource(playableUrl);
      hlsInstance.attachMedia(video);

      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        video.play().catch(err => console.warn('HLS Autoplay:', err));
      });

      hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setIsLoading(false);
          setError('HLS Stream Error: Unable to parse or load HLS playlist manifest.');
        }
      });
    } else if (isHlsUrl && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playableUrl;
    }

    const onPlay = () => {
      setIsPlaying(true);
      resetAutoHideTimer();
    };
    const onPause = () => {
      setIsPlaying(false);
      setShowControls(true);
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    };
    const onTimeUpdate = () => {
      const cur = video.currentTime;
      setCurrentTime(cur);

      // Persist resume position every few seconds
      if (cur > 10 && title) {
        try {
          localStorage.setItem(`resume_pos_${title}`, cur.toString());
        } catch (e) {}
      }

      if (video.buffered.length > 0) {
        // Find which buffered range we are currently in
        for (let i = 0; i < video.buffered.length; i++) {
          if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime) {
            setBufferedTime(video.buffered.end(i));
            break;
          }
        }
      }
    };
    const onLoadedMetadata = () => {
      const vidDuration = video.duration;
      // Only trust browser duration if it is not Infinity AND (we don't have a manual duration OR browser reported a significantly larger value)
      setDuration(prev => {
        if (vidDuration && vidDuration !== Infinity && (prev <= 0 || vidDuration > prev)) {
          return vidDuration;
        }
        return prev;
      });
      setIsLoading(false);

      // Restore saved playback position if available
      if (title) {
        try {
          const savedPos = parseFloat(localStorage.getItem(`resume_pos_${title}`) || '0');
          if (savedPos > 15 && (!vidDuration || savedPos < vidDuration - 45)) {
            video.currentTime = savedPos;
            setCurrentTime(savedPos);
            console.log(`[Player] Resumed playback at: ${savedPos}s`);
          }
        } catch (e) {}
      }
    };

    // Attempt to fetch duration from custom headers for fragmented streams (MKV remux)
    if (playableUrl && playableUrl.includes('/api/stream')) {
      fetch(playableUrl, { method: 'HEAD' })
        .then(res => {
          const customDuration = res.headers.get('X-Video-Duration');
          if (customDuration) {
            const parsedDuration = parseFloat(customDuration);
            if (!isNaN(parsedDuration) && parsedDuration > 0) {
              setDuration(parsedDuration);
              console.log('[Player] Set manual duration from header:', parsedDuration);
            }
          }
        })
        .catch(err => console.warn('[Player] Duration header fetch failed:', err));
    }
    const onWaiting = () => {
      // Only set loading if video has already started playing and is buffering
      if (video.currentTime > 0.5) {
        setIsLoading(true);
      }
    };
    const onPlaying = () => {
      setIsLoading(false);
      setIsPlaying(true);
      resetAutoHideTimer();
    };
    const onCanPlay = () => setIsLoading(false);
    const onLoadedData = () => setIsLoading(false);
    const onEnded = () => {
      if (title) {
        try {
          localStorage.removeItem(`resume_pos_${title}`);
        } catch (e) {}
      }
      if (onNextEpisode && hasNext) {
        onNextEpisode();
      }
    };
    const onError = async () => {
      if (retryCount < 2) {
        console.warn('[Player] Transient stream error detected, auto-retrying...', video.error);
        setRetryCount(prev => prev + 1);
        return;
      }
      setIsLoading(false);
      const videoError = video.error;
      let msg = 'Unable to load stream. Please try again.';
      if (videoError?.code === 4) msg = 'Unable to load stream. Please try again.';
      if (videoError?.code === 3) msg = 'Network error while downloading video.';

      if (playableUrl && playableUrl.includes('/api/stream')) {
        try {
          const res = await fetch(playableUrl, { headers: { Range: 'bytes=0-10' } });
          if (!res.ok) {
            const serverMsg = await res.text();
            if (serverMsg && serverMsg.trim()) {
              msg = serverMsg.trim();
            }
          }
        } catch (e) {
          // keep fallback msg
        }
      }

      setError(msg);
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    // Standard non-HLS video playback with safe fallback
    if (!isHlsUrl) {
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsLoading(false);
            setIsPlaying(true);
          })
          .catch((err) => {
            console.warn('[Player] Direct unmuted autoplay prevented by browser:', err);
            // Browser blocked unmuted autoplay - attempt muted autoplay
            video.muted = true;
            setIsMuted(true);
            video.play()
              .then(() => {
                setIsLoading(false);
                setIsPlaying(true);
              })
              .catch((mutedErr) => {
                console.warn('[Player] Muted autoplay also prevented:', mutedErr);
                // Crucial: Clear loading state so user can tap the large play button
                setIsLoading(false);
                setIsPlaying(false);
              });
          });
      }
    }

    // Safety watchdog: ensure loading spinner never blocks the user longer than 2.5s
    const safetyTimer = setTimeout(() => {
      setIsLoading(false);
    }, 2500);

    return () => {
      clearTimeout(safetyTimer);
      if (hlsInstance) {
        hlsInstance.destroy();
        hlsRef.current = null;
      }
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
    };
  }, [playableUrl, isYouTube]);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      resetAutoHideTimer();
      if (e.key === 'Escape') onClose();
      else if (e.key === ' ' && !isYouTube) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isPlaying, isYouTube]);

  if (!isOpen) return null;

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(e => {
        if (e.name !== 'AbortError' && !e.message?.includes('interrupted')) {
          console.warn('Play error:', e);
        }
      });
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    resetAutoHideTimer();
    const time = Number(e.target.value);
    videoRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleSkip = (seconds: number) => {
    if (!videoRef.current) return;
    resetAutoHideTimer();
    const newTime = Math.max(0, Math.min(duration || 0, videoRef.current.currentTime + seconds));
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    resetAutoHideTimer();
    const val = Number(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
    }
    setIsMuted(val === 0);
  };

  const toggleMute = () => {
    resetAutoHideTimer();
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    videoRef.current.muted = nextMuted;
  };

  const toggleFullscreen = () => {
    resetAutoHideTimer();
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || !isFinite(secs) || secs < 0) return '00:00';
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleRetry = () => {
    resetAutoHideTimer();
    setRetryCount(prev => prev + 1);
  };

  const handleDownload = async () => {
    if (!videoUrl) return;
    if (onRequestDownload) {
      onRequestDownload({
        title,
        posterUrl,
        streamingUrl: playableUrl || videoUrl,
        displayCategory: category,
        videoQualities,
      });
      return;
    }
    if (isDownloading) return;
    setIsDownloading(true);
    
    try {
      // Try to get file size
      const res = await fetch(playableUrl || videoUrl, { method: 'HEAD' });
      const size = res.headers.get('content-length');
      let formattedSize = 'Unknown Size';
      if (size) {
        const mb = parseInt(size) / (1024 * 1024);
        formattedSize = mb > 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
      }
      setDownloadSize(formattedSize);

      // Add to downloads and trigger device download
      startDownload({
        title,
        posterUrl: posterUrl || '',
        videoUrl: playableUrl || videoUrl,
        quality: currentQuality || '720p HD',
        originalCategory: category || 'Movie',
      });
      
      setTimeout(() => setIsDownloading(false), 2000);
    } catch (e) {
      console.error('Download failed', e);
      setIsDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col justify-between select-none overflow-hidden">
      <div
        ref={containerRef}
        onMouseMove={handleUserActivity}
        className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden"
      >
        {/* Top Header */}
        <div 
          onClick={(e) => { e.stopPropagation(); resetAutoHideTimer(); }}
          className={`absolute top-0 left-0 w-full bg-gradient-to-b from-black/90 via-black/60 to-transparent p-4 flex items-center justify-between z-40 transition-opacity duration-300 ${
            showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-2.5 truncate max-w-[80%]">
            <span className="bg-yellow-400 text-black text-[10px] font-black px-1.5 py-0.5 rounded uppercase">
              {currentQuality !== 'Default' ? `${currentQuality} STREAM` : 'HD STREAM'}
            </span>
            <h3 className="text-sm sm:text-base font-bold text-white truncate shadow-black drop-shadow-md">{title}</h3>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                resetAutoHideTimer();
                handleDownload();
              }}
              disabled={isDownloading}
              title="Download Movie"
              className={`p-2 rounded-full bg-black/40 text-yellow-400 border border-yellow-400/30 transition-all backdrop-blur-sm cursor-pointer flex items-center justify-center ${
                isDownloading ? 'opacity-50 animate-pulse' : 'hover:bg-yellow-400 hover:text-black'
              }`}
            >
              <Download size={18} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                resetAutoHideTimer();
                setShowTVCastModal(true);
              }}
              title="Cast to Smart TV"
              className="p-2 rounded-full bg-black/40 hover:bg-yellow-400 text-yellow-400 hover:text-black transition-colors backdrop-blur-sm cursor-pointer flex items-center justify-center border border-yellow-400/30"
            >
              <Tv size={18} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full bg-black/40 hover:bg-red-600 text-white transition-colors backdrop-blur-sm cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* TV Cast Discovery & Connection Modal */}
        <TVCastModal
          isOpen={showTVCastModal}
          onClose={() => setShowTVCastModal(false)}
          title={title}
          videoUrl={playableUrl || videoUrl}
        />

        {/* Player Viewport */}
        <div 
          className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden cursor-pointer"
          onClick={handleViewportClick}
        >
          {!isYouTube ? (
            <>
              <video
                ref={videoRef}
                src={playableUrl || undefined}
                playsInline
                preload="auto"
                className="w-full h-full object-contain pointer-events-none"
              />

              {/* Double-Tap Netflix Ripple Overlay */}
              {doubleTapFeedback && (
                <div 
                  className={`absolute top-0 bottom-0 w-1/2 flex flex-col items-center justify-center bg-white/10 backdrop-blur-xs z-30 animate-in fade-in zoom-in-90 duration-200 pointer-events-none ${
                    doubleTapFeedback.side === 'right' ? 'right-0 rounded-l-full' : 'left-0 rounded-r-full'
                  }`}
                >
                  <div className="flex flex-col items-center gap-1 text-yellow-400 font-black">
                    {doubleTapFeedback.side === 'right' ? (
                      <RotateCw size={40} className="animate-spin-slow" />
                    ) : (
                      <RotateCcw size={40} className="animate-spin-slow" />
                    )}
                    <span className="text-sm font-mono tracking-widest">{doubleTapFeedback.text}</span>
                  </div>
                </div>
              )}

              {/* Small Loading Spinner at Bottom Center */}
              {isLoading && !error && (
                <div className="absolute bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-2.5 bg-black/80 backdrop-blur-md px-4 py-2 rounded-full border border-neutral-800 z-25 pointer-events-none shadow-xl select-none">
                  <RefreshCw className="animate-spin text-yellow-400" size={16} />
                  <span className="text-xs text-gray-200 font-bold tracking-wide">Loading...</span>
                </div>
              )}

              {/* Minimal Clean Error & Options Screen */}
              {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 z-30 px-6 text-center">
                  <div className="max-w-md bg-neutral-900 border border-red-800/60 p-5 rounded-2xl shadow-2xl mb-4">
                    <p className="text-xs text-red-400 font-bold mb-1 uppercase tracking-wider">Stream Playback Notice</p>
                    <p className="text-xs text-gray-300 leading-relaxed">{error}</p>
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-2 max-w-md">
                    <button
                      onClick={() => {
                        setError(null);
                        setIsLoading(true);
                        handleRetry();
                      }}
                      className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-500 text-black font-black text-xs px-5 py-2.5 rounded-xl transition-all active:scale-95 cursor-pointer shadow-lg shadow-yellow-400/20"
                    >
                      <RotateCcw size={15} /> Retry Playback
                    </button>



                    <button
                      onClick={() => {
                        setError(null);
                        setIsLoading(true);
                        setPlayableUrl('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4');
                      }}
                      className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-gray-300 font-semibold text-xs px-4 py-2.5 rounded-xl border border-neutral-700 transition-all cursor-pointer"
                    >
                      <Play size={14} /> Test Sample
                    </button>

                    <button
                      onClick={() => setShowServerConfig(prev => !prev)}
                      className="flex items-center gap-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-gray-400 hover:text-white text-xs px-3 py-2.5 rounded-xl border border-neutral-800 transition-all cursor-pointer"
                      title="Configure Backend Server"
                    >
                      <Settings size={14} /> Server
                    </button>
                  </div>

                  {showServerConfig && (
                    <div className="mt-4 p-3 bg-neutral-900 border border-neutral-700 rounded-xl max-w-md w-full text-left space-y-2 animate-in fade-in duration-150">
                      <label className="text-[11px] font-bold text-gray-300 block">Stream Server URL:</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={customServerInput}
                          onChange={(e) => setCustomServerInput(e.target.value)}
                          placeholder="https://your-backend.run.app"
                          className="flex-1 bg-black text-white text-xs px-3 py-1.5 rounded-lg border border-neutral-700 focus:outline-none focus:border-yellow-400"
                        />
                        <button
                          onClick={() => {
                            if (customServerInput.trim()) {
                              localStorage.setItem('movie_portal_backend_url', customServerInput.trim());
                            } else {
                              localStorage.removeItem('movie_portal_backend_url');
                            }
                            setShowServerConfig(false);
                            setError(null);
                            setIsLoading(true);
                            handleRetry();
                          }}
                          className="bg-yellow-400 text-black font-bold text-xs px-3 py-1.5 rounded-lg hover:bg-yellow-300 transition-all cursor-pointer"
                        >
                          Save
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-500">Enter your live cloud server or Cloud Run URL to proxy Telegram streams.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Center Play Icon (Paused) */}
              {!isPlaying && !error && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsLoading(false);
                    togglePlay();
                    resetAutoHideTimer();
                  }}
                  className="absolute inset-0 m-auto w-20 h-20 rounded-full bg-yellow-400/90 text-black flex items-center justify-center shadow-2xl transition-transform hover:scale-110 active:scale-90 z-30 cursor-pointer"
                >
                  <Play size={32} fill="black" className="ml-1" />
                </button>
              )}
            </>
          ) : (
            <iframe
              src={`https://www.youtube.com/embed/${videoUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|v\/|embed\/|user\/(?:\w+\/)?))([^?&]+)/)?.[1]}?autoplay=1&rel=0`}
              title={title}
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          )}
        </div>

        {/* Custom Controls Bar */}
        {!isYouTube && !error && (
          <div 
            onClick={(e) => { e.stopPropagation(); resetAutoHideTimer(); }}
            className={`absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/95 via-black/80 to-transparent p-4 pb-6 space-y-3 z-40 transition-opacity duration-300 ${
              showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
          >
            {/* Timeline */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono text-gray-400 w-16 text-right tabular-nums">
                {formatTime(currentTime)}
              </span>
              <div className="relative flex-grow h-1.5 bg-neutral-800 rounded-full group">
                <input
                  type="range"
                  min="0"
                  max={duration || 100}
                  value={currentTime}
                  onChange={handleSeek}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                />
                <div 
                  className="absolute h-full bg-white/20 rounded-full pointer-events-none"
                  style={{ width: `${(bufferedTime / (duration || 100)) * 100}%` }}
                />
                <div 
                  className="absolute h-full bg-yellow-400 rounded-full pointer-events-none z-10"
                  style={{ width: `${(currentTime / (duration || 100)) * 100}%` }}
                />
                <div 
                  className="absolute h-3 w-3 bg-white rounded-full -top-[3px] shadow-lg pointer-events-none transition-transform group-hover:scale-125 z-10"
                  style={{ left: `calc(${(currentTime / (duration || 100)) * 100}% - 6px)` }}
                />
              </div>
              <span className="text-[11px] font-mono text-gray-400 w-16 tabular-nums">
                {formatTime(duration)}
              </span>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {onPrevEpisode && (
                  <button
                    onClick={onPrevEpisode}
                    disabled={!hasPrev}
                    className="text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
                  >
                    <SkipBack size={20} fill="currentColor" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleSkip(-10)}
                  title="Rewind 10s"
                  className="text-gray-300 hover:text-yellow-400 transition-colors cursor-pointer flex items-center gap-0.5 text-xs font-bold"
                >
                  <RotateCcw size={18} />
                  <span className="text-[10px]">10s</span>
                </button>

                <button
                  type="button"
                  onClick={togglePlay}
                  className="bg-yellow-400 text-black p-2.5 rounded-full transition-transform active:scale-90 cursor-pointer shadow-lg hover:bg-yellow-300"
                >
                  {isPlaying ? <Pause size={20} fill="black" /> : <Play size={20} fill="black" className="ml-0.5" />}
                </button>

                <button
                  type="button"
                  onClick={() => handleSkip(10)}
                  title="Forward 10s"
                  className="text-gray-300 hover:text-yellow-400 transition-colors cursor-pointer flex items-center gap-0.5 text-xs font-bold"
                >
                  <span className="text-[10px]">10s</span>
                  <RotateCw size={18} />
                </button>

                {onNextEpisode && (
                  <button
                    onClick={onNextEpisode}
                    disabled={!hasNext}
                    className="text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
                  >
                    <SkipForward size={20} fill="currentColor" />
                  </button>
                )}

                <div className="flex items-center gap-2 group ml-2">
                  <button onClick={toggleMute} className="text-gray-400 hover:text-white transition-colors">
                    {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    className="w-20 accent-white h-1 bg-neutral-800 rounded cursor-pointer"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                {/* Audio Menu */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setShowAudioMenu(!showAudioMenu);
                      setShowQualityMenu(false);
                      setShowSpeedMenu(false);
                      setShowSubtitlesMenu(false);
                    }}
                    className="flex items-center gap-1.5 text-gray-400 hover:text-white text-[10px] font-black border border-neutral-800 px-2.5 py-1 rounded-md transition-colors cursor-pointer"
                  >
                    <Music size={14} className={showAudioMenu ? 'text-yellow-400' : ''} />
                    <span>Audio</span>
                  </button>
                  {showAudioMenu && (
                    <div className="absolute bottom-full right-0 mb-2 bg-neutral-900 border border-neutral-800 rounded-lg shadow-xl overflow-hidden min-w-[130px] z-50">
                      <div className="px-3 py-2 text-[9px] font-black text-gray-500 bg-black/40 border-b border-neutral-800 uppercase">Audio Track</div>
                      {['Default (Stereo)', 'Hindi HD', 'English HD'].map((track) => (
                        <button
                          key={track}
                          onClick={() => {
                            setSelectedAudio(track);
                            setShowAudioMenu(false);
                          }}
                          className={`w-full text-left px-3 py-2.5 text-[11px] hover:bg-yellow-400 hover:text-black transition-colors flex items-center justify-between ${
                            selectedAudio === track ? 'text-yellow-400 font-bold bg-white/5' : 'text-gray-300'
                          }`}
                        >
                          <span>{track}</span>
                          {selectedAudio === track && <Check size={12} className="stroke-[3]" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Subtitles Menu */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setShowSubtitlesMenu(!showSubtitlesMenu);
                      setShowQualityMenu(false);
                      setShowSpeedMenu(false);
                      setShowAudioMenu(false);
                    }}
                    className="flex items-center gap-1.5 text-gray-400 hover:text-white text-[10px] font-black border border-neutral-800 px-2.5 py-1 rounded-md transition-colors cursor-pointer"
                  >
                    <Captions size={14} className={showSubtitlesMenu ? 'text-yellow-400' : ''} />
                    <span>Subtitles</span>
                  </button>
                  {showSubtitlesMenu && (
                    <div className="absolute bottom-full right-0 mb-2 bg-neutral-900 border border-neutral-800 rounded-lg shadow-xl overflow-hidden min-w-[120px] z-50">
                      <div className="px-3 py-2 text-[9px] font-black text-gray-500 bg-black/40 border-b border-neutral-800 uppercase">Subtitles (CC)</div>
                      {['Off', 'English', 'Hindi'].map((sub) => (
                        <button
                          key={sub}
                          onClick={() => {
                            setSelectedSubtitle(sub);
                            setShowSubtitlesMenu(false);
                          }}
                          className={`w-full text-left px-3 py-2.5 text-[11px] hover:bg-yellow-400 hover:text-black transition-colors flex items-center justify-between ${
                            selectedSubtitle === sub ? 'text-yellow-400 font-bold bg-white/5' : 'text-gray-300'
                          }`}
                        >
                          <span>{sub}</span>
                          {selectedSubtitle === sub && <Check size={12} className="stroke-[3]" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quality Menu */}
                {availableQualities.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => {
                        setShowQualityMenu(!showQualityMenu);
                        setShowSpeedMenu(false);
                      }}
                      className="flex items-center gap-1.5 text-gray-400 hover:text-white text-[10px] font-black border border-neutral-800 px-2.5 py-1 rounded-md transition-colors"
                    >
                      <Settings size={14} className={showQualityMenu ? 'text-yellow-400' : ''} />
                      {currentQuality}
                    </button>
                    {showQualityMenu && (
                      <div className="absolute bottom-full right-0 mb-2 bg-neutral-900 border border-neutral-800 rounded-lg shadow-xl overflow-hidden min-w-[110px] z-50">
                        <div className="px-3 py-2 text-[9px] font-black text-gray-500 bg-black/40 border-b border-neutral-800 uppercase">Select Quality</div>
                        {availableQualities.map((q) => (
                          <button
                            key={q}
                            onClick={() => handleQualityChange(q)}
                            className={`w-full text-left px-3 py-2.5 text-[11px] hover:bg-yellow-400 hover:text-black transition-colors flex items-center justify-between ${
                              currentQuality === q ? 'text-yellow-400 font-bold bg-white/5' : 'text-gray-300'
                            }`}
                          >
                            <span>{q}</span>
                            {currentQuality === q && <Check size={12} className="stroke-[3]" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Speed Menu */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setShowSpeedMenu(!showSpeedMenu);
                      setShowQualityMenu(false);
                    }}
                    className="text-gray-400 hover:text-white text-[10px] font-black border border-neutral-800 px-2.5 py-1 rounded-md transition-colors"
                  >
                    {playbackSpeed}x
                  </button>
                  {showSpeedMenu && (
                    <div className="absolute bottom-full right-0 mb-2 bg-neutral-900 border border-neutral-800 rounded-lg shadow-xl overflow-hidden min-w-[90px] z-50">
                      <div className="px-3 py-2 text-[9px] font-black text-gray-500 bg-black/40 border-b border-neutral-800 uppercase">Playback Speed</div>
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((spd) => (
                        <button
                          key={spd}
                          onClick={() => {
                            setPlaybackSpeed(spd);
                            if (videoRef.current) videoRef.current.playbackRate = spd;
                            setShowSpeedMenu(false);
                          }}
                          className={`w-full text-left px-3 py-2.5 text-[11px] hover:bg-yellow-400 hover:text-black transition-colors flex items-center justify-between ${
                            playbackSpeed === spd ? 'text-yellow-400 font-bold bg-white/5' : 'text-gray-300'
                          }`}
                        >
                          <span>{spd}x</span>
                          {playbackSpeed === spd && <Check size={12} className="stroke-[3]" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  onClick={toggleFullscreen}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
