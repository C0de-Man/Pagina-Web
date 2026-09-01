'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { urlFicha } from '@/lib/slug';

export default function MovieCard({ pelicula, dbId, customPoster }: { pelicula: any, dbId: number | null, customPoster: string | null }) {
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
      .catch(() => { });
  }, [dbId, customPoster]);

  // Href real, siempre resoluble sin JS:
  // - Si ya la tienes en TU base de datos (dbId), vamos directo a su ficha.
  // - Si no, vamos a la resolvedora /movie/tmdb/[tmdbId], que la guarda y
  //   redirige a su ficha — así el click central / Ctrl+click / "abrir en
  //   pestaña nueva" funcionan como en cualquier enlace normal, sin
  //   necesidad de interceptar el click con JS.
  // TMDB marca cada resultado con media_type ('movie' | 'tv') — sin esto,
  // el enlace siempre apuntaba a la resolvedora de PELÍCULAS aunque fuera
  // una serie, y como los ids de TMDB para películas y series son espacios
  // numéricos totalmente distintos, acababa cargando una película random
  // que compartía ese número (o nada, si no existía ninguna).
  const tipo = pelicula.media_type === 'tv' ? 'SERIE' : (pelicula.tipo || 'PELICULA');
  const resolvedorTmdb = tipo === 'SERIE' ? 'series' : 'movie';
  const href = dbId ? urlFicha({ ...pelicula, tipo, id: dbId }) : `/${resolvedorTmdb}/tmdb/${pelicula.id}`;
  // Magia: Si tienes un póster personalizado (customPoster), usa ese. Si no, usa el
  // ya guardado (item.portada, para items que vienen de tu propia base de datos como
  // listas/perfil) o el de TMDB (poster_path, para resultados de búsqueda en crudo).
  const posterUrl = miCustomPoster || pelicula.portada || (pelicula.poster_path ? `https://image.tmdb.org/t/p/w780${pelicula.poster_path}` : null);
  const titulo = pelicula.title || pelicula.name || pelicula.titulo;
  const anio = pelicula.anio || (pelicula.release_date ? pelicula.release_date.split('-')[0] : (pelicula.first_air_date ? pelicula.first_air_date.split('-')[0] : ''));

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

      {/* Oscurecer y mostrar título + año al pasar el cursor */}
      <div className="absolute inset-0 rounded-md bg-black/90 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-center p-2 pointer-events-none">
        <p className="text-sm font-bold text-white">
          {titulo} <span className="font-normal text-gray-300">({anio})</span>
        </p>
      </div>
    </Link>
  );
}