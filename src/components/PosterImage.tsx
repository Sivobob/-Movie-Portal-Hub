import React, { useEffect, useMemo, useState } from 'react';
import { Film, Tv } from 'lucide-react';
import { upgradePosterUrl } from '../utils/posterUrl';

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

export default function PosterImage({
  posterUrl,
  backdropUrl,
  title,
  year,
  width = 400,
  alt,
  className = 'w-full h-full object-cover',
  loading = 'lazy',
  decoding = 'async',
  draggable = false,
  isSeries = false,
  compactFallback = false,
}: PosterImageProps) {
  const candidates = useMemo(() => {
    const rawList: string[] = [];
    const add = (u?: string | null) => {
      const s = typeof u === 'string' ? u.trim() : '';
      if (s && s !== 'N/A' && !rawList.includes(s)) {
        rawList.push(s);
      }
    };
    if (posterUrl) {
      add(upgradePosterUrl(posterUrl, width));
      add(posterUrl);
    }
    if (backdropUrl) {
      add(upgradePosterUrl(backdropUrl, width));
      add(backdropUrl);
    }
    return rawList;
  }, [posterUrl, backdropUrl, width]);

  const [attemptIdx, setAttemptIdx] = useState(0);

  useEffect(() => {
    setAttemptIdx(0);
  }, [posterUrl, backdropUrl, width]);

  const activeSrc = attemptIdx < candidates.length ? candidates[attemptIdx] : '';

  if (!activeSrc) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-neutral-900 via-neutral-950 to-black flex flex-col items-center justify-center p-2.5 text-center select-none">
        {isSeries ? (
          <Tv size={compactFallback ? 18 : 26} className="text-neutral-600 mb-1.5 flex-shrink-0" />
        ) : (
          <Film size={compactFallback ? 18 : 26} className="text-neutral-600 mb-1.5 flex-shrink-0" />
        )}
        {!compactFallback && title && (
          <p className="text-[11px] font-bold text-neutral-300 line-clamp-3 leading-snug">
            {title}
          </p>
        )}
        {!compactFallback && year && (
          <span className="mt-1 text-[9px] font-semibold text-neutral-500">
            {year}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
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
