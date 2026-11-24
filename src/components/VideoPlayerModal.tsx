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
  VolumeX,
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
  Sun,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';
import {
  abortLocalBridgeStreams,
  buildApiUrl,
  ensureAndroidStreamBridge,
  forceUseLocalNativeBridge,
  getApiBaseUrl,
  getNativeLocalBridgeUrl,
  getRemoteTranscodeBackendUrl,
  hasRemoteTranscodeBackend,
  isUsingLocalNativeBridge,
  probeWorkingBackendUrl,
} from '../utils/apiConfig';
import { fetchStreamInfo, formatClockTime, getCachedStreamInfo, parseDurationToSeconds } from '../utils/duration';
import { isEpisodeNewActive, getEpisodeDisplayLabel } from '../services/movieStorage';
import { normalizePlayerTrackList } from '../utils/videoQuality';
import { resolveEpisodePlaybackDurationSec, resolveStreamBuildPlan } from '../utils/playerHelpers';
import { useAuth } from '../context/AuthContext';
import { recordMovieViewStart } from '../services/movieViewsService';

interface ParsedSubtitleCue {
  start: number;
  end: number;
  text: string;
}

function parseVttTimestamp(raw: string): number {
  const cleaned = raw.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    return (Number(parts[0]) || 0) * 3600 + (Number(parts[1]) || 0) * 60 + (parseFloat(parts[2]) || 0);
  }
  if (parts.length === 2) {
    return (Number(parts[0]) || 0) * 60 + (parseFloat(parts[1]) || 0);
  }
  return parseFloat(cleaned) || 0;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

function parseWebVttCues(vttText: string): ParsedSubtitleCue[] {
  if (!vttText) return [];
  const blocks = vttText.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const cues: ParsedSubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const [startRaw, endRawWithMeta] = lines[timeIdx].split('-->');
    if (!startRaw || !endRawWithMeta) continue;
    const endRaw = endRawWithMeta.trim().split(/\s+/)[0];
    const start = parseVttTimestamp(startRaw);
    const end = parseVttTimestamp(endRaw);
    const rawBody = lines
      .slice(timeIdx + 1)
      .join('\n')
      .replace(/\\N|\\n/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]*\}/g, '');
    const text = decodeHtmlEntities(rawBody).trim();
    if (text && end > start) {
      cues.push({ start, end, text });
    }
  }
  return cues;
}

function isAppleMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1)
  );
}


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
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const recordedViewMovieIdRef = useRef<string | null>(null);

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
  const [forceNativeIosHls, setForceNativeIosHls] = useState(false);
  const [manualRetryNonce, setManualRetryNonce] = useState(0);
  const [exoReconnectNonce, setExoReconnectNonce] = useState(0);
  const [html5ReconnectNonce, setHtml5ReconnectNonce] = useState(0);
  const [hasDecodedFrame, setHasDecodedFrame] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [isAutoplayMuted, setIsAutoplayMuted] = useState(() => !Capacitor.isNativePlatform() && isAppleMobileBrowser());
  const [seekPreviewTime, setSeekPreviewTime] = useState<number | null>(null);
  const isDraggingSeekRef = useRef(false);
  const seekPreviewTimeRef = useRef<number | null>(null);
  const handleSeekCommitRef = useRef<() => void>(() => {});
  const wasMutedByAutoplayRef = useRef(!Capacitor.isNativePlatform() && isAppleMobileBrowser());
  const autoplayBlockedRef = useRef(false);
  const durationRef = useRef(initialDuration || 0);
  const knownDurationRef = useRef(initialDuration || 0);
  const hasAuthoritativeDurationRef = useRef(false);
  const currentTimeRef = useRef(0);
  const resumeOffsetRef = useRef(0);
  const qualityResumeTargetRef = useRef<number | null>(null);
  const isInitialOpenStreamRef = useRef(true);
  const hasExplicitInitialTimeRef = useRef(false);
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
  const exoNetworkRecoveryAttemptsRef = useRef<number>(0);
  const html5NetworkRecoveryAttemptsRef = useRef<number>(0);
  const lastManualQualityPickAtRef = useRef<number>(0);
  const [brightnessLevel, setBrightnessLevel] = useState<number>(1);
  const brightnessRef = useRef<number>(1);
  const [volumeLevel, setVolumeLevel] = useState<number>(1);
  const volumeRef = useRef<number>(1);
  const [gestureHud, setGestureHud] = useState<{ type: 'brightness' | 'volume'; percent: number } | null>(null);
  const gestureHudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeStateRef = useRef<{
    lockedMode: 'pending' | 'brightness' | 'volume';
    side: 'left' | 'right';
    startX: number;
    startY: number;
    initialVal: number;
    height: number;
    pointerId: number;
  } | null>(null);
  const swipeConsumedClickRef = useRef<boolean>(false);

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
  const selectedQualityRef = useRef<string>('Auto');
  selectedQualityRef.current = selectedQuality;
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [fitNotice, setFitNotice] = useState<string | null>(null);
  const [qualityNotice, setQualityNotice] = useState<string | null>(null);
  const qualityNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showQualityToast = (msg: string) => {
    if (qualityNoticeTimerRef.current) clearTimeout(qualityNoticeTimerRef.current);
    setQualityNotice(msg);
    qualityNoticeTimerRef.current = setTimeout(() => {
      setQualityNotice(null);
    }, 2800);
  };

  const triggerAutoSlow360pSwitch = (posSec: number) => {
    const curQ = (selectedQualityRef.current || 'Auto').trim().toUpperCase();
    if (curQ === '360P' || curQ === 'OFFLINE') return;
    const curUrl = String(preflightCacheRef.current?.url || activeStreamUrl || '').trim();
    if (!curUrl || /^(file:|blob:)/i.test(curUrl)) return;
    if (Capacitor.isNativePlatform() && !hasRemoteTranscodeBackend()) return;
    if (Date.now() - lastManualQualityPickAtRef.current < 12000) return;

    const safePos = Math.max(
      0,
      Number.isFinite(posSec) && posSec > 0 ? posSec : (currentTimeRef.current || 0),
      qualityResumeTargetRef.current || 0
    );
    console.warn(`[VideoPlayer] Slow network detected at ${safePos.toFixed(1)}s — switching to 360P`);
    qualityResumeTargetRef.current = safePos > 0.5 ? safePos : null;
    resumeOffsetRef.current = safePos;
    selectedQualityRef.current = '360P';
    setSelectedQuality('360P');
    setFallbackStage('level3_transcode');
    fallbackStageRef.current = 'level3_transcode';
    setStreamFallbackMode('transcode');
    streamFallbackModeRef.current = 'transcode';
    const offsetFloor = Math.floor(safePos);
    setStreamStartOffset(offsetFloor);
    streamStartOffsetRef.current = offsetFloor;
    setIsLoading(true);
  };

  // Real detected audio and subtitle tracks
  const [realAudioTracks, setRealAudioTracks] = useState<Array<{ id: number | string; label: string; lang?: string }>>([
    { id: 0, label: language || (movie?.language) || 'Original Audio', lang: '' },
  ]);
  const [selectedAudio, setSelectedAudio] = useState<string>(language || (movie?.language) || 'Original Audio');
  const [realSubtitleTracks, setRealSubtitleTracks] = useState<Array<{ id: number | string; label: string; lang?: string; streamIndex?: number; codec?: string; forced?: boolean }>>([]);
  const [selectedSubtitle, setSelectedSubtitle] = useState<string>('Off');
  const selectedSubtitleRef = useRef<string>('Off');
  selectedSubtitleRef.current = selectedSubtitle;
  const [activeSubtitleCue, setActiveSubtitleCue] = useState<string>('');
  const [isSubtitleLoading, setIsSubtitleLoading] = useState<boolean>(false);
  const [subtitleNotice, setSubtitleNotice] = useState<string | null>(null);
  const webSubtitleCuesRef = useRef<ParsedSubtitleCue[]>([]);
  const serverProbedSubTracksRef = useRef<Array<{ id: number | string; label: string; lang?: string; streamIndex?: number; codec?: string; forced?: boolean }>>([]);
  const loadedSubChunksRef = useRef<Set<number>>(new Set());
  const inflightSubChunksRef = useRef<Set<number>>(new Set());
  const activeServerSubTrackRef = useRef<{ srcUrl: string; trackIdx: number; label: string; lang?: string } | null>(null);
  const subtitleNoticeTimerRef = useRef<any>(null);



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

  const closeOtherMenus = () => {
    setShowSpeedMenu(false);
    setShowAudioMenu(false);
    setShowSubtitlesMenu(false);
    setShowSettingsMenu(false);
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
    if (vid && (wasMutedByAutoplayRef.current || vid.muted)) {
      vid.muted = false;
      wasMutedByAutoplayRef.current = false;
      setIsAutoplayMuted(false);
    }
  };

  const viewportLastTapRef = useRef<{ time: number; side: 'left' | 'right' | null }>({ time: 0, side: null });
  const viewportSeekBurstRef = useRef<{ time: number; side: 'left' | 'right' | null; total: number }>({ time: 0, side: null, total: 0 });
  const viewportSingleTapTimerRef = useRef<any>(null);
  const [seekFeedback, setSeekFeedback] = useState<{ side: 'left' | 'right'; label: string } | null>(null);
  const seekFeedbackTimerRef = useRef<any>(null);

  const triggerDoubleTapSeek = (direction: 'forward' | 'rewind', burstTotal?: number) => {
    ensureUnmutedOnInteraction();
    if (direction === 'forward') {
      handleSkip(10);
      const absLabel = Math.abs(burstTotal ?? 10);
      setSeekFeedback({ side: 'right', label: `+${absLabel}s` });
    } else {
      handleSkip(-10);
      const absLabel = Math.abs(burstTotal ?? 10);
      setSeekFeedback({ side: 'left', label: `-${absLabel}s` });
    }
    if (seekFeedbackTimerRef.current) clearTimeout(seekFeedbackTimerRef.current);
    seekFeedbackTimerRef.current = setTimeout(() => setSeekFeedback(null), 700);
  };

  // Screen Tap Handler:
  // When double tapped/clicked on right: +10s forward (supports rapid +20s, +30s bursts)
  // When double tapped/clicked on left: -10s rewind (supports rapid -20s, -30s bursts)
  // When single tapped: toggle controls visibility (delayed past double-tap window so Tap 1 never spawns overlays before Tap 2)
  const hideGestureHudSoon = () => {
    if (gestureHudTimerRef.current) clearTimeout(gestureHudTimerRef.current);
    gestureHudTimerRef.current = setTimeout(() => {
      setGestureHud(null);
    }, 750);
  };

  const handleGestureStart = (clientX: number, clientY: number, height: number, id = 1) => {
    if (isLocked || error || isYouTube) return;
    const side: 'left' | 'right' = clientX < window.innerWidth / 2 ? 'left' : 'right';
    const bridge = (window as any).AndroidPlayerBridge;

    let initVal = side === 'left' ? brightnessRef.current : volumeRef.current;
    if (Capacitor.isNativePlatform()) {
      try {
        if (side === 'left' && typeof bridge?.getPlayerBrightness === 'function') {
          const b = Number(bridge.getPlayerBrightness());
          if (Number.isFinite(b) && b >= 0) {
            initVal = Math.max(0.01, Math.min(1, b));
            brightnessRef.current = initVal;
            setBrightnessLevel(initVal);
          }
        } else if (side === 'right' && typeof bridge?.getPlayerVolume === 'function') {
          const v = Number(bridge.getPlayerVolume());
          if (Number.isFinite(v) && v >= 0) {
            initVal = Math.max(0, Math.min(1, v));
            volumeRef.current = initVal;
            setVolumeLevel(initVal);
          }
        }
      } catch {}
    } else if (side === 'right' && videoRef.current) {
      initVal = videoRef.current.muted ? 0 : Math.max(0, Math.min(1, videoRef.current.volume ?? 1));
      volumeRef.current = initVal;
    }

    swipeConsumedClickRef.current = false;
    swipeStateRef.current = {
      lockedMode: 'pending',
      side,
      startX: clientX,
      startY: clientY,
      initialVal: initVal,
      height: height || window.innerHeight,
      pointerId: id,
    };
  };

  const handleGestureMove = (clientX: number, clientY: number, id = 1) => {
    const st = swipeStateRef.current;
    if (!st || st.pointerId !== id || isLocked || error || isYouTube) return;

    const dx = clientX - st.startX;
    const dy = st.startY - clientY; // positive = swipe UP (bottom -> top)

    if (st.lockedMode === 'pending') {
      if (Math.abs(dy) < 10 || Math.abs(dy) <= Math.abs(dx) * 1.1) {
        return;
      }
      st.lockedMode = st.side === 'left' ? 'brightness' : 'volume';
      swipeConsumedClickRef.current = true;
      if (viewportSingleTapTimerRef.current) {
        clearTimeout(viewportSingleTapTimerRef.current);
        viewportSingleTapTimerRef.current = null;
      }
      if (gestureHudTimerRef.current) {
        clearTimeout(gestureHudTimerRef.current);
        gestureHudTimerRef.current = null;
      }
    }

    const sensitivityPx = Math.max(140, st.height * 0.5);
    const rawNext = st.initialVal + dy / sensitivityPx;
    const clamped = Math.max(0, Math.min(1, rawNext));
    const pct = Math.round(clamped * 100);
    const bridge = (window as any).AndroidPlayerBridge;

    if (st.lockedMode === 'brightness') {
      const safeB = Math.max(0.01, clamped);
      brightnessRef.current = safeB;
      setBrightnessLevel(safeB);
      if (Capacitor.isNativePlatform()) {
        try {
          bridge?.setPlayerBrightness?.(safeB);
        } catch {}
      }
      setGestureHud({ type: 'brightness', percent: pct });
    } else if (st.lockedMode === 'volume') {
      volumeRef.current = clamped;
      setVolumeLevel(clamped);
      if (Capacitor.isNativePlatform()) {
        try {
          bridge?.setPlayerVolume?.(clamped);
        } catch {}
      } else if (videoRef.current) {
        try {
          videoRef.current.volume = clamped;
          if (clamped <= 0.01) {
            videoRef.current.muted = true;
          } else if (videoRef.current.muted) {
            videoRef.current.muted = false;
            wasMutedByAutoplayRef.current = false;
            setIsAutoplayMuted(false);
          }
        } catch {}
      }
      setGestureHud({ type: 'volume', percent: pct });
    }
  };

  const handleGestureEnd = (id = 1) => {
    const st = swipeStateRef.current;
    if (!st || st.pointerId !== id) return;
    const wasSwipe = st.lockedMode !== 'pending';
    swipeStateRef.current = null;
    if (wasSwipe) {
      hideGestureHudSoon();
    }
  };

  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    try {
      (e.currentTarget as any).setPointerCapture?.(e.pointerId);
    } catch {}
    handleGestureStart(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect().height, e.pointerId);
  };

  const handleViewportPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    handleGestureMove(e.clientX, e.clientY, e.pointerId);
  };

  const handleViewportPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      (e.currentTarget as any).releasePointerCapture?.(e.pointerId);
    } catch {}
    handleGestureEnd(e.pointerId);
  };

  const handleViewportTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      handleGestureStart(t.clientX, t.clientY, e.currentTarget.getBoundingClientRect().height, 9999);
    }
  };

  const handleViewportTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      handleGestureMove(t.clientX, t.clientY, 9999);
      if (swipeStateRef.current?.lockedMode !== 'pending') {
        if (e.cancelable) e.preventDefault();
      }
    }
  };

  const handleViewportTouchEnd = () => {
    handleGestureEnd(9999);
  };

  const handleViewportTap = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (swipeConsumedClickRef.current) {
      swipeConsumedClickRef.current = false;
      return;
    }
    ensureUnmutedOnInteraction();
    if (isLocked) {
      setShowLockPrompt((prev) => !prev);
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      lockTimerRef.current = setTimeout(() => {
        setShowLockPrompt(false);
      }, 3000);
      return;
    }

    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const tapSide: 'left' | 'right' = (e.clientX - rect.left) > rect.width / 2 ? 'right' : 'left';
    const delta = tapSide === 'right' ? 10 : -10;

    // Rapid consecutive burst taps after a double-tap (triple/quadruple tap)
    if (now - viewportSeekBurstRef.current.time < 550 && viewportSeekBurstRef.current.side === tapSide) {
      if (viewportSingleTapTimerRef.current) clearTimeout(viewportSingleTapTimerRef.current);
      const nextTotal = viewportSeekBurstRef.current.total + delta;
      viewportSeekBurstRef.current = { time: now, side: tapSide, total: nextTotal };
      viewportLastTapRef.current = { time: 0, side: null };
      triggerDoubleTapSeek(tapSide === 'right' ? 'forward' : 'rewind', nextTotal);
      return;
    }

    // Double-click / double-tap within 340ms -> seek +/-10s
    if (now - viewportLastTapRef.current.time < 340 && viewportLastTapRef.current.side === tapSide) {
      if (viewportSingleTapTimerRef.current) clearTimeout(viewportSingleTapTimerRef.current);
      viewportLastTapRef.current = { time: 0, side: null };
      viewportSeekBurstRef.current = { time: now, side: tapSide, total: delta };
      triggerDoubleTapSeek(tapSide === 'right' ? 'forward' : 'rewind', delta);
      return;
    }

    viewportLastTapRef.current = { time: now, side: tapSide };
    if (viewportSingleTapTimerRef.current) clearTimeout(viewportSingleTapTimerRef.current);
    viewportSingleTapTimerRef.current = setTimeout(() => {
      if (!showControlsRef.current) {
        showControlsWithTimer();
      } else {
        hideControlsNow();
      }
    }, 355);
  };

  // Resolve playable stream URL & preflight metadata (once per movie/episode or manual Retry)
  const [playableUrl, setPlayableUrl] = useState<string>('');
  const [streamSourceKey, setStreamSourceKey] = useState<string>('');
  const [preflightReadyKey, setPreflightReadyKey] = useState<number>(0);

  // Compute initial known duration for the active movie or selected episode
  const resolveKnownEpisodeOrMovieDuration = () => {
    if (isSeries && currentEpisode) {
      return resolveEpisodePlaybackDurationSec(
        currentEpisode,
        0,
        activeSeasonIdx === seasonIndex && activeEpisodeIdx === episodeIndex,
        initialDuration
      );
    }
    return (
      (initialDuration && initialDuration > 0 ? initialDuration : 0) ||
      (typeof targetMovie?.duration === 'number' && targetMovie.duration > 0 ? targetMovie.duration : 0) ||
      parseDurationToSeconds(targetMovie?.runtime) ||
      0
    );
  };

  // Sync late initialDuration only when no authoritative duration is known yet
  useEffect(() => {
    if (hasAuthoritativeDurationRef.current) return;
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
    exoNetworkRecoveryAttemptsRef.current = 0;
    html5NetworkRecoveryAttemptsRef.current = 0;
    setSelectedAudioIdx(0);
    setUseLocalBridgeFallback(false);
    setForceNativeIosHls(false);
    setRealAudioTracks([]);
    setRealSubtitleTracks([]);
    serverProbedSubTracksRef.current = [];
    activeServerSubTrackRef.current = null;
    loadedSubChunksRef.current.clear();
    inflightSubChunksRef.current.clear();
    setIsSubtitleLoading(false);
    setSubtitleNotice(null);
    setSelectedSubtitle('Off');
    setHasDecodedFrame(false);
    const activeMovieId = String(movie?.id || movie?.imdbId || '').trim();
    if (!activeMovieId || recordedViewMovieIdRef.current !== activeMovieId) {
      recordedViewMovieIdRef.current = null;
    }
    setAutoplayBlocked(false);
    autoplayBlockedRef.current = false;
    const iosStartMuted = !Capacitor.isNativePlatform() && isAppleMobileBrowser() && manualRetryNonce === 0;
    setIsAutoplayMuted(iosStartMuted);
    wasMutedByAutoplayRef.current = iosStartMuted;
    setError(null);
    setErrorDetail(null);
    setSeekPreviewTime(null);
    seekPreviewTimeRef.current = null;
    isDraggingSeekRef.current = false;
    setCurrentTime(0);
    currentTimeRef.current = 0;
    setBufferedTime(0);
    const resetDur = resolveKnownEpisodeOrMovieDuration();
    hasAuthoritativeDurationRef.current = false;
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
    setSelectedSubtitle('Off');
    selectedSubtitleRef.current = 'Off';
    setActiveSubtitleCue('');
    setIsSubtitleLoading(false);
    setSubtitleNotice(null);
    activeServerSubTrackRef.current = null;
    loadedSubChunksRef.current.clear();
    inflightSubChunksRef.current.clear();
    webSubtitleCuesRef.current = [];
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
      const effectiveInitialTime = (isInitialOpenStreamRef.current && initialTime > 0) ? initialTime : 0;
      hasExplicitInitialTimeRef.current = isInitialOpenStreamRef.current && initialTime > 0;

      if (isOfflineLocal) {
        if (!cancelled) {
          userPickedQualityRef.current = false;
          setSelectedQuality('Offline');
          if (effectiveInitialTime > 0.25) {
            resumeOffsetRef.current = effectiveInitialTime;
            setCurrentTime(effectiveInitialTime);
            currentTimeRef.current = effectiveInitialTime;
          }
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
        if (effectiveInitialTime > 0.25) {
          resumeOffsetRef.current = effectiveInitialTime;
          setCurrentTime(effectiveInitialTime);
          currentTimeRef.current = effectiveInitialTime;
        }
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

      const evaluateNativeExoChoice = (info: any): {
        mode: 'direct' | 'remux' | 'transcode';
        stage: 'level1_hw' | 'level2_sw' | 'level2_surface' | 'level2_remux' | 'level3_transcode';
        preferSw: boolean;
      } => {
        const pixFmtLower = String(info?.pixFmt || '').toLowerCase();
        const is10BitStream = Boolean(
          info?.is10Bit ||
            pixFmtLower.includes('10le') ||
            pixFmtLower.includes('10be') ||
            pixFmtLower.includes('p10') ||
            pixFmtLower.includes('12le') ||
            pixFmtLower.includes('12be') ||
            pixFmtLower.includes('p12') ||
            pixFmtLower.includes('yuv422') ||
            pixFmtLower.includes('yuv444')
        );
        const vCodec = String(info?.videoCodec || '').toLowerCase();
        const aCodec = String(info?.audioCodec || '').toLowerCase();
        const isHevcStream = vCodec === 'hevc' || vCodec === 'h265';
        const isVp9Stream = vCodec === 'vp9';
        const isAv1Stream = vCodec === 'av1' || vCodec === 'av01';
        const is4KStream = (info?.width && info.width > 2100) || (info?.height && info.height > 1200);

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
        const genericUnsupportedAudio =
          Boolean(info?.hasUnsupportedAudio) &&
          caps.supportsAc3 === false &&
          caps.supportsEac3 === false &&
          caps.supportsDts === false;
        const audioIncompatible = ac3Unsupported || eac3Unsupported || dtsUnsupported || genericUnsupportedAudio;

        const exceedsMaxHevc = isHevcStream && is4KStream && caps.maxHevcWidth && info.width > caps.maxHevcWidth;
        const exceedsMaxAvc =
          (vCodec === 'h264' || vCodec === 'avc') && is4KStream && caps.maxAvcWidth && info.width > caps.maxAvcWidth;

        if (audioIncompatible && remoteTranscodeAvailable) {
          return { mode: 'transcode', stage: 'level3_transcode', preferSw: false };
        }
        if (is10BitStream && !deviceSupports10BitHw && remoteTranscodeAvailable) {
          return { mode: 'transcode', stage: 'level3_transcode', preferSw: false };
        }
        if (is10BitStream && !deviceSupports10Bit && remoteTranscodeAvailable) {
          return { mode: 'transcode', stage: 'level3_transcode', preferSw: false };
        }
        if (is10BitStream && !deviceSupports10BitHw && deviceHasSoftwareHevc) {
          return { mode: 'direct', stage: 'level2_sw', preferSw: true };
        }
        if (isHevcStream && !deviceHasHardwareHevc) {
          if (remoteTranscodeAvailable && (!deviceHasSoftwareHevc || is4KStream || (info?.height && info.height > 1088))) {
            return { mode: 'transcode', stage: 'level3_transcode', preferSw: false };
          }
          if (deviceHasSoftwareHevc) {
            return { mode: 'direct', stage: 'level2_sw', preferSw: true };
          }
        }
        if (
          (exceedsMaxHevc || exceedsMaxAvc || (isVp9Stream && !deviceSupportsVp9) || (isAv1Stream && !deviceSupportsAv1)) &&
          remoteTranscodeAvailable
        ) {
          return { mode: 'transcode', stage: 'level3_transcode', preferSw: false };
        }
        return { mode: 'direct', stage: 'level1_hw', preferSw: false };
      };

      const applyStreamInfoMetadata = (info: any, isBackgroundEnrich: boolean) => {
        if (!info || info.status !== 'ok') return;

        if (typeof info.durationSec === 'number' && info.durationSec > 0) {
          if (info.probedByFfprobe === true || !hasAuthoritativeDurationRef.current) {
            probedDuration = info.durationSec;
            knownDurationRef.current = info.durationSec;
            durationRef.current = info.durationSec;
            setDuration(info.durationSec);
            if (info.probedByFfprobe === true) {
              hasAuthoritativeDurationRef.current = true;
            }
          }
        }

        const navConn = (navigator as any)?.connection;
        const isInitialSlowNet = Boolean(
          navConn &&
            (navConn.saveData ||
              navConn.effectiveType === '2g' ||
              navConn.effectiveType === 'slow-2g' ||
              (typeof navConn.downlink === 'number' && navConn.downlink > 0 && navConn.downlink < 0.7))
        );
        const startSlow360p = !userPickedQualityRef.current && isInitialSlowNet && remoteTranscodeAvailable;

        if (typeof info.height === 'number' && info.height > 0) {
          probedHeight = info.height;
          if (!userPickedQualityRef.current && !startSlow360p) {
            const autoQ = info.height <= 520 ? '480P' : info.height <= 780 ? '720P' : '1080P';
            selectedQualityRef.current = autoQ;
            setSelectedQuality(autoQ);
          }
        }

        const cleanProbedSubs =
          Array.isArray(info.subtitleTracks) && info.subtitleTracks.length > 0
            ? normalizePlayerTrackList(info.subtitleTracks, 'subtitle')
            : [];
        serverProbedSubTracksRef.current = cleanProbedSubs;
        if (cleanProbedSubs.length > 0) {
          setRealSubtitleTracks(cleanProbedSubs);
        }

        if (startSlow360p) {
          selectedQualityRef.current = '360P';
          setSelectedQuality('360P');
          chosenMode = 'transcode';
          chosenStage = 'level3_transcode';
        } else if (!exoCapable) {
          if (
            info.recommendedMode === 'remux' ||
            info.recommendedMode === 'transcode' ||
            info.recommendedMode === 'direct'
          ) {
            chosenMode = info.recommendedMode;
          }
          if (isAppleMobileBrowser()) {
            const vCodec = String(info.videoCodec || '').toLowerCase();
            const cont = String(info.container || '').toLowerCase();
            if (cont.includes('webm') || vCodec === 'vp8' || vCodec === 'vp9') {
              chosenMode = 'transcode';
            } else if (chosenMode === 'direct') {
              chosenMode = 'remux';
            }
          }
          chosenStage =
            chosenMode === 'transcode'
              ? 'level3_transcode'
              : chosenMode === 'remux'
                ? 'level2_remux'
                : 'level1_hw';
        } else {
          const exoEval = evaluateNativeExoChoice(info);
          chosenMode = exoEval.mode;
          chosenStage = exoEval.stage;
          initialPreferSw = exoEval.preferSw;
        }

        if (!exoCapable) {
          if (Array.isArray(info.audioTracks) && info.audioTracks.length > 0) {
            const cleanAudio = normalizePlayerTrackList(info.audioTracks, 'audio');
            setRealAudioTracks(cleanAudio);
            const preferredLang = verifiedLanguageRef.current.toLowerCase();
            const matchIdx = cleanAudio.findIndex(
              (t) =>
                String(t.lang || '').toLowerCase().includes(preferredLang) ||
                String(t.label || '').toLowerCase().includes(preferredLang)
            );
            const chosenTrack = matchIdx >= 0 ? cleanAudio[matchIdx] : cleanAudio[0];
            if (chosenTrack) {
              setSelectedAudio(chosenTrack.label);
              if (typeof chosenTrack.id === 'number') {
                setSelectedAudioIdx(chosenTrack.id);
                if (chosenTrack.id > 0 && chosenMode === 'direct' && remoteTranscodeAvailable) {
                  chosenMode = 'remux';
                  chosenStage = 'level2_remux';
                }
              }
            }
          }
          setRealSubtitleTracks(cleanProbedSubs);
        }

        if (isBackgroundEnrich && preflightCacheRef.current?.url === trimmed) {
          preflightCacheRef.current = {
            ...preflightCacheRef.current,
            durationSec: probedDuration || preflightCacheRef.current.durationSec,
            sourceHeight: probedHeight || preflightCacheRef.current.sourceHeight,
            recommendedMode: chosenMode,
          };
          if (!userPickedQualityRef.current && chosenMode === 'transcode' && streamFallbackModeRef.current === 'direct') {
            const curPos = Math.floor(currentTimeRef.current || 0);
            setFallbackStage('level3_transcode');
            fallbackStageRef.current = 'level3_transcode';
            setStreamStartOffset(curPos);
            streamStartOffsetRef.current = curPos;
            setStreamFallbackMode('transcode');
            streamFallbackModeRef.current = 'transcode';
          }
        }
      };

      const cachedInfo = manualRetryNonce === 0 ? getCachedStreamInfo(trimmed) : null;
      const canLaunchExoOptimistically = exoCapable && !cachedInfo && !userPickedQualityRef.current;

      if (cachedInfo) {
        applyStreamInfoMetadata(cachedInfo, false);
      } else if (canLaunchExoOptimistically) {
        // Instant playback on native Android ExoPlayer without waiting 14s for ffprobe stream-info!
        fetchStreamInfo(trimmed, { timeoutMs: isUsingLocalNativeBridge() ? 14000 : 18000 })
          .then((info) => {
            if (!cancelled && info) {
              applyStreamInfoMetadata(info, true);
            }
          })
          .catch(() => {});
      } else {
        try {
          const info = await fetchStreamInfo(trimmed, {
            force: manualRetryNonce > 0,
            timeoutMs: isUsingLocalNativeBridge() ? 14000 : 18000,
          });
          if (!cancelled && info) {
            applyStreamInfoMetadata(info, false);
          }
        } catch (err) {
          console.warn('[VideoPlayer] stream-info preflight notice:', err);
          if (!exoCapable && isAppleMobileBrowser() && isTelegram && chosenMode === 'direct') {
            chosenMode = 'remux';
            chosenStage = 'level2_remux';
          }
        }
      }

      if (cancelled) return;

      const useIosVodResume = !Capacitor.isNativePlatform() && isAppleMobileBrowser();

      // Apply initialTime directly when transitioning from inline small screen, or fallback to saved resume position
      if (effectiveInitialTime > 0.25) {
        if (chosenMode !== 'direct' && !useIosVodResume) {
          initialStart = Math.max(0, Math.floor(effectiveInitialTime));
        } else {
          resumeOffsetRef.current = effectiveInitialTime;
          setCurrentTime(effectiveInitialTime);
          currentTimeRef.current = effectiveInitialTime;
        }
      } else if (!hasExplicitInitialTimeRef.current && episodeResumeKey) {
        try {
          const savedPos = parseFloat(localStorage.getItem(`resume_pos_${episodeResumeKey}`) || '0');
          if (savedPos > 2 && (!probedDuration || savedPos < probedDuration - 20)) {
            if (chosenMode !== 'direct' && !useIosVodResume) {
              initialStart = Math.floor(savedPos);
            } else {
              resumeOffsetRef.current = savedPos;
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

    const canScaleRemote = !Capacitor.isNativePlatform() || hasRemoteTranscodeBackend();
    const isIosWeb = !Capacitor.isNativePlatform() && isAppleMobileBrowser();
    const durHint = Math.round(preflightCacheRef.current.durationSec || durationRef.current || knownDurationRef.current || 0);
    const startHint = Math.floor(Math.max(0, qualityResumeTargetRef.current || resumeOffsetRef.current || 0));

    const plan = resolveStreamBuildPlan({
      rawUrl: trimmed,
      selectedQuality: selectedQuality || 'Auto',
      videoQualities,
      recommendedMode: preflightCacheRef.current.recommendedMode || 'direct',
      streamFallbackMode,
      canScaleRemote,
      isNativePlatform: Capacitor.isNativePlatform(),
      isIosWeb,
      userPickedQuality: userPickedQualityRef.current,
      audioIdx: selectedAudioIdx,
      durationSec: durHint,
      startHint,
      streamStartOffset,
    });

    if (!plan.isTelegram && !plan.needsScaledTranscode && plan.effectiveMode === 'direct') {
      setPlayableUrl(plan.sourceUrl);
      return;
    }

    if (plan.useHlsPipeline) {
      let hlsQs = `?url=${encodeURIComponent(plan.sourceUrl)}&mode=${plan.effectiveMode}`;
      if (plan.qualityParam && (userPickedQualityRef.current || plan.needsScaledTranscode)) {
        hlsQs += `&quality=${plan.qualityParam}`;
      }
      if (selectedAudioIdx > 0) hlsQs += `&audioIdx=${selectedAudioIdx}`;
      if (durHint > 0) hlsQs += `&dur=${durHint}`;
      if (startHint >= 4) hlsQs += `&start=${startHint}`;
      if (Capacitor.isNativePlatform()) {
        const remoteBase = getRemoteTranscodeBackendUrl() || getApiBaseUrl();
        setPlayableUrl(
          remoteBase
            ? `${remoteBase}/api/telegram/hls/playlist.m3u8${hlsQs}`
            : buildApiUrl(`/api/telegram/hls/playlist.m3u8${hlsQs}`)
        );
      } else {
        setPlayableUrl(buildApiUrl(`/api/telegram/hls/playlist.m3u8${hlsQs}`));
      }
      return;
    }

    let params = `?url=${encodeURIComponent(plan.sourceUrl)}&ext=.mp4`;

    if (plan.effectiveMode === 'remux') {
      params += `&remux=1`;
      if (streamStartOffset >= 1) params += `&start=${Math.floor(streamStartOffset)}`;
      if (selectedAudioIdx > 0) params += `&audioIdx=${selectedAudioIdx}`;
    } else if (plan.effectiveMode === 'transcode') {
      params += `&transcode=1`;
      if (plan.qualityParam) params += `&quality=${plan.qualityParam}`;
      if (streamStartOffset >= 1) params += `&start=${Math.floor(streamStartOffset)}`;
      if (selectedAudioIdx > 0) params += `&audioIdx=${selectedAudioIdx}`;
    }

    let apiUrl: string;
    if (Capacitor.isNativePlatform() && plan.effectiveMode !== 'direct') {
      const remoteBase = getRemoteTranscodeBackendUrl() || getApiBaseUrl();
      apiUrl = remoteBase ? `${remoteBase}/api/stream${params}` : buildApiUrl(`/api/stream${params}`);
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
    if (!isOpen) {
      isInitialOpenStreamRef.current = true;
      hasExplicitInitialTimeRef.current = false;
      qualityResumeTargetRef.current = null;
      setGestureHud(null);
      if (Capacitor.isNativePlatform()) {
        try {
          (window as any).AndroidPlayerBridge?.resetPlayerBrightness?.();
        } catch {}
      }
      return;
    }

    isInitialOpenStreamRef.current = true;
    isInteractingRef.current = false;
    showControlsWithTimer();
    setSelectedAudio(verifiedLanguageRef.current);

    if (Capacitor.isNativePlatform()) {
      try {
        const b = (window as any).AndroidPlayerBridge;
        b?.setPlaybackActive?.(true);
        if (typeof b?.getPlayerBrightness === 'function') {
          const curB = Number(b.getPlayerBrightness());
          if (Number.isFinite(curB) && curB > 0) {
            brightnessRef.current = curB;
            setBrightnessLevel(curB);
          }
        }
        if (typeof b?.getPlayerVolume === 'function') {
          const curV = Number(b.getPlayerVolume());
          if (Number.isFinite(curV) && curV >= 0) {
            volumeRef.current = curV;
            setVolumeLevel(curV);
          }
        }
      } catch {}
    } else {
      brightnessRef.current = 1;
      setBrightnessLevel(1);
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
    let resumeSec = Math.max(resumeOffsetRef.current || 0, qualityResumeTargetRef.current || 0);
    resumeOffsetRef.current = 0;

    if (resumeSec <= 0.25 && !hasExplicitInitialTimeRef.current && streamFallbackModeRef.current === 'direct' && episodeResumeKey) {
      try {
        const saved = parseFloat(localStorage.getItem(`resume_pos_${episodeResumeKey}`) || '0');
        const knownDur = durationRef.current || knownDurationRef.current;
        if (saved > 2 && (!knownDur || saved < knownDur - 20)) {
          resumeSec = saved;
        }
      } catch {}
    }

    const isHlsExo = /\.m3u8/i.test(playableUrl);
    const exoStartOffset = resumeSec;
    let exoReadySeekRetries = 0;
    let lastExoReadySeekAtMs = 0;

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
    let smoothPlaybackSinceMs = 0;
    let exoStallIncidentCount = 0;
    let exoStallWindowStartMs = 0;
    let exoLastCountedStallStartMs = 0;

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
      const lowerReason = reason.toLowerCase();
      const isNetworkOrStall =
        lowerReason.includes('buffering_timeout') ||
        lowerReason.includes('premature_eof') ||
        lowerReason.includes('timeout') ||
        lowerReason.includes('socket') ||
        lowerReason.includes('connection') ||
        lowerReason.includes('network') ||
        lowerReason.includes('eof') ||
        lowerReason.includes('http') ||
        lowerReason.includes('source') ||
        lowerReason.includes('unexpected') ||
        lowerReason.includes('extractor') ||
        lowerReason.includes('chunk') ||
        lowerReason.includes('parser') ||
        lowerReason.includes('io') ||
        safePos >= 15;

      console.warn(`[ExoPlayer] Fallback escalation triggered from ${stage} (${reason}) at ${safePos}s`);

      // If playback hit a transient mid-stream stall/EOF/network drop,
      // reconnect at the exact same healthy stage & position rather than ending or downgrading codecs!
      if (isNetworkOrStall && safePos >= 10 && exoNetworkRecoveryAttemptsRef.current < 20) {
        exoNetworkRecoveryAttemptsRef.current += 1;
        if (!isHlsExo && /[?&](transcode|remux)=1/i.test(playableUrl)) {
          setStreamStartOffset(safePos);
          streamStartOffsetRef.current = safePos;
        } else {
          resumeOffsetRef.current = safePos;
        }
        setIsLoading(true);
        setExoReconnectNonce((n) => n + 1);
        return;
      }

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

        const baseOffset = !isHlsExo && streamFallbackModeRef.current !== 'direct' ? streamStartOffsetRef.current : 0;
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

        // Infinite buffering stall guard & slow-network 360P downgrade
        if (st.state === 2) {
          const metric = rawBuffered + rawPos;
          const nowMs = Date.now();
          if (bufferingStallStartMs === 0 || Math.abs(metric - bufferingLastProgressMetric) > 0.15) {
            bufferingStallStartMs = nowMs;
            bufferingLastProgressMetric = metric;
          } else {
            const stallElapsed = nowMs - bufferingStallStartMs;
            if (
              st.firstFrameRendered &&
              hasRemoteTranscodeBackend() &&
              (selectedQualityRef.current || '').toUpperCase() !== '360P' &&
              nowMs - lastManualQualityPickAtRef.current >= 12000
            ) {
              if (stallElapsed >= 2000 && exoLastCountedStallStartMs !== bufferingStallStartMs) {
                exoLastCountedStallStartMs = bufferingStallStartMs;
                if (nowMs - exoStallWindowStartMs > 40000) {
                  exoStallWindowStartMs = nowMs;
                  exoStallIncidentCount = 1;
                } else {
                  exoStallIncidentCount += 1;
                }
              }
              if (stallElapsed >= 8000 || exoStallIncidentCount >= 2) {
                escalated = true;
                clearInterval(pollTimer);
                bridge.stopExoMedia?.();
                abortLocalBridgeStreams();
                triggerAutoSlow360pSwitch(effectiveTime);
                return;
              }
            }
            if (stallElapsed > 45000) {
              escalateExoPlayback('buffering_timeout', effectiveTime);
              return;
            }
          }
        } else {
          bufferingStallStartMs = 0;
        }

        if (st.firstFrameRendered || renderedCount > 0) {
          setHasDecodedFrame(true);
          if (st.isPlaying && !st.isBuffering) {
            const targetMovieId = String(movie?.id || movie?.imdbId || '').trim();
            if (movie && targetMovieId && recordedViewMovieIdRef.current !== targetMovieId) {
              recordedViewMovieIdRef.current = targetMovieId;
              recordMovieViewStart(movie, user?.uid).catch(() => {});
            }
            if (smoothPlaybackSinceMs === 0) {
              smoothPlaybackSinceMs = Date.now();
            } else if (Date.now() - smoothPlaybackSinceMs > 12000) {
              exoNetworkRecoveryAttemptsRef.current = 0;
            }
          } else {
            smoothPlaybackSinceMs = 0;
          }
        } else {
          smoothPlaybackSinceMs = 0;
        }

        setIsPlaying(Boolean(st.isPlaying));
        setIsLoading(Boolean(st.isBuffering || (st.state === 1 && !st.isPlaying && !st.ended)));

        const pendingTarget = qualityResumeTargetRef.current;
        const holdingResumeTarget =
          pendingTarget !== null &&
          pendingTarget > 3 &&
          effectiveTime < pendingTarget - 4;

        if (holdingResumeTarget) {
          if (
            st.state === 3 &&
            st.seekable &&
            exoReadySeekRetries < 4 &&
            Date.now() - lastExoReadySeekAtMs > 1400
          ) {
            exoReadySeekRetries += 1;
            lastExoReadySeekAtMs = Date.now();
            try {
              bridge.exoSeek?.(pendingTarget);
            } catch {}
          }
          if (!isDraggingSeekRef.current) {
            setCurrentTime(pendingTarget);
            currentTimeRef.current = pendingTarget;
          }
        } else {
          if (
            pendingTarget !== null &&
            (effectiveTime >= pendingTarget - 4 || pendingTarget <= 3) &&
            (st.firstFrameRendered || renderedCount > 0)
          ) {
            qualityResumeTargetRef.current = null;
          }
          if (!isDraggingSeekRef.current && typeof st.currentTime === 'number') {
            if (exoStartOffset > 3 && !st.firstFrameRendered && effectiveTime < exoStartOffset - 3) {
              setCurrentTime(exoStartOffset);
              currentTimeRef.current = exoStartOffset;
            } else {
              setCurrentTime(effectiveTime);
              currentTimeRef.current = effectiveTime;
            }
          }
        }
        if (typeof st.bufferedPosition === 'number') {
          setBufferedTime(effectiveBuffered);
        }
        if (typeof st.duration === 'number' && st.duration > 1 && isFinite(st.duration)) {
          const isDirectOrHls = streamFallbackModeRef.current === 'direct' || isHlsExo;
          const candidateDur = !isDirectOrHls && baseOffset > 0 ? baseOffset + st.duration : st.duration;
          if (isDirectOrHls) {
            hasAuthoritativeDurationRef.current = true;
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

        if (effectiveTime > 1 && !holdingResumeTarget) {
          onProgress?.(effectiveTime, durationRef.current);
          if (effectiveTime > 2 && episodeResumeKey) {
            try {
              localStorage.setItem(`resume_pos_${episodeResumeKey}`, String(effectiveTime));
            } catch {}
          }
        }

        if (Array.isArray(st.audioTracks) && st.audioTracks.length > 0) {
          const cleanAudio = normalizePlayerTrackList(st.audioTracks, 'audio');
          const sig = JSON.stringify(cleanAudio);
          if (sig !== lastAudioJson) {
            lastAudioJson = sig;
            setRealAudioTracks(cleanAudio);
            const activeTrk = cleanAudio.find((t) => t.selected) || cleanAudio[0];
            if (activeTrk?.label) setSelectedAudio(activeTrk.label);
          }
        }

        if (Array.isArray(st.subtitleTracks) && st.subtitleTracks.length > 0) {
          const cleanSubs = normalizePlayerTrackList(st.subtitleTracks, 'subtitle');
          const sig = JSON.stringify(cleanSubs);
          if (sig !== lastSubJson) {
            lastSubJson = sig;
            setRealSubtitleTracks(cleanSubs);
          }
        } else if (serverProbedSubTracksRef.current.length > 0) {
          const sig = JSON.stringify(serverProbedSubTracksRef.current);
          if (sig !== lastSubJson) {
            lastSubJson = sig;
            setRealSubtitleTracks(serverProbedSubTracksRef.current);
          }
        }

        if (selectedSubtitleRef.current === 'Off') {
          setActiveSubtitleCue('');
        } else if (activeServerSubTrackRef.current) {
          ensureSubtitleWindowAtTime(effectiveTime, true);
          syncActiveSubtitleAtTime(effectiveTime);
        } else {
          setActiveSubtitleCue(typeof st.cueText === 'string' ? st.cueText : '');
        }

        if (st.ended && !endedHandled) {
          const knownDur = knownDurationRef.current || durationRef.current || 0;
          const isPrematureEnd = knownDur > 90 && effectiveTime > 10 && effectiveTime < knownDur - 25;
          if (isPrematureEnd && exoNetworkRecoveryAttemptsRef.current < 20) {
            escalateExoPlayback('premature_eof', effectiveTime);
            return;
          }
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
  }, [exoModeActive, playableUrl, preferSoftwareDecoder, surfaceMode, manualRetryNonce, exoReconnectNonce]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || isYouTube || !playableUrl || canUseNativeExo) return;

    let cancelled = false;
    let hlsInstance: Hls | null = null;
    const isHlsUrl = /\.m3u8/i.test(playableUrl);
    const isAppleDevice = isAppleMobileBrowser();
    // Use hls.js on non-Apple devices; Apple devices (iPhone/iPad/Safari) play .m3u8 natively via built-in AVPlayer!
    const usesHlsJs = isHlsUrl && Hls.isSupported() && !isAppleDevice && !forceNativeIosHls;
    const canSeekDirectTimeline = streamFallbackModeRef.current === 'direct' || isHlsUrl;

    // Determine exact initial seek position before starting HTML5/HLS playback
    const initialResumeCandidate = Math.max(resumeOffsetRef.current || 0, qualityResumeTargetRef.current || 0);
    let pendingSeekTarget: number | null =
      initialResumeCandidate > 0.25 && canSeekDirectTimeline
        ? initialResumeCandidate
        : null;
    resumeOffsetRef.current = 0;

    if (
      pendingSeekTarget === null &&
      !hasExplicitInitialTimeRef.current &&
      canSeekDirectTimeline &&
      episodeResumeKey
    ) {
      try {
        const savedPos = parseFloat(localStorage.getItem(`resume_pos_${episodeResumeKey}`) || '0');
        const knownDur = durationRef.current || knownDurationRef.current;
        if (savedPos > 2 && (!knownDur || savedPos < knownDur - 20)) {
          pendingSeekTarget = savedPos;
        }
      } catch {}
    }

    let seekAttempts = 0;
    let seekConfirmed = pendingSeekTarget === null;
    let isPlayInFlight = false;
    let hasPlayedAnyFrame = false;
    autoplayBlockedRef.current = false;
    setAutoplayBlocked(false);

    const tryApplyPendingSeek = () => {
      if (cancelled || seekConfirmed || pendingSeekTarget === null || !canSeekDirectTimeline) {
        return;
      }
      const vidDuration = video.duration;
      const knownDur = vidDuration && isFinite(vidDuration) ? vidDuration : durationRef.current;
      if (knownDur > 0 && pendingSeekTarget >= knownDur - 2) {
        seekConfirmed = true;
        pendingSeekTarget = null;
        qualityResumeTargetRef.current = null;
        return;
      }
      if (Math.abs(video.currentTime - pendingSeekTarget) <= 2.8) {
        seekConfirmed = true;
        pendingSeekTarget = null;
        qualityResumeTargetRef.current = null;
        return;
      }
      if (video.readyState < 1) {
        return;
      }
      if (seekAttempts < 25) {
        seekAttempts += 1;
        try {
          video.currentTime = pendingSeekTarget;
          setCurrentTime(pendingSeekTarget);
          currentTimeRef.current = pendingSeekTarget;
        } catch {}
      } else {
        seekConfirmed = true;
        pendingSeekTarget = null;
        qualityResumeTargetRef.current = null;
      }
    };

    const startHtml5Playback = () => {
      if (cancelled || isPlayInFlight || autoplayBlockedRef.current || !video.paused) return;
      isPlayInFlight = true;

      // On iOS Safari/WebKit, async preflight fetch expires the tap gesture token, so start muted cleanly
      // and show a one-tap Sound button unless user explicitly tapped Sound/Retry/Play.
      if (isAppleDevice && manualRetryNonce === 0 && wasMutedByAutoplayRef.current) {
        video.muted = true;
        video.defaultMuted = true;
      } else if (!wasMutedByAutoplayRef.current) {
        video.muted = false;
        setIsAutoplayMuted(false);
      }

      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          isPlayInFlight = false;
          if (!cancelled) {
            autoplayBlockedRef.current = false;
            setAutoplayBlocked(false);
            tryApplyPendingSeek();
            setIsPlaying(true);
            if (video.readyState >= 3) {
              setIsLoading(false);
            }
          }
        }).catch((firstErr: any) => {
          isPlayInFlight = false;
          if (cancelled || firstErr?.name === 'AbortError') return;
          if (!video.muted) {
            // Fallback muted autoplay if WebView/Safari blocks unmuted autoplay; unmutes on first user tap
            video.muted = true;
            video.defaultMuted = true;
            wasMutedByAutoplayRef.current = true;
            setIsAutoplayMuted(true);
            isPlayInFlight = true;
            video.play().then(() => {
              isPlayInFlight = false;
              if (!cancelled) {
                autoplayBlockedRef.current = false;
                setAutoplayBlocked(false);
                tryApplyPendingSeek();
                setIsPlaying(true);
                if (video.readyState >= 3) {
                  setIsLoading(false);
                }
              }
            }).catch((playErr: any) => {
              isPlayInFlight = false;
              if (!cancelled && playErr?.name !== 'AbortError') {
                autoplayBlockedRef.current = true;
                setAutoplayBlocked(true);
                setIsLoading(false);
                setIsPlaying(false);
                showControlsWithTimer();
              }
            });
          } else {
            autoplayBlockedRef.current = true;
            setAutoplayBlocked(true);
            setIsLoading(false);
            setIsPlaying(false);
            showControlsWithTimer();
          }
        });
      } else {
        isPlayInFlight = false;
      }
    };

    let hlsRetryTimer: ReturnType<typeof setTimeout> | null = null;
    if (usesHlsJs) {
      try {
        video.removeAttribute('src');
        video.querySelectorAll('source').forEach((s) => s.remove());
        video.load();
        (video as any).disableRemotePlayback = true;
      } catch {}
      hlsInstance = new Hls({
        enableWorker: !isAppleDevice,
        lowLatencyMode: false,
        preferManagedMediaSource: true,
        startPosition: pendingSeekTarget !== null ? pendingSeekTarget : -1,
        maxBufferLength: 45,
        maxMaxBufferLength: 120,
        backBufferLength: 30,
        manifestLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 1200,
        levelLoadingTimeOut: 20000,
        levelLoadingMaxRetry: 6,
        levelLoadingRetryDelay: 1200,
        fragLoadingTimeOut: 40000,
        fragLoadingMaxRetry: 8,
        fragLoadingRetryDelay: 1000,
        fragLoadingMaxRetryTimeout: 20000,
        xhrSetup: (xhr, reqUrl) => {
          try {
            if (new URL(reqUrl, window.location.href).origin === window.location.origin) {
              xhr.withCredentials = true;
            }
          } catch {}
        },
      });
      hlsRef.current = hlsInstance;
      hlsInstance.loadSource(playableUrl);
      hlsInstance.attachMedia(video);

      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
        tryApplyPendingSeek();
        if (hlsInstance && hlsInstance.audioTracks && hlsInstance.audioTracks.length > 0) {
          const tracks = normalizePlayerTrackList(
            hlsInstance.audioTracks.map((t, idx) => ({
              id: idx,
              label: t.name || t.lang || `Audio ${idx + 1}`,
              lang: t.lang
            })),
            'audio'
          );
          setRealAudioTracks(tracks);
          if (tracks.length > 0) {
            setSelectedAudio(tracks[hlsInstance.audioTrack]?.label || tracks[0].label);
          }
        }
        if (
          serverProbedSubTracksRef.current.length === 0 &&
          hlsInstance &&
          hlsInstance.subtitleTracks &&
          hlsInstance.subtitleTracks.length > 0
        ) {
          const subTracks = normalizePlayerTrackList(
            hlsInstance.subtitleTracks.map((s, idx) => ({
              id: idx,
              label: s.name || s.lang || `Subtitle ${idx + 1}`,
              lang: s.lang
            })),
            'subtitle'
          );
          setRealSubtitleTracks(subTracks);
        }

        startHtml5Playback();
      });

      let consecutiveSlowFrags = 0;
      hlsInstance.on(Hls.Events.FRAG_LOADED, (_event, data: any) => {
        if (cancelled || !hasPlayedAnyFrame) return;
        const stats = data?.frag?.stats;
        const loadedBytes = Number(stats?.loaded || stats?.total || 0);
        const tReq = Number(stats?.loading?.start || 0);
        const tEnd = Number(stats?.loading?.end || 0);
        const dlMs = tEnd > tReq ? tEnd - tReq : 0;
        if (dlMs > 1500 && loadedBytes > 65536) {
          const kbps = (loadedBytes * 8) / dlMs;
          if (kbps < 380) {
            consecutiveSlowFrags += 1;
            if (consecutiveSlowFrags >= 2) {
              consecutiveSlowFrags = 0;
              triggerAutoSlow360pSwitch(currentTimeRef.current || video.currentTime || 0);
            }
          } else {
            consecutiveSlowFrags = 0;
          }
        } else if (dlMs > 0 && loadedBytes > 65536) {
          consecutiveSlowFrags = 0;
        }
      });

      let hlsRecoverCount = 0;
      let lastMediaRecoverAt = 0;
      hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || cancelled) return;
        if (hlsRecoverCount < 10) {
          hlsRecoverCount += 1;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            const resumeAt = Math.max(0, Math.floor(currentTimeRef.current || 0));
            const delayMs = Math.min(4000, 600 * hlsRecoverCount);
            console.warn(`[VideoPlayer] HLS network error (#${hlsRecoverCount}), retrying load from ${resumeAt}s...`);
            if (hlsRetryTimer) clearTimeout(hlsRetryTimer);
            hlsRetryTimer = setTimeout(() => {
              if (!cancelled) {
                hlsInstance?.startLoad(resumeAt > 0 ? resumeAt : -1);
              }
            }, delayMs);
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            const now = Date.now();
            if (now - lastMediaRecoverAt < 10000) {
              try {
                hlsInstance?.swapAudioCodec();
              } catch {}
            }
            lastMediaRecoverAt = now;
            hlsInstance?.recoverMediaError();
            return;
          }
        }
        if (currentTimeRef.current >= 5 && html5NetworkRecoveryAttemptsRef.current < 20) {
          html5NetworkRecoveryAttemptsRef.current += 1;
          setIsLoading(true);
          resumeOffsetRef.current = currentTimeRef.current;
          setHtml5ReconnectNonce((n) => n + 1);
          return;
        }
        if (isAppleDevice && !forceNativeIosHls && video.canPlayType('application/vnd.apple.mpegurl')) {
          setIsLoading(true);
          resumeOffsetRef.current = currentTimeRef.current;
          setForceNativeIosHls(true);
          return;
        }
        if (/t\.me|telegram\.me/i.test(activeStreamUrl) && streamFallbackModeRef.current !== 'transcode') {
          setIsLoading(true);
          setStreamStartOffset(Math.floor(currentTimeRef.current));
          setStreamFallbackMode('transcode');
          return;
        }
        setIsLoading(false);
        setError('stream_error');
        setErrorDetail('Stream connection interrupted. Tap Retry to continue from where you stopped.');
      });
    } else if (isHlsUrl && video.canPlayType('application/vnd.apple.mpegurl')) {
      try {
        (video as any).disableRemotePlayback = false;
      } catch {}
      if (video.getAttribute('src') !== playableUrl) {
        video.src = playableUrl;
      }
      tryApplyPendingSeek();
      startHtml5Playback();
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
      if (pendingSeekTarget !== null && pendingSeekTarget > 3 && video.currentTime < pendingSeekTarget - 3) {
        tryApplyPendingSeek();
        return;
      }
      const activeMode = streamFallbackModeRef.current;
      const startOff = !isHlsUrl && activeMode !== 'direct' ? streamStartOffsetRef.current : 0;
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
        if (activeMode === 'direct' || isHlsUrl) {
          hasAuthoritativeDurationRef.current = true;
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
        if (effectiveTime > 2 && episodeResumeKey && pendingSeekTarget === null) {
          try {
            localStorage.setItem(`resume_pos_${episodeResumeKey}`, effectiveTime.toString());
          } catch (e) {}
        }
      }

      // Sync real WebVTT / native textTrack cues for web playback
      if (selectedSubtitleRef.current === 'Off') {
        setActiveSubtitleCue('');
      } else {
        if (activeServerSubTrackRef.current) {
          ensureSubtitleWindowAtTime(effectiveTime, true);
        }
        syncActiveSubtitleAtTime(effectiveTime);
      }

      if (video.buffered.length > 0) {
        const offsetBase = !isHlsUrl && activeMode !== 'direct' ? streamStartOffsetRef.current : 0;
        for (let i = 0; i < video.buffered.length; i++) {
          if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime) {
            setBufferedTime(offsetBase + video.buffered.end(i));
            break;
          }
        }
      }

      if (video.currentTime > 0.15) {
        hasPlayedAnyFrame = true;
        setIsLoading(false);
        autoplayBlockedRef.current = false;
        setAutoplayBlocked(false);
      }

      // Black Screen & Audio-Only Auto-Recovery Guard:
      // On Apple WebKit native HLS, getVideoPlaybackQuality().totalVideoFrames can report 0 even when hardware AVPlayer is rendering normally.
      if (video.currentTime > 1.5 && !video.paused && video.readyState >= 2 && /t\.me|telegram\.me/i.test(activeStreamUrl)) {
        const isBlackScreen = video.videoWidth === 0 || video.videoHeight === 0;
        const quality = !isAppleDevice && typeof video.getVideoPlaybackQuality === 'function' ? video.getVideoPlaybackQuality() : null;
        const decodedFrames = !isAppleDevice
          ? (quality ? quality.totalVideoFrames : (video as any).webkitDecodedFrameCount)
          : undefined;
        const hasZeroFrames = !isAppleDevice && typeof decodedFrames === 'number' && decodedFrames === 0 && video.currentTime > 1.8;

        if (isBlackScreen || hasZeroFrames) {
          if (streamFallbackMode !== 'transcode') {
            console.warn('[VideoPlayer] Black screen / 0 decoded video frames detected. Switching to H.264 transcode...');
            setIsLoading(true);
            setHasDecodedFrame(false);
            if (isAppleMobileBrowser()) {
              resumeOffsetRef.current = effectiveTime;
            } else {
              setStreamStartOffset(Math.floor(effectiveTime));
            }
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
      if (activeMode === 'direct' || isHlsUrl) {
        if (vidDuration && isFinite(vidDuration) && vidDuration > 1) {
          hasAuthoritativeDurationRef.current = true;
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
      if (streamFallbackModeRef.current !== 'direct' && !isHlsUrl && knownDurationRef.current > 0) {
        return;
      }
      if (video.duration && isFinite(video.duration) && video.duration > 1) {
        hasAuthoritativeDurationRef.current = true;
        setDuration(video.duration);
        durationRef.current = video.duration;
        knownDurationRef.current = video.duration;
      }
    };

    const onLoadedMetadata = () => {
      syncDurationFallback();

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

      // Detect HTML5 Text / Subtitle Tracks only if server probe did not provide tracks
      if (serverProbedSubTracksRef.current.length === 0 && video.textTracks && video.textTracks.length > 0) {
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
        if (subs.length > 0) {
          setRealSubtitleTracks(subs);
        }
      }

      tryApplyPendingSeek();
      if (!usesHlsJs && playableUrl) {
        startHtml5Playback();
      }
    };

    const onWaiting = () => {
      if (video.currentTime > 0.2) setIsLoading(true);
    };

    const onPlaying = () => {
      hasPlayedAnyFrame = true;
      autoplayBlockedRef.current = false;
      setAutoplayBlocked(false);
      tryApplyPendingSeek();
      setIsLoading(false);
      setIsPlaying(true);
      const targetMovieId = String(movie?.id || movie?.imdbId || '').trim();
      if (movie && targetMovieId && recordedViewMovieIdRef.current !== targetMovieId) {
        recordedViewMovieIdRef.current = targetMovieId;
        recordMovieViewStart(movie, user?.uid).catch(() => {});
      }
      if (showControlsRef.current) scheduleAutoHideTimer();
    };

    const onCanPlay = () => {
      tryApplyPendingSeek();
      if (pendingSeekTarget === null || video.readyState >= 3) {
        setIsLoading(false);
      }
      if (playableUrl && video.paused && !autoplayBlockedRef.current) {
        startHtml5Playback();
      }
    };

    const onLoadedData = () => {
      tryApplyPendingSeek();
      if (video.readyState >= 3) {
        setIsLoading(false);
      }
    };

    const onSeeked = () => {
      if (pendingSeekTarget !== null && Math.abs(video.currentTime - pendingSeekTarget) <= 2.8) {
        seekConfirmed = true;
        pendingSeekTarget = null;
        qualityResumeTargetRef.current = null;
      }
      if (selectedSubtitleRef.current !== 'Off') {
        const startOff = !isHlsUrl && streamFallbackModeRef.current !== 'direct' ? streamStartOffsetRef.current : 0;
        const effectiveSeekTime = startOff + (video.currentTime || 0);
        if (activeServerSubTrackRef.current) {
          ensureSubtitleWindowAtTime(effectiveSeekTime, true);
        }
        syncActiveSubtitleAtTime(effectiveSeekTime);
      }
    };
    const onEnded = () => {
      const activePos = currentTimeRef.current || 0;
      const knownDur = knownDurationRef.current || durationRef.current || 0;
      const isPrematureHtml5End =
        /t\.me|telegram\.me/i.test(activeStreamUrl) &&
        knownDur > 90 &&
        activePos > 10 &&
        activePos < knownDur - 25 &&
        html5NetworkRecoveryAttemptsRef.current < 20;
      if (isPrematureHtml5End) {
        html5NetworkRecoveryAttemptsRef.current += 1;
        setIsLoading(true);
        if (isAppleDevice || isHlsUrl || streamFallbackModeRef.current === 'direct') {
          resumeOffsetRef.current = activePos;
        } else {
          setStreamStartOffset(Math.floor(activePos));
        }
        setHtml5ReconnectNonce((n) => n + 1);
        return;
      }
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
      // Ignore abort errors triggered by intentional src changes / unmount
      if (mediaErr?.code === 1) return;
      console.warn('Video stream error event fired:', mediaErr?.code, mediaErr?.message);

      const isIosFallbackCandidate = !Capacitor.isNativePlatform() && isAppleDevice;
      if ((/t\.me|telegram\.me/i.test(activeStreamUrl) || isIosFallbackCandidate) && !isUsingLocalNativeBridge()) {
        // Automatically retry with MKV->HLS/fMP4 remux, then H.264/AAC transcode when using Node backend
        if (streamFallbackMode === 'direct') {
          setIsLoading(true);
          if (isIosFallbackCandidate || isHlsUrl) {
            resumeOffsetRef.current = currentTimeRef.current;
          } else {
            setStreamStartOffset(Math.floor(currentTimeRef.current));
          }
          setStreamFallbackMode('remux');
          return;
        }
        if (streamFallbackMode === 'remux') {
          setIsLoading(true);
          if (isIosFallbackCandidate || isHlsUrl) {
            resumeOffsetRef.current = currentTimeRef.current;
          } else {
            setStreamStartOffset(Math.floor(currentTimeRef.current));
          }
          setStreamFallbackMode('transcode');
          return;
        }
        // Same-mode transient mid-stream reconnect (never permanently drop a movie mid-way on transient glitches)
        if (currentTimeRef.current >= 5 && html5NetworkRecoveryAttemptsRef.current < 20) {
          html5NetworkRecoveryAttemptsRef.current += 1;
          const activePos = currentTimeRef.current;
          setIsLoading(true);
          if (isIosFallbackCandidate || isHlsUrl || streamFallbackModeRef.current === 'direct') {
            resumeOffsetRef.current = activePos;
          } else {
            setStreamStartOffset(Math.floor(activePos));
          }
          setTimeout(() => {
            if (!cancelled) setHtml5ReconnectNonce((n) => n + 1);
          }, Math.min(3500, 1000 * html5NetworkRecoveryAttemptsRef.current));
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
      } else if (currentTimeRef.current >= 5 && html5NetworkRecoveryAttemptsRef.current < 20) {
        html5NetworkRecoveryAttemptsRef.current += 1;
        setIsLoading(true);
        resumeOffsetRef.current = currentTimeRef.current;
        setTimeout(() => {
          if (!cancelled) setHtml5ReconnectNonce((n) => n + 1);
        }, 1200);
        return;
      }

      setIsLoading(false);
      setIsPlaying(false);
      setError('stream_error');
      setErrorDetail('Stream connection interrupted. Tap Retry to continue from where you stopped.');
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

    try {
      video.setAttribute('webkit-playsinline', 'true');
      video.setAttribute('x-webkit-playsinline', 'true');
    } catch {}

    const onWebkitBeginFullscreen = () => {
      setIsFullscreen(true);
    };
    const onWebkitEndFullscreen = () => {
      setIsFullscreen(false);
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
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    video.addEventListener('webkitbeginfullscreen', onWebkitBeginFullscreen);
    video.addEventListener('webkitendfullscreen', onWebkitEndFullscreen);
    document.addEventListener('visibilitychange', onVisibilityChange);

    // If no pending seek offset, kick off playback right away; if resuming from small screen, start after metadata so browser seeks before playing frame 0
    if (!usesHlsJs && playableUrl) {
      if (pendingSeekTarget === null) {
        startHtml5Playback();
      } else if (video.readyState >= 1) {
        tryApplyPendingSeek();
        startHtml5Playback();
      }
    }

    const seekFallbackTimer = setTimeout(() => {
      if (!cancelled && playableUrl && video.paused && !autoplayBlockedRef.current && (!usesHlsJs || video.readyState >= 1)) {
        tryApplyPendingSeek();
        startHtml5Playback();
      }
    }, 1200);

    const iosDirectStallTimer =
      isAppleDevice && streamFallbackMode === 'direct' && (/t\.me|telegram\.me/i.test(activeStreamUrl) || /\.mp4/i.test(playableUrl))
        ? setTimeout(() => {
            if (
              !cancelled &&
              !hasPlayedAnyFrame &&
              !autoplayBlockedRef.current &&
              !video.error &&
              video.readyState < 3 &&
              video.currentTime < 0.2
            ) {
              console.warn('[VideoPlayer] iOS Safari direct stream stalled >6.5s, escalating to HLS remux');
              setIsLoading(true);
              resumeOffsetRef.current = currentTimeRef.current;
              setStreamFallbackMode('remux');
            }
          }, 6500)
        : null;

    const iosRemuxStallTimer =
      isAppleDevice && streamFallbackMode === 'remux'
        ? setTimeout(() => {
            if (
              !cancelled &&
              !hasPlayedAnyFrame &&
              !autoplayBlockedRef.current &&
              !video.error &&
              video.readyState < 3 &&
              video.currentTime < 0.2
            ) {
              console.warn('[VideoPlayer] iOS HLS remux stalled >18s, escalating to HLS transcode');
              setIsLoading(true);
              resumeOffsetRef.current = currentTimeRef.current;
              setStreamFallbackMode('transcode');
            }
          }, 18000)
        : null;

    const safetyTimer = setTimeout(() => {
      if (cancelled) return;
      if (video.readyState >= 2 || autoplayBlockedRef.current) {
        setIsLoading(false);
      } else if (isAppleDevice && !hasPlayedAnyFrame) {
        if (streamFallbackMode === 'direct') {
          setStreamFallbackMode('remux');
        } else if (streamFallbackMode === 'remux') {
          setStreamFallbackMode('transcode');
        } else {
          autoplayBlockedRef.current = true;
          setAutoplayBlocked(true);
          setIsLoading(false);
          setIsPlaying(false);
        }
      }
    }, streamFallbackMode === 'direct' ? 12000 : 28000);

    // Mid-playback stall watchdog: ensures streams never freeze silently around 10-15 minutes & drops to 360P on slow net
    let lastWatchPos = video.currentTime || 0;
    let lastAdvanceAtMs = Date.now();
    let smoothRunSinceMs = 0;
    let nudgeTriedForCurrentStall = false;
    let stallEventsWindowStartMs = 0;
    let stallEventsCount = 0;
    let countedCurrentStall = false;
    const html5StallWatchdog = setInterval(() => {
      if (cancelled || autoplayBlockedRef.current) return;
      if (video.paused || video.ended) {
        lastAdvanceAtMs = Date.now();
        smoothRunSinceMs = 0;
        return;
      }

      const posNow = video.currentTime || 0;
      if (Math.abs(posNow - lastWatchPos) >= 0.25) {
        lastWatchPos = posNow;
        lastAdvanceAtMs = Date.now();
        nudgeTriedForCurrentStall = false;
        countedCurrentStall = false;
        if (smoothRunSinceMs === 0) {
          smoothRunSinceMs = Date.now();
        } else if (Date.now() - smoothRunSinceMs > 12000) {
          html5NetworkRecoveryAttemptsRef.current = 0;
        }
        return;
      }

      smoothRunSinceMs = 0;
      const now = Date.now();
      const stallMs = now - lastAdvanceAtMs;

      if (hasPlayedAnyFrame && (selectedQualityRef.current || '').toUpperCase() !== '360P' && now - lastManualQualityPickAtRef.current >= 12000) {
        if (stallMs >= 2500 && !countedCurrentStall) {
          countedCurrentStall = true;
          if (now - stallEventsWindowStartMs > 40000) {
            stallEventsWindowStartMs = now;
            stallEventsCount = 1;
          } else {
            stallEventsCount += 1;
          }
        }
        if (stallMs >= 8000 || stallEventsCount >= 2) {
          triggerAutoSlow360pSwitch(currentTimeRef.current || posNow);
          return;
        }
      }

      if (hasPlayedAnyFrame && stallMs >= 16000 && !nudgeTriedForCurrentStall) {
        nudgeTriedForCurrentStall = true;
        if (hlsInstance) {
          const resumeAt = Math.max(0, Math.floor(currentTimeRef.current || posNow));
          try {
            hlsInstance.startLoad(resumeAt);
          } catch {}
        }
        video.play().catch(() => {});
      } else if (hasPlayedAnyFrame && stallMs >= 26000 && html5NetworkRecoveryAttemptsRef.current < 20) {
        html5NetworkRecoveryAttemptsRef.current += 1;
        const activePos = currentTimeRef.current || posNow;
        console.warn(`[VideoPlayer] HTML5/HLS stalled >26s at ${activePos.toFixed(1)}s. Reconnecting (#${html5NetworkRecoveryAttemptsRef.current})...`);
        setIsLoading(true);
        if (isAppleDevice || isHlsUrl || streamFallbackModeRef.current === 'direct') {
          resumeOffsetRef.current = activePos;
        } else {
          setStreamStartOffset(Math.floor(activePos));
        }
        setHtml5ReconnectNonce((n) => n + 1);
      }
    }, 1000);

    return () => {
      cancelled = true;
      clearTimeout(seekFallbackTimer);
      clearTimeout(safetyTimer);
      clearInterval(html5StallWatchdog);
      if (hlsRetryTimer) clearTimeout(hlsRetryTimer);
      if (iosDirectStallTimer) clearTimeout(iosDirectStallTimer);
      if (iosRemuxStallTimer) clearTimeout(iosRemuxStallTimer);
      if (hlsInstance) {
        hlsInstance.destroy();
        hlsRef.current = null;
      }
      try {
        video.pause();
        video.removeAttribute('src');
        video.querySelectorAll('source').forEach((s) => s.remove());
      } catch {}
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('waiting', onStallWaiting);
      video.removeEventListener('stalled', onStalled);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      video.removeEventListener('webkitbeginfullscreen', onWebkitBeginFullscreen);
      video.removeEventListener('webkitendfullscreen', onWebkitEndFullscreen);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [playableUrl, isYouTube, exoModeActive, episodeResumeKey, manualRetryNonce, html5ReconnectNonce, forceNativeIosHls]);

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
    autoplayBlockedRef.current = false;
    setAutoplayBlocked(false);
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
        if (videoRef.current?.error) {
          setError('stream_error');
        }
      });
    }
  };

  // Helper: commit seek to targetTime (handles ExoPlayer and HTML5/HLS video seek directly without restarting)
  const commitSeek = (targetTime: number) => {
    const maxDur = durationRef.current || knownDurationRef.current || 0;
    const clamped = maxDur > 0 ? Math.max(0, Math.min(maxDur, targetTime)) : Math.max(0, targetTime);

    qualityResumeTargetRef.current = null;
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

    const isVodHls = /\.m3u8/i.test(playableUrl);
    if (!isVodHls && streamFallbackMode !== 'direct' && /t\.me|telegram\.me/i.test(activeStreamUrl)) {
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
    const preFsTime = vid && isFinite(vid.currentTime) ? vid.currentTime : 0;
    const docAny = document as any;
    const elAny = target as any;
    const activeFs = Boolean(document.fullscreenElement || docAny.webkitFullscreenElement || isFullscreen);

    const preserveTimeAfterFs = () => {
      if (vid && preFsTime > 0.5 && Math.abs(vid.currentTime - preFsTime) > 1.5) {
        try {
          vid.currentTime = preFsTime;
        } catch {}
      }
      if (wasPlaying && vid && vid.paused) {
        vid.play().catch(() => {});
      }
    };

    if (!activeFs) {
      if (!Capacitor.isNativePlatform()) {
        try {
          const ori = (screen as any).orientation;
          if (ori && typeof ori.lock === 'function') {
            ori.lock('landscape').catch(() => {});
          }
        } catch {}
      }

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
          }
          preserveTimeAfterFs();
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
        : (docAny.webkitFullscreenElement && (docAny as any).webkitExitFullscreen)
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
          preserveTimeAfterFs();
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

    // HLS multi-audio switch (only use client-side switch when playlist itself contains multiple audio tracks)
    if (
      hlsRef.current &&
      typeof track.id === 'number' &&
      hlsRef.current.audioTracks &&
      hlsRef.current.audioTracks.length > 1
    ) {
      hlsRef.current.audioTrack = track.id;
    } else if (videoRef.current && (videoRef.current as any).audioTracks && (videoRef.current as any).audioTracks.length > 1) {
      const audioTracksApi = (videoRef.current as any).audioTracks;
      for (let i = 0; i < audioTracksApi.length; i++) {
        audioTracksApi[i].enabled = (i === track.id);
      }
    } else if (/t\.me|telegram\.me/i.test(activeStreamUrl) && typeof track.id === 'number') {
      setIsLoading(true);
      resumeOffsetRef.current = currentTimeRef.current;
      setSelectedAudioIdx(track.id);
      if (streamFallbackMode === 'direct' && track.id > 0) {
        setStreamFallbackMode('remux');
      }
      if (!Capacitor.isNativePlatform() || hasRemoteTranscodeBackend()) {
        // HLS playlist pipeline seeks via resumeOffsetRef
      } else {
        setStreamStartOffset(Math.floor(currentTimeRef.current));
      }
    }
  };

  const SUB_CHUNK_STEP = 300;
  const SUB_CHUNK_DUR = 360;

  const showSubtitleNoticeBriefly = (msg: string) => {
    setSubtitleNotice(msg);
    if (subtitleNoticeTimerRef.current) clearTimeout(subtitleNoticeTimerRef.current);
    subtitleNoticeTimerRef.current = setTimeout(() => {
      setSubtitleNotice(null);
    }, 3500);
  };

  const mergeWebSubtitleCues = (incoming: ParsedSubtitleCue[]) => {
    if (!incoming || incoming.length === 0) return;
    const mergedMap = new Map<string, ParsedSubtitleCue>();
    for (const c of webSubtitleCuesRef.current) {
      mergedMap.set(`${Math.round(c.start * 10)}|${Math.round(c.end * 10)}|${c.text}`, c);
    }
    for (const c of incoming) {
      mergedMap.set(`${Math.round(c.start * 10)}|${Math.round(c.end * 10)}|${c.text}`, c);
    }
    webSubtitleCuesRef.current = Array.from(mergedMap.values()).sort((a, b) => a.start - b.start);
  };

  const syncActiveSubtitleAtTime = (sec: number) => {
    if (selectedSubtitleRef.current === 'Off') {
      setActiveSubtitleCue('');
      return;
    }
    if (webSubtitleCuesRef.current.length > 0) {
      const activeCues = webSubtitleCuesRef.current.filter(
        (c) => sec >= c.start && sec <= c.end
      );
      setActiveSubtitleCue(activeCues.map((c) => c.text).join('\n'));
      return;
    }
    const vid = videoRef.current;
    if (vid && vid.textTracks && vid.textTracks.length > 0) {
      let cueOut = '';
      for (let i = 0; i < vid.textTracks.length; i++) {
        const tr = vid.textTracks[i];
        if (tr.mode !== 'disabled' && tr.activeCues && tr.activeCues.length > 0) {
          const parts: string[] = [];
          for (let c = 0; c < tr.activeCues.length; c++) {
            const rawTxt = String((tr.activeCues[c] as any)?.text || '').replace(/<[^>]+>/g, '').trim();
            if (rawTxt) parts.push(rawTxt);
          }
          cueOut = parts.join('\n');
          break;
        }
      }
      setActiveSubtitleCue(cueOut);
    }
  };

  const fetchSubtitleChunk = async (
    meta: { srcUrl: string; trackIdx: number; label: string; lang?: string },
    chunkIdx: number,
    showSpinner = false
  ) => {
    if (chunkIdx < 0) return;
    if (loadedSubChunksRef.current.has(chunkIdx) || inflightSubChunksRef.current.has(chunkIdx)) return;
    inflightSubChunksRef.current.add(chunkIdx);
    if (showSpinner) setIsSubtitleLoading(true);
    try {
      const startSec = chunkIdx * SUB_CHUNK_STEP;
      const vttUrl = buildApiUrl(
        `/api/telegram/subtitles.vtt?url=${encodeURIComponent(meta.srcUrl)}&trackIdx=${meta.trackIdx}&start=${startSec}&dur=${SUB_CHUNK_DUR}&lang=${encodeURIComponent(meta.lang || meta.label)}`
      );
      const res = await fetch(vttUrl);
      if (
        !activeServerSubTrackRef.current ||
        activeServerSubTrackRef.current.trackIdx !== meta.trackIdx ||
        selectedSubtitleRef.current !== meta.label
      ) {
        return;
      }
      loadedSubChunksRef.current.add(chunkIdx);
      const statusHeader = res.headers.get('X-Subtitle-Status') || '';
      if (res.ok) {
        const text = await res.text();
        if (
          !activeServerSubTrackRef.current ||
          activeServerSubTrackRef.current.trackIdx !== meta.trackIdx ||
          selectedSubtitleRef.current !== meta.label
        ) {
          return;
        }
        const parsed = parseWebVttCues(text);
        if (parsed.length > 0) {
          mergeWebSubtitleCues(parsed);
          syncActiveSubtitleAtTime(currentTimeRef.current || 0);
        } else if (statusHeader === 'bitmap_unsupported' && webSubtitleCuesRef.current.length === 0) {
          showSubtitleNoticeBriefly('Image-based subtitles (PGS/VobSub) cannot display as web text');
        }
      }
    } catch {
    } finally {
      inflightSubChunksRef.current.delete(chunkIdx);
      if (showSpinner) setIsSubtitleLoading(false);
    }
  };

  const ensureSubtitleWindowAtTime = (timeSec: number, prefetchNext = true) => {
    const meta = activeServerSubTrackRef.current;
    if (!meta || selectedSubtitleRef.current === 'Off') return;
    const safeSec = Math.max(0, timeSec || 0);
    const curChunk = Math.floor(safeSec / SUB_CHUNK_STEP);
    if (!loadedSubChunksRef.current.has(curChunk) && !inflightSubChunksRef.current.has(curChunk)) {
      fetchSubtitleChunk(meta, curChunk, webSubtitleCuesRef.current.length === 0);
    }
    if (prefetchNext && safeSec - curChunk * SUB_CHUNK_STEP >= SUB_CHUNK_STEP - 90) {
      const nextChunk = curChunk + 1;
      if (!loadedSubChunksRef.current.has(nextChunk) && !inflightSubChunksRef.current.has(nextChunk)) {
        fetchSubtitleChunk(meta, nextChunk, false);
      }
    }
  };

  // Real Subtitle Selection
  const handleSelectSubtitle = async (label: string) => {
    setSelectedSubtitle(label);
    selectedSubtitleRef.current = label;
    setShowSubtitlesMenu(false);
    setShowLanguageMenu(false);
    setActiveSubtitleCue('');
    setSubtitleNotice(null);
    setIsSubtitleLoading(false);
    webSubtitleCuesRef.current = [];
    loadedSubChunksRef.current.clear();
    inflightSubChunksRef.current.clear();
    activeServerSubTrackRef.current = null;
    resetAutoHideTimer();

    if (label === 'Off') {
      if (exoModeActive) {
        (window as any).AndroidPlayerBridge?.exoSelectSubtitleTrack?.('off');
      }
      if (hlsRef.current) hlsRef.current.subtitleTrack = -1;
      if (videoRef.current && videoRef.current.textTracks) {
        for (let i = 0; i < videoRef.current.textTracks.length; i++) {
          videoRef.current.textTracks[i].mode = 'disabled';
        }
      }
      return;
    }

    const matched = realSubtitleTracks.find((s) => s.label === label);
    if (!matched) return;

    // Native ExoPlayer direct track ID ("group:track")
    if (exoModeActive && typeof matched.id === 'string' && matched.id.includes(':')) {
      (window as any).AndroidPlayerBridge?.exoSelectSubtitleTrack?.(String(matched.id));
      return;
    }

    if (hlsRef.current && typeof matched.id === 'number') {
      hlsRef.current.subtitleTrack = matched.id;
    }
    if (videoRef.current && videoRef.current.textTracks && videoRef.current.textTracks.length > 0 && typeof matched.id === 'number') {
      for (let i = 0; i < videoRef.current.textTracks.length; i++) {
        // Use 'hidden' so browser doesn't double-render default yellow/large box over our clean white overlay
        videoRef.current.textTracks[i].mode = i === matched.id ? 'hidden' : 'disabled';
      }
    }

    // Fetch real extracted WebVTT cues from backend in fast time-windows around playback position
    const srcUrl = activeStreamUrl.trim();
    const numericTrackIdx =
      typeof matched.id === 'number'
        ? matched.id
        : Number.isFinite(Number(matched.id))
          ? Number(matched.id)
          : -1;

    if (srcUrl && !/^(file:|blob:)/i.test(srcUrl) && numericTrackIdx >= 0) {
      const meta = {
        srcUrl,
        trackIdx: numericTrackIdx,
        label,
        lang: matched.lang || label,
      };
      activeServerSubTrackRef.current = meta;
      const curSec = Math.max(0, currentTimeRef.current || 0);
      const startChunk = Math.floor(curSec / SUB_CHUNK_STEP);
      await fetchSubtitleChunk(meta, startChunk, true);
    }
  };



  // Real Season Selection (Shows only actually uploaded seasons)
  const handleSelectSeason = (sIdx: number) => {
    resetAutoHideTimer();
    setShowSeasonDropdown(false);
    isInitialOpenStreamRef.current = false;
    hasExplicitInitialTimeRef.current = false;
    qualityResumeTargetRef.current = null;
    setActiveSeasonIdx(sIdx);

    const targetSeason = seasonsList[sIdx];
    const targetEpisodes = targetSeason?.episodes || [];
    if (targetEpisodes.length > 0) {
      const firstEp = targetEpisodes[0];
      setActiveEpisodeIdx(0);
      if (firstEp.streamUrl) {
        setActiveStreamUrl(firstEp.streamUrl);
        const sLabel = String(targetSeason.seasonNumber).padStart(2, '0');
        const eLabel = getEpisodeDisplayLabel(firstEp, 0, true);
        setCurrentEpisodeTitle(`${seriesOrMovieTitle} - S${sLabel}E${eLabel}: ${firstEp.title}`);
        if (onEpisodeChange) onEpisodeChange(sIdx, 0);
      }
    }
  };

  // Real Episode Selection (Plays that exact episode immediately)
  const handleSelectEpisode = (eIdx: number) => {
    resetAutoHideTimer();
    setShowEpisodeDropdown(false);
    isInitialOpenStreamRef.current = false;
    hasExplicitInitialTimeRef.current = false;
    qualityResumeTargetRef.current = null;
    setActiveEpisodeIdx(eIdx);

    const ep = episodesList[eIdx];
    if (ep && ep.streamUrl) {
      setActiveStreamUrl(ep.streamUrl);
      const sLabel = String(currentSeason?.seasonNumber || activeSeasonIdx + 1).padStart(2, '0');
      const eLabel = getEpisodeDisplayLabel(ep, eIdx, true);
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
          className={`relative w-full h-full ${exoModeActive ? 'bg-transparent' : 'bg-black'} flex items-center justify-center overflow-hidden cursor-pointer touch-none select-none`}
          onClick={handleViewportTap}
          onPointerDown={handleViewportPointerDown}
          onPointerMove={handleViewportPointerMove}
          onPointerUp={handleViewportPointerEnd}
          onPointerCancel={handleViewportPointerEnd}
          onTouchStart={handleViewportTouchStart}
          onTouchMove={handleViewportTouchMove}
          onTouchEnd={handleViewportTouchEnd}
          onTouchCancel={handleViewportTouchEnd}
        >
          {!isYouTube ? (
            <>
              {!canUseNativeExo && (() => {
                const isAppleDevice = isAppleMobileBrowser();
                const useHlsJsSrc = Boolean(playableUrl && /\.m3u8/i.test(playableUrl) && Hls.isSupported() && !isAppleDevice && !forceNativeIosHls);
                return (
                <video
                  key={`${playableUrl}|${manualRetryNonce}|${html5ReconnectNonce}|${forceNativeIosHls ? 'nat' : 'mse'}`}
                  ref={videoRef}
                  src={useHlsJsSrc ? undefined : (playableUrl || undefined)}
                  poster={!hasDecodedFrame && currentTime < 1.2 && posterUrl ? posterUrl : undefined}
                  playsInline
                  autoPlay
                  muted={isAutoplayMuted}
                  preload="auto"
                  controlsList="nodownload"
                  disablePictureInPicture
                  className={`w-full h-full ${objectFitClass} pointer-events-none bg-black transition-all`}
                />
                );
              })()}

              {/* Web / Non-native Brightness Dimming Overlay */}
              {!canUseNativeExo && brightnessLevel < 0.99 && (
                <div
                  className="absolute inset-0 bg-black pointer-events-none z-20 transition-opacity duration-75"
                  style={{ opacity: Math.min(0.82, Math.max(0, (1 - brightnessLevel) * 0.82)) }}
                />
              )}

              {/* Gesture HUD Overlay: Left Brightness / Right Volume */}
              {gestureHud && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-black/80 border border-white/15 backdrop-blur-md rounded-2xl px-4 py-3 min-w-[156px] flex flex-col items-center gap-2 pointer-events-none shadow-2xl">
                  <div className="flex items-center gap-2 text-white">
                    {gestureHud.type === 'brightness' ? (
                      <Sun size={20} className="text-amber-300" />
                    ) : gestureHud.percent === 0 ? (
                      <VolumeX size={20} className="text-red-400" />
                    ) : (
                      <Volume2 size={20} className="text-emerald-400" />
                    )}
                    <span className="text-xs font-bold tracking-wide">
                      {gestureHud.type === 'brightness' ? 'Brightness' : 'Volume'} {gestureHud.percent}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-75 ${
                        gestureHud.type === 'brightness' ? 'bg-amber-300' : 'bg-emerald-400'
                      }`}
                      style={{ width: `${gestureHud.percent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Double-Tap / Double-Click Seek Ripple Feedback (+10s / -10s) */}
              {seekFeedback && (
                <div
                  className={`absolute top-1/2 -translate-y-1/2 z-45 flex flex-col items-center justify-center pointer-events-none animate-in fade-in zoom-in-75 duration-150 ${
                    seekFeedback.side === 'right' ? 'right-12 sm:right-24' : 'left-12 sm:left-24'
                  }`}
                >
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-black/70 border border-white/20 backdrop-blur-md flex flex-col items-center justify-center text-white shadow-2xl">
                    {seekFeedback.side === 'right' ? (
                      <Forward10Icon className="w-8 h-8 sm:w-10 sm:h-10 text-[#00d664]" />
                    ) : (
                      <Rewind10Icon className="w-8 h-8 sm:w-10 sm:h-10 text-[#00d664]" />
                    )}
                    <span className="text-xs sm:text-sm font-black text-white mt-0.5">{seekFeedback.label}</span>
                  </div>
                </div>
              )}

              {/* Loading Indicator */}
              {isLoading && !error && !autoplayBlocked && (
                <div className="absolute inset-0 m-auto px-4 py-3 min-w-[116px] w-fit h-fit flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-sm rounded-2xl z-30 pointer-events-none">
                  <RefreshCw className="animate-spin text-white" size={26} />
                  <span className="text-xs text-white/95 font-semibold tracking-wide whitespace-nowrap">
                    {selectedQuality && selectedQuality !== 'Auto' && selectedQuality !== 'Offline'
                      ? `${selectedQuality.toLowerCase()} loading...`
                      : 'Loading...'}
                  </span>
                </div>
              )}

              {/* Subtle Unmute Pill when iPhone WebKit starts muted autoplay */}
              {isAutoplayMuted && !isLoading && !error && !isLocked && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    ensureUnmutedOnInteraction();
                    resetAutoHideTimer();
                  }}
                  className="absolute top-16 left-1/2 -translate-x-1/2 z-45 flex items-center gap-1.5 bg-black/80 hover:bg-black/95 border border-white/25 px-3.5 py-1.5 rounded-full text-white text-xs font-semibold shadow-xl backdrop-blur-md cursor-pointer active:scale-95 transition-transform"
                >
                  <VolumeX size={14} className="text-amber-400" />
                  <span>Tap for Sound</span>
                </button>
              )}

              {/* Active Subtitle Overlay (Real extracted cues only, crisp legible white text at bottom) */}
              {selectedSubtitle !== 'Off' && (activeSubtitleCue.trim() || isSubtitleLoading || subtitleNotice) && (
                <div
                  className={`absolute left-1/2 -translate-x-1/2 z-30 max-w-[92%] sm:max-w-2xl px-2 text-center pointer-events-none transition-all duration-200 ${
                    showControls && !isLocked ? 'bottom-24 sm:bottom-28' : 'bottom-4 sm:bottom-6'
                  }`}
                >
                  {activeSubtitleCue.trim() ? (
                    <span className="inline-block bg-black/55 px-3 py-1 rounded-lg text-white text-sm sm:text-base font-semibold leading-snug whitespace-pre-line [text-shadow:0_1px_4px_rgba(0,0,0,0.95),0_0_2px_rgba(0,0,0,1)]">
                      {activeSubtitleCue}
                    </span>
                  ) : subtitleNotice ? (
                    <span className="inline-block bg-black/75 border border-white/15 px-3 py-1 rounded-full text-amber-300 text-xs font-medium">
                      {subtitleNotice}
                    </span>
                  ) : isSubtitleLoading ? (
                    <span className="inline-block bg-black/70 border border-white/15 px-3 py-1 rounded-full text-white/90 text-xs font-medium">
                      Loading {selectedSubtitle} subtitles...
                    </span>
                  ) : null}
                </div>
              )}
              {/* Screen Fit Mode Momentary Toast */}
              {fitNotice && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-black/85 border border-emerald-500/50 text-emerald-400 font-bold text-xs sm:text-sm px-4 py-2 rounded-2xl shadow-2xl backdrop-blur-md pointer-events-none animate-in fade-in zoom-in-95 duration-150">
                  {fitNotice}
                </div>
              )}
              {/* Quality Change / Server Status Toast */}
              {qualityNotice && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-black/85 border border-white/20 text-white font-semibold text-xs px-4 py-2 rounded-2xl shadow-2xl backdrop-blur-md pointer-events-none">
                  {qualityNotice}
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
                        const next = !showSeasonDropdown;
                        closeOtherMenus();
                        setShowEpisodeDropdown(false);
                        setShowSeasonDropdown(next);
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
                        const next = !showEpisodeDropdown;
                        closeOtherMenus();
                        setShowSeasonDropdown(false);
                        setShowEpisodeDropdown(next);
                        resetAutoHideTimer();
                      }}
                      className="bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg px-2.5 py-1 text-xs text-white font-semibold flex items-center gap-1 backdrop-blur-md shadow-sm transition-colors cursor-pointer max-w-[150px] sm:max-w-[200px]"
                    >
                      <span className="truncate">
                        {currentEpisode
                          ? `EP ${getEpisodeDisplayLabel(currentEpisode, activeEpisodeIdx, false)}: ${currentEpisode.title}`
                          : `Episode ${activeEpisodeIdx + 1}`}
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
                              <span className="font-bold mr-1 text-neutral-400 flex-shrink-0">
                                EP {getEpisodeDisplayLabel(ep, idx, false)}:
                              </span>
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
          className={`absolute inset-0 m-auto w-fit h-fit flex items-center justify-center gap-12 sm:gap-20 z-40 transition-opacity duration-300 pointer-events-none ${
            (showControls || autoplayBlocked) && !isLocked && (!isLoading || autoplayBlocked) ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* 10-Second Rewind Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleSkip(-10);
            }}
            onPointerDown={handleControlInteractionStart}
            onPointerUp={handleControlInteractionEnd}
            onPointerCancel={handleControlInteractionEnd}
            title="Rewind 10 seconds"
            className={`text-white hover:text-white/80 flex items-center justify-center transition-transform hover:scale-110 active:scale-90 cursor-pointer drop-shadow-xl ${
              (showControls || autoplayBlocked) && !isLocked && (!isLoading || autoplayBlocked) ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
          >
            <Rewind10Icon className="w-10 h-10 sm:w-12 sm:h-12" />
          </button>

          {/* Large Center Solid White Play / Pause Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            onPointerDown={handleControlInteractionStart}
            onPointerUp={handleControlInteractionEnd}
            onPointerCancel={handleControlInteractionEnd}
            title={isPlaying ? "Pause" : "Play"}
            className={`text-white hover:text-white/80 flex items-center justify-center transition-transform hover:scale-110 active:scale-90 cursor-pointer drop-shadow-2xl ${
              (showControls || autoplayBlocked) && !isLocked && (!isLoading || autoplayBlocked) ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
          >
            {isPlaying ? (
              <Pause size={44} className="fill-white stroke-none" />
            ) : (
              <Play size={44} className="fill-white stroke-none ml-1" />
            )}
          </button>

          {/* 10-Second Forward Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleSkip(10);
            }}
            onPointerDown={handleControlInteractionStart}
            onPointerUp={handleControlInteractionEnd}
            onPointerCancel={handleControlInteractionEnd}
            title="Forward 10 seconds"
            className={`text-white hover:text-white/80 flex items-center justify-center transition-transform hover:scale-110 active:scale-90 cursor-pointer drop-shadow-xl ${
              (showControls || autoplayBlocked) && !isLocked && (!isLoading || autoplayBlocked) ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
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
                        {realSubtitleTracks
                          .filter((sub) => sub.label.trim().toLowerCase() !== 'off')
                          .map((sub) => (
                            <button
                              key={`${sub.id}-${sub.label}`}
                              type="button"
                              onClick={() => handleSelectSubtitle(sub.label)}
                              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-white/10 transition-colors flex items-center justify-between cursor-pointer ${
                                selectedSubtitle === sub.label ? 'text-emerald-400 font-bold bg-white/5' : 'text-white'
                              }`}
                            >
                              <span className="truncate">{sub.label}</span>
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
                          onClick={async () => {
                            const qLower = q.toLowerCase();
                            if (q === selectedQuality) {
                              setShowQualityMenu(false);
                              resetAutoHideTimer();
                              return;
                            }
                            const curPos = Math.max(
                              0,
                              currentTimeRef.current || 0,
                              qualityResumeTargetRef.current || 0
                            );
                            const curFloor = Math.floor(curPos);
                            lastManualQualityPickAtRef.current = Date.now();
                            exoNetworkRecoveryAttemptsRef.current = 0;
                            html5NetworkRecoveryAttemptsRef.current = 0;

                            const baseSrcUrl = (preflightCacheRef.current?.url || '').trim();
                            const rawExplicit =
                              qLower !== 'auto' &&
                              (videoQualities?.[qLower] || videoQualities?.[q] || '');
                            const trimmedExplicit = String(rawExplicit || '').trim();
                            const explicit =
                              trimmedExplicit && trimmedExplicit.replace(/\/+$/, '') !== baseSrcUrl.replace(/\/+$/, '')
                                ? trimmedExplicit
                                : '';
                            const needsScaledTranscode =
                              !explicit && (qLower === '360p' || qLower === '480p' || qLower === '720p');

                            let canScaleRemote = !Capacitor.isNativePlatform() || hasRemoteTranscodeBackend();
                            if (needsScaledTranscode && !canScaleRemote) {
                              setShowQualityMenu(false);
                              showQualityToast(`Connecting streaming server for ${q}...`);
                              await probeWorkingBackendUrl(true).catch(() => null);
                              canScaleRemote = !Capacitor.isNativePlatform() || hasRemoteTranscodeBackend();
                              if (!canScaleRemote) {
                                showQualityToast(`Server offline — unable to switch to ${q}`);
                                resetAutoHideTimer();
                                return;
                              }
                            }

                            userPickedQualityRef.current = qLower !== 'auto';
                            selectedQualityRef.current = q;
                            setSelectedQuality(q);
                            setShowQualityMenu(false);
                            resetAutoHideTimer();

                            qualityResumeTargetRef.current = curPos > 0.5 ? curPos : null;
                            resumeOffsetRef.current = curPos;

                            const baseRec = preflightCacheRef.current?.recommendedMode || 'direct';
                            if (qLower === 'auto' || (qLower === '1080p' && !explicit && baseRec !== 'transcode')) {
                              const nextStage =
                                baseRec === 'transcode'
                                  ? 'level3_transcode'
                                  : baseRec === 'remux'
                                  ? 'level2_remux'
                                  : 'level1_hw';
                              setFallbackStage(nextStage);
                              fallbackStageRef.current = nextStage;
                              setStreamFallbackMode(baseRec);
                              streamFallbackModeRef.current = baseRec;
                              setStreamStartOffset(curFloor);
                              streamStartOffsetRef.current = curFloor;
                              showQualityToast(q === 'Auto' ? 'Quality: Auto' : 'Quality: 1080P FHD');
                            } else if (explicit) {
                              setFallbackStage('level1_hw');
                              fallbackStageRef.current = 'level1_hw';
                              setStreamFallbackMode('direct');
                              streamFallbackModeRef.current = 'direct';
                              setStreamStartOffset(curFloor);
                              streamStartOffsetRef.current = curFloor;
                              showQualityToast(`Quality: ${q}`);
                            } else {
                              setFallbackStage('level3_transcode');
                              fallbackStageRef.current = 'level3_transcode';
                              setStreamFallbackMode('transcode');
                              streamFallbackModeRef.current = 'transcode';
                              setStreamStartOffset(curFloor);
                              streamStartOffsetRef.current = curFloor;
                              showQualityToast(
                                q === '360P'
                                  ? 'Switching to 360P Data Saver...'
                                  : q === '480P'
                                  ? 'Switching to 480P SD...'
                                  : q === '720P'
                                  ? 'Switching to 720P HD...'
                                  : 'Switching to 1080P FHD...'
                              );
                            }
                            setIsLoading(true);
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
