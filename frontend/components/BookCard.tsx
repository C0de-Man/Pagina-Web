'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { urlFicha } from '@/lib/slug';

export default function BookCard({ libro, dbId, customPoster, fullWidth }: { libro: any, dbId: number | null, customPoster: string | null, fullWidth?: boolean }) {
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
      .catch(() => { });
  }, [dbId, customPoster]);

  // Si ya está guardado, vamos directo a su ficha (siempre /book/..., tanto
  // si vino de Google Books como de MangaDex — ambos se guardan como LIBRO).
  // Si no, a la resolvedora que corresponda según de dónde vino el resultado.
  const href = dbId
    ? urlFicha({ ...libro, id: dbId, tipo: 'LIBRO' })
    : libro.fuente === 'mal'
      ? `/book/mal/${libro.origenId}`
      : libro.fuente === 'mangadex'
        ? `/book/mangadex/${libro.origenId}`
        : `/book/googlebooks/${libro.origenId}`;

  const posterUrl = miCustomPoster || libro.portada || null;
  const titulo = libro.titulo;
  const anio = libro.anio || '';
  const autor = libro.autor || (libro.autores || [])[0] || '';

  return (
    <Link href={href} className={`${fullWidth ? 'w-full' : 'flex-shrink-0 w-32 md:w-40'} group cursor-pointer relative block`}>
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

      <div className="absolute inset-0 rounded-md bg-black/90 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center text-center p-2 pointer-events-none">
        <p className="text-sm font-bold text-white">
          {titulo} <span className="font-normal text-gray-300">({anio})</span>
        </p>
        {autor && <p className="text-xs text-gray-400 mt-1">{autor}</p>}
      </div>
    </Link>
  );
}