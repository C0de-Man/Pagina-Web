'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { urlFicha } from '@/lib/slug';

export default function SearchResultItem({ item, dbId, portadaCompartida }: { item: any, dbId: number | null, portadaCompartida: string | null }) {
  const [loading, setLoading] = useState(false);
  const esJuego = item.media_type === 'juego';
  const esLibro = item.media_type === 'libro';
  const [miCustomPoster, setMiCustomPoster] = useState<string | null>(null);

  useEffect(() => {
    if (!dbId) return;
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
  }, [dbId]);

  const hrefLibroSinGuardar = () => {
    switch (item.fuente) {
      case 'mal': return `/book/mal/${item.origenId}`;
      case 'mangadex': return `/book/mangadex/${item.origenId}`;
      case 'comicvine': return `/book/comicvine/${item.origenId}`;
      case 'anilist': return `/book/anilist/${item.origenId}`;
      default: return `/book/googlebooks/${item.origenId}`;
    }
  };

  // 2. Calculamos SIEMPRE la URL directa usando el formato resolutivo (ej: /game/igdb/123)
  // Aunque no esté en DB, Next.js interceptará la ruta y lo creará al vuelo allí.
  let urlDirecta = '';
  
  if (dbId) {
    const tipo = esLibro ? 'LIBRO' : undefined;
    urlDirecta = urlFicha({ ...item, id: dbId, ...(tipo ? { tipo } : {}) });
  } else {
    // Si no está en DB, usamos las rutas resolutoras
    if (esJuego) urlDirecta = `/game/igdb/${item.id}`;
    else if (esLibro) urlDirecta = hrefLibroSinGuardar();
    else {
        const tipoEnlace = item.media_type === 'tv' ? 'series' : 'movie';
        urlDirecta = `/${tipoEnlace}/tmdb/${item.id}`;
    }
  }

  const posterUrl = miCustomPoster || portadaCompartida ||
    (esJuego ? item.cover?.url : esLibro ? item.portada : item.poster_path ? `https://image.tmdb.org/t/p/w200${item.poster_path}` : null);
  
  const title = esJuego ? item.name : esLibro ? item.titulo : (item.title || item.name);
  const year = esJuego ? (item.first_release_date ? new Date(item.first_release_date * 1000).getFullYear() : '') : esLibro ? (item.anio || '') : (item.release_date ? item.release_date.split('-')[0] : (item.first_air_date ? item.first_air_date.split('-')[0] : ''));
  const descripcion = esJuego ? item.summary : esLibro ? item.autor : item.overview;
  const etiqueta = item.media_type === 'movie' ? 'MOVIE' : item.media_type === 'tv' ? 'SERIES' : esJuego ? 'GAME' : esLibro ? 'BOOK' : 'OTHER';

  const clasesContenedor = `flex gap-4 group cursor-pointer transition ${loading ? 'opacity-50 blur-sm' : ''}`;

  const ContenidoTarjeta = (
    <>
      <div className="flex-shrink-0 w-24 relative">
        {posterUrl ? (
          <img src={posterUrl} alt={title} className="w-full rounded border border-gray-700 group-hover:border-gray-400 transition object-cover aspect-[2/3] shadow-lg" />
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
          <h2 className="text-xl font-bold text-white group-hover:text-blue-400 transition">{title}</h2>
          <span className="text-sm text-gray-400">{year}</span>
        </div>
        <p className="text-sm text-gray-400 line-clamp-3">{descripcion || "Sin descripción disponible."}</p>
        <div className="mt-2 flex gap-2">
           <span className="text-xs font-semibold bg-gray-800 px-2 py-1 rounded text-gray-400">{etiqueta}</span>
        </div>
      </div>
    </>
  );

  return (
    <Link 
      href={urlDirecta} 
      className={clasesContenedor}
      onClick={() => setLoading(true)} // Mantenemos el efecto de desenfoque al hacer clic normal
    >
      {ContenidoTarjeta}
    </Link>
  );
}