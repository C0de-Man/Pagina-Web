'use client';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import Link from 'next/link'; // 1. Añadimos la importación de Link
import { urlFicha } from '@/lib/slug';

export default function SearchResultItem({ item, dbId, portadaCompartida }: { item: any, dbId: number | null, portadaCompartida: string | null }) {
  const router = useRouter();
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

  // 2. Calculamos de antemano si ya tenemos una URL directa a la que ir
  let urlDirecta = null;
  if (dbId) {
    const tipo = esLibro ? 'LIBRO' : undefined;
    urlDirecta = urlFicha({ ...item, id: dbId, ...(tipo ? { tipo } : {}) });
  } else if (esLibro) {
    urlDirecta = hrefLibroSinGuardar();
  }

  // 3. El handleClick original, pero solo se usa si NO hay urlDirecta
  const handleClick = async () => {
    if (loading || urlDirecta) return; 
    setLoading(true);

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
  };

  const posterUrl = miCustomPoster || portadaCompartida ||
    (esJuego ? item.cover?.url : esLibro ? item.portada : item.poster_path ? `https://image.tmdb.org/t/p/w200${item.poster_path}` : null);
  
  const title = esJuego ? item.name : esLibro ? item.titulo : (item.title || item.name);
  const year = esJuego ? (item.first_release_date ? new Date(item.first_release_date * 1000).getFullYear() : '') : esLibro ? (item.anio || '') : (item.release_date ? item.release_date.split('-')[0] : (item.first_air_date ? item.first_air_date.split('-')[0] : ''));
  const descripcion = esJuego ? item.summary : esLibro ? item.autor : item.overview;
  const etiqueta = item.media_type === 'movie' ? 'MOVIE' : item.media_type === 'tv' ? 'SERIES' : esJuego ? 'GAME' : esLibro ? 'BOOK' : 'OTHER';

  const clasesContenedor = `flex gap-4 group cursor-pointer transition ${loading ? 'opacity-50 blur-sm' : ''}`;

  // 4. Extraemos el contenido visual para no repetirlo
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

  // 5. Renderizado condicional: si hay URL usamos <Link> (soporta clic central), sino usamos <div>
  if (urlDirecta) {
    return (
      <Link href={urlDirecta} className={clasesContenedor}>
        {ContenidoTarjeta}
      </Link>
    );
  }

  return (
    <div onClick={handleClick} className={clasesContenedor}>
      {ContenidoTarjeta}
    </div>
  );
}