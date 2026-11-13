import express from 'express';
import type { Request, Response } from 'express';
import { requireAdmin, AuthRequest } from './authMiddleware.ts';
import { upgradePosterUrl } from '../utils/posterUrl.ts';

const router = express.Router();

function getApiKey(): { key: string; isCustom: boolean } {
  const custom = process.env.OMDB_API_KEY || process.env.VITE_OMDB_API_KEY;
  if (custom && custom.trim().length > 0) {
    return { key: custom.trim(), isCustom: true };
  }
  // Default working key for OMDb
  return { key: 'trilogy', isCustom: false };
}

/**
 * Extracts year from a query like "Inception (2010)" or "Batman 1989"
 */
function extractYear(query: string): { title: string; year: string | null } {
  const yearMatch = query.match(/\(?(\d{4})\)?/);
  if (yearMatch) {
    const year = yearMatch[1];
    const title = query.replace(yearMatch[0], '').trim();
    return { title, year };
  }
  return { title: query, year: null };
}

router.get('/test-auth', requireAdmin, (req: AuthRequest, res: Response) => {
  res.json({
    message: 'Authentication successful',
    user: {
      uid: req.user?.uid,
      email: req.user?.email,
      admin: !!req.user?.admin
    }
  });
});

/**
 * Service Status Endpoint
 */
router.get('/status', async (_req: Request, res: Response) => {
  const { key, isCustom } = getApiKey();
  try {
    const testRes = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&i=tt0133093`);
    const testData = await testRes.json();
    
    if (testData.Response === 'True') {
      return res.json({
        status: 'connected',
        provider: isCustom ? 'OMDb (Custom Key)' : 'OMDb API',
        message: 'OMDb metadata service online and operational',
        configured: true
      });
    }

    if (testData.Error === 'Request limit reached!') {
      return res.json({
        status: 'limit_reached',
        provider: 'OMDb API',
        message: 'OMDb daily request limit reached. Set OMDB_API_KEY in environment for custom limits.',
        configured: false
      });
    }

    if (testData.Error === 'Invalid API key!') {
      return res.json({
        status: 'invalid_key',
        provider: 'OMDb API',
        message: 'Invalid OMDb API key configured.',
        configured: false
      });
    }

    return res.json({
      status: 'error',
      provider: 'OMDb API',
      message: testData.Error || 'OMDb service error',
      configured: false
    });
  } catch (err: any) {
    return res.json({ status: 'error', message: err?.message || 'Network error reaching OMDb' });
  }
});

/**
 * Queries IMDb official live suggestions API (powers imdb.com search bar)
 */
async function fetchImdbSuggestions(query: string): Promise<Array<{
  imdbId: string;
  title: string;
  year: number | string;
  type: string;
  posterUrl: string;
  cast?: string;
}>> {
  try {
    const clean = query
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (!clean) return [];

    const url = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(clean)}.json`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data.d)) return [];

    return data.d
      .filter((item: any) => item.id && item.id.startsWith('tt'))
      .map((item: any) => {
        const q = (item.q || '').toLowerCase();
        let itemType = 'movie';
        if (q.includes('series') || q.includes('tv')) {
          itemType = 'series';
        } else if (q.includes('video game')) {
          itemType = 'game';
        }

        // Preserve high-resolution poster image (1080px wide, QL90, uncropped)
        const poster = upgradePosterUrl(item.i?.imageUrl || '', 1080);

        return {
          imdbId: item.id,
          title: item.l,
          year: item.y || 'N/A',
          type: itemType,
          posterUrl: poster,
          cast: item.s || ''
        };
      });
  } catch (err) {
    console.warn('[metadataRouter] IMDb suggestions error:', err);
    return [];
  }
}

/**
 * Search Endpoint (IMDb Live Engine + OMDb fallback/merger)
 */
