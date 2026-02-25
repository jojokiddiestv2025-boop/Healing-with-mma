import { motion } from 'motion/react';

interface VoiceVisualizerProps {
  isActive: boolean;
  isConnecting: boolean;
}

export function VoiceVisualizer({ isActive, isConnecting }: VoiceVisualizerProps) {
  return (
    <div className="relative flex items-center justify-center w-64 h-64">
      {/* Outer Glow */}
      <motion.div
        className="absolute inset-0 rounded-full bg-emerald-500/20 blur-3xl"
        animate={{
          scale: isActive ? [1, 1.2, 1] : 1,
          opacity: isActive ? [0.3, 0.6, 0.3] : 0.2,
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Pulsing Rings */}
      {[...Array(3)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute inset-0 border border-emerald-500/30 rounded-full"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={isActive ? {
            scale: [0.8, 1.5],
            opacity: [0.5, 0],
          } : { scale: 0.8, opacity: 0 }}
          transition={{
            duration: 2,
            repeat: Infinity,
            delay: i * 0.6,
            ease: "easeOut",
          }}
        />
      ))}

      {/* Central Orb */}
      <motion.div
        className={`relative z-10 w-32 h-32 rounded-full flex items-center justify-center shadow-2xl
          ${isConnecting ? 'bg-amber-400' : isActive ? 'bg-emerald-500' : 'bg-zinc-700'}`}
        animate={isActive ? {
          scale: [1, 1.05, 1],
          boxShadow: [
            "0 0 20px rgba(16, 185, 129, 0.4)",
            "0 0 40px rgba(16, 185, 129, 0.6)",
            "0 0 20px rgba(16, 185, 129, 0.4)"
          ]
        } : {}}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <div className="w-24 h-24 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center">
          {isConnecting ? (
            <motion.div
              className="w-8 h-8 border-4 border-white border-t-transparent rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            />
          ) : (
            <motion.div
              className="flex gap-1 items-center"
              animate={isActive ? {
                height: [10, 30, 10]
              } : {}}
            >
              {[...Array(5)].map((_, i) => (
                <motion.div
                  key={i}
                  className="w-1.5 bg-white rounded-full"
                  animate={isActive ? {
                    height: [12, 24, 12, 32, 12][i % 5],
                  } : { height: 4 }}
                  transition={{
                    duration: 0.8,
                    repeat: Infinity,
                    delay: i * 0.1,
                    ease: "easeInOut",
                  }}
                />
              ))}
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
