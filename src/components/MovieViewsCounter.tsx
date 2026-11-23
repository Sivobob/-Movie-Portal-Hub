import React from 'react';
import { Eye } from 'lucide-react';
import { formatCompactViews, getNormalizedViewsCount } from '../services/movieViewsService';

interface MovieViewsCounterProps {
  movie?: any;
  count?: number | null;
  showLabel?: boolean;
  className?: string;
}

export default function MovieViewsCounter({
  movie,
  count,
  showLabel = false,
  className = '',
}: MovieViewsCounterProps) {
  const resolvedCount =
    typeof count === 'number' && Number.isFinite(count)
      ? Math.max(0, Math.floor(count))
      : getNormalizedViewsCount(movie);

  const exactLabel = `${resolvedCount.toLocaleString()} ${
    resolvedCount === 1 ? 'user' : 'users'
  } watched`;

  if (showLabel) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-neutral-300 font-medium tabular-nums whitespace-nowrap flex-shrink-0 ${className}`}
        title={exactLabel}
        aria-label={exactLabel}
      >
        <Eye size={12} className="text-neutral-400 flex-shrink-0" />
        <span>
          {resolvedCount.toLocaleString()} {resolvedCount === 1 ? 'watch' : 'watches'}
        </span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-semibold text-neutral-400 tabular-nums whitespace-nowrap flex-shrink-0 leading-none ${className}`}
      title={exactLabel}
      aria-label={exactLabel}
    >
      <Eye size={11} className="text-neutral-400/90 flex-shrink-0" />
      <span>{formatCompactViews(resolvedCount)}</span>
    </span>
  );
}
