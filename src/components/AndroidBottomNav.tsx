import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Search, Download, Settings, ShieldCheck } from 'lucide-react';
import { useAuth, isAuthorizedAdminEmail } from '../context/AuthContext';

interface AndroidBottomNavProps {
  activeCategory?: string | null;
  onSelectCategory?: (category: string | null) => void;
  activeDownloadsCount?: number;
}

export default function AndroidBottomNav({
  activeCategory,
  onSelectCategory,
  activeDownloadsCount = 0,
}: AndroidBottomNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();

  const isUnlockedSession = typeof window !== 'undefined' && localStorage.getItem('admin_unlocked_session') === '20180020511';
  const isAuthorized = isAuthorizedAdminEmail(user?.email) || isUnlockedSession;
  const canAccessAdmin = (isAuthorized && isAdmin) || isUnlockedSession;

  const pathname = location.pathname;
  const isHome = pathname === '/' && (!activeCategory || activeCategory !== 'Downloads');
  const isSearch = pathname === '/search';
  const isDownloads = activeCategory === 'Downloads';
  const isAdminPage = pathname === '/admin';

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-black/95 border-t border-neutral-900/90 backdrop-blur-xl px-2 py-1 safe-bottom select-none">
      <div className="max-w-md mx-auto grid grid-cols-4 items-center">
        {/* Home */}
        <button
          type="button"
          onClick={() => {
            if (onSelectCategory) onSelectCategory(null);
            if (pathname !== '/') navigate('/');
          }}
          className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all cursor-pointer active:scale-95 ${
            isHome ? 'text-yellow-400 font-black' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Home size={20} className={isHome ? 'stroke-[2.5]' : 'stroke-2'} />
          <span className="text-[10px] mt-1 tracking-tight">Home</span>
          {isHome && <span className="w-1 h-1 bg-yellow-400 rounded-full mt-0.5"></span>}
        </button>

        {/* Search */}
        <button
          type="button"
          onClick={() => navigate('/search')}
          className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all cursor-pointer active:scale-95 ${
            isSearch ? 'text-yellow-400 font-black' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Search size={20} className={isSearch ? 'stroke-[2.5]' : 'stroke-2'} />
          <span className="text-[10px] mt-1 tracking-tight">Search</span>
          {isSearch && <span className="w-1 h-1 bg-yellow-400 rounded-full mt-0.5"></span>}
        </button>

        {/* Downloads */}
        <button
          type="button"
          onClick={() => {
            if (pathname !== '/') navigate('/');
            if (onSelectCategory) onSelectCategory('Downloads');
          }}
          className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all cursor-pointer active:scale-95 relative ${
            isDownloads ? 'text-yellow-400 font-black' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <div className="relative">
            <Download size={20} className={isDownloads ? 'stroke-[2.5]' : 'stroke-2'} />
            {activeDownloadsCount > 0 && (
              <span className="absolute -top-1.5 -right-2 bg-yellow-400 text-black text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center animate-pulse">
                {activeDownloadsCount}
              </span>
            )}
          </div>
          <span className="text-[10px] mt-1 tracking-tight">Downloads</span>
          {isDownloads && <span className="w-1 h-1 bg-yellow-400 rounded-full mt-0.5"></span>}
        </button>

        {/* Settings / Admin */}
        <button
          type="button"
          onClick={() => {
            if (canAccessAdmin) {
              navigate('/admin');
            } else {
              // Open Settings trigger on header or navigate
              navigate('/admin');
            }
          }}
          className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all cursor-pointer active:scale-95 ${
            isAdminPage ? 'text-yellow-400 font-black' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          {canAccessAdmin ? (
            <ShieldCheck size={20} className={isAdminPage ? 'stroke-[2.5] text-yellow-400' : 'stroke-2'} />
          ) : (
            <Settings size={20} className="stroke-2" />
          )}
          <span className="text-[10px] mt-1 tracking-tight">
            {canAccessAdmin ? 'Admin' : 'Settings'}
          </span>
          {isAdminPage && <span className="w-1 h-1 bg-yellow-400 rounded-full mt-0.5"></span>}
        </button>
      </div>
    </nav>
  );
}
