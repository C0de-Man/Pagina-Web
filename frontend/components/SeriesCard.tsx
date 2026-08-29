'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { urlFicha } from '@/lib/slug';

export default function SeriesCard({ serie, dbId, customPoster }: { serie: any, dbId: number | null, customPoster: string | null }) {
  const [miCustomPoster, setMiCustomPoster] = useState<string | null>(customPoster);

  useEffect(() => {
    if (customPoster || !dbId) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch(`http://localhost:3001/media/${dbId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.customPoster) setMiCustomPoster(data.customPoster);
      })
      .catch(() => {});
  }, [dbId, customPoster]);

  // Igual que MovieCard: si ya está en TU base de datos, directo a su
  // ficha. Si no, a la resolvedora /series/tmdb/[tmdbId], que la guarda y
  // redirige — permite click central/Ctrl+click igual que un enlace normal.
  // (con dbId hay que forzar tipo: 'SERIE' porque el objeto "serie" viene
  // en crudo de TMDB y no trae ese campo)
  const href = dbId ? urlFicha({ ...serie, id: dbId, tipo: 'SERIE' }) : `/series/tmdb/${serie.id}`;

  const posterUrl = miCustomPoster || serie.portada || (serie.poster_path ? `https://image.tmdb.org/t/p/w500${serie.poster_path}` : null);
  const titulo = serie.name || serie.title || serie.titulo;
  const anio = serie.anio || (serie.first_air_date ? serie.first_air_date.split('-')[0] : (serie.release_date ? serie.release_date.split('-')[0] : ''));

  return (
    <Link href={href} className="flex-shrink-0 w-32 md:w-40 group cursor-pointer relative block">
      {posterUrl ? (
        <img
          src={posterUrl}
          alt={titulo}
          className="w-full aspect-[2/3] object-cover rounded-md border border-gray-700 group-hover:border-gray-400 transition duration-300 shadow-lg"
        />
      ) : (
        <div className="w-full aspect-[2/3] bg-gray-800 rounded-md border border-gray-700 flex items-center justify-center text-xs text-center p-2 group-hover:border-gray-400 transition shadow-lg">
          {titulo}
        </div>
      )}

      <div className="absolute inset-0 rounded-md bg-black/90 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-center p-2 pointer-events-none">
        <p className="text-sm font-bold text-white">
          {titulo} <span className="font-normal text-gray-300">({anio})</span>
        </p>
      </div>
    </Link>
  );
}