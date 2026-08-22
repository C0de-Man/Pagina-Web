'use client';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { urlFicha } from '@/lib/slug';

export default function SearchResultItem({ item, dbId, customPoster }: { item: any, dbId: number | null, customPoster: string | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const esJuego = item.media_type === 'juego';
  // Mismo patrón que MovieCard/GameCard: si no nos pasan un customPoster
  // explícito y el título ya está guardado (dbId), lo comprobamos nosotros
  // mismos tras montarnos, en el navegador, donde sí hay acceso al token.
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

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);

    if (dbId) {
      router.push(urlFicha({ ...item, id: dbId }));
    } else {
      try {
        if (esJuego) {
          const res = await fetch('http://localhost:3001/media/igdb', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ igdbId: item.id })
          });
          const nuevoJuego = await res.json();
          router.push(urlFicha(nuevoJuego));
        } else {
          const tipo = item.media_type === 'tv' ? 'SERIE' : 'PELICULA';

          const res = await fetch('http://localhost:3001/media/tmdb', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tmdbId: item.id, tipo })
          });
          const nuevaPeli = await res.json();
          router.push(urlFicha(nuevaPeli));
        }
      } catch (error) {
        console.error("Error al guardar:", error);
        setLoading(false);
      }
    }
  };

  const posterUrl = miCustomPoster || (esJuego ? item.cover?.url : (item.poster_path ? `https://image.tmdb.org/t/p/w200${item.poster_path}` : null));
  const title = esJuego ? item.name : (item.title || item.name);
  const year = esJuego
    ? (item.first_release_date ? new Date(item.first_release_date * 1000).getFullYear() : '')
    : (item.release_date ? item.release_date.split('-')[0] : (item.first_air_date ? item.first_air_date.split('-')[0] : ''));
  const descripcion = esJuego ? item.summary : item.overview;
  const etiqueta = item.media_type === 'movie' ? 'PELÍCULA' : item.media_type === 'tv' ? 'SERIE' : esJuego ? 'JUEGO' : 'OTRO';

  return (
    <div onClick={handleClick} className={`flex gap-4 group cursor-pointer transition ${loading ? 'opacity-50 blur-sm' : ''}`}>
      <div className="flex-shrink-0 w-24 relative">
        {posterUrl ? (
          <img 
            src={posterUrl} 
            alt={title} 
            className="w-full rounded border border-gray-700 group-hover:border-gray-400 transition object-cover aspect-[2/3] shadow-lg"
          />
        ) : (
          <div className="w-full aspect-[2/3] bg-gray-800 rounded border border-gray-700 flex items-center justify-center text-xs text-gray-500 text-center p-2">Sin imagen</div>
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center rounded pointer-events-none">
             <span className="text-white text-[10px] font-bold bg-black/60 px-2 py-1 rounded">Cargando...</span>
          </div>
        )}
      </div>
      
      <div className="flex flex-col pt-1">
        <div className="flex items-baseline gap-2 mb-1">
          <h2 className="text-xl font-bold text-white group-hover:text-blue-400 transition">
            {title}
          </h2>
          <span className="text-sm text-gray-400">{year}</span>
        </div>
        
        <p className="text-sm text-gray-400 line-clamp-3">
          {descripcion || "Sin descripción disponible."}
        </p>
        
        <div className="mt-2 flex gap-2">
           <span className="text-xs font-semibold bg-gray-800 px-2 py-1 rounded text-gray-400">
             {etiqueta}
           </span>
        </div>
      </div>
    </div>
  );
}