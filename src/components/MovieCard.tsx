import React, { memo } from 'react';
import { motion } from 'framer-motion';
import { upgradePosterUrl } from '../utils/posterUrl';
import { getVisibleQualityBadge } from '../utils/qualityBadge';

const MovieCard = memo(({ 
  movie, 
  onClick 
}: { 
  movie: any; 
  onClick: () => void; 
}) => {
  const rawPoster = movie.posterUrl || movie.backdropUrl || '';
  const hdPoster = upgradePosterUrl(rawPoster, 1080) || rawPoster;
  const qualityBadge = getVisibleQualityBadge(movie);

  return (
    <motion.div 
      className="relative rounded-xl overflow-hidden aspect-[2/3] cursor-pointer group shadow-lg border border-neutral-800/80 bg-neutral-950"
      whileHover={{ scale: 1.04 }}
      onClick={onClick}
    >
      {/* Clean HD Poster Image */}
      <img 
        src={hdPoster || undefined} 
        alt={movie.title} 
        loading="lazy"
        decoding="async"
        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" 
        onError={(e: any) => {
          const img = e.currentTarget;
          if (rawPoster && img.src !== rawPoster && !img.dataset.triedRaw) {
            img.dataset.triedRaw = '1';
            img.src = rawPoster;
            return;
          }
          img.src = 'https://images.unsplash.com/photo-1595760205842-8356d2cf98b1?q=80&w=800';
        }} 
      />

      {/* Top Right Quality Badge (Admin-controlled: HD, HDTC, or hidden for No Badge) */}
      {qualityBadge && (
        <div className="absolute top-2 right-2 bg-black/90 border border-yellow-400/40 text-yellow-400 text-[10px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider shadow z-10">
          {qualityBadge}
        </div>
      )}

      {/* Bottom Right Yellow Circular Play Button */}
      <div className="absolute bottom-2 right-2 sm:bottom-2.5 sm:right-2.5 z-20 group-hover:scale-110 transition-transform duration-200">
        <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#facc15] border border-black flex items-center justify-center shadow-md">
          <svg viewBox="0 0 24 24" className="w-3 h-3 sm:w-3.5 sm:h-3.5 ml-0.5">
            <path d="M6 4l15 8-15 8V4z" fill="#00e676" stroke="#000000" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* Bottom Details Vignette Gradient (Title, Year, Genre) */}
      <div className="absolute bottom-0 left-0 w-full p-2 sm:p-2.5 bg-gradient-to-t from-black via-black/80 to-transparent pr-9 sm:pr-10">
        <h3 className="text-white text-[11px] sm:text-xs font-black truncate drop-shadow">{movie.title}</h3>
        <p className="text-gray-400 text-[9px] sm:text-[10px] font-bold truncate">{movie.releaseYear || 2026} • {movie.genre || movie.displayCategory || 'Movie'}</p>
      </div>
    </motion.div>
  );
});

export default MovieCard;
