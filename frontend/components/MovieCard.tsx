'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function MovieCard({ pelicula, dbId, customPoster }: { pelicula: any, dbId: number | null, customPoster: string | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);

    if (dbId) {
      // Magia 1: Si ya la tienes en TU base de datos, te lleva directo a tu página.
      router.push(`/media/${dbId}`);
    } else {
      // Magia 2: Si NO la tienes, la guarda en tu base de datos y luego te lleva a la página.
      try {
        const res = await fetch('http://localhost:3001/media/tmdb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tmdbId: pelicula.id, tipo: 'PELICULA' })
        });
        const nuevaPeli = await res.json();
        router.push(`/media/${nuevaPeli.id}`);
      } catch (error) {
        console.error("Error al guardar la película", error);
        setLoading(false);
      }
    }
  };

  // Magia 3: Si tienes un póster personalizado (customPoster), usa ese. Si no, usa el de TMDB.
  const posterUrl = customPoster || (pelicula.poster_path ? `https://image.tmdb.org/t/p/w500${pelicula.poster_path}` : null);

  return (
    <div onClick={handleClick} className="flex-shrink-0 w-32 md:w-40 group cursor-pointer relative">
      {posterUrl ? (
        <img 
          src={posterUrl} 
          alt={pelicula.title} 
          className={`w-full aspect-[2/3] object-cover rounded-md border border-gray-700 group-hover:border-gray-400 group-hover:scale-105 transition duration-300 shadow-lg ${loading ? 'opacity-50 blur-sm' : ''}`}
        />
      ) : (
        <div className="w-full aspect-[2/3] bg-gray-800 rounded-md border border-gray-700 flex items-center justify-center text-xs text-center p-2 group-hover:border-gray-400 transition shadow-lg">
          {pelicula.title}
        </div>
      )}
      
      {/* Indicador de carga por si tarda medio segundo en guardarse */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md pointer-events-none">
          <span className="text-white text-xs font-bold bg-black/60 px-2 py-1 rounded">Cargando...</span>
        </div>
      )}
    </div>
  );
}