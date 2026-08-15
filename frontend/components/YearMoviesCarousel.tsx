'use client';
import { useState } from 'react';
import MovieCard from './MovieCard';

export default function YearMoviesCarousel({
  items,
}: {
  items: { pelicula: any; dbId: number | null; customPoster: string | null }[];
}) {
  const [start, setStart] = useState(0);
  const perPage = 4;

  const visibles = items.slice(start, start + perPage);
  const puedeRetroceder = start > 0;
  const puedeAvanzar = start + perPage < items.length;

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => setStart((s) => Math.max(0, s - perPage))}
        disabled={!puedeRetroceder}
        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded border border-gray-700 text-gray-400 hover:text-white hover:border-gray-400 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer text-xl"
      >
        ‹
      </button>

      <div className="flex-grow grid grid-cols-4 gap-4 justify-items-center">
        {visibles.map(({ pelicula, dbId, customPoster }) => (
          <MovieCard key={pelicula.id} pelicula={pelicula} dbId={dbId} customPoster={customPoster} />
        ))}
      </div>

      <button
        onClick={() => setStart((s) => (s + perPage < items.length ? s + perPage : s))}
        disabled={!puedeAvanzar}
        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded border border-gray-700 text-gray-400 hover:text-white hover:border-gray-400 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer text-xl"
      >
        ›
      </button>
    </div>
  );
}