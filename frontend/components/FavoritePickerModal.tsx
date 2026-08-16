'use client';
import { useState, useEffect } from 'react';

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
      fetch(`http://localhost:3001/search?q=${encodeURIComponent(query)}`)
        .then((res) => res.json())
        .then((data) => setResultados(Array.isArray(data) ? data.slice(0, 8) : []))
        .catch(() => setResultados([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const elegir = async (item: any) => {
    try {
      const resDb = await fetch('http://localhost:3001/media');
      const myDb = await resDb.json();
      const local = myDb.find((m: any) => m.tmdbId === item.id);

      if (local) {
        onSelect(local);
      } else {
        const res = await fetch('http://localhost:3001/media/tmdb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tmdbId: item.id, tipo: 'PELICULA' }),
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
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-300">Pick a favorite film</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl cursor-pointer">✕</button>
        </div>

        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name of Film"
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />

        <div className="mt-3 max-h-72 overflow-y-auto space-y-1">
          {loading && <p className="text-gray-500 text-sm px-1">Buscando...</p>}
          {!loading && resultados.map((item) => {
            const titulo = item.title || item.name;
            const anio = item.release_date ? item.release_date.split('-')[0] : (item.first_air_date ? item.first_air_date.split('-')[0] : '');
            return (
              <div
                key={item.id}
                onClick={() => elegir(item)}
                className="px-3 py-2 rounded hover:bg-gray-800 cursor-pointer text-sm flex justify-between items-center transition"
              >
                <span>{titulo} {anio && <span className="text-gray-500">({anio})</span>}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}