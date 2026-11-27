export interface MetadataSearchItem {
  imdbId: string;
  title: string;
  year: number | string;
  type: string;
  posterUrl: string;
  cast?: string;
}

export interface MetadataDetailData {
  imdbId: string;
  title: string;
  originalTitle: string;
  releaseYear: number;
  posterUrl: string;
  backdropUrl: string;
  genre: string;
  description: string;
  director: string;
  cast: string;
  runtime: string;
  language: string;
  rating: number;
  suggestedCategory: string;
}

function cleanWikiImageUrl(url?: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('utm_source');
    parsed.searchParams.delete('utm_campaign');
    parsed.searchParams.delete('utm_content');
    return parsed.toString();
  } catch {
    return url;
  }
}

function extractQueryParts(query: string): { words: string[]; year: string | null } {
  const yearMatch = query.match(/\b((?:19|20)\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : null;
  const words = query
    .toLowerCase()
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  return { words, year };
}

function normalizeTitleKey(title: string): string {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function extractYearFromText(description?: string, extract?: string): string {
  const descMatch = String(description || '').match(/\b((?:19|20)\d{2})\b/);
  if (descMatch) return descMatch[1];

  const text = String(extract || '');
  const releaseMatch = text.match(/(?:re-released|released|premiere[d]?|upcoming)[^.]{0,60}?\b((?:19|20)\d{2})\b/i);
  if (releaseMatch) return releaseMatch[1];

  const firstSentence = text.split(/[.!?]\s/)[0] || text;
  const sentMatch = firstSentence.match(/\b((?:19|20)\d{2})\b/);
  if (sentMatch) return sentMatch[1];

  return 'N/A';
}

function isFilmOrSeriesWikiPage(title: string, description: string, extract: string): boolean {
  const lowerTitle = title.toLowerCase();
  if (
    lowerTitle.startsWith('list of ') ||
    lowerTitle.startsWith('marketing of ') ||
    lowerTitle.startsWith('production of ') ||
    lowerTitle.startsWith('development of ') ||
    lowerTitle.includes('soundtrack') ||
    lowerTitle.includes('discography') ||
    lowerTitle.includes('in other media')
  ) {
    return false;
  }
  const combined = `${description} ${extract.slice(0, 260)}`.toLowerCase();
  if (/\b(fictional organization|fictional character|comic book|video game|album|song)\b/.test(description.toLowerCase())) {
    return false;
  }
  return /\b(film|movie|re-release|web series|television series|tv series|miniseries|mini-series|anime|animated feature|documentary film)\b/i.test(
    combined
  );
}

function scoreMatch(item: MetadataSearchItem, queryWords: string[], queryYear: string | null): number {
  const titleLower = String(item.title || '').toLowerCase();
  const titleWords = titleLower.replace(/[^a-z0-9]+/g, ' ');
  let matchedWords = 0;
  for (const w of queryWords) {
    if (titleWords.includes(w) || titleLower.includes(w)) {
      matchedWords += 1;
    }
  }
  const yearBonus = queryYear && String(item.year) === queryYear ? 1.5 : 0;
  return matchedWords * 2 + yearBonus;
}

export async function searchWikipediaFilmSuggestions(query: string): Promise<MetadataSearchItem[]> {
  try {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const { words, year } = extractQueryParts(trimmed);
    const searchUrl =
      `https://en.wikipedia.org/w/api.php?action=query&generator=search` +
      `&gsrsearch=${encodeURIComponent(trimmed)}&gsrlimit=8` +
      `&prop=pageimages|description|extracts&exintro=1&explaintext=1&exchars=320` +
      `&piprop=original|thumbnail&pithumbsize=1000&pilicense=any&origin=*&format=json`;

    const res = await fetch(searchUrl, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];

    const data = await res.json();
    const pages = Object.values(data?.query?.pages || {}) as any[];
    if (pages.length === 0) return [];

    const results: MetadataSearchItem[] = [];
    for (const page of pages) {
      const title = String(page.title || '').trim();
      const description = String(page.description || '').trim();
      const extract = String(page.extract || '').trim();
      if (!title || !page.pageid) continue;
      if (!isFilmOrSeriesWikiPage(title, description, extract)) continue;

      const titleLower = title.toLowerCase();
      const matchedCount = words.filter((w) => titleLower.includes(w)).length;
      if (words.length > 0 && matchedCount === 0) continue;

      const detectedYear = extractYearFromText(description, extract);
      const isSeries = /\b(series|miniseries|mini-series|television|tv)\b/i.test(`${description} ${extract.slice(0, 180)}`);
      const posterUrl = cleanWikiImageUrl(page.original?.source || page.thumbnail?.source || '');

      results.push({
        imdbId: `wiki-${page.pageid}`,
        title,
        year: detectedYear,
        type: isSeries ? 'series' : 'movie',
        posterUrl,
      });
    }

    results.sort((a, b) => scoreMatch(b, words, year) - scoreMatch(a, words, year));
    return results;
  } catch (err) {
    console.warn('[wikipediaMetadata] search error:', err);
    return [];
  }
}

export function mergeImdbAndWikiResults(
  query: string,
  imdbAndOmdbResults: MetadataSearchItem[],
  wikiResults: MetadataSearchItem[]
): MetadataSearchItem[] {
  if (!wikiResults || wikiResults.length === 0) return imdbAndOmdbResults;
  if (!imdbAndOmdbResults || imdbAndOmdbResults.length === 0) return wikiResults;

  const { words, year } = extractQueryParts(query);
  const topExistingScore = Math.max(
    ...imdbAndOmdbResults.map((r) => scoreMatch(r, words, year)),
    0
  );

  const existingTitleYearKeys = new Set(
    imdbAndOmdbResults.map((r) => `${normalizeTitleKey(r.title)}_${String(r.year || '')}`)
  );
  const existingTitlesOnly = new Set(imdbAndOmdbResults.map((r) => normalizeTitleKey(r.title)));

  const promotedWiki: MetadataSearchItem[] = [];
  const trailingWiki: MetadataSearchItem[] = [];

  for (const wItem of wikiResults) {
    const keyWithYear = `${normalizeTitleKey(wItem.title)}_${String(wItem.year || '')}`;
    const keyTitle = normalizeTitleKey(wItem.title);
    if (existingTitleYearKeys.has(keyWithYear)) continue;

    const wScore = scoreMatch(wItem, words, year);
    if (wScore > topExistingScore) {
      promotedWiki.push(wItem);
    } else if (!existingTitlesOnly.has(keyTitle) && wScore >= words.length * 2) {
      trailingWiki.push(wItem);
    }
  }

  return [...promotedWiki, ...imdbAndOmdbResults, ...trailingWiki];
}

function cleanWikiMarkup(raw: string): string {
  return raw
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^/]*\/>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{\s*(?:Plainlist|Plain list|Unbulleted list|Ubl|Indented plainlist|Flatlist|Hlist)\s*\|?/gi, '')
    .replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\{\{|\}\}/g, '')
    .replace(/''+/g, '')
    .replace(/^\s*[*•|]\s*/gm, '')
    .split(/\n|,|\|/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && !/^\(.*\)$/.test(s))
    .join(', ');
}

function extractInfoboxField(wikitext: string, fieldName: string): string {
  const regex = new RegExp(`\\|\\s*${fieldName}\\s*=\\s*([\\s\\S]*?)(?=\\n\\s*\\|\\s*[a-zA-Z_]+\\s*=|\\n\\}\\}|$)`, 'i');
  const m = wikitext.match(regex);
  return m ? m[1].trim() : '';
}

export async function fetchWikipediaFilmDetail(wikiId: string): Promise<MetadataDetailData | null> {
  const match = String(wikiId || '').match(/^wiki-(\d+)$/i);
  if (!match) return null;
  const pageId = match[1];

  try {
    const detailUrl =
      `https://en.wikipedia.org/w/api.php?action=query&pageids=${encodeURIComponent(pageId)}` +
      `&prop=pageimages|description|extracts|revisions&rvprop=content&rvslots=main&rvsection=0` +
      `&exintro=1&explaintext=1&exchars=900&piprop=original|thumbnail&pithumbsize=1000&pilicense=any&origin=*&format=json`;

    const res = await fetch(detailUrl, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const page = data?.query?.pages?.[pageId];
    if (!page || page.missing !== undefined) return null;

    const title = String(page.title || '').trim();
    const descriptionText = String(page.description || '').trim();
    const extract = String(page.extract || '').trim();
    const wikitext = String(page.revisions?.[0]?.slots?.main?.['*'] || '');

    const rawPoster = cleanWikiImageUrl(page.original?.source || page.thumbnail?.source || '');

    // Extract release year from Film date template or text
    let releaseYear = new Date().getFullYear();
    const filmDateMatch = wikitext.match(/\{\{(?:Film date|Start date)[^}]*?\|((?:19|20)\d{2})/i);
    if (filmDateMatch) {
      releaseYear = parseInt(filmDateMatch[1], 10) || releaseYear;
    } else {
      const detected = extractYearFromText(descriptionText, extract);
      if (detected !== 'N/A') releaseYear = parseInt(detected, 10) || releaseYear;
    }

    const director = cleanWikiMarkup(extractInfoboxField(wikitext, 'director'));
    const rawCast = cleanWikiMarkup(extractInfoboxField(wikitext, 'starring'));
    const cast = rawCast
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6)
      .join(', ');

    const rawRuntime = extractInfoboxField(wikitext, 'runtime');
    const runtimeMatch = rawRuntime.match(/(\d{2,3})\s*(?:min|minutes)/i);
    const runtime = runtimeMatch ? `${runtimeMatch[1]} min` : '';

    const rawLang = cleanWikiMarkup(extractInfoboxField(wikitext, 'language')) || 'English';
    const rawCountry = cleanWikiMarkup(extractInfoboxField(wikitext, 'country'));
    const rawGenre = cleanWikiMarkup(extractInfoboxField(wikitext, 'genre'));

    const lowerCombined = `${descriptionText} ${extract} ${rawCountry} ${rawLang}`.toLowerCase();
    const isSeries = /\b(series|miniseries|mini-series|television|tv)\b/i.test(`${descriptionText} ${extract.slice(0, 180)}`);
    const isAnime = /\banime\b/i.test(lowerCombined);
    const isBollywood = /\b(india|indian|hindi|tamil|telugu|malayalam|kannada|marathi|punjabi|bollywood)\b/i.test(lowerCombined);

    let suggestedCategory = 'Hollywood Movie';
    if (isSeries) suggestedCategory = isAnime ? 'Anime Series' : 'Web Series';
    else if (isAnime) suggestedCategory = 'Anime Movie';
    else if (isBollywood) suggestedCategory = 'Bollywood Movie';

    let genre = rawGenre || 'Action';
    if (!rawGenre) {
      if (lowerCombined.includes('superhero')) genre = 'Action, Adventure, Sci-Fi';
      else if (lowerCombined.includes('thriller')) genre = 'Action, Thriller';
      else if (lowerCombined.includes('comedy')) genre = 'Comedy, Drama';
      else if (lowerCombined.includes('horror')) genre = 'Horror, Thriller';
      else if (lowerCombined.includes('romance')) genre = 'Romance, Drama';
    }

    return {
      imdbId: `wiki-${pageId}`,
      title,
      originalTitle: title,
      releaseYear,
      posterUrl: rawPoster,
      backdropUrl: rawPoster,
      genre,
      description: extract,
      director,
      cast,
      runtime,
      language: rawLang.split(',')[0]?.trim() || (isBollywood ? 'Hindi' : 'English'),
      rating: 8.0,
      suggestedCategory,
    };
  } catch (err) {
    console.warn('[wikipediaMetadata] detail error:', err);
    return null;
  }
}
