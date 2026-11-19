import { useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { PRE_BACKEND_URL, probeWorkingBackendUrl } from '../utils/apiConfig';
import { upgradePosterUrl } from '../utils/posterUrl';
import { isNativeAndroid } from '../utils/platform';
import { getTimestampMs } from '../services/movieStorage';
import { getAppPreferences } from '../services/userPreferencesService';
import { ensureWebPushSubscribed, isWebPushSupported } from '../services/webPushService';

const NOTIFIED_STORAGE_KEY = 'mp_notified_announcements_v1';
const SEEDED_STORAGE_KEY = 'mp_notified_seeded_v1';
const INITIAL_RECENT_WINDOW_MS = 10 * 60 * 1000;
const MAX_STORED_IDS = 150;

function readNotifiedIds(): string[] {
  try {
    const raw = localStorage.getItem(NOTIFIED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function saveNotifiedId(id: string, syncToNative = true): void {
  if (!id) return;
  try {
    const existing = readNotifiedIds();
    if (!existing.includes(id)) {
      const next = [...existing, id].slice(-MAX_STORED_IDS);
      localStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify(next));
    }
    if (syncToNative) {
      try {
        (window as any).AndroidPlayerBridge?.markAnnouncementNotified?.(id);
      } catch {}
    }
  } catch {}
}

function formatRichNotificationPayload(id: string, raw: any) {
  const title = String(raw?.title || 'New Release').trim();
  const releaseYear = String(raw?.releaseYear || '').trim();
  const category = String(raw?.category || '').trim();
  const isSeries = Boolean(raw?.isSeries || category.toLowerCase().includes('series'));
  const language = String(raw?.language || '').trim();
  const genre = String(raw?.genre || '').trim();
  const qualityBadge = String(raw?.qualityBadge || '').trim();
  const runtime = String(raw?.runtime || '').trim();
  const message = String(raw?.message || 'GO STREAM or DOWNLOAD NOW').trim();
  const rawPoster = String(raw?.posterUrl || '').trim();
  const rawBackdrop = String(raw?.backdropUrl || rawPoster).trim();
  const posterUrl = upgradePosterUrl(rawPoster, 600) || rawPoster;
  const backdropUrl = upgradePosterUrl(rawBackdrop, 1280) || rawBackdrop || posterUrl;
  const movieId = String(raw?.movieId || '').trim();
  const createdAtMs = getTimestampMs(raw?.createdAtMs || raw?.createdAt) || Date.now();

  const yearPart = releaseYear && releaseYear !== '0' ? ` (${releaseYear})` : '';
  const typeLabel = isSeries ? 'Full Series' : 'Full Movie';
  const notificationTitle = String(raw?.notificationTitle || '').trim()
    || `Watch Now : ${title}${yearPart} ${typeLabel} available now`;

  const detailParts = [
    qualityBadge && qualityBadge.toUpperCase() !== 'NONE' ? qualityBadge : '',
    language,
    genre,
    runtime,
  ].filter(Boolean);

  const notificationBody = String(raw?.notificationBody || '').trim()
    || (detailParts.length > 0 ? `${message} • ${detailParts.join(' • ')}` : message);

  return {
    id,
    movieId,
    title,
    releaseYear,
    category,
    isSeries,
    language,
    genre,
    qualityBadge,
    runtime,
    posterUrl,
    backdropUrl,
    imageUrl: backdropUrl || posterUrl,
    message,
    notificationTitle,
    notificationBody,
    createdAtMs,
  };
}

const notifiedSessionSet = new Set<string>();

function dispatchNotificationToDevice(
  payload: ReturnType<typeof formatRichNotificationPayload>
): boolean {
  if (!getAppPreferences().notificationsEnabled) {
    return false;
  }
  if (notifiedSessionSet.has(payload.id)) {
    return false;
  }

  // 1. Native Android APK: show rich BigPictureStyle notification ONLY if permission is already granted
  if (isNativeAndroid()) {
    try {
      const bridge = (window as any).AndroidPlayerBridge;
      if (bridge && typeof bridge.showReleaseNotification === 'function') {
        const hasPerm =
          typeof bridge.hasNotificationPermission === 'function'
            ? Boolean(bridge.hasNotificationPermission())
            : true;
        if (!hasPerm) {
          try {
            bridge.requestNotificationPermission?.();
          } catch {}
          return false;
        }
        bridge.showReleaseNotification(JSON.stringify(payload));
        notifiedSessionSet.add(payload.id);
        saveNotifiedId(payload.id, false);
        return true;
      }
    } catch {}
    return false;
  }

  // 2. Web / Android Chrome / PWA Browser fallback
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    notifiedSessionSet.add(payload.id);
    saveNotifiedId(payload.id, false);
    const titleText = 'Movie Hub';
    const options: any = {
      body: `${payload.notificationTitle}\n${payload.notificationBody}`,
      icon: payload.posterUrl || '/pwa-192x192.png',
      image: payload.imageUrl || '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: `mp-release-${payload.id}`,
      renotify: false,
      data: {
        movieId: payload.movieId,
        url: payload.movieId ? `/?open=${encodeURIComponent(payload.movieId)}` : '/',
      },
    };

    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker?.controller) {
        navigator.serviceWorker.ready
          .then((reg) => reg.showNotification(titleText, options))
          .catch(() => {});
        return true;
      }
    } catch {}

    try {
      const notif = new Notification(titleText, options);
      notif.onclick = () => {
        try {
          window.focus();
          if (payload.movieId) {
            window.dispatchEvent(new CustomEvent('movie_portal_open_movie', { detail: payload.movieId }));
          }
          notif.close();
        } catch {}
      };
      return true;
    } catch {}
  }

  return false;
}

