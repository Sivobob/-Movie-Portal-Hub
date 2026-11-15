import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Search, Settings, ShieldCheck } from 'lucide-react';
import { useAuth, isAuthorizedAdminEmail } from '../context/AuthContext';

interface AndroidBottomNavProps {
  activeCategory?: string | null;
  onSelectCategory?: (category: string | null) => void;
}

export default function AndroidBottomNav({
  activeCategory,
  onSelectCategory,
}: AndroidBottomNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();

  const isUnlockedSession = typeof window !== 'undefined' && localStorage.getItem('admin_unlocked_session') === '20180020511';
  const isAuthorized = isAuthorizedAdminEmail(user?.email) || isUnlockedSession;
  const canAccessAdmin = (isAuthorized && isAdmin) || isUnlockedSession;

  const pathname = location.pathname;
  const isHome = pathname === '/' && !activeCategory;
  const isSearch = pathname === '/search';
  const isAdminPage = pathname === '/admin';

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-black/95 border-t border-neutral-950 backdrop-blur-xl px-4 py-2 safe-bottom select-none">
      <div className="max-w-md mx-auto grid grid-cols-3 items-center">
        {/* Home */}
        <button
          type="button"
          onClick={() => {
            if (onSelectCategory) onSelectCategory(null);
            if (pathname !== '/') navigate('/');
          }}
          className={`flex flex-col items-center justify-center py-1.5 px-2 rounded-2xl transition-all cursor-pointer active:scale-95 ${
            isHome ? 'text-yellow-400 font-black' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Home size={22} className={isHome ? 'stroke-[2.5]' : 'stroke-2'} />
          <span className="text-[11px] mt-1 tracking-tight font-bold">Home</span>
          {isHome && <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full mt-0.5"></span>}
        </button>

        {/* Search */}
        <button
          type="button"
          onClick={() => navigate('/search')}
          className={`flex flex-col items-center justify-center py-1.5 px-2 rounded-2xl transition-all cursor-pointer active:scale-95 ${
            isSearch ? 'text-yellow-400 font-black' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Search size={22} className={isSearch ? 'stroke-[2.5]' : 'stroke-2'} />
          <span className="text-[11px] mt-1 tracking-tight font-bold">Search</span>
          {isSearch && <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full mt-0.5"></span>}
        </button>

        {/* Settings / Admin */}
        <button
          type="button"
          onClick={() => navigate('/admin')}
          className={`flex flex-col items-center justify-center py-1.5 px-2 rounded-2xl transition-all cursor-pointer active:scale-95 ${
            isAdminPage ? 'text-yellow-400 font-black' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          {canAccessAdmin ? (
            <ShieldCheck size={22} className={isAdminPage ? 'stroke-[2.5] text-yellow-400' : 'stroke-2'} />
          ) : (
            <Settings size={22} className="stroke-2" />
          )}
          <span className="text-[11px] mt-1 tracking-tight font-bold">
            {canAccessAdmin ? 'Admin' : 'Settings'}
          </span>
          {isAdminPage && <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full mt-0.5"></span>}
        </button>
      </div>
    </nav>
  );
}
