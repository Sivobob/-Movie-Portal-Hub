/**
 * Upgrades low-resolution IMDb/OMDb/TMDB/Unsplash poster URLs to crisp high-definition
 * variants without cropping or distortion.
 */
export function upgradePosterUrl(rawUrl?: string | null, targetWidth = 1080): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim();
  if (!url || url === 'N/A') return '';

  // Upgrade insecure Amazon/IMDb CDN URLs to HTTPS
  if (/^http:\/\/([^/]*\.)?(media-amazon\.com|media-imdb\.com|images-amazon\.com)/i.test(url)) {
    url = url.replace(/^http:\/\//i, 'https://');
  }

  // Amazon / IMDb CDN (m.media-amazon.com, ia.media-imdb.com, etc.)
  // Examples:
  //   ..._V1_SX300.jpg
  //   ..._V1_QL75_UX380_CR0,0,380,562_.jpg
  //   ..._V1_.jpg (which can be 15MB+ 6000px raw images)
  if (/(media-amazon\.com|media-imdb\.com|images-amazon\.com)/i.test(url) || /\._V1/i.test(url)) {
    const hdSuffix = `._V1_QL90_UX${targetWidth}_.jpg`;
    if (/\._V1[^/]*\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url)) {
      return url.replace(/\._V1[^/]*\.(jpg|jpeg|png|webp)(\?.*)?$/i, hdSuffix);
    }
    if (/(@+)\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url)) {
      return url.replace(/(@+)\.(jpg|jpeg|png|webp)(\?.*)?$/i, `$1${hdSuffix}`);
    }
  }

  // TMDB CDN (upgrade w200/w300/w342/w500 to crisp HD w780 or original)
  if (/image\.tmdb\.org\/t\/p\/(w\d+|original)\//i.test(url)) {
    const tmdbSize = targetWidth >= 1200 ? 'original' : 'w780';
    return url.replace(/\/t\/p\/(w\d+|original)\//i, `/t/p/${tmdbSize}/`);
  }

  // Unsplash fallback URLs
  if (/images\.unsplash\.com/i.test(url)) {
    let updated = url;
    if (/[?&]w=\d+/i.test(updated)) {
      updated = updated.replace(/([?&])w=\d+/i, `$1w=${Math.max(targetWidth, 1080)}`);
    }
    if (/[?&]q=\d+/i.test(updated)) {
      updated = updated.replace(/([?&])q=\d+/i, '$1q=90');
    }
    return updated;
  }

  return url;
}

export function normalizeMoviePosters<T extends Record<string, any>>(movie: T): T {
  if (!movie) return movie;
  const hdPoster = upgradePosterUrl(movie.posterUrl, 1080);
  const hdBackdrop = upgradePosterUrl(movie.backdropUrl || movie.posterUrl, 1200);
  return {
    ...movie,
    posterUrl: hdPoster || movie.posterUrl || '',
    backdropUrl: hdBackdrop || movie.backdropUrl || hdPoster || movie.posterUrl || '',
  };
}