const PUSH_PROMPT_DISMISSED_KEY = 'mp_push_prompt_dismissed_v1';

export default function ReleaseNotificationBridge() {
  const navigate = useNavigate();
  const initialSnapshotDoneRef = useRef(false);
  const pendingDocsRef = useRef<Array<{ id: string; data: any; createdAtMs: number; expiresAtMs: number }>>([]);
  const retryPendingRef = useRef<() => void>(() => {});
  const [showPushPrompt, setShowPushPrompt] = useState(false);

  const checkShouldShowPrompt = () => {
    try {
      if (typeof window === 'undefined' || window.self !== window.top) return false;
      if (!isWebPushSupported()) return false;
      if (!getAppPreferences().notificationsEnabled) return false;
      if (Notification.permission !== 'default') return false;
      if (sessionStorage.getItem(PUSH_PROMPT_DISMISSED_KEY) === '1') return false;
      return true;
    } catch {
      return false;
    }
  };

  // Sync backend base URL & consume any pending notification tap deep-link on Android / Web Push
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setShowPushPrompt(checkShouldShowPrompt());

    const handleDeepLinkOpen = (movieId: string) => {
      const cleanId = String(movieId || '').trim();
      if (!cleanId) return;
      try {
        sessionStorage.setItem('mp_pending_open_movie_id', cleanId);
      } catch {}
      navigate('/');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('movie_portal_open_movie', { detail: cleanId }));
      }, 100);
    };

    // Consume ?open=<movieId> when launched from a closed-app Web Push notification click
    try {
      const params = new URLSearchParams(window.location.search);
      const openMovieId = params.get('open');
      if (openMovieId) {
        params.delete('open');
        const nextSearch = params.toString();
        const cleanUrl = `${window.location.pathname}${nextSearch ? '?' + nextSearch : ''}${window.location.hash || ''}`;
        window.history.replaceState({}, '', cleanUrl);
        handleDeepLinkOpen(openMovieId);
      }
    } catch {}

    const checkPendingNativeTap = () => {
      try {
        const bridge = (window as any).AndroidPlayerBridge;
        if (bridge && typeof bridge.consumePendingOpenMovieId === 'function') {
          const pendingId = String(bridge.consumePendingOpenMovieId() || '').trim();
          if (pendingId) {
            handleDeepLinkOpen(pendingId);
          }
        }
      } catch {}
    };

    const onNativeOpenEvent = (e: Event) => {
      const detailId = (e as CustomEvent)?.detail;
      if (detailId) {
        handleDeepLinkOpen(String(detailId));
      }
    };

    const onServiceWorkerMessage = (event: MessageEvent) => {
      const data = event?.data;
      if (data && data.type === 'MOVIE_PORTAL_OPEN_MOVIE' && data.movieId) {
        handleDeepLinkOpen(String(data.movieId));
      }
    };

    const processDocList = (
      rawItems: Array<{ id: string; data: any; createdAtMs: number; expiresAtMs: number }>
    ) => {
      const now = Date.now();
      const alreadySeeded = localStorage.getItem(SEEDED_STORAGE_KEY) === 'true';
      const seenIds = new Set(readNotifiedIds());

      const docs = rawItems
        .filter((item) => !(item.expiresAtMs > 0 && item.expiresAtMs < now))
        .sort((a, b) => a.createdAtMs - b.createdAtMs);

      pendingDocsRef.current = docs;

      if (!initialSnapshotDoneRef.current) {
        initialSnapshotDoneRef.current = true;
        if (!alreadySeeded) {
          for (const item of docs) {
            if (now - item.createdAtMs > INITIAL_RECENT_WINDOW_MS) {
              saveNotifiedId(item.id);
              seenIds.add(item.id);
              notifiedSessionSet.add(item.id);
            }
          }
          try {
            localStorage.setItem(SEEDED_STORAGE_KEY, 'true');
          } catch {}
        }
      }

      const unseen = docs.filter((item) => !seenIds.has(item.id) && !notifiedSessionSet.has(item.id));
      if (unseen.length === 0) return;

      const toNotify = unseen.slice(-1);
      const toMarkOnly = unseen.slice(0, Math.max(0, unseen.length - 1));
      for (const oldItem of toMarkOnly) {
        saveNotifiedId(oldItem.id);
        notifiedSessionSet.add(oldItem.id);
      }
      for (const item of toNotify) {
        if (now - item.createdAtMs > 48 * 60 * 60 * 1000) {
          saveNotifiedId(item.id);
          notifiedSessionSet.add(item.id);
          continue;
        }
        const payload = formatRichNotificationPayload(item.id, item.data);
        dispatchNotificationToDevice(payload);
      }
    };

    const retryPendingOnPermission = () => {
      setShowPushPrompt(checkShouldShowPrompt());
      if (!isNativeAndroid() && getAppPreferences().notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
        ensureWebPushSubscribed(false).catch(() => {});
      }
      if (pendingDocsRef.current.length > 0) {
        processDocList(pendingDocsRef.current);
      }
      checkPendingNativeTap();
    };
    retryPendingRef.current = retryPendingOnPermission;

    if (isNativeAndroid()) {
      try {
        (window as any).AndroidPlayerBridge?.setBackendBaseUrl?.(PRE_BACKEND_URL);
      } catch {}
      probeWorkingBackendUrl()
        .then((resolved) => {
          if (resolved && !/^https?:\/\/127\.0\.0\.1/i.test(resolved)) {
            try {
              (window as any).AndroidPlayerBridge?.setBackendBaseUrl?.(resolved);
            } catch {}
          }
        })
        .catch(() => {});
      checkPendingNativeTap();
    } else if ('Notification' in window) {
      if (Notification.permission === 'granted' && getAppPreferences().notificationsEnabled) {
        ensureWebPushSubscribed(false).catch(() => {});
      }
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage);
    }

    window.addEventListener('focus', retryPendingOnPermission);
    window.addEventListener('movie_portal_open_movie', onNativeOpenEvent);
    window.addEventListener('movie_portal_notif_permission_granted', retryPendingOnPermission);

    // Subscribe to admins/latest_release_notification mirror document (single source of truth)
    let lastReleaseSig = '';
    const qMirror = doc(db, 'admins', 'latest_release_notification');
    const unsubMirror = onSnapshot(
      qMirror,
      { includeMetadataChanges: false },
      (snap) => {
        if (!snap.exists()) return;
        const d: any = snap.data() || {};
        const releaseSig = `${d.latestId || ''}_${d.createdAtMs || ''}`;
        if (lastReleaseSig && releaseSig && releaseSig !== lastReleaseSig) {
          try {
            window.dispatchEvent(new CustomEvent('movies_updated'));
          } catch {}
        }
        if (releaseSig) {
          lastReleaseSig = releaseSig;
        }

        const items: Array<{ id: string; data: any; createdAtMs: number; expiresAtMs: number }> = [];
        try {
          const parsed = JSON.parse(String(d.itemsJson || '[]'));
          if (Array.isArray(parsed)) {
            for (const entry of parsed) {
              if (!entry || !entry.id) continue;
              const createdAtMs = getTimestampMs(entry.createdAtMs || entry.createdAt) || Date.now();
              items.push({ id: String(entry.id), data: entry, createdAtMs, expiresAtMs: 0 });
            }
          }
        } catch {}
        if (items.length === 0 && d.latestId) {
          items.push({
            id: String(d.latestId),
            data: d,
            createdAtMs: Number(d.createdAtMs) || Date.now(),
            expiresAtMs: 0,
          });
        }
        if (items.length > 0) {
          processDocList(items);
        }
      },
      () => {}
    );

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onServiceWorkerMessage);
      }
      window.removeEventListener('focus', retryPendingOnPermission);
      window.removeEventListener('movie_portal_open_movie', onNativeOpenEvent);
      window.removeEventListener('movie_portal_notif_permission_granted', retryPendingOnPermission);
      unsubMirror();
    };
  }, [navigate]);

  const handleEnableAlertsClick = async () => {
    const res = await ensureWebPushSubscribed(true);
    setShowPushPrompt(false);
    if (res.permission === 'granted') {
      retryPendingRef.current();
    }
  };

  const handleDismissPrompt = () => {
    try {
      sessionStorage.setItem(PUSH_PROMPT_DISMISSED_KEY, '1');
    } catch {}
    setShowPushPrompt(false);
  };

  if (!showPushPrompt) return null;

  return (
    <div className="fixed bottom-20 left-3 right-3 sm:left-auto sm:right-5 sm:bottom-6 sm:w-96 z-50 bg-[#181b22]/95 backdrop-blur-md border border-yellow-400/35 rounded-2xl p-3.5 shadow-2xl flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-yellow-400/15 border border-yellow-400/30 flex items-center justify-center text-yellow-400 flex-shrink-0">
        <Bell size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-white leading-tight">Instant Movie Alerts</p>
        <p className="text-[11px] text-neutral-300 leading-snug mt-0.5">
          Get notified immediately on upload even when app is closed.
        </p>
      </div>
      <button
        type="button"
        onClick={handleEnableAlertsClick}
        className="px-3 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-500 text-black text-xs font-black flex-shrink-0 cursor-pointer transition-colors"
      >
        Allow
      </button>
      <button
        type="button"
        onClick={handleDismissPrompt}
        aria-label="Dismiss"
        className="p-1 text-neutral-400 hover:text-white cursor-pointer flex-shrink-0"
      >
        <X size={15} />
      </button>
    </div>
  );
}