router.get('/search', async (req: Request, res: Response) => {
  const rawQuery = (req.query.q as string) || '';
  const query = rawQuery.trim();
  if (!query) {
    return res.status(400).json({ error: 'Search query required' });
  }

  const { key, isCustom } = getApiKey();

  // 1. Direct IMDb ID / URL Lookup (e.g., tt0372784 or https://www.imdb.com/title/tt0372784/)
  const imdbIdMatch = query.match(/(tt\d+)/i);
  if (imdbIdMatch) {
    const imdbId = imdbIdMatch[1].toLowerCase();
    try {
      const url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(imdbId)}&plot=short`;
      const [omdbRes, imdbSuggestions] = await Promise.all([
        fetch(url).then((r) => r.json()).catch(() => null),
        fetchImdbSuggestions(imdbId)
      ]);
      const data = omdbRes;
      const imdbHit = imdbSuggestions.find((x) => x.imdbId.toLowerCase() === imdbId) || imdbSuggestions[0];

      if (data && data.Response === 'True') {
        const bestPoster = upgradePosterUrl(
          imdbHit?.posterUrl || (data.Poster && data.Poster !== 'N/A' ? data.Poster : ''),
          1080
        );
        return res.json({
          status: 'ok',
          provider: 'IMDb / OMDb API',
          results: [{
            imdbId: data.imdbID,
            title: data.Title,
            year: data.Year,
            type: data.Type || 'movie',
            posterUrl: bestPoster,
            cast: data.Actors && data.Actors !== 'N/A' ? data.Actors : (imdbHit?.cast || '')
          }]
        });
      }

      if (imdbHit) {
        return res.json({
          status: 'ok',
          provider: 'IMDb Live Search',
          results: [imdbHit]
        });
      }

      if (data?.Error === 'Invalid API key!') {
        return res.status(401).json({ status: 'invalid_key', results: [], message: 'Invalid API key.' });
      }
      if (data?.Error === 'Request limit reached!') {
        return res.status(429).json({ status: 'limit_reached', results: [], message: 'Daily request limit reached.' });
      }
      return res.json({ status: 'not_found', results: [], message: data?.Error || `No title found with IMDb ID ${imdbId}.` });
    } catch (err: any) {
      console.error('[metadataRouter] Direct IMDb ID lookup error:', err);
      return res.status(503).json({ status: 'network_error', results: [], message: 'Network error connecting to metadata service.' });
    }
  }

  // 2. Fetch live results from IMDb's official suggestion engine (matching imdb.com)
  const imdbPromise = fetchImdbSuggestions(query);

  // 3. Simultaneously query OMDb API with s=TITLE for comprehensive coverage
  const { title: cleanTitle, year } = extractYear(query);
  const searchTitle = cleanTitle || query;
  let omdbUrl = `https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&s=${encodeURIComponent(searchTitle)}`;
  if (year) {
    omdbUrl += `&y=${encodeURIComponent(year)}`;
  }

  const omdbPromise = fetch(omdbUrl)
    .then((r) => r.json())
    .catch((err) => {
      console.warn('[metadataRouter] OMDb search fetch warning:', err);
      return null;
    });

  try {
    const [imdbResults, omdbData] = await Promise.all([imdbPromise, omdbPromise]);

    const combinedResults: Array<{
      imdbId: string;
      title: string;
      year: number | string;
      type: string;
      posterUrl: string;
      cast?: string;
    }> = [];

    const seenIds = new Set<string>();

    // Prioritize IMDb live suggestion results (official, real-time, covers all latest releases & anime)
    if (Array.isArray(imdbResults)) {
      for (const item of imdbResults) {
        if (!seenIds.has(item.imdbId)) {
          seenIds.add(item.imdbId);
          combinedResults.push(item);
        }
      }
    }

    // Merge OMDb results
    if (omdbData && omdbData.Response === 'True' && Array.isArray(omdbData.Search)) {
      for (const item of omdbData.Search) {
        if (!seenIds.has(item.imdbID)) {
          seenIds.add(item.imdbID);
          combinedResults.push({
            imdbId: item.imdbID,
            title: item.Title,
            year: item.Year,
            type: item.Type || 'movie',
            posterUrl: upgradePosterUrl(item.Poster, 1080),
          });
        }
      }
    }

    if (combinedResults.length > 0) {
      return res.json({
        status: 'ok',
        provider: 'IMDb Live Search',
        totalResults: combinedResults.length,
        results: combinedResults,
      });
    }

    // If query had a year that failed to match, retry title only
    if (year && cleanTitle) {
      const retryResults = await fetchImdbSuggestions(cleanTitle);
      if (retryResults.length > 0) {
        return res.json({
          status: 'ok',
          provider: 'IMDb Live Search',
          totalResults: retryResults.length,
          results: retryResults,
        });
      }
    }

    return res.json({
      status: 'not_found',
      results: [],
      message: `No matching movies, series or anime found on IMDb for "${query}".`,
    });
  } catch (err: any) {
    console.error('[metadataRouter] Search error:', err);
    return res.status(503).json({
      status: 'network_error',
      results: [],
      message: 'Failed to communicate with metadata service. Please check your network connection.',
    });
  }
});

/**
 * Detail Endpoint (i=IMDB_ID)
 */
router.get('/detail', async (req: Request, res: Response) => {
  let id = (req.query.id as string) || '';
  let titleParam = (req.query.title as string) || '';
  const { key, isCustom } = getApiKey();

  if (id) {
    const match = id.match(/(tt\d+)/i);
    if (match) id = match[1].toLowerCase();
  }

  if (!id && !titleParam) {
    return res.status(400).json({ error: 'Movie IMDb ID or title parameter is required' });
  }

  try {
    const url = id 
      ? `https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(id)}&plot=full`
      : `https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&t=${encodeURIComponent(titleParam)}&plot=full`;

    const imdbLookupKey = id || titleParam;
    const [omdbRes, imdbSuggestions] = await Promise.all([
      fetch(url).then((r) => r.json()).catch(() => null),
      imdbLookupKey ? fetchImdbSuggestions(imdbLookupKey) : Promise.resolve([])
    ]);

    const data = omdbRes;
    const imdbHit = id
      ? (imdbSuggestions.find((x) => x.imdbId.toLowerCase() === id) || imdbSuggestions[0])
      : imdbSuggestions[0];

    if (data && data.Response === 'True') {
      const genre = data.Genre && data.Genre !== 'N/A' ? data.Genre : 'Action';
      const lang = data.Language && data.Language !== 'N/A' ? data.Language : 'Hindi';
      const country = data.Country && data.Country !== 'N/A' ? data.Country : '';
      
      const isAnime = genre.toLowerCase().includes('animation') && (lang.toLowerCase().includes('japanese') || country.toLowerCase().includes('japan'));
      const isBollywood = country.toLowerCase().includes('india') || lang.toLowerCase().includes('hindi');
      
      let cat = 'Hollywood Movie';
      if (data.Type === 'series') cat = isAnime ? 'Anime Series' : 'Web Series';
      else if (isAnime) cat = 'Anime Movie';
      else if (isBollywood) cat = 'Bollywood Movie';

      const rawPoster = imdbHit?.posterUrl || (data.Poster && data.Poster !== 'N/A' ? data.Poster : '');
      const posterUrl = upgradePosterUrl(rawPoster, 1080);
      const backdropUrl = upgradePosterUrl(rawPoster, 1280) || posterUrl;

      return res.json({
        status: 'ok',
        provider: isCustom ? 'OMDb (Custom Key)' : 'OMDb API',
        data: {
          imdbId: data.imdbID || id,
          title: data.Title || '',
          originalTitle: data.Title || '',
          releaseYear: parseInt(data.Year) || new Date().getFullYear(),
          posterUrl,
          backdropUrl,
          genre,
          description: data.Plot && data.Plot !== 'N/A' ? data.Plot : '',
          director: data.Director && data.Director !== 'N/A' ? data.Director : '',
          cast: data.Actors && data.Actors !== 'N/A' ? data.Actors : (imdbHit?.cast || ''),
          runtime: data.Runtime && data.Runtime !== 'N/A' ? data.Runtime : '',
          language: lang,
          rating: parseFloat(data.imdbRating) || 8.0,
          suggestedCategory: cat
        }
      });
    }

    if (imdbHit) {
      const posterUrl = upgradePosterUrl(imdbHit.posterUrl, 1080);
      const backdropUrl = upgradePosterUrl(imdbHit.posterUrl, 1280) || posterUrl;
      return res.json({
        status: 'ok',
        provider: 'IMDb Live Engine',
        data: {
          imdbId: imdbHit.imdbId || id,
          title: imdbHit.title || '',
          originalTitle: imdbHit.title || '',
          releaseYear: parseInt(String(imdbHit.year)) || new Date().getFullYear(),
          posterUrl,
          backdropUrl,
          genre: 'Action',
          description: '',
          director: '',
          cast: imdbHit.cast || '',
          runtime: '',
          language: 'Hindi',
          rating: 8.0,
          suggestedCategory: imdbHit.type === 'series' ? 'Web Series' : 'Bollywood Movie'
        }
      });
    }

    if (data?.Error === 'Invalid API key!') {
      return res.status(401).json({ error: 'Invalid OMDb API key.' });
    }
    if (data?.Error === 'Request limit reached!') {
      return res.status(429).json({ error: 'OMDb API daily request limit reached.' });
    }

    return res.status(404).json({ error: data?.Error || 'Metadata details not found.' });
  } catch (err: any) {
    console.error('[metadataRouter] Detail fetch error:', err);
    return res.status(503).json({ error: 'Failed to communicate with metadata service.' });
  }
});

export default router;
