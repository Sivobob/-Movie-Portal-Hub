import { useEffect, useRef } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { PRE_BACKEND_URL, probeWorkingBackendUrl } from '../utils/apiConfig';
import { upgradePosterUrl } from '../utils/posterUrl';
import { isNativeAndroid } from '../utils/platform';
import { getTimestampMs } from '../services/movieStorage';

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

function saveNotifiedId(id: string): void {
  if (!id) return;
  try {
    const existing = readNotifiedIds();
    if (!existing.includes(id)) {
      const next = [...existing, id].slice(-MAX_STORED_IDS);
      localStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify(next));
    }
    try {
      (window as any).AndroidPlayerBridge?.markAnnouncementNotified?.(id);
    } catch {}
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
  const notificationTitle = `Watch Now : ${title}${yearPart} ${typeLabel} available now`;

  const detailParts = [
    qualityBadge && qualityBadge.toUpperCase() !== 'NONE' ? qualityBadge : '',
    language,
    genre,
    runtime,
  ].filter(Boolean);

  const notificationBody = detailParts.length > 0
    ? `${message} • ${detailParts.join(' • ')}`
    : message;

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

function dispatchNotificationToDevice(payload: ReturnType<typeof formatRichNotificationPayload>) {
  saveNotifiedId(payload.id);

  // 1. Native Android APK: show rich BigPictureStyle notification with app name & movie image
  if (isNativeAndroid()) {
    try {
      const bridge = (window as any).AndroidPlayerBridge;
      if (bridge && typeof bridge.showReleaseNotification === 'function') {
        bridge.showReleaseNotification(JSON.stringify(payload));
        return;
      }
    } catch {}
  }

  // 2. Web / PWA Browser fallback
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const notif = new Notification('Movie Portal', {
        body: `${payload.notificationTitle}\n${payload.notificationBody}`,
        icon: payload.posterUrl || '/assets/icons/master_icon.jpg',
        image: payload.imageUrl || '/assets/icons/master_icon.jpg',
        badge: '/assets/icons/master_icon.jpg',
        tag: `mp-release-${payload.id}`,
      } as any);
      notif.onclick = () => {
        try {
          window.focus();
          if (payload.movieId) {
            window.dispatchEvent(new CustomEvent('movie_portal_open_movie', { detail: payload.movieId }));
          }
          notif.close();
        } catch {}
      };
    } catch {}
  }
}

export default function ReleaseNotificationBridge() {
  const navigate = useNavigate();
  const initialSnapshotDoneRef = useRef(false);

  // Sync backend base URL & consume any pending notification tap deep-link on Android
  useEffect(() => {
    if (typeof window === 'undefined') return;

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
    } else if ('Notification' in window && Notification.permission === 'default') {
      const askOnce = () => {
        Notification.requestPermission().catch(() => {});
        window.removeEventListener('pointerdown', askOnce);
      };
      window.addEventListener('pointerdown', askOnce, { once: true });
    }

    window.addEventListener('focus', checkPendingNativeTap);
    window.addEventListener('movie_portal_open_movie', onNativeOpenEvent);
    return () => {
      window.removeEventListener('focus', checkPendingNativeTap);
      window.removeEventListener('movie_portal_open_movie', onNativeOpenEvent);
    };
  }, [navigate]);

  // Listen to real-time Firestore announcements for all connected users
  useEffect(() => {
    const q = collection(db, 'announcements');
    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: false },
      (snapshot) => {
        const now = Date.now();
        const alreadySeeded = localStorage.getItem(SEEDED_STORAGE_KEY) === 'true';
        const seenIds = new Set(readNotifiedIds());

        const docs = snapshot.docs
          .map((d) => {
            const data: any = d.data() || {};
            const createdAtMs = getTimestampMs(data.createdAtMs || data.createdAt) || now;
            const expiresAtMs = getTimestampMs(data.expiresAt);
            return { id: d.id, data, createdAtMs, expiresAtMs };
          })
          .filter((item) => !(item.expiresAtMs > 0 && item.expiresAtMs < now))
          .sort((a, b) => a.createdAtMs - b.createdAtMs);

        if (!initialSnapshotDoneRef.current) {
          initialSnapshotDoneRef.current = true;
          if (!alreadySeeded) {
            for (const item of docs) {
              if (now - item.createdAtMs > INITIAL_RECENT_WINDOW_MS) {
                saveNotifiedId(item.id);
                seenIds.add(item.id);
              }
            }
            try {
              localStorage.setItem(SEEDED_STORAGE_KEY, 'true');
            } catch {}
          }
        }

        const unseen = docs.filter((item) => !seenIds.has(item.id));
        if (unseen.length === 0) return;

        // Avoid spamming if many were queued offline: deliver up to 3 newest and mark the rest seen
        const toNotify = unseen.slice(-3);
        const toMarkOnly = unseen.slice(0, Math.max(0, unseen.length - 3));
        for (const oldItem of toMarkOnly) {
          saveNotifiedId(oldItem.id);
        }
        for (const item of toNotify) {
          if (now - item.createdAtMs > 48 * 60 * 60 * 1000) {
            saveNotifiedId(item.id);
            continue;
          }
          const payload = formatRichNotificationPayload(item.id, item.data);
          dispatchNotificationToDevice(payload);
        }
      },
      (err) => {
        console.warn('[ReleaseNotificationBridge] Firestore listener warning:', err?.message || err);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  return null;
}
