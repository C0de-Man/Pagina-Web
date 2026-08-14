'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function SearchResultItem({ item, dbId, customPoster }: { item: any, dbId: number | null, customPoster: string | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);

    if (dbId) {
      // Si ya la tienes, te lleva directo
      router.push(`/media/${dbId}`);
    } else {
      // Si NO la tienes, la guarda y luego te lleva
      try {
        // Determinamos si es peli o serie
        const tipo = item.media_type === 'tv' ? 'SERIE' : 'PELICULA';
        
        const res = await fetch('http://localhost:3001/media/tmdb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tmdbId: item.id, tipo })
        });
        const nuevaPeli = await res.json();
        router.push(`/media/${nuevaPeli.id}`);
      } catch (error) {
        console.error("Error al guardar:", error);
        setLoading(false);
      }
    }
  };

  // Usamos el póster personalizado si existe, si no, el oficial
  const posterUrl = customPoster || (item.poster_path ? `https://image.tmdb.org/t/p/w200${item.poster_path}` : null);
  const title = item.title || item.name;
  const year = item.release_date ? item.release_date.split('-')[0] : (item.first_air_date ? item.first_air_date.split('-')[0] : '');

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
        
        {/* Cartelito de carga al hacer clic */}
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
          {item.overview || "Sin descripción disponible."}
        </p>
        
        <div className="mt-2 flex gap-2">
           <span className="text-xs font-semibold bg-gray-800 px-2 py-1 rounded text-gray-400">
             {item.media_type === 'movie' ? 'PELÍCULA' : item.media_type === 'tv' ? 'SERIE' : 'OTRO'}
           </span>
        </div>
      </div>
    </div>
  );
}