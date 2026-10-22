import { Mic, Volume2 } from 'lucide-react';

/** Middle bars react most, outer bars least, like a voice. */
const BAR_WEIGHTS = [0.5, 0.8, 1, 0.8, 0.5];
const MIN_PX = 3;
const MAX_PX = 18;

interface LevelMeterProps {
  /** 0..1, see useLiveAudioLevels */
  level: number;
  source: 'you' | 'them';
  /** Dimmed and flat while paused. */
  paused?: boolean;
}

/**
 * Five-bar live input meter with the source's icon. "You" is the microphone,
 * "Them" the system audio; seeing both move confirms both sides are captured.
 */
export function LevelMeter({ level, source, paused = false }: LevelMeterProps) {
  const Icon = source === 'you' ? Mic : Volume2;
  const label = source === 'you' ? 'Your microphone' : 'Other side (system audio)';
  const active = !paused && level > 0.02;

  return (
    <div
      className="flex items-center gap-1.5"
      title={`${label}${paused ? ' (paused)' : ''}`}
      aria-label={`${label} level`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((paused ? 0 : level) * 100)}
    >
      <Icon size={14} className={active ? 'text-gray-700' : 'text-gray-400'} />
      <div className="flex items-center gap-[3px] h-[18px]">
        {BAR_WEIGHTS.map((weight, i) => {
          const height = paused ? MIN_PX : MIN_PX + (MAX_PX - MIN_PX) * Math.min(1, level * weight * 1.25);
          return (
            <div
              key={i}
              className={`w-[3px] rounded-full transition-[height] duration-100 ease-out ${
                active ? (source === 'you' ? 'bg-emerald-500' : 'bg-sky-500') : 'bg-gray-300'
              }`}
              style={{ height }}
            />
          );
        })}
      </div>
    </div>
  );
}
