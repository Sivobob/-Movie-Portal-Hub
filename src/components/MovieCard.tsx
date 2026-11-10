import React, { memo } from 'react';
import { motion } from 'framer-motion';
import { Download } from 'lucide-react';

const MovieCard = memo(({ 
  movie, 
  onClick, 
  onDownloadClick 
}: { 
  movie: any; 
  onClick: () => void; 
  onDownloadClick?: (e: React.MouseEvent) => void;
}) => {
  return (
    <motion.div 
      className="relative rounded-xl overflow-hidden aspect-[2/3] cursor-pointer group shadow-lg border border-neutral-800/80 bg-neutral-950"
      whileHover={{ scale: 1.04 }}
      onClick={onClick}
    >
      {/* Clean Poster Image */}
      <img 
        src={movie.posterUrl || undefined} 
        alt={movie.title} 
        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" 
        onError={(e: any) => { e.target.src = 'https://images.unsplash.com/photo-1595760205842-8356d2cf98b1?q=80&w=400'; }} 
      />

      {/* Top Right HD Badge */}
      <div className="absolute top-2 right-2 bg-black/90 border border-yellow-400/40 text-yellow-400 text-[10px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider shadow z-10">
        HD
      </div>

      {/* Top Left Quick Download Button */}
      {onDownloadClick && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDownloadClick(e);
          }}
          className="absolute top-2 left-2 z-20 w-7 h-7 rounded-full bg-black/85 hover:bg-yellow-400 text-yellow-400 hover:text-black border border-yellow-400/40 flex items-center justify-center transition-all cursor-pointer shadow-md active:scale-90"
          title="Download with Quality Options"
          aria-label="Download"
        >
          <Download size={13} className="stroke-[2.5]" />
        </button>
      )}

      {/* Bottom Right Yellow Circular Play Button */}
      <div className="absolute bottom-2.5 right-2.5 z-20 group-hover:scale-110 transition-transform duration-200">
        <div className="w-7 h-7 rounded-full bg-[#facc15] border border-black flex items-center justify-center shadow-md">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 ml-0.5">
            <path d="M6 4l15 8-15 8V4z" fill="#00e676" stroke="#000000" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* Bottom Details Vignette Gradient (Title, Year, Genre) */}
      <div className="absolute bottom-0 left-0 w-full p-2.5 bg-gradient-to-t from-black via-black/80 to-transparent pr-11">
        <h3 className="text-white text-xs font-black truncate drop-shadow">{movie.title}</h3>
        <p className="text-gray-400 text-[10px] font-bold">{movie.releaseYear || 2026} • {movie.genre || movie.displayCategory || 'Movie'}</p>
      </div>
    </motion.div>
  );
});

export default MovieCard;
