import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Home, Tv, Film, Layers } from 'lucide-react';

interface AndroidBottomNavProps {
  activeCategory?: string | null;
  onSelectCategory?: (category: string | null) => void;
}

export default function AndroidBottomNav({
  activeCategory: _activeCategory,
  onSelectCategory,
}: AndroidBottomNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const currentCategory = searchParams.get('category');

  const pathname = location.pathname;
  if (pathname === '/admin') return null;

  const isHome = pathname === '/' && !currentCategory;
  const isBollywood = pathname === '/' && currentCategory === 'Bollywood';
  const isHollywood = pathname === '/' && currentCategory === 'Hollywood';
  const isSeries = pathname === '/' && currentCategory === 'Series';

  const goToHome = () => {
    if (onSelectCategory) onSelectCategory(null);
    navigate('/');
  };

  const goToCategory = (cat: string) => {
    if (onSelectCategory) onSelectCategory(cat);
    navigate(`/?category=${cat}`);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-black/95 border-t border-neutral-900/90 backdrop-blur-xl px-2 py-2 safe-bottom select-none">
      <div className="max-w-md mx-auto grid grid-cols-5 items-center text-center">
        {/* 1. Home */}
        <button
          type="button"
          onClick={goToHome}
          className={`flex flex-col items-center justify-center py-1 px-1 rounded-2xl transition-all cursor-pointer active:scale-95 ${
            isHome ? 'text-red-600 font-black' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Home size={22} className={isHome ? 'stroke-[2.5]' : 'stroke-2'} />
          <span className="text-[10px] mt-1 tracking-tight font-bold">Home</span>
          {isHome && <span className="w-1.5 h-1.5 bg-red-600 rounded-full mt-0.5"></span>}
        </button>

        {/* 2. Bollywood */}
        <button
          type="button"
          onClick={() => goToCategory('Bollywood')}
          className={`flex flex-col items-center justify-center py-1 px-1 rounded-2xl transition-all cursor-pointer active:scale-95 ${
            isBollywood ? 'text-red-600 font-black' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Tv size={22} className={isBollywood ? 'stroke-[2.5]' : 'stroke-2'} />
          <span className="text-[10px] mt-1 tracking-tight font-bold">Bollywood</span>
          {isBollywood && <span className="w-1.5 h-1.5 bg-red-600 rounded-full mt-0.5"></span>}
        </button>

        {/* 3. Center M Logo */}
        <button
          type="button"
          onClick={goToHome}
          className="flex flex-col items-center justify-center py-0.5 px-1 group cursor-pointer active:scale-95"
          aria-label="Movie Portal Home"
        >
          <div className="w-9 h-9 rounded-full bg-neutral-900 border border-red-600/50 flex items-center justify-center shadow-[0_0_15px_rgba(229,9,20,0.4)] group-hover:border-red-600 transition-all">
            <span
              style={{
                fontFamily: "'Bangers', cursive, system-ui",
                color: '#E50914',
                WebkitTextStroke: '1px #000000',
              }}
              className="text-xl font-black uppercase tracking-tight"
            >
              M
            </span>
          </div>
          <span className="text-[9px] mt-0.5 tracking-tight font-bold text-red-500">Portal</span>
        </button>

        {/* 4. Hollywood */}
        <button
          type="button"
          onClick={() => goToCategory('Hollywood')}
          className={`flex flex-col items-center justify-center py-1 px-1 rounded-2xl transition-all cursor-pointer active:scale-95 ${
            isHollywood ? 'text-red-600 font-black' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Film size={22} className={isHollywood ? 'stroke-[2.5]' : 'stroke-2'} />
          <span className="text-[10px] mt-1 tracking-tight font-bold">Hollywood</span>
          {isHollywood && <span className="w-1.5 h-1.5 bg-red-600 rounded-full mt-0.5"></span>}
        </button>

        {/* 5. Series */}
        <button
          type="button"
          onClick={() => goToCategory('Series')}
          className={`flex flex-col items-center justify-center py-1 px-1 rounded-2xl transition-all cursor-pointer active:scale-95 ${
            isSeries ? 'text-red-600 font-black' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Layers size={22} className={isSeries ? 'stroke-[2.5]' : 'stroke-2'} />
          <span className="text-[10px] mt-1 tracking-tight font-bold">Series</span>
          {isSeries && <span className="w-1.5 h-1.5 bg-red-600 rounded-full mt-0.5"></span>}
        </button>
      </div>
    </nav>
  );
}
