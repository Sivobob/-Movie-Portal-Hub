import { useEffect } from 'react';

export default function UpdateNotification() {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__MOVIE_PORTAL_MANDATORY_UPDATE__ = false;
      try {
        (window as any).AndroidPlayerBridge?.setMandatoryUpdateRequired?.(false);
      } catch {}
    }
  }, []);

  return null;
}
