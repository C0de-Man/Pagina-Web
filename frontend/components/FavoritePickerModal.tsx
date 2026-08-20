'use client';
import { useState, useEffect } from 'react';
import { withLangRegion } from '@/lib/preferences';

export default function FavoritePickerModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (media: any) => void;
}) {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResultados([]);
      return;
    }
    const timeout = setTimeout(() => {
      setLoading(true);
      // Buscamos a la vez en TMDB (películas/series) e IGDB (juegos), igual
      // que hace la página /search — antes esto solo miraba TMDB, así que
      // buscar un juego (p. ej. "Red Dead Redemption 2") no encontraba nada.
      Promise.all([
        fetch(withLangRegion(`http://localhost:3001/tmdb/buscar?q=${encodeURIComponent(query)}`)).then((r) => r.json()).catch(() => []),
        fetch(`http://localhost:3001/igdb/search?q=${encodeURIComponent(query)}`).then((r) => r.json()).catch(() => []),
      ])
        .then(([tmdbData, igdbData]) => {
          // /tmdb/buscar usa TMDB search/multi: además de películas y series
          // trae personas (actores, directores...) mezcladas, que aquí no queremos.
          const soloPeliculasYSeries = (Array.isArray(tmdbData) ? tmdbData : [])
            .filter((item: any) => item.media_type === 'movie' || item.media_type === 'tv');

          const juegos = (Array.isArray(igdbData) ? igdbData : []).map((j: any) => ({
            ...j,
            media_type: 'juego',
          }));

          setResultados([...soloPeliculasYSeries, ...juegos].slice(0, 12));
        })
        .catch(() => setResultados([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const elegir = async (item: any) => {
    try {
      const resDb = await fetch('http://localhost:3001/media');
      const myDb = await resDb.json();

      if (item.media_type === 'juego') {
        const local = myDb.find((m: any) => m.igdbId === item.id);
        if (local) {
          onSelect(local);
        } else {
          const res = await fetch('http://localhost:3001/media/igdb', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ igdbId: item.id }),
          });
          const nuevo = await res.json();
          onSelect(nuevo);
        }
        return;
      }

      const local = myDb.find((m: any) => m.tmdbId === item.id);
      if (local) {
        onSelect(local);
      } else {
        const res = await fetch('http://localhost:3001/media/tmdb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tmdbId: item.id, tipo: item.media_type === 'tv' ? 'SERIE' : 'PELICULA' }),
        });
        const nueva = await res.json();
        onSelect(nueva);
      }
    } catch (e) {
      // si falla, simplemente no seleccionamos nada
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-md p-5 text-white shadow-2xl"
      >
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-300">Pick a favorite title</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl cursor-pointer">✕</button>
        </div>

        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name of a film, series or game"
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />

        <div className="mt-3 max-h-72 overflow-y-auto space-y-1">
          {loading && <p className="text-gray-500 text-sm px-1">Buscando...</p>}
          {!loading && resultados.map((item) => {
            const titulo = item.title || item.name;
            const anio = item.release_date
              ? item.release_date.split('-')[0]
              : item.first_air_date
              ? item.first_air_date.split('-')[0]
              : item.first_release_date
              ? new Date(item.first_release_date * 1000).getFullYear()
              : '';
            const etiquetaTipo = item.media_type === 'juego' ? 'Juego' : item.media_type === 'tv' ? 'Serie' : 'Película';
            return (
              <div
                key={`${item.media_type}-${item.id}`}
                onClick={() => elegir(item)}
                className="px-3 py-2 rounded hover:bg-gray-800 cursor-pointer text-sm flex justify-between items-center transition"
              >
                <span>{titulo} {anio && <span className="text-gray-500">({anio})</span>}</span>
                <span className="text-[10px] text-gray-500 uppercase tracking-wide ml-2 flex-shrink-0">{etiquetaTipo}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}