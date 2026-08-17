'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { urlFicha } from '@/lib/slug';

export default function GameCard({ juego, dbId, customPoster }: { juego: any, dbId: number | null, customPoster: string | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);

    if (dbId) {
      router.push(urlFicha({ ...juego, id: dbId }));
    } else {
      try {
        const res = await fetch('http://localhost:3001/media/igdb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ igdbId: juego.id })
        });
        const nuevoJuego = await res.json();
        router.push(urlFicha(nuevoJuego));
      } catch (error) {
        console.error("Error al guardar el juego", error);
        setLoading(false);
      }
    }
  };

  const posterUrl = customPoster || juego.cover?.url || null;
  const titulo = juego.name || juego.titulo;
  const anio = juego.anio || (juego.first_release_date ? new Date(juego.first_release_date * 1000).getFullYear() : '');

  return (
    <div onClick={handleClick} className="flex-shrink-0 w-32 md:w-40 group cursor-pointer relative">
      {posterUrl ? (
        <img
          src={posterUrl}
          alt={titulo}
          className={`w-full aspect-[2/3] object-cover rounded-md border border-gray-700 group-hover:border-gray-400 transition duration-300 shadow-lg ${loading ? 'opacity-50 blur-sm' : ''}`}
        />
      ) : (
        <div className="w-full aspect-[2/3] bg-gray-800 rounded-md border border-gray-700 flex items-center justify-center text-xs text-center p-2 group-hover:border-gray-400 transition shadow-lg">
          {titulo}
        </div>
      )}

      {!loading && (
        <div className="absolute inset-0 rounded-md bg-black/90 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-center p-2 pointer-events-none">
          <p className="text-sm font-bold text-white">
            {titulo} <span className="font-normal text-gray-300">({anio})</span>
          </p>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md pointer-events-none">
          <span className="text-white text-xs font-bold bg-black/60 px-2 py-1 rounded">Cargando...</span>
        </div>
      )}
    </div>
  );
}