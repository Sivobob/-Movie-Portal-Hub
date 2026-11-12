import React, { useState, useEffect, useRef } from 'react';
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
  Download,
  RefreshCw,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';
import { useDownloads } from '../hooks/useDownloads';
import { buildApiUrl } from '../utils/apiConfig';

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
  onNextEpisode?: () => void;
  onPrevEpisode?: () => void;
  onEpisodeChange?: (seasonIndex: number, episodeIndex: number) => void;
  onRequestDownload?: (movie: any) => void;
}

// Custom 10-Second Rewind Icon matching reference design
function Rewind10Icon({ className = "w-7 h-7 sm:w-9 sm:h-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 5 C10.8 5 5 10.8 5 18 C5 25.2 10.8 31 18 31 C25.2 31 31 25.2 31 18 C31 12.8 28 8.3 23.5 6.2" />
      <polygon points="21,2 24.5,6.5 19.5,8.5" fill="currentColor" stroke="none" />
      <text x="18" y="21.5" textAnchor="middle" fontSize="9" fontWeight="bold" fill="currentColor" stroke="none" fontFamily="system-ui, -apple-system, sans-serif">10</text>
    </svg>
  );
}

// Custom 10-Second Forward Icon matching reference design
function Forward10Icon({ className = "w-7 h-7 sm:w-9 sm:h-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 5 C25.2 5 31 10.8 31 18 C31 25.2 25.2 31 18 31 C10.8 31 5 25.2 5 18 C5 12.8 8 8.3 12.5 6.2" />
      <polygon points="15,2 11.5,6.5 16.5,8.5" fill="currentColor" stroke="none" />
      <text x="18" y="21.5" textAnchor="middle" fontSize="9" fontWeight="bold" fill="currentColor" stroke="none" fontFamily="system-ui, -apple-system, sans-serif">10</text>
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
  onRequestDownload,
}: VideoPlayerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration);
  const [bufferedTime, setBufferedTime] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);

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

  // Real detected audio and subtitle tracks
  const [realAudioTracks, setRealAudioTracks] = useState<Array<{ id: number | string; label: string; lang?: string }>>([]);
  const [selectedAudio, setSelectedAudio] = useState<string>('Hindi');
  const [realSubtitleTracks, setRealSubtitleTracks] = useState<Array<{ id: number | string; label: string; lang?: string }>>([]);
  const [selectedSubtitle, setSelectedSubtitle] = useState<string>('Off');

  // Quality State
  const availableQualities = Object.keys(videoQualities)
    .filter((k) => typeof videoQualities[k] === 'string' && videoQualities[k].trim().length > 0)
    .sort((a, b) => (parseInt(b) || 0) - (parseInt(a) || 0));

  const [currentQuality, setCurrentQuality] = useState<string>(() => {
    return availableQualities.length > 0 ? availableQualities[0] : 'Default';
  });

  // Download integration
  const { startDownload } = useDownloads();
  const [isDownloading, setIsDownloading] = useState(false);

  // Autohide controls state & timer
  const [showControls, setShowControls] = useState(true);
  const autoHideTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  // Automatically start / reset 5-second autohide timer
  // CRITICAL REQUIREMENT: Controls disappear after exactly 5 seconds even if paused
  const resetAutoHideTimer = () => {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
    autoHideTimerRef.current = setTimeout(() => {
      setShowControls(false);
      setShowSpeedMenu(false);
      setShowAudioMenu(false);
      setShowSubtitlesMenu(false);
      setShowSettingsMenu(false);
      setShowSeasonDropdown(false);
      setShowEpisodeDropdown(false);
    }, 5000);
  };

  const showControlsWithTimer = () => {
    setShowControls(true);
    resetAutoHideTimer();
  };

  // Screen Tap Handler:
  // When hidden: tap anywhere reveals controls immediately and starts 5s timer
  // When visible: tap on the video backdrop toggles controls off immediately
  const handleViewportTap = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!showControls) {
      showControlsWithTimer();
    } else {
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      setShowControls(false);
      setShowSpeedMenu(false);
      setShowAudioMenu(false);
      setShowSubtitlesMenu(false);
      setShowSettingsMenu(false);
      setShowSeasonDropdown(false);
      setShowEpisodeDropdown(false);
    }
  };

  // Resolve playable stream URL
  const [playableUrl, setPlayableUrl] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;

    setError(null);
    setIsLoading(true);

    const activeSource = (videoQualities && videoQualities[currentQuality]) || activeStreamUrl;
    if (!activeSource || !activeSource.trim()) {
      setIsLoading(false);
      return;
    }

    const trimmed = activeSource.trim();
    const isTelegram = /t\.me|telegram\.me/i.test(trimmed);

    if (isTelegram) {
      const params = `?url=${encodeURIComponent(trimmed)}&ext=.mp4`;
      setPlayableUrl(buildApiUrl(`/api/stream${params}`));
    } else {
      setPlayableUrl(trimmed);
    }
  }, [isOpen, activeStreamUrl, currentQuality]);

  // Initial Autohide timer on open & cleanup
  useEffect(() => {
    if (isOpen) {
      showControlsWithTimer();
      setSelectedAudio(verifiedLanguage);
      try {
        window.history.pushState({ playerModalOpen: true }, '');
      } catch (e) {}
    }

    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      onClose();
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isOpen, onClose, verifiedLanguage]);

  // Fullscreen listeners
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFull = Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
      setIsFullscreen(isFull);
      if (Capacitor.isNativePlatform()) {
        try {
          if (isFull) {
            StatusBar.hide().catch(() => {});
          }
        } catch (e) {}
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Video Element & HLS Setup
  const isYouTube = /youtube\.com|youtu\.be/i.test(activeStreamUrl);

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
        // Detect HLS Audio tracks
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
        // Detect HLS Subtitles
        if (hlsInstance && hlsInstance.subtitleTracks && hlsInstance.subtitleTracks.length > 0) {
          const subTracks = hlsInstance.subtitleTracks.map((s, idx) => ({
            id: idx,
            label: s.name || s.lang || `Sub ${idx + 1}`,
            lang: s.lang
          }));
          setRealSubtitleTracks(subTracks);
        }

        video.play().catch(() => {});
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
      resetAutoHideTimer();
    };

    const onPause = () => {
      setIsPlaying(false);
      resetAutoHideTimer();
    };

    const onTimeUpdate = () => {
      const cur = video.currentTime;
      setCurrentTime(cur);

      if (cur > 10 && seriesOrMovieTitle) {
        try {
          localStorage.setItem(`resume_pos_${seriesOrMovieTitle}`, cur.toString());
        } catch (e) {}
      }

      if (video.buffered.length > 0) {
        for (let i = 0; i < video.buffered.length; i++) {
          if (video.buffered.start(i) <= cur && video.buffered.end(i) >= cur) {
            setBufferedTime(video.buffered.end(i));
            break;
          }
        }
      }
    };

    const onLoadedMetadata = () => {
      const vidDuration = video.duration;
      if (vidDuration && vidDuration !== Infinity && (duration <= 0 || vidDuration > duration)) {
        setDuration(vidDuration);
      }
      setIsLoading(false);

      // Detect HTML5 Audio Tracks if browser exposes them
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
        setSelectedAudio(detected[0]?.label || verifiedLanguage);
      } else {
        // Fallback to verified movie metadata audio language
        setRealAudioTracks([{ id: 0, label: verifiedLanguage, lang: verifiedLanguage.toLowerCase() }]);
        setSelectedAudio(verifiedLanguage);
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

      // Resume position
      if (seriesOrMovieTitle) {
        try {
          const savedPos = parseFloat(localStorage.getItem(`resume_pos_${seriesOrMovieTitle}`) || '0');
          if (savedPos > 15 && (!vidDuration || savedPos < vidDuration - 45)) {
            video.currentTime = savedPos;
            setCurrentTime(savedPos);
          }
        } catch (e) {}
      }
    };

    // Check custom header duration for remux streams
    if (playableUrl && playableUrl.includes('/api/stream')) {
      fetch(playableUrl, { method: 'HEAD' })
        .then(res => {
          const customDuration = res.headers.get('X-Video-Duration');
          if (customDuration) {
            const parsed = parseFloat(customDuration);
            if (!isNaN(parsed) && parsed > 0) setDuration(parsed);
          }
        })
        .catch(() => {});
    }

    const onWaiting = () => {
      if (video.currentTime > 0.5) setIsLoading(true);
    };

    const onPlaying = () => {
      setIsLoading(false);
      setIsPlaying(true);
      resetAutoHideTimer();
    };

    const onCanPlay = () => setIsLoading(false);
    const onLoadedData = () => setIsLoading(false);
    const onEnded = () => {
      if (seriesOrMovieTitle) {
        try {
          localStorage.removeItem(`resume_pos_${seriesOrMovieTitle}`);
        } catch (e) {}
      }
      if (onNextEpisode && hasNext) {
        onNextEpisode();
      }
    };

    const onError = () => {
      setIsLoading(false);
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

    if (!isHlsUrl && playableUrl) {
      if (video.src !== playableUrl) {
        video.src = playableUrl;
      }
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          setIsLoading(false);
          setIsPlaying(true);
        }).catch(() => {
          // Fallback muted autoplay for mobile browser policies
          video.muted = true;
          video.play().then(() => {
            setIsLoading(false);
            setIsPlaying(true);
          }).catch(() => {
            setIsLoading(false);
            setIsPlaying(false);
          });
        });
      }
    }

    const safetyTimer = setTimeout(() => setIsLoading(false), 2500);

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
  }, [playableUrl, isYouTube, seriesOrMovieTitle, verifiedLanguage]);

  // Keyboard shortcut listener (Space = play/pause, Left/Right = skip, Escape = close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      resetAutoHideTimer();
      if (e.key === 'Escape') onClose();
      else if (e.key === ' ' && !isYouTube) {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        handleSkip(-10);
      } else if (e.key === 'ArrowRight') {
        handleSkip(10);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isPlaying, isYouTube]);

  if (!isOpen) return null;

  // Real Play / Pause Control
  const togglePlay = () => {
    if (!videoRef.current) return;
    resetAutoHideTimer();
    if (!videoRef.current.paused) {
      videoRef.current.pause();
    } else {
      if (!videoRef.current.src && playableUrl) {
        videoRef.current.src = playableUrl;
      }
      videoRef.current.play().catch(() => {});
    }
  };

  // Real 10-Second Skip Control
  const handleSkip = (seconds: number) => {
    if (!videoRef.current) return;
    resetAutoHideTimer();
    const newTime = Math.max(0, Math.min(duration || 0, videoRef.current.currentTime + seconds));
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  // Real Seek via Progress Bar
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    resetAutoHideTimer();
    const time = Number(e.target.value);
    videoRef.current.currentTime = time;
    setCurrentTime(time);
  };

  // Real Fullscreen Toggle
  const toggleFullscreen = () => {
    resetAutoHideTimer();
    if (!containerRef.current) return;
    if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
      } else if ((containerRef.current as any).webkitRequestFullscreen) {
        (containerRef.current as any).webkitRequestFullscreen();
        setIsFullscreen(true);
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  // Real Audio Selection
  const handleSelectAudio = (track: { id: number | string; label: string }) => {
    setSelectedAudio(track.label);
    setShowAudioMenu(false);
    resetAutoHideTimer();

    // HLS multi-audio switch
    if (hlsRef.current && typeof track.id === 'number') {
      hlsRef.current.audioTrack = track.id;
    } else if (videoRef.current && (videoRef.current as any).audioTracks) {
      const audioTracksApi = (videoRef.current as any).audioTracks;
      for (let i = 0; i < audioTracksApi.length; i++) {
        audioTracksApi[i].enabled = (i === track.id);
      }
    }
  };

  // Real Subtitle Selection
  const handleSelectSubtitle = (label: string) => {
    setSelectedSubtitle(label);
    setShowSubtitlesMenu(false);
    resetAutoHideTimer();

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

  // Real Quality Change
  const handleQualityChange = (quality: string) => {
    if (quality === currentQuality) return;
    const time = videoRef.current?.currentTime || 0;
    const wasPlaying = isPlaying;

    setCurrentQuality(quality);
    setShowSettingsMenu(false);
    setIsLoading(true);
    resetAutoHideTimer();

    const onLoaded = () => {
      if (videoRef.current) {
        videoRef.current.currentTime = time;
        if (wasPlaying) videoRef.current.play().catch(() => {});
      }
      videoRef.current?.removeEventListener('loadedmetadata', onLoaded);
    };
    videoRef.current?.addEventListener('loadedmetadata', onLoaded);
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
        setCurrentEpisodeTitle(`${seriesOrMovieTitle} - S0${targetSeason.seasonNumber}E0${firstEp.episodeNumber}: ${firstEp.title}`);
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
      setCurrentEpisodeTitle(`${seriesOrMovieTitle} - S0${currentSeason?.seasonNumber}E0${ep.episodeNumber}: ${ep.title}`);
      if (onEpisodeChange) onEpisodeChange(activeSeasonIdx, eIdx);
    }
  };

  // Real Download Handling
  const handleDownload = () => {
    if (!activeStreamUrl) return;
    if (onRequestDownload) {
      onRequestDownload({
        title: currentEpisodeTitle,
        posterUrl,
        streamingUrl: playableUrl || activeStreamUrl,
        displayCategory: displayCat,
        videoQualities,
      });
      return;
    }
    if (isDownloading) return;
    setIsDownloading(true);
    startDownload({
      title: currentEpisodeTitle,
      posterUrl: posterUrl || '',
      videoUrl: playableUrl || activeStreamUrl,
      quality: currentQuality || '720p HD',
      originalCategory: displayCat,
    });
    setTimeout(() => setIsDownloading(false), 2000);
  };

  // Format Time into hh:mm:ss or mm:ss
  const formatTime = (secs: number) => {
    if (isNaN(secs) || !isFinite(secs) || secs < 0) return '00:00';
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col justify-between select-none overflow-hidden">
      <div
        ref={containerRef}
        className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden"
      >
        {/* TV Cast Modal */}
        <TVCastModal
          isOpen={showTVCastModal}
          onClose={() => setShowTVCastModal(false)}
          title={currentEpisodeTitle}
          videoUrl={playableUrl || activeStreamUrl}
        />

        {/* Video Screen Viewport */}
        <div
          className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden cursor-pointer"
          onClick={handleViewportTap}
        >
          {!isYouTube ? (
            <>
              <video
                key={playableUrl}
                ref={videoRef}
                src={playableUrl || undefined}
                playsInline
                preload="auto"
                className="w-full h-full object-contain pointer-events-none"
              />

              {/* Loading Indicator */}
              {isLoading && (
                <div className="absolute inset-0 m-auto w-24 h-24 flex flex-col items-center justify-center gap-2 bg-black/60 backdrop-blur-md rounded-2xl z-25 pointer-events-none shadow-2xl">
                  <RefreshCw className="animate-spin text-yellow-400" size={28} />
                  <span className="text-[11px] text-gray-200 font-bold tracking-wide">Buffering</span>
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

        {/* TOP BAR OVERLAY */}
        <div
          onClick={(e) => { e.stopPropagation(); resetAutoHideTimer(); }}
          className={`absolute top-0 left-0 w-full bg-gradient-to-b from-black/90 via-black/50 to-transparent p-4 sm:p-6 flex items-center justify-between z-40 transition-opacity duration-300 ${
            showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Top-Left: Back Arrow, Title, Subtitle, and Season/Episode Selectors on the SAME horizontal row */}
          <div className="flex items-center gap-2.5 sm:gap-4 max-w-[70%] sm:max-w-[75%] min-w-0">
            <button
              type="button"
              onClick={onClose}
              title="Back"
              className="p-1.5 sm:p-2 text-white hover:text-yellow-400 rounded-full hover:bg-white/10 transition-colors flex-shrink-0 cursor-pointer"
            >
              <ArrowLeft size={24} className="sm:w-7 sm:h-7 stroke-[2.5]" />
            </button>

            <div className="flex items-center gap-2 sm:gap-3 flex-wrap min-w-0">
              <div className="min-w-0">
                <h3 className="text-base sm:text-xl font-bold text-white tracking-wide truncate max-w-[150px] sm:max-w-xs drop-shadow-md">
                  {seriesOrMovieTitle}
                </h3>
                <p className="text-[11px] sm:text-xs text-neutral-300 font-medium truncate">
                  {subtitleLine}
                </p>
              </div>

              {/* SERIES SELECTORS: Shown only for series, positioned directly beside the Series Name */}
              {isSeries && seasonsList.length > 0 && (
                <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                  {/* Season Dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setShowSeasonDropdown(!showSeasonDropdown);
                        setShowEpisodeDropdown(false);
                        setShowSpeedMenu(false);
                        setShowAudioMenu(false);
                        setShowSubtitlesMenu(false);
                        setShowSettingsMenu(false);
                        resetAutoHideTimer();
                      }}
                      className="bg-neutral-900/85 hover:bg-neutral-800 border border-neutral-700/80 rounded-lg px-2.5 py-1 sm:px-3 sm:py-1.5 text-xs text-white font-semibold flex items-center gap-1.5 backdrop-blur-md shadow-md transition-colors cursor-pointer"
                    >
                      <span>Season {currentSeason?.seasonNumber || (activeSeasonIdx + 1)}</span>
                      <ChevronDown size={14} className={`transition-transform duration-200 ${showSeasonDropdown ? 'rotate-180 text-yellow-400' : 'text-neutral-400'}`} />
                    </button>

                    {showSeasonDropdown && (
                      <div className="absolute top-full left-0 mt-2 bg-neutral-900/95 border border-neutral-700 rounded-xl shadow-2xl py-1 min-w-[130px] max-h-60 overflow-y-auto backdrop-blur-lg z-50">
                        <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-800">
                          Seasons ({seasonsList.length})
                        </div>
                        {seasonsList.map((s: any, idx: number) => (
                          <button
                            key={s.seasonNumber || idx}
                            type="button"
                            onClick={() => handleSelectSeason(idx)}
                            className={`w-full text-left px-3 py-2 text-xs hover:bg-yellow-400 hover:text-black transition-colors flex items-center justify-between cursor-pointer ${
                              activeSeasonIdx === idx ? 'text-yellow-400 font-bold bg-white/5' : 'text-white'
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
                        setShowSpeedMenu(false);
                        setShowAudioMenu(false);
                        setShowSubtitlesMenu(false);
                        setShowSettingsMenu(false);
                        resetAutoHideTimer();
                      }}
                      className="bg-neutral-900/85 hover:bg-neutral-800 border border-neutral-700/80 rounded-lg px-2.5 py-1 sm:px-3 sm:py-1.5 text-xs text-white font-semibold flex items-center gap-1.5 backdrop-blur-md shadow-md transition-colors cursor-pointer max-w-[160px] sm:max-w-[200px]"
                    >
                      <span className="truncate">
                        {currentEpisode ? `EP ${currentEpisode.episodeNumber}: ${currentEpisode.title}` : `Episode ${activeEpisodeIdx + 1}`}
                      </span>
                      <ChevronDown size={14} className={`flex-shrink-0 transition-transform duration-200 ${showEpisodeDropdown ? 'rotate-180 text-yellow-400' : 'text-neutral-400'}`} />
                    </button>

                    {showEpisodeDropdown && (
                      <div className="absolute top-full left-0 mt-2 bg-neutral-900/95 border border-neutral-700 rounded-xl shadow-2xl py-1 min-w-[200px] max-w-xs max-h-64 overflow-y-auto backdrop-blur-lg z-50">
                        <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-800">
                          Season {currentSeason?.seasonNumber} Episodes ({episodesList.length})
                        </div>
                        {episodesList.map((ep: any, idx: number) => (
                          <button
                            key={ep.episodeNumber || idx}
                            type="button"
                            onClick={() => handleSelectEpisode(idx)}
                            className={`w-full text-left px-3 py-2.5 text-xs hover:bg-yellow-400 hover:text-black transition-colors flex items-center justify-between gap-2 cursor-pointer border-b border-neutral-800/40 last:border-0 ${
                              activeEpisodeIdx === idx ? 'text-yellow-400 font-bold bg-white/5' : 'text-white'
                            }`}
                          >
                            <div className="truncate min-w-0">
                              <span className="font-bold mr-1.5 text-neutral-400">EP {ep.episodeNumber}:</span>
                              <span>{ep.title}</span>
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

          {/* Top-Right: Fullscreen Only */}
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              className="p-2 rounded-full hover:bg-white/10 text-white hover:text-yellow-400 transition-colors cursor-pointer"
            >
              {isFullscreen ? <Minimize size={22} className="stroke-[2.2]" /> : <Maximize size={22} className="stroke-[2.2]" />}
            </button>
          </div>
        </div>

        {/* CENTER CONTROLS: 10s Rewind, Play/Pause, 10s Forward */}
        <div
          onClick={(e) => { e.stopPropagation(); resetAutoHideTimer(); }}
          className={`absolute inset-0 m-auto w-fit h-fit flex items-center justify-center gap-6 sm:gap-12 z-40 transition-opacity duration-300 ${
            showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* 10-Second Rewind Button */}
          <button
            type="button"
            onClick={() => handleSkip(-10)}
            title="Rewind 10 seconds"
            className="w-14 h-14 sm:w-18 sm:h-18 rounded-full bg-black/55 hover:bg-black/75 backdrop-blur-md border border-white/15 text-white hover:text-yellow-400 flex items-center justify-center transition-transform hover:scale-110 active:scale-95 shadow-2xl cursor-pointer"
          >
            <Rewind10Icon />
          </button>

          {/* Large Center Play / Pause Button */}
          <button
            type="button"
            onClick={togglePlay}
            title={isPlaying ? "Pause" : "Play"}
            className="w-18 h-18 sm:w-22 sm:h-22 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-transform hover:scale-105 active:scale-95 shadow-2xl cursor-pointer"
          >
            {isPlaying ? (
              <Pause size={32} className="sm:w-10 sm:h-10 fill-white stroke-none" />
            ) : (
              <Play size={32} className="sm:w-10 sm:h-10 fill-white stroke-none ml-1" />
            )}
          </button>

          {/* 10-Second Forward Button */}
          <button
            type="button"
            onClick={() => handleSkip(10)}
            title="Forward 10 seconds"
            className="w-14 h-14 sm:w-18 sm:h-18 rounded-full bg-black/55 hover:bg-black/75 backdrop-blur-md border border-white/15 text-white hover:text-yellow-400 flex items-center justify-center transition-transform hover:scale-110 active:scale-95 shadow-2xl cursor-pointer"
          >
            <Forward10Icon />
          </button>
        </div>

        {/* BOTTOM CONTROLS OVERLAY: Progress Bar, Speed, Audio, Subtitles, Fullscreen */}
        <div
          onClick={(e) => { e.stopPropagation(); resetAutoHideTimer(); }}
          className={`absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/95 via-black/70 to-transparent p-4 sm:p-6 pb-6 sm:pb-8 space-y-3 sm:space-y-4 z-40 transition-opacity duration-300 ${
            showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Progress Bar with Current Time and Total Duration */}
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="text-xs sm:text-sm font-semibold text-white w-14 sm:w-16 text-right tabular-nums select-none">
              {formatTime(currentTime)}
            </span>

            <div className="relative flex-grow h-1.5 sm:h-2 bg-neutral-700/80 rounded-full group cursor-pointer">
              <input
                type="range"
                min="0"
                max={duration || 100}
                value={currentTime}
                onChange={handleSeek}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-30"
              />
              {/* Buffered progress */}
              <div
                className="absolute h-full bg-white/25 rounded-full pointer-events-none"
                style={{ width: `${(bufferedTime / (duration || 100)) * 100}%` }}
              />
              {/* Played progress (Yellow) */}
              <div
                className="absolute h-full bg-yellow-400 rounded-full pointer-events-none z-10"
                style={{ width: `${(currentTime / (duration || 100)) * 100}%` }}
              />
              {/* Yellow Scrubber Handle */}
              <div
                className="absolute h-4 w-4 sm:h-4.5 sm:w-4.5 bg-yellow-400 rounded-full -top-[5px] shadow-lg pointer-events-none transition-transform group-hover:scale-125 z-20"
                style={{ left: `calc(${(currentTime / (duration || 100)) * 100}% - 8px)` }}
              />
            </div>

            <span className="text-xs sm:text-sm font-semibold text-white w-14 sm:w-16 tabular-nums select-none">
              {formatTime(duration)}
            </span>
          </div>

          {/* Bottom Action Controls: Speed (left), Audio, Subtitles, Fullscreen (right) */}
          <div className="flex items-center justify-between gap-3">
            {/* Playback Speed Pill */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowSpeedMenu(!showSpeedMenu);
                  setShowAudioMenu(false);
                  setShowSubtitlesMenu(false);
                  setShowSettingsMenu(false);
                  resetAutoHideTimer();
                }}
                className="bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-700/70 rounded-full px-3.5 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium text-white flex items-center gap-1.5 sm:gap-2 shadow-lg backdrop-blur-md cursor-pointer transition-colors"
              >
                <Gauge size={16} className="text-neutral-300" />
                <span>{playbackSpeed}x</span>
                <ChevronDown size={14} className={`text-neutral-400 transition-transform ${showSpeedMenu ? 'rotate-180 text-yellow-400' : ''}`} />
              </button>

              {/* Speed Popover Menu */}
              {showSpeedMenu && (
                <div className="absolute bottom-full left-0 mb-2 bg-neutral-900/95 border border-neutral-700 rounded-xl shadow-2xl py-1 min-w-[120px] backdrop-blur-lg z-50">
                  <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-800">
                    Playback Speed
                  </div>
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      onClick={() => {
                        setPlaybackSpeed(spd);
                        if (videoRef.current) videoRef.current.playbackRate = spd;
                        setShowSpeedMenu(false);
                        resetAutoHideTimer();
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-yellow-400 hover:text-black transition-colors flex items-center justify-between cursor-pointer ${
                        playbackSpeed === spd ? 'text-yellow-400 font-bold bg-white/5' : 'text-white'
                      }`}
                    >
                      <span>{spd}x</span>
                      {playbackSpeed === spd && <Check size={14} className="stroke-[3]" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right Controls: Audio, Subtitles, Fullscreen */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Audio Language Pill */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowAudioMenu(!showAudioMenu);
                    setShowSubtitlesMenu(false);
                    setShowSpeedMenu(false);
                    setShowSettingsMenu(false);
                    resetAutoHideTimer();
                  }}
                  className="bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-700/70 rounded-full px-3.5 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium text-white flex items-center gap-1.5 sm:gap-2 shadow-lg backdrop-blur-md cursor-pointer transition-colors"
                >
                  <Volume2 size={16} className="text-neutral-300" />
                  <span>Audio: {selectedAudio || 'Hindi'}</span>
                  <ChevronDown size={14} className={`text-neutral-400 transition-transform ${showAudioMenu ? 'rotate-180 text-yellow-400' : ''}`} />
                </button>

                {/* Audio Tracks Popover */}
                {showAudioMenu && (
                  <div className="absolute bottom-full right-0 mb-2 bg-neutral-900/95 border border-neutral-700 rounded-xl shadow-2xl py-1 min-w-[170px] backdrop-blur-lg z-50">
                    <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-800">
                      Audio Tracks
                    </div>
                    {realAudioTracks.length > 0 ? (
                      realAudioTracks.map((trk) => (
                        <button
                          key={trk.label}
                          type="button"
                          onClick={() => handleSelectAudio(trk)}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-yellow-400 hover:text-black transition-colors flex items-center justify-between cursor-pointer ${
                            selectedAudio === trk.label ? 'text-yellow-400 font-bold bg-white/5' : 'text-white'
                          }`}
                        >
                          <span>{trk.label}</span>
                          {selectedAudio === trk.label && <Check size={14} className="stroke-[3]" />}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-xs text-neutral-400">
                        1 Audio Track ({selectedAudio || 'Hindi'})
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Subtitles Language Pill */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowSubtitlesMenu(!showSubtitlesMenu);
                    setShowAudioMenu(false);
                    setShowSpeedMenu(false);
                    setShowSettingsMenu(false);
                    resetAutoHideTimer();
                  }}
                  className="bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-700/70 rounded-full px-3.5 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium text-white flex items-center gap-1.5 sm:gap-2 shadow-lg backdrop-blur-md cursor-pointer transition-colors"
                >
                  <Captions size={16} className="text-neutral-300" />
                  <span>Subtitles: {selectedSubtitle}</span>
                  <ChevronDown size={14} className={`text-neutral-400 transition-transform ${showSubtitlesMenu ? 'rotate-180 text-yellow-400' : ''}`} />
                </button>

                {/* Subtitles Popover */}
                {showSubtitlesMenu && (
                  <div className="absolute bottom-full right-0 mb-2 bg-neutral-900/95 border border-neutral-700 rounded-xl shadow-2xl py-1 min-w-[190px] backdrop-blur-lg z-50">
                    <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-800">
                      Subtitles (CC)
                    </div>
                    {/* Subtitle Off Option */}
                    <button
                      type="button"
                      onClick={() => handleSelectSubtitle('Off')}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-yellow-400 hover:text-black transition-colors flex items-center justify-between cursor-pointer ${
                        selectedSubtitle === 'Off' ? 'text-yellow-400 font-bold bg-white/5' : 'text-white'
                      }`}
                    >
                      <span>Off</span>
                      {selectedSubtitle === 'Off' && <Check size={14} className="stroke-[3]" />}
                    </button>

                    {realSubtitleTracks.length > 0 ? (
                      realSubtitleTracks.map((sub) => (
                        <button
                          key={sub.label}
                          type="button"
                          onClick={() => handleSelectSubtitle(sub.label)}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-yellow-400 hover:text-black transition-colors flex items-center justify-between cursor-pointer ${
                            selectedSubtitle === sub.label ? 'text-yellow-400 font-bold bg-white/5' : 'text-white'
                          }`}
                        >
                          <span>{sub.label}</span>
                          {selectedSubtitle === sub.label && <Check size={14} className="stroke-[3]" />}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-xs text-neutral-400 italic">
                        No subtitles available
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Settings Gear Icon */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowSettingsMenu(!showSettingsMenu);
                    setShowAudioMenu(false);
                    setShowSubtitlesMenu(false);
                    setShowSpeedMenu(false);
                    setShowSeasonDropdown(false);
                    setShowEpisodeDropdown(false);
                    resetAutoHideTimer();
                  }}
                  title="Settings"
                  className={`bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-700/70 text-white hover:text-yellow-400 p-2 sm:px-3 sm:py-2 rounded-xl text-xs sm:text-sm flex items-center justify-center shadow-lg backdrop-blur-md cursor-pointer transition-colors ${
                    showSettingsMenu ? 'text-yellow-400' : ''
                  }`}
                >
                  <Settings size={18} />
                </button>

                {/* Settings Popover Menu */}
                {showSettingsMenu && (
                  <div className="absolute bottom-full right-0 mb-2 bg-neutral-900/95 border border-neutral-700 rounded-2xl shadow-2xl p-3 min-w-[220px] backdrop-blur-xl z-50 text-white space-y-2.5">
                    <div className="px-2 py-1 text-[11px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-800">
                      Player Settings
                    </div>

                    {/* Quality Selector if multiple available */}
                    {availableQualities.length > 0 && (
                      <div className="px-1">
                        <div className="text-xs text-neutral-300 font-semibold mb-1.5">Stream Quality</div>
                        <div className="grid grid-cols-3 gap-1">
                          {availableQualities.map((q) => (
                            <button
                              key={q}
                              type="button"
                              onClick={() => handleQualityChange(q)}
                              className={`px-2 py-1 text-xs rounded-lg font-bold transition-colors cursor-pointer ${
                                currentQuality === q ? 'bg-yellow-400 text-black' : 'bg-neutral-800 hover:bg-neutral-700 text-white'
                              }`}
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Cast to Smart TV */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowSettingsMenu(false);
                        setShowTVCastModal(true);
                        resetAutoHideTimer();
                      }}
                      className="w-full text-left px-2 py-2 rounded-lg text-xs font-semibold hover:bg-white/10 flex items-center gap-2.5 cursor-pointer transition-colors"
                    >
                      <Tv size={16} className="text-yellow-400 flex-shrink-0" />
                      <span>Cast to TV / Chromecast</span>
                    </button>

                    {/* Download Video (Movies Only) */}
                    {!isSeries && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowSettingsMenu(false);
                          handleDownload();
                          resetAutoHideTimer();
                        }}
                        className="w-full text-left px-2 py-2 rounded-lg text-xs font-semibold hover:bg-white/10 flex items-center gap-2.5 cursor-pointer transition-colors"
                      >
                        <Download size={16} className="text-yellow-400 flex-shrink-0" />
                        <span>Download</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Fullscreen Button */}
              <button
                type="button"
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                className="bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-700/70 text-white hover:text-yellow-400 p-2 sm:px-3 sm:py-2 rounded-xl text-xs sm:text-sm flex items-center justify-center shadow-lg backdrop-blur-md cursor-pointer transition-colors"
              >
                {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
