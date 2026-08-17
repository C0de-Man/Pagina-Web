'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { urlFicha } from '@/lib/slug';

const API_URL = 'http://localhost:3001';

interface JuegoOriginal {
  igdbId: number;
  titulo: string;
  anio: number | null;
  portada: string | null;
}

export default function GameRemakeOfBadge({ igdbId }: { igdbId?: number }) {
  const [remakeOf, setRemakeOf] = useState<JuegoOriginal | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!igdbId) return;
    let cancelado = false;
    fetch(`${API_URL}/igdb/remake-of/${igdbId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelado) setRemakeOf(d);
      })
      .catch((err) => console.error('Error buscando el juego original', err));
    return () => {
      cancelado = true;
    };
  }, [igdbId]);

  if (!remakeOf) return null;

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      // Comprobamos si el juego original ya existe en tu base de datos
      const resDb = await fetch(`${API_URL}/media`);
      const myDb = await resDb.json();
      const local = myDb.find((m: any) => m.igdbId === remakeOf.igdbId);

      if (local) {
        router.push(urlFicha(local));
      } else {
        // Si no existe, lo creamos automáticamente a partir de IGDB
        const res = await fetch(`${API_URL}/media/igdb`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ igdbId: remakeOf.igdbId }),
        });
        const nuevo = await res.json();
        router.push(urlFicha(nuevo));
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