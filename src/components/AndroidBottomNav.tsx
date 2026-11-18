import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Download, User } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface AndroidBottomNavProps {
  activeCategory?: string | null;
  onSelectCategory?: (category: string | null) => void;
}

const MESSAGES_SEEN_AT_KEY = 'mp_messages_last_seen_ms';

export default function AndroidBottomNav({
  activeCategory: _activeCategory,
  onSelectCategory,
}: AndroidBottomNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);

  const pathname = location.pathname;

  useEffect(() => {
    let active = true;
    const checkUnread = async () => {
      try {
        const lastSeen = Number(localStorage.getItem(MESSAGES_SEEN_AT_KEY) || '0');
        const snap = await getDoc(doc(db, 'admins', 'latest_release_notification'));
        if (!active || !snap.exists()) return;
        const data = snap.data();
        const latestMs = Number(data?.createdAtMs || 0);
        setHasUnreadMessages(latestMs > lastSeen);
      } catch {
        // Ignore silent background unread check errors
      }
    };
    checkUnread();
    const onRead = () => setHasUnreadMessages(false);
    window.addEventListener('mp_messages_read', onRead);
    return () => {
      active = false;
      window.removeEventListener('mp_messages_read', onRead);
    };
  }, [pathname]);

  // Hide bottom bar on Admin, Settings, Search routes
  if (pathname === '/admin' || pathname === '/settings' || pathname === '/search') {
    return null;
  }

  const isHome = pathname === '/';
  const isDownloads = pathname === '/downloads';
  const isMe = pathname === '/me';

  const goHome = () => {
    if (onSelectCategory) onSelectCategory(null);
    navigate('/');
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#121418]/95 border-t border-white/[0.08] backdrop-blur-xl px-4 py-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] select-none">
      <div className="max-w-lg mx-auto grid grid-cols-3 items-center text-center">
        {/* 1. Home */}
        <button
          type="button"
          onClick={goHome}
          className={`flex flex-col items-center justify-center min-h-[46px] py-1 px-2 rounded-xl transition-colors cursor-pointer active:scale-95 ${
            isHome ? 'text-[#00d664]' : 'text-neutral-400 hover:text-neutral-200'
          }`}
          aria-label="Home"
        >
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isHome ? 'bg-[#00d664]/15' : ''}`}>
            <Home size={20} className={isHome ? 'stroke-[2.5]' : 'stroke-[1.9]'} />
          </div>
          <span className={`text-[11px] mt-0.5 tracking-tight ${isHome ? 'font-bold text-[#00d664]' : 'font-medium'}`}>
            Home
          </span>
        </button>

        {/* 2. Downloads */}
        <button
          type="button"
          onClick={() => navigate('/downloads')}
          className={`flex flex-col items-center justify-center min-h-[46px] py-1 px-2 rounded-xl transition-colors cursor-pointer active:scale-95 ${
            isDownloads ? 'text-[#00d664]' : 'text-neutral-400 hover:text-neutral-200'
          }`}
          aria-label="Downloads"
        >
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isDownloads ? 'bg-[#00d664]/15' : ''}`}>
            <Download size={20} className={isDownloads ? 'stroke-[2.5]' : 'stroke-[1.9]'} />
          </div>
          <span className={`text-[11px] mt-0.5 tracking-tight ${isDownloads ? 'font-bold text-[#00d664]' : 'font-medium'}`}>
            Downloads
          </span>
        </button>

        {/* 3. Me */}
        <button
          type="button"
          onClick={() => navigate('/me')}
          className={`flex flex-col items-center justify-center min-h-[46px] py-1 px-2 rounded-xl transition-colors cursor-pointer active:scale-95 ${
            isMe ? 'text-[#00d664]' : 'text-neutral-400 hover:text-neutral-200'
          }`}
          aria-label="Me"
        >
          <div className={`relative w-7 h-7 rounded-lg flex items-center justify-center ${isMe ? 'bg-[#00d664]/15' : ''}`}>
            <User size={20} className={isMe ? 'stroke-[2.5]' : 'stroke-[1.9]'} />
            {hasUnreadMessages && (
              <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-[#121418]" />
            )}
          </div>
          <span className={`text-[11px] mt-0.5 tracking-tight ${isMe ? 'font-bold text-[#00d664]' : 'font-medium'}`}>
            Me
          </span>
        </button>
      </div>
    </nav>
  );
}
