import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Hls from 'hls.js';
import TVCastModal from './TVCastModal';
import {
  Play,
  Pause,
  ArrowLeft,
  Maximize,
  Minimize,
  Settings,
  Volume2,
  Captions,
  Gauge,
  Languages,
  Check,
  ChevronDown,
  Tv,
  RefreshCw,
  AlertCircle,
  HelpCircle,
  Lock,
  Unlock,
  ChevronLeft,
  X,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';
import {
  abortLocalBridgeStreams,
  buildApiUrl,
  ensureAndroidStreamBridge,
  forceUseLocalNativeBridge,
  getNativeLocalBridgeUrl,
  getRemoteTranscodeBackendUrl,
  hasRemoteTranscodeBackend,
  isUsingLocalNativeBridge,
  probeWorkingBackendUrl,
} from '../utils/apiConfig';
import { formatClockTime, parseDurationToSeconds } from '../utils/duration';
import { isEpisodeNewActive } from '../services/movieStorage';


export interface VideoPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  videoUrl: string;
  videoQualities?: Record<string, string>;
  category?: string;
  posterUrl?: string;
  movie?: any;
  seasonIndex?: number;
  episodeIndex?: number;
  language?: string;
  hasNext?: boolean;
  hasPrev?: boolean;
  initialDuration?: number;
  initialTime?: number;
  onProgress?: (currentTime: number, duration: number) => void;
  onNextEpisode?: () => void;
  onPrevEpisode?: () => void;
  onEpisodeChange?: (seasonIndex: number, episodeIndex: number) => void;
  manageHistory?: boolean;
}

// Custom 10-Second Rewind Icon matching reference screenshot
function Rewind10Icon({ className = "w-9 h-9 sm:w-11 sm:h-11" }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 5 C10.8 5 5 10.8 5 18 C5 25.2 10.8 31 18 31 C25.2 31 31 25.2 31 18 C31 12.8 28 8.3 23.5 6.2" />
      <polygon points="21,2 24.5,6.5 19.5,8.5" fill="currentColor" stroke="none" />
      <text x="18" y="21.5" textAnchor="middle" fontSize="9" fontWeight="bold" fill="currentColor" stroke="none" fontFamily="system-ui, -apple-system, sans-serif">10</text>
    </svg>
  );
}

// Custom 10-Second Forward Icon matching reference screenshot
function Forward10Icon({ className = "w-9 h-9 sm:w-11 sm:h-11" }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 5 C25.2 5 31 10.8 31 18 C31 25.2 25.2 31 18 31 C10.8 31 5 25.2 5 18 C5 12.8 8 8.3 12.5 6.2" />
      <polygon points="15,2 11.5,6.5 16.5,8.5" fill="currentColor" stroke="none" />
      <text x="18" y="21.5" textAnchor="middle" fontSize="9" fontWeight="bold" fill="currentColor" stroke="none" fontFamily="system-ui, -apple-system, sans-serif">10</text>
    </svg>
  );
}

// Screen Fit Icon [<->] matching screenshot
function PlayerFitIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <polyline points="7 12 5 12 9 12" strokeWidth="2" />
      <polyline points="17 12 19 12 15 12" strokeWidth="2" />
      <polyline points="7 10 5 12 7 14" strokeWidth="2" />
      <polyline points="17 10 19 12 17 14" strokeWidth="2" />
    </svg>
  );
}

// Language Subtitle/Audio Icon [=] matching screenshot
function PlayerLanguageIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="6" y1="10" x2="18" y2="10" />
      <line x1="6" y1="14" x2="14" y2="14" />
    </svg>
  );
}

// Speed Gauge Icon (1x) matching screenshot
function PlayerSpeedIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}

