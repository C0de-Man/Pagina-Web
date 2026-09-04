'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { urlFicha } from '@/lib/slug';

export default function GameCard({ juego, dbId, customPoster, fullWidth }: { juego: any, dbId: number | null, customPoster: string | null, fullWidth?: boolean }) {
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

  // Href real, siempre resoluble sin JS:
  // - Si ya lo tienes en TU base de datos (dbId), vamos directo a su ficha.
  // - Si no, vamos a la resolvedora /game/igdb/[igdbId] (nueva página — ver
  //   abajo, hay que crearla), que lo guarda y redirige a su ficha.
  const href = dbId ? urlFicha({ ...juego, id: dbId }) : `/game/igdb/${juego.id}`;

  const posterUrl = miCustomPoster || juego.portada || juego.cover?.url || null;
  const titulo = juego.name || juego.titulo;
  const anio = juego.anio || (juego.first_release_date ? new Date(juego.first_release_date * 1000).getFullYear() : '');

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

      <div className="absolute inset-0 rounded-md bg-black/90 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-center p-2 pointer-events-none">
        <p className="text-sm font-bold text-white">
          {titulo} <span className="font-normal text-gray-300">({anio})</span>
        </p>
      </div>
    </Link>
  );
}