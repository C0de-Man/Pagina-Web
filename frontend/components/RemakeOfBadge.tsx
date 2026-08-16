'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { urlFicha } from '@/lib/slug';

export default function RemakeOfBadge({
  remakeOf,
}: {
  remakeOf: { tmdbId: number; titulo: string; anio: string | null } | null;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  if (!remakeOf) return null;

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      // Comprobamos si esa película original ya existe en tu base de datos
      const resDb = await fetch('http://localhost:3001/media');
      const myDb = await resDb.json();
      const local = myDb.find((m: any) => m.tmdbId === remakeOf.tmdbId);

      if (local) {
        router.push(urlFicha(local));
      } else {
        // Si no existe, la creamos automáticamente a partir de TMDB
        const res = await fetch('http://localhost:3001/media/tmdb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tmdbId: remakeOf.tmdbId, tipo: 'PELICULA' }),
        });
        const nueva = await res.json();
        router.push(urlFicha(nueva));
      }
    } catch (e) {
      setLoading(false);
    }
  };

  return (
    <div className="text-sm text-gray-400 mb-4 -mt-4 w-fit">
      Remake de{' '}
      <span
        onClick={handleClick}
        className={`text-blue-400 font-semibold underline cursor-pointer hover:text-blue-300 transition ${
          loading ? 'opacity-50' : ''
        }`}
      >
        {remakeOf.titulo}
        {remakeOf.anio && ` (${remakeOf.anio})`}
      </span>
    </div>
  );
}