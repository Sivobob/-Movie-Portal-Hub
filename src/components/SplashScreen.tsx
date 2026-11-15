import { motion } from 'framer-motion';

export default function SplashScreen({ onFinish }: { onFinish: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 flex flex-col items-center justify-center bg-black z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onAnimationComplete={onFinish}
      transition={{ duration: 0.5 }}
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1, ease: "easeOut" }}
        className="flex flex-col items-center"
      >
        <img
          src="/assets/movie_portal_mascot_v2.jpg"
          alt="MOVIE PORTAL Mascot"
          className="w-32 h-32 mb-6"
          style={{ filter: "drop-shadow(0 0 15px rgba(255, 255, 0, 0.5))" }}
        />
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="text-2xl font-bold text-yellow-400 tracking-widest uppercase"
        >
          MOVIE PORTAL
        </motion.h1>
      </motion.div>
    </motion.div>
  );
}
