import React, { useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Film, Tv } from 'lucide-react';
import { upgradePosterUrl } from '../utils/posterUrl';
import { buildApiUrl, getRemoteTranscodeBackendUrl } from '../utils/apiConfig';

interface PosterImageProps {
  posterUrl?: string | null;
  backdropUrl?: string | null;
  title?: string;
  year?: string | number;
  width?: number;
  alt?: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  draggable?: boolean;
  isSeries?: boolean;
  compactFallback?: boolean;
}

const ALLOWED_PROXY_HOST_RE = /^https?:\/\/([^/]*\.)?(media-amazon\.com|media-imdb\.com|images-amazon\.com|upload\.wikimedia\.org|image\.tmdb\.org|images\.unsplash\.com|static\.toiimg\.com|mzstatic\.com)\//i;

export default function PosterImage({
  posterUrl,
  backdropUrl,
  title,
  year,
  width = 420,
  alt,
  className = 'w-full h-full object-cover',
  loading = 'eager',
  decoding = 'async',
  draggable = false,
  isSeries = false,
  compactFallback = false,
}: PosterImageProps) {
  const candidates = useMemo(() => {
    const rawList: string[] = [];
    const svgFallbacks: string[] = [];
    const add = (u?: string | null) => {
      const s = typeof u === 'string' ? u.trim() : '';
      if (!s || s === 'N/A') return;
      if (s.startsWith('data:image/svg+xml')) {
        if (!svgFallbacks.includes(s)) svgFallbacks.push(s);
        return;
      }
      if (!rawList.includes(s)) {
        rawList.push(s);
      }
    };

    const addWithVariants = (u?: string | null) => {
      const s = typeof u === 'string' ? u.trim() : '';
      if (!s || s === 'N/A') return;
      if (s.startsWith('/posters/')) {
        add(s);
        const remoteUrl = buildApiUrl(s);
        if (remoteUrl && remoteUrl !== s && /^https?:\/\/(?!127\.0\.0\.1|localhost)/i.test(remoteUrl)) {
          add(remoteUrl);
        }
        return;
      }
      const primary = upgradePosterUrl(s, width);
      add(primary);
      if (/(media-amazon\.com|media-imdb\.com|images-amazon\.com)/i.test(s) && width > 320) {
        add(upgradePosterUrl(s, 300));
      }
      add(s);
    };

    if (posterUrl) addWithVariants(posterUrl);
    if (backdropUrl) addWithVariants(backdropUrl);

    const isNative = Capacitor.isNativePlatform();
    const remoteBackend = isNative ? getRemoteTranscodeBackendUrl() : '';
    if (!isNative || remoteBackend) {
      const primaryHttp = rawList.find((u) => ALLOWED_PROXY_HOST_RE.test(u));
      if (primaryHttp) {
        const proxyPath = `/api/metadata/poster-proxy?url=${encodeURIComponent(primaryHttp)}`;
        add(isNative && remoteBackend ? `${remoteBackend}${proxyPath}` : proxyPath);
      }
    }

    return rawList.length > 0 ? rawList : svgFallbacks;
  }, [posterUrl, backdropUrl, width]);

  const [attemptIdx, setAttemptIdx] = useState(0);
  const [retryCycle, setRetryCycle] = useState(0);

  useEffect(() => {
    setAttemptIdx(0);
    setRetryCycle(0);
  }, [posterUrl, backdropUrl, width]);

  const exhausted = attemptIdx >= candidates.length;

  useEffect(() => {
    if (!exhausted || candidates.length === 0) return;

    const handleOnline = () => {
      setAttemptIdx(0);
      setRetryCycle((c) => c + 1);
    };
    window.addEventListener('online', handleOnline);

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (retryCycle < 2) {
      const delayMs = retryCycle === 0 ? 1200 : 3500;
      timer = setTimeout(() => {
        setAttemptIdx(0);
        setRetryCycle((c) => c + 1);
      }, delayMs);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      if (timer) clearTimeout(timer);
    };
  }, [exhausted, retryCycle, candidates.length]);

  const activeSrc = !exhausted ? candidates[attemptIdx] : '';

  if (!activeSrc || exhausted) {
    return (
      <div className="w-full h-full bg-gradient-to-tr from-neutral-950 via-neutral-900 to-emerald-950 flex flex-col items-center justify-center p-3 text-center select-none relative overflow-hidden shadow-inner">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.18),transparent_70%)]" />
        <div className="w-12 h-12 rounded-2xl bg-neutral-900/90 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-2 shadow-lg z-10">
          {isSeries ? <Tv size={compactFallback ? 16 : 24} /> : <Film size={compactFallback ? 16 : 24} />}
        </div>
        {!compactFallback && title && (
          <p className="text-xs font-black text-white line-clamp-3 leading-snug drop-shadow z-10 px-1">
            {title}
          </p>
        )}
        {!compactFallback && (
          <span className="mt-1 text-[10px] font-bold text-emerald-400/90 tracking-wide z-10">
            {year || '2026'} • Movie Hub
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      key={`${attemptIdx}-${retryCycle}`}
      src={activeSrc}
      alt={alt || title || 'Poster'}
      loading={loading}
      decoding={decoding}
      draggable={draggable}
      referrerPolicy="no-referrer"
      className={className}
      onError={() => {
        setAttemptIdx((prev) => prev + 1);
      }}
    />
  );
}
