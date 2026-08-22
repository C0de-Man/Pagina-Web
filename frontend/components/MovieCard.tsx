'use client';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { urlFicha } from '@/lib/slug';

export default function MovieCard({ pelicula, dbId, customPoster }: { pelicula: any, dbId: number | null, customPoster: string | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  // Si el padre ya nos pasó un customPoster explícito, lo respetamos. Si no,
  // y la película ya está guardada en la base de datos (dbId), lo comprobamos
  // nosotros mismos tras montarnos — las páginas que listan tarjetas (perfil,
  // listas, populares...) se renderizan en el servidor, sin token, así que
  // nunca pueden saber si el usuario tiene una portada personalizada.
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
      // Magia 1: Si ya la tienes en TU base de datos, te lleva directo a tu página.
      router.push(urlFicha({ ...pelicula, id: dbId }));
    } else {
      // Magia 2: Si NO la tienes, la guarda en tu base de datos y luego te lleva a la página.
      try {
        const res = await fetch('http://localhost:3001/media/tmdb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tmdbId: pelicula.id, tipo: 'PELICULA' })
        });
        const nuevaPeli = await res.json();
        router.push(urlFicha(nuevaPeli));
      } catch (error) {
        console.error("Error al guardar la película", error);
        setLoading(false);
      }
    }
  };

  // Magia 3: Si tienes un póster personalizado (customPoster), usa ese. Si no, usa el
  // ya guardado (item.portada, para items que vienen de tu propia base de datos como
  // listas/perfil) o el de TMDB (poster_path, para resultados de búsqueda en crudo).
  const posterUrl = miCustomPoster || pelicula.portada || (pelicula.poster_path ? `https://image.tmdb.org/t/p/w500${pelicula.poster_path}` : null);
  const titulo = pelicula.title || pelicula.name || pelicula.titulo;
  const anio = pelicula.anio || (pelicula.release_date ? pelicula.release_date.split('-')[0] : (pelicula.first_air_date ? pelicula.first_air_date.split('-')[0] : ''));

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

      {/* Oscurecer y mostrar título + año al pasar el cursor */}
      {!loading && (
        <div className="absolute inset-0 rounded-md bg-black/90 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-center p-2 pointer-events-none">
          <p className="text-sm font-bold text-white">
            {titulo} <span className="font-normal text-gray-300">({anio})</span>
          </p>
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