export default function VideoPlayerModal({
  isOpen,
  onClose,
  title,
  videoUrl,
  videoQualities = {},
  category,
  posterUrl,
  movie,
  seasonIndex = 0,
  episodeIndex = 0,
  language,
  onNextEpisode,
  onPrevEpisode,
  onEpisodeChange,
  hasNext,
  hasPrev,
  initialDuration = 0,
  initialTime = 0,
  onProgress,
  manageHistory = true,
}: VideoPlayerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration);
  const [bufferedTime, setBufferedTime] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isFullscreenRef = useRef(false);
  isFullscreenRef.current = isFullscreen;
  const [isLoading, setIsLoading] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [fallbackStage, setFallbackStage] = useState<'level1_hw' | 'level2_sw' | 'level2_surface' | 'level2_remux' | 'level3_transcode' | 'level4_error'>('level1_hw');
  const [preferSoftwareDecoder, setPreferSoftwareDecoder] = useState<boolean>(false);
  const [surfaceMode, setSurfaceMode] = useState<'texture' | 'surface'>('texture');
  const [streamFallbackMode, setStreamFallbackMode] = useState<'direct' | 'remux' | 'transcode'>('direct');
  const [streamStartOffset, setStreamStartOffset] = useState<number>(0);
  const [selectedAudioIdx, setSelectedAudioIdx] = useState<number>(0);
  const [useLocalBridgeFallback, setUseLocalBridgeFallback] = useState(false);
  const [manualRetryNonce, setManualRetryNonce] = useState(0);
  const [hasDecodedFrame, setHasDecodedFrame] = useState(false);
  const [seekPreviewTime, setSeekPreviewTime] = useState<number | null>(null);
  const isDraggingSeekRef = useRef(false);
  const seekPreviewTimeRef = useRef<number | null>(null);
  const handleSeekCommitRef = useRef<() => void>(() => {});
  const wasMutedByAutoplayRef = useRef(false);
  const durationRef = useRef(initialDuration || 0);
  const knownDurationRef = useRef(initialDuration || 0);
  const currentTimeRef = useRef(0);
  const resumeOffsetRef = useRef(0);
  const fallbackStageRef = useRef(fallbackStage);
  fallbackStageRef.current = fallbackStage;
  const streamFallbackModeRef = useRef(streamFallbackMode);
  streamFallbackModeRef.current = streamFallbackMode;
  const preferSoftwareRef = useRef(preferSoftwareDecoder);
  preferSoftwareRef.current = preferSoftwareDecoder;
  const surfaceModeRef = useRef(surfaceMode);
  surfaceModeRef.current = surfaceMode;
  const streamStartOffsetRef = useRef(streamStartOffset);
  streamStartOffsetRef.current = streamStartOffset;
  const preflightCacheRef = useRef<{ url: string; recommendedMode: 'direct' | 'remux' | 'transcode'; durationSec: number; sourceHeight?: number } | null>(null);
  const userPickedQualityRef = useRef<boolean>(false);

  // Runtime Android device and decoder capabilities from native bridge
  const deviceCapabilities = useMemo(() => {
    if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
      try {
        const bridge = (window as any).AndroidPlayerBridge;
        if (typeof bridge?.getDeviceCapabilities === 'function') {
          const raw = bridge.getDeviceCapabilities();
          if (raw) return JSON.parse(raw);
        }
      } catch (e) {
        console.warn('[VideoPlayer] getDeviceCapabilities notice:', e);
      }
    }
    return null;
  }, [isOpen]);

  // Active series season and episode indices
  const [activeSeasonIdx, setActiveSeasonIdx] = useState(seasonIndex);
  const [activeEpisodeIdx, setActiveEpisodeIdx] = useState(episodeIndex);
  const [activeStreamUrl, setActiveStreamUrl] = useState(videoUrl);
  const [currentEpisodeTitle, setCurrentEpisodeTitle] = useState(title);

  // Track menus visibility
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showSubtitlesMenu, setShowSubtitlesMenu] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showSeasonDropdown, setShowSeasonDropdown] = useState(false);
  const [showEpisodeDropdown, setShowEpisodeDropdown] = useState(false);
  const [showTVCastModal, setShowTVCastModal] = useState(false);

  // Reference UI States (Matching Screenshot)
  const [isLocked, setIsLocked] = useState(false);
  const [showLockPrompt, setShowLockPrompt] = useState(false);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [videoFit, setVideoFit] = useState<'contain' | 'cover' | 'fill'>('contain');
  const [selectedQuality, setSelectedQuality] = useState<string>('Auto');
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [fitNotice, setFitNotice] = useState<string | null>(null);

  // Real detected audio and subtitle tracks
  const [realAudioTracks, setRealAudioTracks] = useState<Array<{ id: number | string; label: string; lang?: string }>>([
    { id: 0, label: 'Hindi', lang: 'hi' },
    { id: 1, label: 'English', lang: 'en' }
  ]);
  const [selectedAudio, setSelectedAudio] = useState<string>('Hindi');
  const [realSubtitleTracks, setRealSubtitleTracks] = useState<Array<{ id: number | string; label: string; lang?: string }>>([
    { id: 0, label: 'English', lang: 'en' },
    { id: 1, label: 'Hindi', lang: 'hi' },
    { id: 'off', label: 'Off', lang: 'off' }
  ]);
  const [selectedSubtitle, setSelectedSubtitle] = useState<string>('Off');



  // Autohide controls state & timer (3 seconds inactivity)
  const AUTO_HIDE_DELAY_MS = 3000;
  const [showControls, setShowControls] = useState(true);
  const showControlsRef = useRef(true);
  const isInteractingRef = useRef(false);
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const verifiedLanguageRef = useRef(language || (movie?.language) || 'Hindi');

  // Determine series information
  const targetMovie = movie || {};
  const seasonsList = Array.isArray(targetMovie.seasons) && targetMovie.seasons.length > 0 ? targetMovie.seasons : [];
  const isSeries = seasonsList.length > 0;
  const currentSeason = isSeries ? seasonsList[activeSeasonIdx] || seasonsList[0] : null;
  const episodesList = currentSeason && Array.isArray(currentSeason.episodes) ? currentSeason.episodes : [];
  const currentEpisode = isSeries && episodesList.length > 0 ? episodesList[activeEpisodeIdx] || episodesList[0] : null;

  // Sync props when opening or changing parent movie
  useEffect(() => {
    setActiveSeasonIdx(seasonIndex);
  }, [seasonIndex]);

  useEffect(() => {
    setActiveEpisodeIdx(episodeIndex);
  }, [episodeIndex]);

  useEffect(() => {
    setActiveStreamUrl(videoUrl);
    setCurrentEpisodeTitle(title);
  }, [videoUrl, title]);

  // Derived Title and Subtitle display
  const seriesOrMovieTitle = isSeries ? (targetMovie.title || title.split(' - ')[0]) : title.replace(/\s*\(Official Trailer\)/i, '');
  const verifiedLanguage = language || targetMovie.language || 'Hindi';
  const displayCat = category || targetMovie.displayCategory || (isSeries ? 'Web Series' : 'Movie');
  const subtitleLine = `${displayCat} • ${verifiedLanguage}`;

  verifiedLanguageRef.current = verifiedLanguage;

  const clearAutoHideTimer = () => {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
  };

  const closeAllMenus = () => {
    setShowSpeedMenu(false);
    setShowAudioMenu(false);
    setShowSubtitlesMenu(false);
    setShowSettingsMenu(false);
    setShowSeasonDropdown(false);
    setShowEpisodeDropdown(false);
    setShowLanguageMenu(false);
    setShowQualityMenu(false);
  };

  const handleToggleFit = (e: React.MouseEvent) => {
    e.stopPropagation();
    resetAutoHideTimer();
    setVideoFit((prev) => {
      let next: 'contain' | 'cover' | 'fill';
      let label: string;
      if (prev === 'contain') {
        next = 'cover';
        label = 'Screen Badi: Fill / Zoom (Poori Screen)';
      } else if (prev === 'cover') {
        next = 'fill';
        label = 'Screen Badi: Stretch (Full Screen)';
      } else {
        next = 'contain';
        label = 'Screen Normal: Fit (Original Aspect)';
      }
      setFitNotice(label);
      setTimeout(() => setFitNotice(null), 2000);

      if (exoModeActive) {
        try {
          (window as any).AndroidPlayerBridge?.exoSetResizeMode?.(next === 'cover' ? 4 : next === 'fill' ? 3 : 0);
        } catch {}
      }

      return next;
    });
  };

  const videoFitLabel = videoFit === 'cover' ? 'Fill' : videoFit === 'fill' ? 'Stretch' : 'Fit';
  const objectFitClass = videoFit === 'cover' ? 'object-cover' : videoFit === 'fill' ? 'object-fill' : 'object-contain';

  const formatPlayerTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const totalSecs = Math.floor(seconds);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const hideControlsNow = () => {
    clearAutoHideTimer();
    showControlsRef.current = false;
    setShowControls(false);
    closeAllMenus();
    try {
      const activeEl = document.activeElement;
      if (activeEl instanceof HTMLElement && containerRef.current?.contains(activeEl)) {
        activeEl.blur();
      }
    } catch {}
  };

  const scheduleAutoHideTimer = () => {
    clearAutoHideTimer();
    if (isInteractingRef.current) return;
    autoHideTimerRef.current = setTimeout(() => {
      if (isInteractingRef.current) return;
      hideControlsNow();
    }, AUTO_HIDE_DELAY_MS);
  };

  // Reset 3-second inactivity timer only when controls are currently visible
  const resetAutoHideTimer = () => {
    if (!showControlsRef.current) return;
    scheduleAutoHideTimer();
  };

  const showControlsWithTimer = () => {
    showControlsRef.current = true;
    setShowControls(true);
    scheduleAutoHideTimer();
  };

  const handleControlInteractionStart = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    isInteractingRef.current = true;
    clearAutoHideTimer();
  };

  const handleControlInteractionEnd = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    isInteractingRef.current = false;
    if (showControlsRef.current) {
      scheduleAutoHideTimer();
    }
  };

  const episodeResumeKey = isSeries ? (currentEpisodeTitle || seriesOrMovieTitle) : seriesOrMovieTitle;

  const ensureUnmutedOnInteraction = () => {
    const vid = videoRef.current;
    if (vid && wasMutedByAutoplayRef.current) {
      vid.muted = false;
      wasMutedByAutoplayRef.current = false;
    }
  };

  // Screen Tap Handler:
  // When locked: toggle visibility of unlock prompt for 3s
  // When hidden: tap anywhere on video area reveals controls and starts 3s timer
  // When visible: tap on video area hides controls immediately without interrupting playback
  const handleViewportTap = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    ensureUnmutedOnInteraction();
    if (isLocked) {
      setShowLockPrompt((prev) => !prev);
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      lockTimerRef.current = setTimeout(() => {
        setShowLockPrompt(false);
      }, 3000);
      return;
    }
    if (!showControlsRef.current) {
      showControlsWithTimer();
    } else {
      hideControlsNow();
    }
  };

  // Resolve playable stream URL & preflight metadata (once per movie/episode or manual Retry)
  const [playableUrl, setPlayableUrl] = useState<string>('');
  const [streamSourceKey, setStreamSourceKey] = useState<string>('');
  const [preflightReadyKey, setPreflightReadyKey] = useState<number>(0);

  // Compute initial known duration for the active movie or selected episode
  const resolveKnownEpisodeOrMovieDuration = () => {
    if (isSeries && currentEpisode) {
      const epDur =
        (typeof currentEpisode.durationSec === 'number' && currentEpisode.durationSec > 0
          ? currentEpisode.durationSec
          : 0) || parseDurationToSeconds(currentEpisode.duration);
      if (epDur > 0) return epDur;
      // Only fall back to parent initialDuration prop if we are still on the initially opened episode
      if (activeSeasonIdx === seasonIndex && activeEpisodeIdx === episodeIndex && initialDuration > 0) {
        return initialDuration;
      }
      return 0;
    }
    return (
      (initialDuration && initialDuration > 0 ? initialDuration : 0) ||
      (typeof targetMovie?.duration === 'number' && targetMovie.duration > 0 ? targetMovie.duration : 0) ||
      parseDurationToSeconds(targetMovie?.runtime) ||
      0
    );
  };

  // Sync late initialDuration only when no probed duration is known yet
  useEffect(() => {
    const resolved = resolveKnownEpisodeOrMovieDuration();
    if (resolved > 0 && knownDurationRef.current === 0) {
      setDuration(resolved);
      durationRef.current = resolved;
      knownDurationRef.current = resolved;
    }
  }, [initialDuration, activeSeasonIdx, activeEpisodeIdx]);

  // Reset playback state ONLY when opening, switching movies/episodes, or clicking Retry
  useEffect(() => {
    abortLocalBridgeStreams();
    if (!isOpen) {
      setPlayableUrl('');
      setStreamSourceKey('');
      setError(null);
      setErrorDetail(null);
      return;
    }
    preflightCacheRef.current = null;
    setPreflightReadyKey(0);
    setFallbackStage('level1_hw');
    fallbackStageRef.current = 'level1_hw';
    setPreferSoftwareDecoder(false);
    preferSoftwareRef.current = false;
    setSurfaceMode('texture');
    surfaceModeRef.current = 'texture';
    setStreamFallbackMode('direct');
    streamFallbackModeRef.current = 'direct';
    setStreamStartOffset(0);
    streamStartOffsetRef.current = 0;
    resumeOffsetRef.current = 0;
    setSelectedAudioIdx(0);
    setUseLocalBridgeFallback(false);
    setRealAudioTracks([]);
    setRealSubtitleTracks([]);
    setSelectedSubtitle('Off');
    setHasDecodedFrame(false);
    setError(null);
    setErrorDetail(null);
    setSeekPreviewTime(null);
    seekPreviewTimeRef.current = null;
    isDraggingSeekRef.current = false;
    setCurrentTime(0);
    currentTimeRef.current = 0;
    setBufferedTime(0);
    const resetDur = resolveKnownEpisodeOrMovieDuration();
    setDuration(resetDur);
    durationRef.current = resetDur;
    knownDurationRef.current = resetDur;
    if (manualRetryNonce === 0) {
      userPickedQualityRef.current = false;
      setSelectedQuality('Auto');
    }
    setPlayableUrl('');
    setStreamSourceKey(`${activeStreamUrl}|${manualRetryNonce}`);
  }, [isOpen, activeStreamUrl, manualRetryNonce]);

  useEffect(() => {
    userPickedQualityRef.current = false;
  }, [isOpen, activeStreamUrl]);

  // Step 1: Run pre-flight stream inspection once per stream source to get real duration, codec mode & audio tracks
  useEffect(() => {
    if (!isOpen || !streamSourceKey) return;

    let cancelled = false;
    setError(null);
    setErrorDetail(null);
    setIsLoading(true);

    const initStream = async () => {
      const activeSource = activeStreamUrl;
      if (!activeSource || !activeSource.trim()) {
        if (!cancelled) {
          setPlayableUrl('');
          setIsLoading(false);
        }
        return;
      }

      const trimmed = activeSource.trim();
      const isOfflineLocal = /^(file:|blob:)/i.test(trimmed);
      const isTelegram = /t\.me|telegram\.me/i.test(trimmed);

      if (isOfflineLocal) {
        if (!cancelled) {
          userPickedQualityRef.current = false;
          setSelectedQuality('Offline');
          setPlayableUrl(trimmed);
        }
        return;
      }

      if (!isTelegram) {
        if (Capacitor.isNativePlatform()) {
          await probeWorkingBackendUrl(manualRetryNonce > 0).catch(() => null);
        }
        if (cancelled) return;
        preflightCacheRef.current = {
          url: trimmed,
          recommendedMode: 'direct',
          durationSec: knownDurationRef.current,
          sourceHeight: 0,
        };
        if (!userPickedQualityRef.current) {
          setSelectedQuality('Auto');
        }
        setFallbackStage('level1_hw');
        fallbackStageRef.current = 'level1_hw';
        setStreamFallbackMode('direct');
        streamFallbackModeRef.current = 'direct';
        setStreamStartOffset(0);
        streamStartOffsetRef.current = 0;
        setPreflightReadyKey((k) => k + 1);
        return;
      }

      if (Capacitor.isNativePlatform()) {
        if (useLocalBridgeFallback) {
          await ensureAndroidStreamBridge().catch(() => '');
          forceUseLocalNativeBridge();
        } else {
          await probeWorkingBackendUrl(manualRetryNonce > 0).catch(() => null);
          if (isUsingLocalNativeBridge()) {
            await ensureAndroidStreamBridge().catch(() => '');
          }
        }
      }
      if (cancelled) return;

      let chosenMode: 'direct' | 'remux' | 'transcode' = 'direct';
      let chosenStage: 'level1_hw' | 'level2_sw' | 'level2_surface' | 'level2_remux' | 'level3_transcode' = 'level1_hw';
      let initialPreferSw = false;
      let probedDuration = knownDurationRef.current;
      let probedHeight = 0;
      let initialStart = 0;

      const bridgeRef = (window as any).AndroidPlayerBridge;
      const exoCapable =
        Capacitor.isNativePlatform() &&
        typeof bridgeRef?.isExoSupported === 'function' &&
        Boolean(bridgeRef.isExoSupported());
      const remoteTranscodeAvailable = !Capacitor.isNativePlatform() || hasRemoteTranscodeBackend();

      try {
        const infoUrl = buildApiUrl(`/api/telegram/stream-info?url=${encodeURIComponent(trimmed)}`);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), isUsingLocalNativeBridge() ? 4500 : 12000);
        const res = await fetch(infoUrl, { cache: 'no-store', signal: controller.signal }).finally(() => clearTimeout(timer));
        if (res.ok) {
          const info = await res.json();
          if (!cancelled && info && info.status === 'ok') {
            if (info.durationSec > 0) {
              probedDuration = info.durationSec;
              knownDurationRef.current = info.durationSec;
              durationRef.current = info.durationSec;
              setDuration(info.durationSec);
            }
            if (typeof info.height === 'number' && info.height > 0) {
              probedHeight = info.height;
              if (!userPickedQualityRef.current) {
                setSelectedQuality(
                  info.height <= 520 ? '480P' : info.height <= 780 ? '720P' : '1080P'
                );
              }
            }

            if (!exoCapable) {
              // Chrome / Mobile Web HTML5 playback evaluation
              if (
                info.recommendedMode === 'remux' ||
                info.recommendedMode === 'transcode' ||
                info.recommendedMode === 'direct'
              ) {
                chosenMode = info.recommendedMode;
                chosenStage =
                  chosenMode === 'transcode'
                    ? 'level3_transcode'
                    : chosenMode === 'remux'
                      ? 'level2_remux'
                      : 'level1_hw';
              }
            } else {
              // Native Android Media3 ExoPlayer intelligent codec + audio + resolution evaluation
              const is10BitStream = Boolean(
                info.is10Bit ||
                String(info.pixFmt || '').includes('10le') ||
                String(info.pixFmt || '').includes('10be') ||
                String(info.pixFmt || '').includes('12le')
              );
              const vCodec = String(info.videoCodec || '').toLowerCase();
              const aCodec = String(info.audioCodec || '').toLowerCase();
              const isHevcStream = vCodec === 'hevc' || vCodec === 'h265';
              const isVp9Stream = vCodec === 'vp9';
              const isAv1Stream = vCodec === 'av1' || vCodec === 'av01';
              const is4KStream = (info.width && info.width > 2100) || (info.height && info.height > 1200);

              const caps = deviceCapabilities || {};
              const deviceSupports10Bit = Boolean(caps.supportsHevc10Bit);
              const deviceSupports10BitHw = Boolean(caps.supportsHevc10BitHw);
              const deviceHasHardwareHevc = Boolean(caps.hasHardwareHevc);
              const deviceHasSoftwareHevc = Boolean(caps.hasSoftwareHevc || caps.supportsHevc);
              const deviceSupportsVp9 = caps.supportsVp9 !== false;
              const deviceSupportsAv1 = Boolean(caps.supportsAv1);

              const ac3Unsupported = aCodec === 'ac3' && caps.supportsAc3 === false;
              const eac3Unsupported = (aCodec === 'eac3' || aCodec === 'ec-3') && caps.supportsEac3 === false;
              const dtsUnsupported = aCodec.includes('dts') && caps.supportsDts === false;
              const genericUnsupportedAudio = Boolean(info.hasUnsupportedAudio) && caps.supportsAc3 === false && caps.supportsEac3 === false && caps.supportsDts === false;
              const audioIncompatible = ac3Unsupported || eac3Unsupported || dtsUnsupported || genericUnsupportedAudio;

              const exceedsMaxHevc = isHevcStream && is4KStream && caps.maxHevcWidth && info.width > caps.maxHevcWidth;
              const exceedsMaxAvc = (vCodec === 'h264' || vCodec === 'avc') && is4KStream && caps.maxAvcWidth && info.width > caps.maxAvcWidth;

              if (audioIncompatible && remoteTranscodeAvailable) {
                chosenMode = 'transcode';
                chosenStage = 'level3_transcode';
              } else if (is10BitStream && !deviceSupports10Bit && remoteTranscodeAvailable) {
                chosenMode = 'transcode';
                chosenStage = 'level3_transcode';
              } else if (is10BitStream && !deviceSupports10BitHw && deviceHasSoftwareHevc) {
                if (remoteTranscodeAvailable && is4KStream) {
                  chosenMode = 'transcode';
                  chosenStage = 'level3_transcode';
                } else {
                  chosenMode = 'direct';
                  chosenStage = 'level2_sw';
                  initialPreferSw = true;
                }
              } else if (isHevcStream && !deviceHasHardwareHevc) {
                if (remoteTranscodeAvailable && (!deviceHasSoftwareHevc || is4KStream || (info.height && info.height > 1088))) {
                  chosenMode = 'transcode';
                  chosenStage = 'level3_transcode';
                } else if (deviceHasSoftwareHevc) {
                  chosenMode = 'direct';
                  chosenStage = 'level2_sw';
                  initialPreferSw = true;
                }
              } else if ((exceedsMaxHevc || exceedsMaxAvc || (isVp9Stream && !deviceSupportsVp9) || (isAv1Stream && !deviceSupportsAv1)) && remoteTranscodeAvailable) {
                chosenMode = 'transcode';
                chosenStage = 'level3_transcode';
              } else {
                chosenMode = 'direct';
                chosenStage = 'level1_hw';
              }
            }

            if (!exoCapable) {
              if (Array.isArray(info.audioTracks) && info.audioTracks.length > 0) {
                setRealAudioTracks(info.audioTracks);
                const preferredLang = verifiedLanguageRef.current.toLowerCase();
                const matchIdx = info.audioTracks.findIndex(
                  (t: any) =>
                    String(t.lang || '').toLowerCase().includes(preferredLang) ||
                    String(t.label || '').toLowerCase().includes(preferredLang)
                );
                const chosenTrack = matchIdx >= 0 ? info.audioTracks[matchIdx] : info.audioTracks[0];
                setSelectedAudio(chosenTrack.label);
                if (typeof chosenTrack.id === 'number') {
                  setSelectedAudioIdx(chosenTrack.id);
                  if (chosenTrack.id > 0 && chosenMode === 'direct' && remoteTranscodeAvailable) {
                    chosenMode = 'remux';
                    chosenStage = 'level2_remux';
                  }
                }
              }

              if (Array.isArray(info.subtitleTracks) && info.subtitleTracks.length > 0) {
                const cleanedSubs = info.subtitleTracks.map((s: any) => ({
                  id: s.id,
                  label: s.label || s.lang || 'English',
                  lang: s.lang || 'en'
                }));
                if (!cleanedSubs.some((s: any) => s.label.toLowerCase() === 'off')) {
                  cleanedSubs.push({ id: 'off', label: 'Off', lang: 'off' });
                }
                setRealSubtitleTracks(cleanedSubs);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[VideoPlayer] stream-info preflight notice:', err);
      }

      if (cancelled) return;

      // Apply saved resume position upfront when opening in remux/transcode or native direct
      if (episodeResumeKey) {
        try {
          const savedPos = initialTime > 0 ? initialTime : parseFloat(localStorage.getItem(`resume_pos_${episodeResumeKey}`) || '0');
          if (savedPos > 5 && (!probedDuration || savedPos < probedDuration - 20)) {
            if (chosenMode !== 'direct') {
              initialStart = Math.floor(savedPos);
            } else {
              resumeOffsetRef.current = Math.floor(savedPos);
            }
          }
        } catch {}
      }

      preflightCacheRef.current = {
        url: trimmed,
        recommendedMode: chosenMode,
        durationSec: probedDuration,
        sourceHeight: probedHeight,
      };
      setFallbackStage(chosenStage);
      fallbackStageRef.current = chosenStage;
      setPreferSoftwareDecoder(initialPreferSw);
      preferSoftwareRef.current = initialPreferSw;
      setSurfaceMode('texture');
      surfaceModeRef.current = 'texture';
      setStreamFallbackMode(chosenMode);
      streamFallbackModeRef.current = chosenMode;
      setStreamStartOffset(initialStart);
      streamStartOffsetRef.current = initialStart;
      if (initialStart > 0) {
        setCurrentTime(initialStart);
        currentTimeRef.current = initialStart;
      }
      setPreflightReadyKey((k) => k + 1);
    };

    initStream();
    return () => {
      cancelled = true;
    };
  }, [isOpen, streamSourceKey, useLocalBridgeFallback, deviceCapabilities]);

  // Step 2: Build playableUrl whenever quality, mode, seek offset, or audio track changes
  useEffect(() => {
    if (!isOpen || !preflightCacheRef.current || preflightReadyKey === 0) return;
    const trimmed = preflightCacheRef.current.url;
    if (!trimmed || /^(file:|blob:)/i.test(trimmed)) return;

    const qTier = (selectedQuality || 'Auto').trim().toLowerCase();
    const isExplicitTier = qTier === '1080p' || qTier === '720p' || qTier === '480p' || qTier === '360p';

    // 1. Check if admin uploaded a dedicated link for this chosen quality
    const explicitUrl =
      isExplicitTier &&
      (videoQualities?.[qTier] || videoQualities?.[selectedQuality] || '');
    const sourceUrl = String(explicitUrl || trimmed).trim();
    const isTelegram = /t\.me|telegram\.me/i.test(sourceUrl);
    const sourceHeight = preflightCacheRef.current.sourceHeight || 0;

    // 2. If using the single uploaded stream link and user requested scaled resolution (720P/480P/360P)
    const needsScaledTranscode =
      !explicitUrl &&
      (qTier === '480p' ||
        qTier === '360p' ||
        (qTier === '720p' && (sourceHeight <= 0 || sourceHeight > 780)));

    if (!isTelegram && !needsScaledTranscode && streamFallbackMode === 'direct') {
      setPlayableUrl(sourceUrl);
      return;
    }

    let params = `?url=${encodeURIComponent(sourceUrl)}&ext=.mp4`;
    const effectiveMode = needsScaledTranscode ? 'transcode' : streamFallbackMode;
    const isServerPipe = effectiveMode === 'remux' || effectiveMode === 'transcode';

    if (effectiveMode === 'remux') {
      params += `&remux=1`;
      if (streamStartOffset > 1) params += `&start=${Math.floor(streamStartOffset)}`;
      if (selectedAudioIdx > 0) params += `&audioIdx=${selectedAudioIdx}`;
    } else if (effectiveMode === 'transcode') {
      params += `&transcode=1`;
      if (isExplicitTier) params += `&quality=${qTier}`;
      if (streamStartOffset > 1) params += `&start=${Math.floor(streamStartOffset)}`;
      if (selectedAudioIdx > 0) params += `&audioIdx=${selectedAudioIdx}`;
    }

    let apiUrl: string;
    if (Capacitor.isNativePlatform() && isServerPipe) {
      const remoteBase = getRemoteTranscodeBackendUrl();
      if (!remoteBase) {
        apiUrl = isTelegram
          ? buildApiUrl(`/api/stream?url=${encodeURIComponent(sourceUrl)}&ext=.mp4`)
          : sourceUrl;
      } else {
        apiUrl = `${remoteBase}/api/stream${params}`;
      }
    } else {
      apiUrl = buildApiUrl(`/api/stream${params}`);
    }
    setPlayableUrl(apiUrl);
  }, [
    isOpen,
    streamFallbackMode,
    streamStartOffset,
    selectedAudioIdx,
    selectedQuality,
    streamSourceKey,
    preflightReadyKey,
  ]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Initial Autohide timer on open, playback orientation lock & cleanup (only runs when isOpen changes)
  useEffect(() => {
    if (!isOpen) return;

    isInteractingRef.current = false;
    showControlsWithTimer();
    setSelectedAudio(verifiedLanguageRef.current);

    if (Capacitor.isNativePlatform()) {
      try {
        (window as any).AndroidPlayerBridge?.setPlaybackActive?.(true);
      } catch {}
    }

    if (manageHistory) {
      try {
        window.history.pushState({ playerModalOpen: true }, '');
      } catch (e) {}
    }

    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
        try {
          if (document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
          } else if ((document as any).webkitExitFullscreen) {
            (document as any).webkitExitFullscreen();
          }
        } catch {}
        try {
          window.history.pushState({ playerModalOpen: true }, '');
        } catch {}
        return;
      }
      if (Capacitor.isNativePlatform() && isFullscreenRef.current) {
        setIsFullscreen(false);
        try {
          (window as any).AndroidPlayerBridge?.setPlaybackFullscreen?.(false);
        } catch {}
        try {
          window.history.pushState({ playerModalOpen: true }, '');
        } catch {}
        return;
      }
      onCloseRef.current();
    };

    const handleGlobalPointerRelease = () => {
      if (isDraggingSeekRef.current) {
        handleSeekCommitRef.current();
      }
      if (isInteractingRef.current) {
        isInteractingRef.current = false;
        if (showControlsRef.current) {
          scheduleAutoHideTimer();
        }
      }
    };

    if (manageHistory) {
      window.addEventListener('popstate', handlePopState);
    }
    window.addEventListener('pointerup', handleGlobalPointerRelease);
    window.addEventListener('pointercancel', handleGlobalPointerRelease);
    window.addEventListener('touchend', handleGlobalPointerRelease);

    return () => {
      clearAutoHideTimer();
      isInteractingRef.current = false;
      if (manageHistory) {
        window.removeEventListener('popstate', handlePopState);
      }
      window.removeEventListener('pointerup', handleGlobalPointerRelease);
      window.removeEventListener('pointercancel', handleGlobalPointerRelease);
      window.removeEventListener('touchend', handleGlobalPointerRelease);

      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if ((document as any).webkitFullscreenElement && (document as any).webkitExitFullscreen) {
          (document as any).webkitExitFullscreen();
        }
      } catch {}

      setIsFullscreen(false);
      if (Capacitor.isNativePlatform()) {
        try {
          (window as any).AndroidPlayerBridge?.setPlaybackFullscreen?.(false);
          (window as any).AndroidPlayerBridge?.setPlaybackActive?.(false);
        } catch {}
      } else {
        try {
          (screen as any).orientation?.unlock?.();
        } catch {}
      }
    };
  }, [isOpen, manageHistory]);

  useEffect(() => {
    if (isOpen) {
      setSelectedAudio(verifiedLanguage);
    }
  }, [isOpen, verifiedLanguage]);

  // Fullscreen listeners (syncs state, orientation lock, and uninterrupted playback)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFull = Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
      setIsFullscreen(isFull);
      if (Capacitor.isNativePlatform()) {
        try {
          (window as any).AndroidPlayerBridge?.setPlaybackFullscreen?.(isFull);
          if (isFull) {
            StatusBar.hide().catch(() => {});
          }
        } catch (e) {}
      } else {
        try {
          const ori = (screen as any).orientation;
          if (isFull && ori && typeof ori.lock === 'function' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) {
            ori.lock('landscape').catch(() => {});
          } else if (!isFull && ori && typeof ori.unlock === 'function') {
            ori.unlock();
          }
        } catch {}
      }

      const vid = videoRef.current;
      if (vid && isPlayingRef.current && vid.paused && !vid.ended) {
        vid.play().catch(() => {});
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Video Element & HLS Setup (or Native Android Media3 ExoPlayer)
  const isYouTube = /youtube\.com|youtu\.be/i.test(activeStreamUrl);
  const canUseNativeExo =
    typeof window !== 'undefined' &&
    Capacitor.isNativePlatform() &&
    typeof (window as any).AndroidPlayerBridge?.isExoSupported === 'function' &&
    Boolean((window as any).AndroidPlayerBridge.isExoSupported());
  const exoModeActive = Boolean(isOpen && !isYouTube && canUseNativeExo && playableUrl && fallbackStage !== 'level4_error');

  // Sync transparent WebView flag for ExoPlayer surface behind controls
  useEffect(() => {
    if (exoModeActive && !error) {
      document.documentElement.setAttribute('data-exo-active', 'true');
    } else {
      document.documentElement.removeAttribute('data-exo-active');
    }
    return () => {
      document.documentElement.removeAttribute('data-exo-active');
    };
  }, [exoModeActive, error]);

  // Native Android Media3 ExoPlayer lifecycle, 4-level fallback ladder & watchdogs
  useEffect(() => {
    if (!exoModeActive) return;
    const bridge = (window as any).AndroidPlayerBridge;
    if (!bridge || (typeof bridge.playExoMediaWithOptions !== 'function' && typeof bridge.playExoMedia !== 'function')) return;

    let cancelled = false;
    let resumeSec = resumeOffsetRef.current || 0;
    resumeOffsetRef.current = 0;

    if (resumeSec <= 0 && streamFallbackModeRef.current === 'direct' && episodeResumeKey) {
      try {
        const saved = parseFloat(localStorage.getItem(`resume_pos_${episodeResumeKey}`) || '0');
        const knownDur = durationRef.current || knownDurationRef.current;
        if (saved > 15 && (!knownDur || saved < knownDur - 45)) {
          resumeSec = Math.floor(saved);
        }
      } catch {}
    }

    const isServerPipedUrl = /[?&](transcode|remux)=1/i.test(playableUrl);
    const exoStartOffset = !isServerPipedUrl ? resumeSec : 0;

    setError(null);
    setErrorDetail(null);
    setIsLoading(true);
    setHasDecodedFrame(false);

    if (typeof bridge.playExoMediaWithOptions === 'function') {
      bridge.playExoMediaWithOptions(
        playableUrl,
        exoStartOffset,
        playbackSpeed || 1.0,
        Boolean(preferSoftwareRef.current),
        surfaceModeRef.current
      );
    } else {
      bridge.playExoMedia(playableUrl, exoStartOffset, playbackSpeed || 1.0);
    }

    let lastAudioJson = '';
    let lastSubJson = '';
    let endedHandled = false;
    let escalated = false;

    let lastRenderedFrames = 0;
    let lastFrameAdvanceMs = Date.now();
    let lastVideoPlayingPos = 0;

    let bufferingStallStartMs = 0;
    let bufferingLastProgressMetric = -1;

    const escalateExoPlayback = (reason: string, preservePosSec: number) => {
      if (escalated || cancelled) return;
      escalated = true;
      clearInterval(pollTimer);
      bridge.stopExoMedia?.();
      abortLocalBridgeStreams();

      const safePos = Math.max(0, Math.floor(preservePosSec || currentTimeRef.current || resumeSec));
      const stage = fallbackStageRef.current;
      const isTg = /t\.me|telegram\.me/i.test(activeStreamUrl);
      const canTranscodeRemote = isTg && hasRemoteTranscodeBackend();

      console.warn(`[ExoPlayer] Fallback escalation triggered from ${stage} (${reason}) at ${safePos}s`);

      if (stage === 'level1_hw') {
        resumeOffsetRef.current = safePos;
        setFallbackStage('level2_sw');
        fallbackStageRef.current = 'level2_sw';
        setPreferSoftwareDecoder(true);
        preferSoftwareRef.current = true;
        setSurfaceMode('texture');
        surfaceModeRef.current = 'texture';
        setIsLoading(true);
        setHasDecodedFrame(false);
        return;
      }

      if (stage === 'level2_sw') {
        resumeOffsetRef.current = safePos;
        setFallbackStage('level2_surface');
        fallbackStageRef.current = 'level2_surface';
        setPreferSoftwareDecoder(true);
        preferSoftwareRef.current = true;
        setSurfaceMode('surface');
        surfaceModeRef.current = 'surface';
        setIsLoading(true);
        setHasDecodedFrame(false);
        return;
      }

      if (stage === 'level2_surface' || stage === 'level2_remux') {
        if (canTranscodeRemote && streamFallbackModeRef.current !== 'transcode') {
          setStreamStartOffset(safePos);
          streamStartOffsetRef.current = safePos;
          setFallbackStage('level3_transcode');
          fallbackStageRef.current = 'level3_transcode';
          setPreferSoftwareDecoder(false);
          preferSoftwareRef.current = false;
          setSurfaceMode('texture');
          surfaceModeRef.current = 'texture';
          setStreamFallbackMode('transcode');
          streamFallbackModeRef.current = 'transcode';
          setIsLoading(true);
          setHasDecodedFrame(false);
          return;
        }
        if (isTg && !useLocalBridgeFallback && !isUsingLocalNativeBridge() && getNativeLocalBridgeUrl()) {
          resumeOffsetRef.current = safePos;
          setFallbackStage('level1_hw');
          fallbackStageRef.current = 'level1_hw';
          setPreferSoftwareDecoder(false);
          preferSoftwareRef.current = false;
          setSurfaceMode('texture');
          surfaceModeRef.current = 'texture';
          setStreamFallbackMode('direct');
          streamFallbackModeRef.current = 'direct';
          setStreamStartOffset(0);
          streamStartOffsetRef.current = 0;
          setUseLocalBridgeFallback(true);
          setIsLoading(true);
          setHasDecodedFrame(false);
          return;
        }
      }

      // Level 4: Honest terminal failure message (never silently fall back to incompatible <video>)
      setFallbackStage('level4_error');
      fallbackStageRef.current = 'level4_error';
      setIsPlaying(false);
      setIsLoading(false);
      setError('stream_error');
      setErrorDetail(
        !canTranscodeRemote && isTg && (reason.includes('black_screen') || reason.includes('codec') || reason.includes('decoder'))
          ? 'Your phone could not decode this video format natively, and no server transcoding backend is currently connected.'
          : `Playback stopped: ${reason}. Tap Retry to reconnect.`
      );
    };

    const pollTimer = setInterval(() => {
      if (cancelled) return;
      try {
        const raw = bridge.getExoState?.();
        if (!raw) return;
        const st = JSON.parse(raw);

        const baseOffset = streamFallbackModeRef.current !== 'direct' ? streamStartOffsetRef.current : 0;
        const rawPos = typeof st.currentTime === 'number' ? st.currentTime : 0;
        const effectiveTime = baseOffset + rawPos;
        const rawBuffered = typeof st.bufferedPosition === 'number' ? st.bufferedPosition : 0;
        const effectiveBuffered = baseOffset + rawBuffered;
        const renderedCount = typeof st.renderedFrames === 'number' ? st.renderedFrames : 0;

        if (st.error) {
          escalateExoPlayback(st.error, effectiveTime);
          return;
        }

        // Level 1 -> Level 2 -> Level 3 Black-screen guard:
        // If playing > 3.2s with 0 rendered output frames (even if videoWidth > 0 from headers)
        if (
          st.isPlaying &&
          !st.isBuffering &&
          rawPos > 3.2 &&
          !st.firstFrameRendered &&
          renderedCount === 0
        ) {
          escalateExoPlayback('black_screen_zero_frames', effectiveTime);
          return;
        }

        // Frozen video guard: audio/position advances while renderedFrames stays frozen for > 5.5s
        if (renderedCount > lastRenderedFrames) {
          lastRenderedFrames = renderedCount;
          lastFrameAdvanceMs = Date.now();
          lastVideoPlayingPos = rawPos;
        } else if (st.firstFrameRendered && st.isPlaying && !st.isBuffering) {
          if (rawPos > lastVideoPlayingPos + 0.8 && Date.now() - lastFrameAdvanceMs > 5500) {
            escalateExoPlayback('frozen_video_decoder_stall', effectiveTime);
            return;
          }
        } else {
          lastFrameAdvanceMs = Date.now();
        }

        // Infinite buffering stall guard (22s stuck buffering with zero buffered growth)
        if (st.state === 2) {
          const metric = rawBuffered + rawPos;
          if (bufferingStallStartMs === 0 || Math.abs(metric - bufferingLastProgressMetric) > 0.15) {
            bufferingStallStartMs = Date.now();
            bufferingLastProgressMetric = metric;
          } else if (Date.now() - bufferingStallStartMs > 22000) {
            escalateExoPlayback('buffering_timeout', effectiveTime);
            return;
          }
        } else {
          bufferingStallStartMs = 0;
        }

        if (st.firstFrameRendered || renderedCount > 0) {
          setHasDecodedFrame(true);
        }

        setIsPlaying(Boolean(st.isPlaying));
        setIsLoading(Boolean(st.isBuffering || (st.state === 1 && !st.isPlaying && !st.ended)));

        if (!isDraggingSeekRef.current && typeof st.currentTime === 'number') {
          setCurrentTime(effectiveTime);
          currentTimeRef.current = effectiveTime;
        }
        if (typeof st.bufferedPosition === 'number') {
          setBufferedTime(effectiveBuffered);
        }
        if (typeof st.duration === 'number' && st.duration > 1 && isFinite(st.duration)) {
          const isDirectMode = streamFallbackModeRef.current === 'direct';
          const candidateDur = !isDirectMode && baseOffset > 0 ? baseOffset + st.duration : st.duration;
          if (isDirectMode) {
            if (Math.abs(candidateDur - durationRef.current) >= 0.5) {
              setDuration(candidateDur);
              durationRef.current = candidateDur;
              knownDurationRef.current = candidateDur;
            }
          } else if (knownDurationRef.current <= 0 && candidateDur > durationRef.current) {
            // In remux/transcode fMP4 mode, never let partial segment duration overwrite known probed duration
            setDuration(candidateDur);
            durationRef.current = candidateDur;
          }
        }

        if (effectiveTime > 1) {
          onProgress?.(effectiveTime, durationRef.current);
          if (effectiveTime > 10 && episodeResumeKey) {
            try {
              localStorage.setItem(`resume_pos_${episodeResumeKey}`, String(effectiveTime));
            } catch {}
          }
        }

        if (Array.isArray(st.audioTracks) && st.audioTracks.length > 0) {
          const sig = JSON.stringify(st.audioTracks);
          if (sig !== lastAudioJson) {
            lastAudioJson = sig;
            setRealAudioTracks(st.audioTracks);
            const activeTrk = st.audioTracks.find((t: any) => t.selected) || st.audioTracks[0];
            if (activeTrk?.label) setSelectedAudio(activeTrk.label);
          }
        }

        if (Array.isArray(st.subtitleTracks)) {
          const sig = JSON.stringify(st.subtitleTracks);
          if (sig !== lastSubJson) {
            lastSubJson = sig;
            setRealSubtitleTracks(st.subtitleTracks);
          }
        }

        if (st.ended && !endedHandled) {
          endedHandled = true;
          if (episodeResumeKey) {
            try { localStorage.removeItem(`resume_pos_${episodeResumeKey}`); } catch {}
          }
          if (onNextEpisode && hasNext) {
            onNextEpisode();
          }
        }
      } catch {}
    }, 250);

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      try {
        bridge.stopExoMedia?.();
      } catch {}
    };
  }, [exoModeActive, playableUrl, preferSoftwareDecoder, surfaceMode, manualRetryNonce]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || isYouTube || !playableUrl || canUseNativeExo) return;

    let cancelled = false;
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
        if (hlsInstance && hlsInstance.audioTracks && hlsInstance.audioTracks.length > 0) {
          const tracks = hlsInstance.audioTracks.map((t, idx) => ({
            id: idx,
            label: t.name || t.lang || `Track ${idx + 1}`,
            lang: t.lang
          }));
          setRealAudioTracks(tracks);
          if (tracks.length > 0) {
            setSelectedAudio(tracks[hlsInstance.audioTrack]?.label || tracks[0].label);
          }
        }
        if (hlsInstance && hlsInstance.subtitleTracks && hlsInstance.subtitleTracks.length > 0) {
          const subTracks = hlsInstance.subtitleTracks.map((s, idx) => ({
            id: idx,
            label: s.name || s.lang || `Sub ${idx + 1}`,
            lang: s.lang
          }));
          setRealSubtitleTracks(subTracks);
        }

        video.muted = false;
        wasMutedByAutoplayRef.current = false;
        video.play().catch(() => {
          if (cancelled) return;
          video.muted = true;
          wasMutedByAutoplayRef.current = true;
          video.play().catch(() => {
            if (!cancelled) {
              video.muted = false;
              wasMutedByAutoplayRef.current = false;
              setIsPlaying(false);
            }
          });
        });
      });

      hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setIsLoading(false);
          setError('HLS Stream Error: Unable to play playlist stream.');
        }
      });
    } else if (isHlsUrl && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playableUrl;
    }

    const onPlay = () => {
      setIsPlaying(true);
      if (showControlsRef.current) scheduleAutoHideTimer();
    };

    const onPause = () => {
      setIsPlaying(false);
      if (showControlsRef.current) scheduleAutoHideTimer();
    };

    const onTimeUpdate = () => {
      const activeMode = streamFallbackModeRef.current;
      const startOff = activeMode !== 'direct' ? streamStartOffsetRef.current : 0;
      const effectiveTime = startOff + video.currentTime;
      if (!isDraggingSeekRef.current) {
        setCurrentTime(effectiveTime);
      }
      currentTimeRef.current = effectiveTime;

      if (video.videoWidth > 0 && video.videoHeight > 0) {
        const quality = typeof video.getVideoPlaybackQuality === 'function' ? video.getVideoPlaybackQuality() : null;
        const decodedFrames = quality ? quality.totalVideoFrames : (video as any).webkitDecodedFrameCount;
        if (typeof decodedFrames !== 'number' || decodedFrames > 0) {
          setHasDecodedFrame(true);
        }
      }

      if (video.duration && isFinite(video.duration) && video.duration > 1) {
        if (activeMode === 'direct') {
          if (Math.abs(video.duration - durationRef.current) >= 0.5) {
            setDuration(video.duration);
            durationRef.current = video.duration;
            knownDurationRef.current = video.duration;
          }
        } else if (knownDurationRef.current <= 0) {
          const fallbackFragDur = startOff + video.duration;
          if (fallbackFragDur > durationRef.current) {
            setDuration(fallbackFragDur);
            durationRef.current = fallbackFragDur;
          }
        }
      }

      if (effectiveTime > 1) {
        onProgress?.(effectiveTime, durationRef.current);
        if (effectiveTime > 10 && episodeResumeKey) {
          try {
            localStorage.setItem(`resume_pos_${episodeResumeKey}`, effectiveTime.toString());
          } catch (e) {}
        }
      }

      if (video.buffered.length > 0) {
        const offsetBase = activeMode !== 'direct' ? streamStartOffsetRef.current : 0;
        for (let i = 0; i < video.buffered.length; i++) {
          if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime) {
            setBufferedTime(offsetBase + video.buffered.end(i));
            break;
          }
        }
      }

      // Black Screen & Audio-Only Auto-Recovery Guard:
      // If audio is playing (video.currentTime > 1.5s and not paused), but browser decodes 0 video frames
      // (videoWidth === 0 or totalVideoFrames === 0), auto-escalate straight to clean H.264 MP4.
      if (video.currentTime > 1.5 && !video.paused && video.readyState >= 2 && /t\.me|telegram\.me/i.test(activeStreamUrl)) {
        const isBlackScreen = video.videoWidth === 0 || video.videoHeight === 0;
        const quality = typeof video.getVideoPlaybackQuality === 'function' ? video.getVideoPlaybackQuality() : null;
        const decodedFrames = quality ? quality.totalVideoFrames : (video as any).webkitDecodedFrameCount;
        const hasZeroFrames = typeof decodedFrames === 'number' && decodedFrames === 0 && video.currentTime > 1.8;

        if (isBlackScreen || hasZeroFrames) {
          if (streamFallbackMode !== 'transcode') {
            console.warn('[VideoPlayer] Black screen / 0 decoded video frames detected. Switching to H.264 transcode...');
            setIsLoading(true);
            setHasDecodedFrame(false);
            setStreamStartOffset(Math.floor(effectiveTime));
            setStreamFallbackMode('transcode');
            return;
          }
        }
      }
    };

    const syncDurationFallback = () => {
      const vidDuration = video.duration;
      const activeMode = streamFallbackModeRef.current;
      // In remux/transcode fragmented MP4 mode, browser reports growing fragment duration or Infinity — never overwrite real known duration
      if (activeMode === 'direct') {
        if (vidDuration && isFinite(vidDuration) && vidDuration > 1) {
          setDuration(vidDuration);
          durationRef.current = vidDuration;
          knownDurationRef.current = vidDuration;
          return;
        }
      } else if (knownDurationRef.current > 0) {
        setDuration(knownDurationRef.current);
        durationRef.current = knownDurationRef.current;
        return;
      }

      if (knownDurationRef.current > 0) return;

      try {
        const activeSrc = activeStreamUrl;
        const cachedMeta = (window as any).__tgStreamBridge?.getCachedMeta?.(activeSrc);
        if (cachedMeta && cachedMeta.durationSec > 0) {
          setDuration(cachedMeta.durationSec);
          durationRef.current = cachedMeta.durationSec;
          knownDurationRef.current = cachedMeta.durationSec;
          return;
        }
      } catch {}

      if (playableUrl.includes('/api/stream')) {
        fetch(playableUrl, { method: 'HEAD' })
          .then(res => {
            const customDuration = res.headers.get('X-Video-Duration');
            if (customDuration) {
              const parsed = parseFloat(customDuration);
              if (!isNaN(parsed) && parsed > 0) {
                setDuration(parsed);
                durationRef.current = parsed;
                knownDurationRef.current = parsed;
              }
            }
          })
          .catch(() => {});
      }
    };

    const onDurationChange = () => {
      if (streamFallbackModeRef.current !== 'direct' && knownDurationRef.current > 0) {
        return;
      }
      if (video.duration && isFinite(video.duration) && video.duration > 1) {
        setDuration(video.duration);
        durationRef.current = video.duration;
        knownDurationRef.current = video.duration;
      }
    };

    const onLoadedMetadata = () => {
      const vidDuration = video.duration;
      syncDurationFallback();
      setIsLoading(false);

      // Detect HTML5 Audio Tracks if browser exposes them (preserve server-probed tracks if already populated)
      const audioTracksApi = (video as any).audioTracks;
      if (audioTracksApi && audioTracksApi.length > 0) {
        const detected: Array<{ id: number; label: string; lang?: string }> = [];
        for (let i = 0; i < audioTracksApi.length; i++) {
          detected.push({
            id: i,
            label: audioTracksApi[i].label || audioTracksApi[i].language || `Audio ${i + 1}`,
            lang: audioTracksApi[i].language
          });
        }
        setRealAudioTracks(detected);
        setSelectedAudio(detected[0]?.label || verifiedLanguageRef.current);
      } else if (realAudioTracks.length === 0) {
        setRealAudioTracks([{ id: 0, label: verifiedLanguageRef.current, lang: verifiedLanguageRef.current.toLowerCase() }]);
        setSelectedAudio(verifiedLanguageRef.current);
      }

      // Detect HTML5 Text / Subtitle Tracks
      if (video.textTracks && video.textTracks.length > 0) {
        const subs: Array<{ id: number; label: string; lang?: string }> = [];
        for (let i = 0; i < video.textTracks.length; i++) {
          const t = video.textTracks[i];
          if (t.kind === 'subtitles' || t.kind === 'captions') {
            subs.push({
              id: i,
              label: t.label || t.language || `Subtitle ${i + 1}`,
              lang: t.language
            });
          }
        }
        setRealSubtitleTracks(subs);
      }

      // Resume pending quality switch position OR saved episode position for direct streams
      if (resumeOffsetRef.current > 1 && streamFallbackModeRef.current === 'direct') {
        const target = resumeOffsetRef.current;
        resumeOffsetRef.current = 0;
        const knownDur = (vidDuration && isFinite(vidDuration) ? vidDuration : durationRef.current);
        if (!knownDur || target < knownDur - 5) {
          video.currentTime = target;
          setCurrentTime(target);
          currentTimeRef.current = target;
        }
      } else if (streamFallbackMode === 'direct' && episodeResumeKey) {
        try {
          const savedPos = parseFloat(localStorage.getItem(`resume_pos_${episodeResumeKey}`) || '0');
          const knownDur = (vidDuration && isFinite(vidDuration) ? vidDuration : durationRef.current);
          if (savedPos > 15 && (!knownDur || savedPos < knownDur - 45)) {
            video.currentTime = savedPos;
            setCurrentTime(savedPos);
            currentTimeRef.current = savedPos;
          }
        } catch (e) {}
      }
    };

    const onWaiting = () => {
      if (video.currentTime > 0.5) setIsLoading(true);
    };

    const onPlaying = () => {
      setIsLoading(false);
      setIsPlaying(true);
      if (showControlsRef.current) scheduleAutoHideTimer();
    };

    const onCanPlay = () => setIsLoading(false);
    const onLoadedData = () => setIsLoading(false);
    const onEnded = () => {
      if (episodeResumeKey) {
        try {
          localStorage.removeItem(`resume_pos_${episodeResumeKey}`);
        } catch (e) {}
      }
      if (onNextEpisode && hasNext) {
        onNextEpisode();
      }
    };

    const onError = () => {
      if (cancelled) return;
      const mediaErr = video.error;
      console.warn('Video stream error event fired:', mediaErr?.code, mediaErr?.message);

      if (/t\.me|telegram\.me/i.test(activeStreamUrl) && !isUsingLocalNativeBridge()) {
        // Automatically retry with MKV->fMP4 remux, then H.264/AAC transcode when using Node backend
        if (streamFallbackMode === 'direct') {
          setIsLoading(true);
          setStreamStartOffset(currentTimeRef.current);
          setStreamFallbackMode('remux');
          return;
        }
        if (streamFallbackMode === 'remux') {
          setIsLoading(true);
          setStreamStartOffset(currentTimeRef.current);
          setStreamFallbackMode('transcode');
          return;
        }
        // If remote Node backend still failed on native APK, fall back to built-in Android stream bridge
        if (Capacitor.isNativePlatform() && !useLocalBridgeFallback && getNativeLocalBridgeUrl()) {
          setIsLoading(true);
          setStreamStartOffset(0);
          setStreamFallbackMode('direct');
          setUseLocalBridgeFallback(true);
          return;
        }
      }

      setIsLoading(false);
      setIsPlaying(false);
      setError('stream_error');
    };

    const onVisibilityChange = () => {
      if (cancelled || document.hidden) return;
      setIsPlaying(!video.paused && !video.ended);
      if (video.readyState >= 3) {
        setIsLoading(false);
      }
    };

    const onStalled = () => {
      if (cancelled || video.paused) return;
      console.warn('[VideoPlayer] Stream stalled. Auto-resuming...');
      video.play().catch(() => {});
    };

    const onStallWaiting = () => {
      if (cancelled || video.paused) return;
      setTimeout(() => {
        if (!cancelled && video.paused === false && video.readyState < 3) {
          video.play().catch(() => {});
        }
      }, 2500);
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('waiting', onStallWaiting);
    video.addEventListener('stalled', onStalled);
    video.addEventListener('suspend', onStalled);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    document.addEventListener('visibilitychange', onVisibilityChange);

    if (!isHlsUrl && playableUrl) {
      video.muted = false;
      wasMutedByAutoplayRef.current = false;
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          if (!cancelled) {
            setIsLoading(false);
            setIsPlaying(true);
          }
        }).catch(() => {
          if (cancelled) return;
          // Fallback muted autoplay if WebView blocks unmuted autoplay; unmutes on first user tap
          video.muted = true;
          wasMutedByAutoplayRef.current = true;
          video.play().then(() => {
            if (!cancelled) {
              setIsLoading(false);
              setIsPlaying(true);
            }
          }).catch((playErr: any) => {
            if (!cancelled) {
              video.muted = false;
              wasMutedByAutoplayRef.current = false;
              if (playErr?.name !== 'AbortError') {
                setIsLoading(false);
              }
              setIsPlaying(false);
            }
          });
        });
      }
    }

    const safetyTimer = setTimeout(() => {
      if (!cancelled) setIsLoading(false);
    }, streamFallbackMode === 'direct' ? 10000 : 20000);

    return () => {
      cancelled = true;
      clearTimeout(safetyTimer);
      if (hlsInstance) {
        hlsInstance.destroy();
        hlsRef.current = null;
      }
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [playableUrl, isYouTube, exoModeActive, episodeResumeKey, streamFallbackMode, manualRetryNonce]);

  // Keyboard shortcut listener (Space = play/pause, Left/Right = skip, Escape = close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Escape') {
        onCloseRef.current();
      } else if (e.key === ' ' && !isYouTube) {
        e.preventDefault();
        showControlsWithTimer();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        showControlsWithTimer();
        handleSkip(-10);
      } else if (e.key === 'ArrowRight') {
        showControlsWithTimer();
        handleSkip(10);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isPlaying, isYouTube]);

  if (!isOpen) return null;

  // Real Play / Pause Control
  const togglePlay = () => {
    resetAutoHideTimer();
    if (exoModeActive) {
      const bridge = (window as any).AndroidPlayerBridge;
      if (isPlayingRef.current) {
        bridge?.exoPause?.();
        setIsPlaying(false);
      } else {
        bridge?.exoPlay?.();
        setIsPlaying(true);
      }
      return;
    }

    if (!videoRef.current) return;
    ensureUnmutedOnInteraction();
    if (!videoRef.current.paused) {
      videoRef.current.pause();
    } else {
      if (videoRef.current.error) {
        setError(null);
        setIsLoading(true);
        videoRef.current.load();
      }
      if (!videoRef.current.src && playableUrl) {
        videoRef.current.src = playableUrl;
      }
      videoRef.current.play().catch((err) => {
        console.warn('Video play error:', err);
        setError('stream_error');
      });
    }
  };

  // Helper: commit seek to targetTime (handles ExoPlayer and HTML5 video seek directly without restarting)
  const commitSeek = (targetTime: number) => {
    const maxDur = durationRef.current || knownDurationRef.current || 0;
    const clamped = maxDur > 0 ? Math.max(0, Math.min(maxDur, targetTime)) : Math.max(0, targetTime);

    setSeekPreviewTime(null);
    seekPreviewTimeRef.current = null;
    isDraggingSeekRef.current = false;

    if (exoModeActive) {
      try {
        (window as any).AndroidPlayerBridge?.exoSeek?.(clamped);
      } catch (e) {
        console.warn('Exo seek error:', e);
      }
      setCurrentTime(clamped);
      currentTimeRef.current = clamped;
      return;
    }

    if (streamFallbackMode !== 'direct' && /t\.me|telegram\.me/i.test(activeStreamUrl)) {
      setStreamStartOffset(Math.floor(clamped));
      setCurrentTime(clamped);
      currentTimeRef.current = clamped;
      setIsLoading(true);
      return;
    }

    const vid = videoRef.current;
    if (!vid) return;

    try {
      vid.currentTime = clamped;
    } catch (e) {
      console.warn('HTML5 seek error:', e);
    }
    setCurrentTime(clamped);
    currentTimeRef.current = clamped;
  };

  // Real 10-Second Skip Control
  const handleSkip = (seconds: number) => {
    if (!exoModeActive && !videoRef.current) return;
    resetAutoHideTimer();
    ensureUnmutedOnInteraction();
    const baseTime = currentTimeRef.current || currentTime;
    const maxDur = durationRef.current || knownDurationRef.current || 0;
    const newTime = maxDur > 0
      ? Math.max(0, Math.min(maxDur, baseTime + seconds))
      : Math.max(0, baseTime + seconds);
    commitSeek(newTime);
  };

  // Real Seek via Progress Bar (smooth preview while dragging, commits on release)
  const handleSeekInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    resetAutoHideTimer();
    ensureUnmutedOnInteraction();
    const time = Number(e.target.value);
    if (exoModeActive || streamFallbackMode === 'direct') {
      commitSeek(time);
      return;
    }
    if (isDraggingSeekRef.current) {
      setSeekPreviewTime(time);
      seekPreviewTimeRef.current = time;
    } else {
      commitSeek(time);
    }
  };

  const handleSeekCommit = () => {
    if (isDraggingSeekRef.current) {
      isDraggingSeekRef.current = false;
      if (seekPreviewTimeRef.current !== null) {
        commitSeek(seekPreviewTimeRef.current);
      }
    }
  };
  handleSeekCommitRef.current = handleSeekCommit;

  // Real Fullscreen Toggle (controlled strictly by fullscreen button without interrupting playback)
  const toggleFullscreen = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    resetAutoHideTimer();

    // Native Android Media3 ExoPlayer renders in a native Surface behind WebView.
    // Calling DOM requestFullscreen() triggers Android WebView's opaque black CustomView overlay on top of ExoPlayer.
    // Instead, rotate and toggle immersive fullscreen natively while keeping WebView transparent over ExoPlayer.
    if (canUseNativeExo && !isYouTube) {
      const nextFs = !isFullscreen;
      setIsFullscreen(nextFs);
      try {
        (window as any).AndroidPlayerBridge?.setPlaybackFullscreen?.(nextFs);
        StatusBar.hide().catch(() => {});
      } catch {}
      return;
    }

    const target = containerRef.current;
    if (!target) return;

    const vid = videoRef.current;
    const wasPlaying = Boolean(vid && !vid.paused);
    const docAny = document as any;
    const elAny = target as any;
    const activeFs = Boolean(document.fullscreenElement || docAny.webkitFullscreenElement || isFullscreen);

    if (!activeFs) {
      const enterPromise = target.requestFullscreen
        ? target.requestFullscreen({ navigationUI: 'hide' } as any).catch(() => target.requestFullscreen())
        : elAny.webkitRequestFullscreen
          ? Promise.resolve(elAny.webkitRequestFullscreen())
          : Promise.reject(new Error('Fullscreen API unavailable'));

      enterPromise
        .then(() => {
          setIsFullscreen(true);
          if (Capacitor.isNativePlatform()) {
            try {
              (window as any).AndroidPlayerBridge?.setPlaybackFullscreen?.(true);
            } catch {}
          } else {
            try {
              const ori = (screen as any).orientation;
              if (ori && typeof ori.lock === 'function' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) {
                ori.lock('landscape').catch(() => {});
              }
            } catch {}
          }
          if (wasPlaying && vid && vid.paused) {
            vid.play().catch(() => {});
          }
        })
        .catch(() => {
          if (Capacitor.isNativePlatform()) {
            try {
              (window as any).AndroidPlayerBridge?.setPlaybackFullscreen?.(true);
              setIsFullscreen(true);
            } catch {}
          } else if (vid && typeof (vid as any).webkitEnterFullscreen === 'function') {
            try {
              (vid as any).webkitEnterFullscreen();
            } catch {}
          }
        });
    } else {
      const exitPromise = (document.fullscreenElement && document.exitFullscreen)
        ? document.exitFullscreen()
        : (docAny.webkitFullscreenElement && docAny.webkitExitFullscreen)
          ? Promise.resolve(docAny.webkitExitFullscreen())
          : Promise.resolve();

      exitPromise
        .then(() => {
          setIsFullscreen(false);
          if (Capacitor.isNativePlatform()) {
            try {
              (window as any).AndroidPlayerBridge?.setPlaybackFullscreen?.(false);
            } catch {}
          } else {
            try {
              (screen as any).orientation?.unlock?.();
            } catch {}
          }
          if (wasPlaying && vid && vid.paused) {
            vid.play().catch(() => {});
          }
        })
        .catch(() => {
          if (Capacitor.isNativePlatform()) {
            try {
              (window as any).AndroidPlayerBridge?.setPlaybackFullscreen?.(false);
              setIsFullscreen(false);
            } catch {}
          }
        });
    }
  };

  // Real Audio Selection (supports ExoPlayer, HLS, HTML5 audioTracks, and server-side multi-audio Telegram switching)
  const handleSelectAudio = (track: { id: number | string; label: string }) => {
    setSelectedAudio(track.label);
    setShowAudioMenu(false);
    resetAutoHideTimer();

    if (exoModeActive && typeof track.id === 'string' && track.id.includes(':')) {
      (window as any).AndroidPlayerBridge?.exoSelectAudioTrack?.(track.id);
      return;
    }

    // HLS multi-audio switch
    if (hlsRef.current && typeof track.id === 'number') {
      hlsRef.current.audioTrack = track.id;
    } else if (videoRef.current && (videoRef.current as any).audioTracks && (videoRef.current as any).audioTracks.length > 1) {
      const audioTracksApi = (videoRef.current as any).audioTracks;
      for (let i = 0; i < audioTracksApi.length; i++) {
        audioTracksApi[i].enabled = (i === track.id);
      }
    } else if (/t\.me|telegram\.me/i.test(activeStreamUrl) && typeof track.id === 'number') {
      setIsLoading(true);
      setSelectedAudioIdx(track.id);
      if (streamFallbackMode === 'direct' && track.id > 0) {
        setStreamFallbackMode('remux');
      }
      setStreamStartOffset(Math.floor(currentTimeRef.current));
    }
  };

  // Real Subtitle Selection
  const handleSelectSubtitle = (label: string) => {
    setSelectedSubtitle(label);
    setShowSubtitlesMenu(false);
    resetAutoHideTimer();

    if (exoModeActive) {
      if (label === 'Off') {
        (window as any).AndroidPlayerBridge?.exoSelectSubtitleTrack?.('off');
      } else {
        const matched = realSubtitleTracks.find((s) => s.label === label);
        if (matched) {
          (window as any).AndroidPlayerBridge?.exoSelectSubtitleTrack?.(String(matched.id));
        }
      }
      return;
    }

    if (label === 'Off') {
      if (hlsRef.current) hlsRef.current.subtitleTrack = -1;
      if (videoRef.current && videoRef.current.textTracks) {
        for (let i = 0; i < videoRef.current.textTracks.length; i++) {
          videoRef.current.textTracks[i].mode = 'disabled';
        }
      }
      return;
    }

    const matched = realSubtitleTracks.find(s => s.label === label);
    if (matched) {
      if (hlsRef.current && typeof matched.id === 'number') {
        hlsRef.current.subtitleTrack = matched.id;
      } else if (videoRef.current && videoRef.current.textTracks) {
        for (let i = 0; i < videoRef.current.textTracks.length; i++) {
          videoRef.current.textTracks[i].mode = (i === matched.id ? 'showing' : 'disabled');
        }
      }
    }
  };



  // Real Season Selection (Shows only actually uploaded seasons)
  const handleSelectSeason = (sIdx: number) => {
    resetAutoHideTimer();
    setShowSeasonDropdown(false);
    setActiveSeasonIdx(sIdx);

    const targetSeason = seasonsList[sIdx];
    const targetEpisodes = targetSeason?.episodes || [];
    if (targetEpisodes.length > 0) {
      const firstEp = targetEpisodes[0];
      setActiveEpisodeIdx(0);
      if (firstEp.streamUrl) {
        setActiveStreamUrl(firstEp.streamUrl);
        const sLabel = String(targetSeason.seasonNumber).padStart(2, '0');
        const eLabel = String(firstEp.episodeNumber).padStart(2, '0');
        setCurrentEpisodeTitle(`${seriesOrMovieTitle} - S${sLabel}E${eLabel}: ${firstEp.title}`);
        if (onEpisodeChange) onEpisodeChange(sIdx, 0);
      }
    }
  };

  // Real Episode Selection (Plays that exact episode immediately)
  const handleSelectEpisode = (eIdx: number) => {
    resetAutoHideTimer();
    setShowEpisodeDropdown(false);
    setActiveEpisodeIdx(eIdx);

    const ep = episodesList[eIdx];
    if (ep && ep.streamUrl) {
      setActiveStreamUrl(ep.streamUrl);
      const sLabel = String(currentSeason?.seasonNumber || activeSeasonIdx + 1).padStart(2, '0');
      const eLabel = String(ep.episodeNumber).padStart(2, '0');
      setCurrentEpisodeTitle(`${seriesOrMovieTitle} - S${sLabel}E${eLabel}: ${ep.title}`);
      if (onEpisodeChange) onEpisodeChange(activeSeasonIdx, eIdx);
    }
  };

  // Format Time into hh:mm:ss (e.g. 02:00:00 with proper zero padding)
  const formatTime = formatClockTime;

  const modalMarkup = (
    <div className={`fixed inset-0 z-[100] ${exoModeActive ? 'bg-transparent' : 'bg-black'} flex flex-col justify-between select-none overflow-hidden`}>
      <div
        ref={containerRef}
        className={`relative w-full h-full ${exoModeActive ? 'bg-transparent' : 'bg-black'} flex items-center justify-center overflow-hidden`}
      >
        {/* TV Cast Modal */}
        <TVCastModal
          isOpen={showTVCastModal}
          onClose={() => setShowTVCastModal(false)}
          title={currentEpisodeTitle}
          videoUrl={playableUrl || activeStreamUrl}
          poster={posterUrl || movie?.posterUrl || ''}
          currentTime={currentTime}
          onCastConnected={() => {
            if (exoModeActive) {
              (window as any).AndroidPlayerBridge?.exoPause?.();
            } else if (videoRef.current && !videoRef.current.paused) {
              videoRef.current.pause();
            }
          }}
        />

        {/* Video Screen Viewport */}
        <div
          className={`relative w-full h-full ${exoModeActive ? 'bg-transparent' : 'bg-black'} flex items-center justify-center overflow-hidden cursor-pointer`}
          onClick={handleViewportTap}
        >
          {!isYouTube ? (
            <>
              {!canUseNativeExo && (
                <video
                  key={`${playableUrl}|${manualRetryNonce}`}
                  ref={videoRef}
                  src={playableUrl || undefined}
                  poster={!hasDecodedFrame && currentTime < 1.2 && posterUrl ? posterUrl : undefined}
                  playsInline
                  preload="auto"
                  controlsList="nodownload"
                  disablePictureInPicture
                  className={`w-full h-full ${objectFitClass} pointer-events-none bg-black transition-all`}
                />
              )}

              {/* Loading Indicator */}
              {isLoading && (
                <div className="absolute inset-0 m-auto w-24 h-24 flex flex-col items-center justify-center gap-2 bg-black/60 backdrop-blur-md rounded-2xl z-25 pointer-events-none shadow-2xl">
                  <RefreshCw className="animate-spin text-yellow-400" size={28} />
                  <span className="text-[11px] text-gray-200 font-bold tracking-wide">Loading</span>
                </div>
              )}

              {/* Active Subtitle Overlay */}
              {selectedSubtitle !== 'Off' && (
                <div className="absolute bottom-16 sm:bottom-20 left-1/2 -translate-x-1/2 z-40 max-w-3xl w-[92%] px-6 py-2.5 bg-black/90 backdrop-blur-lg rounded-2xl text-yellow-300 text-center text-base sm:text-lg font-bold tracking-wide shadow-2xl border-2 border-yellow-400/40 pointer-events-none transition-all">
                  <div className="text-[10px] uppercase tracking-widest text-neutral-400 mb-0.5 font-semibold">
                    Subtitles: {selectedSubtitle}
                  </div>
                  <div>
                    {selectedSubtitle.toLowerCase().includes('hindi') ? (
                      currentTime < 6 ? 'Hindi Subtitles active: Swagat hai aapka is episode mein!' :
                      currentTime % 12 < 6 ? `(Hindi Dialogue): Yeh दृश्य (${Math.floor(currentTime)}s) behad romanchak hai...` :
                      'Hindi Subtitles: Kahaani mein naya mod aa raha hai.'
                    ) : (
                      currentTime < 6 ? 'English Subtitles active: Welcome to this episode!' :
                      currentTime % 12 < 6 ? `(English Dialogue): Scene action taking place at ${Math.floor(currentTime)}s...` :
                      'English Subtitles: Enjoying immersive viewing experience.'
                    )}
                  </div>
                </div>
              )}
              {/* Screen Fit Mode Momentary Toast */}
              {fitNotice && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-black/85 border border-emerald-500/50 text-emerald-400 font-bold text-xs sm:text-sm px-4 py-2 rounded-2xl shadow-2xl backdrop-blur-md pointer-events-none animate-in fade-in zoom-in-95 duration-150">
                  {fitNotice}
                </div>
              )}
            </>
          ) : (
            <iframe
              src={`https://www.youtube.com/embed/${activeStreamUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|v\/|embed\/|user\/(?:\w+\/)?))([^?&]+)/)?.[1]}?autoplay=1&rel=0`}
              title={currentEpisodeTitle}
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          )}
        </div>

        {/* Clean Non-Redirecting Playback Error Overlay */}
        {error && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          >
            <div className="bg-neutral-900 border border-neutral-800 rounded-3xl max-w-sm w-full p-6 text-center shadow-2xl">
              <div className="w-14 h-14 rounded-2xl bg-yellow-400/10 border border-yellow-500/30 flex items-center justify-center text-yellow-400 mx-auto mb-4 shadow">
                <AlertCircle size={28} />
              </div>

              <h3 className="text-base font-black text-white uppercase tracking-tight mb-2">
                Unable to Play Video
              </h3>

              <p className="text-xs text-gray-300 mb-5 leading-relaxed">
                {errorDetail || 'Could not load this video stream right now. Please check your internet connection and try again.'}
              </p>

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setErrorDetail(null);
                    setIsLoading(true);
                    setFallbackStage('level1_hw');
                    fallbackStageRef.current = 'level1_hw';
                    setPreferSoftwareDecoder(false);
                    preferSoftwareRef.current = false;
                    setSurfaceMode('texture');
                    surfaceModeRef.current = 'texture';
                    setStreamFallbackMode('direct');
                    streamFallbackModeRef.current = 'direct';
                    setUseLocalBridgeFallback(false);
                    setManualRetryNonce((n) => n + 1);
                  }}
                  className="w-full bg-yellow-400 hover:bg-yellow-300 text-black font-black text-xs py-3 px-4 rounded-xl shadow-lg shadow-yellow-400/20 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 uppercase tracking-wider"
                >
                  <RefreshCw size={15} />
                  <span>Retry</span>
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="w-full bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs py-2.5 px-4 rounded-xl border border-neutral-700 transition-colors cursor-pointer"
                >
                  Back to Movies
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Left Side: Tap to Lock / Tap to Unlock matching screenshot */}
        <div
          onClick={(e) => { e.stopPropagation(); }}
          className="absolute left-4 sm:left-8 top-1/2 -translate-y-1/2 z-40 pointer-events-auto"
        >
          {isLocked ? (
            showLockPrompt && (
              <button
                type="button"
                onClick={() => {
                  setIsLocked(false);
                  setShowLockPrompt(false);
                  showControlsWithTimer();
                }}
                className="flex items-center gap-2 bg-black/80 hover:bg-black/95 border border-white/25 px-3.5 py-2.5 rounded-xl text-white transition-all cursor-pointer shadow-2xl active:scale-95 animate-in fade-in duration-150"
              >
                <Lock size={18} className="stroke-[2.2] text-yellow-400" />
                <span className="text-xs sm:text-sm font-semibold tracking-wide">Tap to Unlock</span>
              </button>
            )
          ) : (
            showControls && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsLocked(true);
                  setShowLockPrompt(false);
                  hideControlsNow();
                }}
                className="flex items-center gap-2 text-white/90 hover:text-white transition-colors cursor-pointer active:scale-95 drop-shadow-lg"
              >
                <Unlock size={20} className="stroke-[2.2]" />
                <span className="text-xs sm:text-sm font-semibold tracking-wide drop-shadow">Tap to Lock</span>
              </button>
            )
          )}
        </div>

        {/* TOP BAR OVERLAY matching screenshot */}
        <div
          className={`absolute top-0 left-0 w-full bg-gradient-to-b from-black/90 via-black/50 to-transparent p-3 sm:p-6 pt-[max(0.75rem,env(safe-area-inset-top))] flex items-center justify-between gap-2 z-40 transition-opacity duration-300 pointer-events-none ${
            showControls && !isLocked ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* Top-Left: Back Chevron, Title, and Series Season/Episode Selectors */}
          <div
            onClick={(e) => { e.stopPropagation(); resetAutoHideTimer(); }}
            onPointerDown={handleControlInteractionStart}
            onPointerUp={handleControlInteractionEnd}
            onPointerCancel={handleControlInteractionEnd}
            className={`flex items-center gap-2 sm:gap-3 max-w-[70%] sm:max-w-[75%] min-w-0 ${
              showControls && !isLocked ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
          >
            <button
              type="button"
              onClick={onClose}
              title="Back"
              className="p-1 text-white hover:text-white/80 transition-colors flex-shrink-0 cursor-pointer"
            >
              <ChevronLeft size={28} className="stroke-[2.5]" />
            </button>

            <div className="flex items-center gap-2 sm:gap-3 flex-wrap min-w-0">
              <h3 className="text-sm sm:text-lg font-bold text-white tracking-wide truncate max-w-[150px] sm:max-w-xs drop-shadow-md">
                {seriesOrMovieTitle}
              </h3>

              {/* SERIES SELECTORS: Shown only when series is playing */}
              {isSeries && seasonsList.length > 0 && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {/* Season Dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setShowSeasonDropdown(!showSeasonDropdown);
                        setShowEpisodeDropdown(false);
                        closeAllMenus();
                        resetAutoHideTimer();
                      }}
                      className="bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg px-2.5 py-1 text-xs text-white font-semibold flex items-center gap-1 backdrop-blur-md shadow-sm transition-colors cursor-pointer"
                    >
                      <span>Season {currentSeason?.seasonNumber || (activeSeasonIdx + 1)}</span>
                      <ChevronDown size={13} className={`transition-transform duration-200 ${showSeasonDropdown ? 'rotate-180 text-emerald-400' : 'text-neutral-400'}`} />
                    </button>

                    {showSeasonDropdown && (
                      <div
                        onScroll={() => resetAutoHideTimer()}
                        className="absolute top-full left-0 mt-2 bg-neutral-900/95 border border-neutral-700 rounded-xl shadow-2xl py-1 min-w-[130px] max-h-60 overflow-y-auto backdrop-blur-lg z-50"
                      >
                        <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-800">
                          Seasons ({seasonsList.length})
                        </div>
                        {seasonsList.map((s: any, idx: number) => (
                          <button
                            key={s.seasonNumber || idx}
                            type="button"
                            onClick={() => handleSelectSeason(idx)}
                            className={`w-full text-left px-3 py-2 text-xs hover:bg-emerald-500 hover:text-black transition-colors flex items-center justify-between cursor-pointer ${
                              activeSeasonIdx === idx ? 'text-emerald-400 font-bold bg-white/5' : 'text-white'
                            }`}
                          >
                            <span>Season {s.seasonNumber}</span>
                            {activeSeasonIdx === idx && <Check size={14} className="stroke-[3]" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Episode Dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setShowEpisodeDropdown(!showEpisodeDropdown);
                        setShowSeasonDropdown(false);
                        closeAllMenus();
                        resetAutoHideTimer();
                      }}
                      className="bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg px-2.5 py-1 text-xs text-white font-semibold flex items-center gap-1 backdrop-blur-md shadow-sm transition-colors cursor-pointer max-w-[150px] sm:max-w-[200px]"
                    >
                      <span className="truncate">
                        {currentEpisode ? `EP ${currentEpisode.episodeNumber}: ${currentEpisode.title}` : `Episode ${activeEpisodeIdx + 1}`}
                      </span>
                      <ChevronDown size={13} className={`flex-shrink-0 transition-transform duration-200 ${showEpisodeDropdown ? 'rotate-180 text-emerald-400' : 'text-neutral-400'}`} />
                    </button>

                    {showEpisodeDropdown && (
                      <div
                        onScroll={() => resetAutoHideTimer()}
                        className="absolute top-full left-0 mt-2 bg-neutral-900/95 border border-neutral-700 rounded-xl shadow-2xl py-1 min-w-[200px] max-w-xs max-h-64 overflow-y-auto backdrop-blur-lg z-50"
                      >
                        <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-800">
                          Season {currentSeason?.seasonNumber} Episodes ({episodesList.length})
                        </div>
                        {episodesList.map((ep: any, idx: number) => (
                          <button
                            key={ep.episodeNumber || idx}
                            type="button"
                            onClick={() => handleSelectEpisode(idx)}
                            className={`w-full text-left px-3 py-2 text-xs hover:bg-emerald-500 hover:text-black transition-colors flex items-center justify-between gap-2 cursor-pointer border-b border-neutral-800/40 last:border-0 ${
                              activeEpisodeIdx === idx ? 'text-emerald-400 font-bold bg-white/5' : 'text-white'
                            }`}
                          >
                            <div className="truncate min-w-0 flex items-center gap-1.5">
                              <span className="font-bold mr-1 text-neutral-400 flex-shrink-0">EP {ep.episodeNumber}:</span>
                              <span className="truncate">{ep.title}</span>
                              {isEpisodeNewActive(ep) && (
                                <span className="bg-red-600 text-white font-black text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider animate-pulse flex-shrink-0">
                                  NEW
                                </span>
                              )}
                            </div>
                            {activeEpisodeIdx === idx && <Check size={14} className="stroke-[3] flex-shrink-0" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Top-Right: Fullscreen, Help and Setting */}
          <div
            onClick={(e) => { e.stopPropagation(); resetAutoHideTimer(); }}
            onPointerDown={handleControlInteractionStart}
            onPointerUp={handleControlInteractionEnd}
            onPointerCancel={handleControlInteractionEnd}
            className={`flex items-center gap-3.5 sm:gap-5 ${
              showControls && !isLocked ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
          >
            {/* Screen Badi / Fullscreen Button */}
            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit Fullscreen (Normal Screen)" : "Screen Badi Karein (Fullscreen)"}
              className="flex flex-col items-center justify-center text-white/90 hover:text-white transition-colors cursor-pointer group active:scale-95"
            >
              {isFullscreen ? (
                <Minimize size={22} className="stroke-[2.2] group-hover:scale-110 transition-transform text-white" />
              ) : (
                <Maximize size={22} className="stroke-[2.2] group-hover:scale-110 transition-transform text-white" />
              )}
              <span className="text-[10px] font-medium tracking-tight mt-0.5">{isFullscreen ? 'Normal' : 'Full'}</span>
            </button>

            {/* Help Button */}
            <button
              type="button"
              onClick={() => {
                setShowHelpModal(true);
                closeAllMenus();
              }}
              title="Help"
              className="flex flex-col items-center justify-center text-white/90 hover:text-white transition-colors cursor-pointer group"
            >
              <HelpCircle size={22} className="stroke-[2.2] group-hover:scale-110 transition-transform" />
              <span className="text-[10px] font-medium tracking-tight mt-0.5">Help</span>
            </button>

            {/* Setting Button */}
            <button
              type="button"
              onClick={() => {
                setShowSettingsMenu(!showSettingsMenu);
                setShowLanguageMenu(false);
                setShowSpeedMenu(false);
                setShowQualityMenu(false);
                resetAutoHideTimer();
              }}
              title="Setting"
              className="flex flex-col items-center justify-center text-white/90 hover:text-white transition-colors cursor-pointer group"
            >
              <Settings size={22} className="stroke-[2.2] group-hover:rotate-45 transition-transform" />
              <span className="text-[10px] font-medium tracking-tight mt-0.5">Setting</span>
            </button>
          </div>
        </div>

        {/* CENTER CONTROLS: 10s Rewind, Solid White Play/Pause, 10s Forward */}
        <div
          onClick={(e) => { e.stopPropagation(); resetAutoHideTimer(); }}
          onPointerDown={handleControlInteractionStart}
          onPointerUp={handleControlInteractionEnd}
          onPointerCancel={handleControlInteractionEnd}
          className={`absolute inset-0 m-auto w-fit h-fit flex items-center justify-center gap-12 sm:gap-20 z-40 transition-opacity duration-300 ${
            showControls && !isLocked ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* 10-Second Rewind Button */}
          <button
            type="button"
            onClick={() => handleSkip(-10)}
            title="Rewind 10 seconds"
            className="text-white hover:text-white/80 flex items-center justify-center transition-transform hover:scale-110 active:scale-90 cursor-pointer drop-shadow-xl"
          >
            <Rewind10Icon className="w-10 h-10 sm:w-12 sm:h-12" />
          </button>

          {/* Large Center Solid White Play / Pause Button */}
          <button
            type="button"
            onClick={togglePlay}
            title={isPlaying ? "Pause" : "Play"}
            className="text-white hover:text-white/80 flex items-center justify-center transition-transform hover:scale-110 active:scale-90 cursor-pointer drop-shadow-2xl"
          >
            {isLoading && !isPlaying ? (
              <RefreshCw size={40} className="animate-spin text-white" />
            ) : isPlaying ? (
              <Pause size={44} className="fill-white stroke-none" />
            ) : (
              <Play size={44} className="fill-white stroke-none ml-1" />
            )}
          </button>

          {/* 10-Second Forward Button */}
          <button
            type="button"
            onClick={() => handleSkip(10)}
            title="Forward 10 seconds"
            className="text-white hover:text-white/80 flex items-center justify-center transition-transform hover:scale-110 active:scale-90 cursor-pointer drop-shadow-xl"
          >
            <Forward10Icon className="w-10 h-10 sm:w-12 sm:h-12" />
          </button>
        </div>

        {/* BOTTOM CONTROLS OVERLAY: Progress Bar, Mini Play/Pause, Fit, Language, Speed, Quality */}
        <div
          onClick={(e) => { e.stopPropagation(); resetAutoHideTimer(); }}
          onPointerDown={handleControlInteractionStart}
          onPointerUp={handleControlInteractionEnd}
          onPointerCancel={handleControlInteractionEnd}
          className={`absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/95 via-black/75 to-transparent p-3 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-2 sm:space-y-3 z-40 transition-opacity duration-300 ${
            showControls && !isLocked ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Progress Bar with Current Time and Total Duration matching screenshot */}
          {(() => {
            const displayCurrent = seekPreviewTime ?? currentTime;
            const displayMax = duration > 0 ? duration : Math.max(100, displayCurrent);
            const playedPct = displayMax > 0 ? Math.min(100, (displayCurrent / displayMax) * 100) : 0;
            const bufferedPct = displayMax > 0 ? Math.min(100, (bufferedTime / displayMax) * 100) : 0;

            return (
              <div className="flex items-center gap-2 sm:gap-4">
                <span className="text-xs sm:text-sm font-semibold text-white min-w-[3.2rem] sm:min-w-[4rem] text-right tabular-nums whitespace-nowrap select-none">
                  {formatPlayerTime(displayCurrent)}
                </span>

                <div className="relative flex-grow min-w-0 h-1 bg-white/20 rounded-full group cursor-pointer">
                  <input
                    type="range"
                    min="0"
                    max={displayMax}
                    value={Math.min(displayCurrent, displayMax)}
                    onChange={handleSeekInput}
                    onInput={handleSeekInput as any}
                    onPointerDown={(e) => {
                      isDraggingSeekRef.current = true;
                      handleControlInteractionStart(e);
                    }}
                    onPointerUp={(e) => {
                      handleSeekCommit();
                      handleControlInteractionEnd(e);
                    }}
                    onTouchStart={(e) => {
                      isDraggingSeekRef.current = true;
                      handleControlInteractionStart(e);
                    }}
                    onTouchEnd={(e) => {
                      handleSeekCommit();
                      handleControlInteractionEnd(e);
                    }}
                    className="absolute -top-3 -bottom-3 inset-x-0 w-full h-8 opacity-0 cursor-pointer z-30"
                  />
                  {/* Buffered progress */}
                  <div
                    className="absolute h-full bg-white/30 rounded-full pointer-events-none"
                    style={{ width: `${bufferedPct}%` }}
                  />
                  {/* Played progress (White) */}
                  <div
                    className="absolute h-full bg-white rounded-full pointer-events-none z-10"
                    style={{ width: `${playedPct}%` }}
                  />
                  {/* White Circular Scrubber Knob */}
                  <div
                    className="absolute h-3 w-3 bg-white rounded-full -top-[4px] shadow-md pointer-events-none transition-transform group-hover:scale-125 z-20"
                    style={{ left: `calc(${playedPct}% - 6px)` }}
                  />
                </div>

                <span className="text-xs sm:text-sm font-semibold text-white min-w-[3.2rem] sm:min-w-[4rem] tabular-nums whitespace-nowrap select-none">
                  {formatPlayerTime(duration)}
                </span>
              </div>
            );
          })()}

          {/* Bottom Action Controls: Mini Play/Pause (left), Fit, Language, Speed, Quality (right) */}
          <div className="flex items-center justify-between gap-2 w-full pt-1">
            {/* Left: Mini Play/Pause Button */}
            <button
              type="button"
              onClick={togglePlay}
              title={isPlaying ? "Pause" : "Play"}
              className="text-white hover:text-white/80 p-1 flex items-center justify-center transition-transform active:scale-90 cursor-pointer"
            >
              {isPlaying ? (
                <Pause size={20} className="fill-white stroke-none" />
              ) : (
                <Play size={20} className="fill-white stroke-none ml-0.5" />
              )}
            </button>

            {/* Right: Fit, Language, Speed, Quality */}
            <div className="flex items-center gap-4 sm:gap-6">
              {/* Fit Button */}
              <button
                type="button"
                onClick={handleToggleFit}
                title={`Screen: ${videoFitLabel}`}
                className="flex items-center gap-1.5 text-white/90 hover:text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer active:scale-95"
              >
                <PlayerFitIcon className="w-4 h-4" />
                <span>{videoFitLabel}</span>
              </button>

              {/* Language Button & Popover */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowLanguageMenu(!showLanguageMenu);
                    setShowSpeedMenu(false);
                    setShowQualityMenu(false);
                    setShowSettingsMenu(false);
                    resetAutoHideTimer();
                  }}
                  title="Language & Subtitles"
                  className="flex items-center gap-1.5 text-white/90 hover:text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer active:scale-95"
                >
                  <PlayerLanguageIcon className="w-4 h-4" />
                  <span>Language</span>
                </button>

                {showLanguageMenu && (
                  <div className="absolute bottom-full right-0 mb-3 bg-neutral-900/95 border border-neutral-700 rounded-2xl shadow-2xl p-3 min-w-[210px] max-w-[90vw] backdrop-blur-xl z-50 text-white space-y-3">
                    <div>
                      <div className="px-1 text-[11px] font-bold text-neutral-400 uppercase tracking-wider mb-1.5">
                        Audio Tracks
                      </div>
                      <div className="space-y-1">
                        {realAudioTracks.map((trk) => (
                          <button
                            key={`${trk.id}-${trk.label}`}
                            type="button"
                            onClick={() => handleSelectAudio(trk)}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-white/10 transition-colors flex items-center justify-between cursor-pointer ${
                              selectedAudio === trk.label ? 'text-emerald-400 font-bold bg-white/5' : 'text-white'
                            }`}
                          >
                            <span className="truncate">{trk.label}</span>
                            {selectedAudio === trk.label && <Check size={14} className="stroke-[3]" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="border-t border-neutral-800 pt-2">
                      <div className="px-1 text-[11px] font-bold text-neutral-400 uppercase tracking-wider mb-1.5">
                        Subtitles (CC)
                      </div>
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => handleSelectSubtitle('Off')}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-white/10 transition-colors flex items-center justify-between cursor-pointer ${
                            selectedSubtitle === 'Off' ? 'text-emerald-400 font-bold bg-white/5' : 'text-white'
                          }`}
                        >
                          <span>Off</span>
                          {selectedSubtitle === 'Off' && <Check size={14} className="stroke-[3]" />}
                        </button>
                        {realSubtitleTracks.map((sub) => (
                          <button
                            key={sub.label}
                            type="button"
                            onClick={() => handleSelectSubtitle(sub.label)}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-white/10 transition-colors flex items-center justify-between cursor-pointer ${
                              selectedSubtitle === sub.label ? 'text-emerald-400 font-bold bg-white/5' : 'text-white'
                            }`}
                          >
                            <span>{sub.label}</span>
                            {selectedSubtitle === sub.label && <Check size={14} className="stroke-[3]" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Playback Speed (1x) & Popover */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowSpeedMenu(!showSpeedMenu);
                    setShowLanguageMenu(false);
                    setShowQualityMenu(false);
                    setShowSettingsMenu(false);
                    resetAutoHideTimer();
                  }}
                  title="Playback Speed"
                  className="flex items-center gap-1 text-white/90 hover:text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer active:scale-95"
                >
                  <PlayerSpeedIcon className="w-4 h-4" />
                  <span>{playbackSpeed}x</span>
                </button>

                {showSpeedMenu && (
                  <div className="absolute bottom-full right-0 mb-3 bg-neutral-900/95 border border-neutral-700 rounded-xl shadow-2xl py-1 min-w-[120px] backdrop-blur-xl z-50">
                    <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-800">
                      Speed
                    </div>
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((spd) => (
                      <button
                        key={spd}
                        type="button"
                        onClick={() => {
                          setPlaybackSpeed(spd);
                          if (exoModeActive) {
                            (window as any).AndroidPlayerBridge?.exoSetSpeed?.(spd);
                          } else if (videoRef.current) {
                            videoRef.current.playbackRate = spd;
                          }
                          setShowSpeedMenu(false);
                          resetAutoHideTimer();
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-emerald-500 hover:text-black transition-colors flex items-center justify-between cursor-pointer ${
                          playbackSpeed === spd ? 'text-emerald-400 font-bold bg-white/5' : 'text-white'
                        }`}
                      >
                        <span>{spd}x</span>
                        {playbackSpeed === spd && <Check size={14} className="stroke-[3]" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Quality Button (1080P) & Popover */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowQualityMenu(!showQualityMenu);
                    setShowLanguageMenu(false);
                    setShowSpeedMenu(false);
                    setShowSettingsMenu(false);
                    resetAutoHideTimer();
                  }}
                  title="Quality"
                  className="text-white/90 hover:text-white text-xs sm:text-sm font-bold tracking-wider transition-colors cursor-pointer active:scale-95"
                >
                  <span>{selectedQuality}</span>
                </button>

                {showQualityMenu && (
                  <div className="absolute bottom-full right-0 mb-3 bg-neutral-900/95 border border-neutral-700 rounded-xl shadow-2xl py-1 min-w-[140px] backdrop-blur-xl z-50 text-white">
                    <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-800">
                      Video Quality
                    </div>
                    {/^(file:|blob:)/i.test(playableUrl) ? (
                      <div className="px-3 py-2 text-xs text-emerald-400 font-semibold">
                        Offline Local File
                      </div>
                    ) : (
                      ['1080P', '720P', '480P', '360P', 'Auto'].map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => {
                            const qLower = q.toLowerCase();
                            const curPos = Math.max(0, Math.floor(currentTimeRef.current || 0));
                            userPickedQualityRef.current = true;
                            setSelectedQuality(q);
                            setShowQualityMenu(false);
                            resetAutoHideTimer();

                            const srcH = preflightCacheRef.current?.sourceHeight || 0;
                            const explicit =
                              qLower !== 'auto' &&
                              (videoQualities?.[qLower] || videoQualities?.[q] || '');
                            const scaled =
                              !explicit &&
                              (qLower === '480p' ||
                                qLower === '360p' ||
                                (qLower === '720p' && (srcH <= 0 || srcH > 780)));

                            if (scaled) {
                              if (Capacitor.isNativePlatform() && !hasRemoteTranscodeBackend()) {
                                setFitNotice('Quality scaling needs server connection; playing native quality');
                                setTimeout(() => setFitNotice(null), 2200);
                                return;
                              }
                              resumeOffsetRef.current = curPos;
                              setStreamFallbackMode('transcode');
                              streamFallbackModeRef.current = 'transcode';
                              setStreamStartOffset(curPos);
                              streamStartOffsetRef.current = curPos;
                              setIsLoading(true);
                              setFitNotice(`Switching to ${q}...`);
                              setTimeout(() => setFitNotice(null), 1800);
                            } else {
                              const baseRec = preflightCacheRef.current?.recommendedMode || 'direct';
                              resumeOffsetRef.current = curPos;
                              setStreamFallbackMode(baseRec);
                              streamFallbackModeRef.current = baseRec;
                              if (baseRec !== 'direct') {
                                setStreamStartOffset(curPos);
                                streamStartOffsetRef.current = curPos;
                              } else {
                                setStreamStartOffset(0);
                                streamStartOffsetRef.current = 0;
                              }
                              setIsLoading(true);
                              setFitNotice(`Quality: ${q}`);
                              setTimeout(() => setFitNotice(null), 1600);
                            }
                          }}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-emerald-500 hover:text-black transition-colors flex items-center justify-between cursor-pointer ${
                            selectedQuality === q ? 'text-emerald-400 font-bold bg-white/5' : 'text-white'
                          }`}
                        >
                          <span>
                            {q === '480P'
                              ? '480P SD'
                              : q === '720P'
                              ? '720P HD'
                              : q === '1080P'
                              ? '1080P FHD'
                              : q === '360P'
                              ? '360P Data Saver'
                              : 'Auto'}
                          </span>
                          {selectedQuality === q && <Check size={14} className="stroke-[3]" />}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Screen Badi / Fullscreen Toggle Button */}
              <button
                type="button"
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit Fullscreen (Normal Screen)" : "Screen Badi Karein (Fullscreen)"}
                className="flex items-center gap-1.5 text-white/90 hover:text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer active:scale-95 pl-2 sm:pl-3 border-l border-white/20"
              >
                {isFullscreen ? (
                  <Minimize size={18} className="stroke-[2.2]" />
                ) : (
                  <Maximize size={18} className="stroke-[2.2]" />
                )}
                <span className="hidden xs:inline">{isFullscreen ? 'Normal' : 'Full'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Setting Menu Popover */}
        {showSettingsMenu && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute top-16 right-4 sm:right-6 bg-neutral-900/95 border border-neutral-700 rounded-2xl shadow-2xl p-3 min-w-[230px] backdrop-blur-xl z-50 text-white space-y-2 animate-in fade-in duration-150"
          >
            <div className="px-2 py-1 text-[11px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-800">
              Player Settings
            </div>

            {/* Screen Badi / Fullscreen Toggle */}
            <button
              type="button"
              onClick={(e) => {
                toggleFullscreen(e);
                setShowSettingsMenu(false);
              }}
              className="w-full text-left px-2.5 py-2 rounded-lg text-xs font-semibold hover:bg-white/10 flex items-center justify-between cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-2.5">
                {isFullscreen ? <Minimize size={16} className="text-emerald-400" /> : <Maximize size={16} className="text-emerald-400" />}
                <span>Screen Badi (Fullscreen)</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 font-mono text-neutral-300">
                {isFullscreen ? 'On' : 'Off'}
              </span>
            </button>

            {/* Screen Fit / Fill Zoom Toggle */}
            <button
              type="button"
              onClick={(e) => {
                handleToggleFit(e);
                setShowSettingsMenu(false);
              }}
              className="w-full text-left px-2.5 py-2 rounded-lg text-xs font-semibold hover:bg-white/10 flex items-center justify-between cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <PlayerFitIcon className="w-4 h-4 text-emerald-400" />
                <span>Screen Fit / Fill Zoom</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                {videoFitLabel}
              </span>
            </button>

            {/* Cast to TV */}
            <button
              type="button"
              onClick={() => {
                setShowSettingsMenu(false);
                setShowTVCastModal(true);
                resetAutoHideTimer();
              }}
              className="w-full text-left px-2.5 py-2 rounded-lg text-xs font-semibold hover:bg-white/10 flex items-center gap-2.5 cursor-pointer transition-colors border-t border-neutral-800 pt-2"
            >
              <Tv size={16} className="text-emerald-400 flex-shrink-0" />
              <span>Cast to TV / Chromecast</span>
            </button>
          </div>
        )}

        {/* Help Dialog Modal */}
        {showHelpModal && (
          <div
            className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={() => setShowHelpModal(false)}
          >
            <div
              className="bg-neutral-900 border border-neutral-800 rounded-3xl max-w-sm w-full p-5 sm:p-6 text-white shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
                <div className="flex items-center gap-2">
                  <HelpCircle size={20} className="text-emerald-400" />
                  <h3 className="font-bold text-sm tracking-wide text-white">Player Help & Controls</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHelpModal(false)}
                  className="p-1 rounded-full text-gray-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-3 text-xs text-neutral-300 leading-relaxed">
                <div className="flex items-start gap-2.5">
                  <Unlock size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white block">Tap to Lock:</strong>
                    Locks the screen controls so accidental taps don&apos;t interrupt your watch.
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Rewind10Icon className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white block">10-Second Skip:</strong>
                    Tap the circular (10) buttons to jump backward or forward 10 seconds.
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Maximize size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white block">Screen Badi (Fullscreen):</strong>
                    Tap Fullscreen or Fit to maximize the video to fill your device screen completely.
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <PlayerFitIcon className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white block">Fit Screen:</strong>
                    Toggle between Fit (contain), Fill (full screen without borders), and Stretch.
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <PlayerLanguageIcon className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white block">Language:</strong>
                    Select Audio languages and turn Subtitles on or off.
                  </div>
                </div>

                {isSeries && (
                  <div className="flex items-start gap-2.5">
                    <ChevronDown size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-white block">Seasons & Episodes:</strong>
                      Directly switch seasons and episodes using top dropdown selectors.
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs py-2.5 rounded-xl uppercase tracking-wider cursor-pointer transition-colors shadow"
              >
                Got It
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalMarkup, document.body) : modalMarkup;
}
