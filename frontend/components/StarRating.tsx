'use client';
import { useState, useRef } from 'react';

export default function StarRating({
  value, // escala 0-10 (2 puntos = 1 estrella, así que admite medias estrellas)
  onRate,
  readOnly = false,
  size = 'md',
}: {
  value: number;
  onRate?: (value: number | null) => void;
  readOnly?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [hover, setHover] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const shown = hover ?? value;
  const fillPercent = Math.max(0, Math.min(100, (shown / 10) * 100));

  const sizeClasses = { sm: 'text-lg gap-0.5', md: 'text-2xl gap-1', lg: 'text-4xl gap-1.5' };

  const getValueFromEvent = (e: React.MouseEvent) => {
    if (!containerRef.current) return value;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const fraction = Math.max(0, Math.min(1, x / rect.width));
    return Math.max(1, Math.round(fraction * 10));
  };

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex ${sizeClasses[size]} ${readOnly ? '' : 'cursor-pointer'} select-none`}
      onMouseMove={readOnly ? undefined : (e) => setHover(getValueFromEvent(e))}
      onMouseLeave={readOnly ? undefined : () => setHover(null)}
      onClick={
        readOnly
          ? undefined
          : (e) => {
              const v = getValueFromEvent(e);
              if (onRate) onRate(v === value ? null : v);
            }
      }
    >
      {/* Fondo: estrellas vacías */}
      <div className="flex text-gray-700">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i}>★</span>
        ))}
      </div>
      {/* Relleno: estrellas amarillas, recortadas al porcentaje exacto */}
      <div
        className="absolute inset-0 flex text-yellow-400 overflow-hidden"
        style={{ width: `${fillPercent}%` }}
      >
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i}>★</span>
        ))}
      </div>
    </div>
  );
}