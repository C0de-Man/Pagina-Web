'use client';
import { useState, useEffect } from 'react';
import { getRegion } from '@/lib/preferences';

export default function WatchProviders({ tmdbId, tipo }: { tmdbId: number; tipo?: string }) {
  const [data, setData] = useState<{ link: string | null; flatrate: any[]; rent: any[]; buy: any[] } | null>(null);

  useEffect(() => {
    if (!tmdbId) return;
    const tipoParam = tipo ? `&tipo=${tipo}` : '';
    fetch(`http://localhost:3001/tmdb/watch-providers/${tmdbId}?region=${getRegion()}${tipoParam}`).then((res) => res.json())
      .then(setData)
      .catch(() => { });
  }, [tmdbId, tipo]);

  if (!data || (data.flatrate.length === 0 && data.rent.length === 0 && data.buy.length === 0)) {
    return null;
  }

  const renderFila = (titulo: string, providers: any[]) => {
    if (providers.length === 0) return null;
    return (
      <div className="mb-3 last:mb-0">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1.5">{titulo}</p>
        <div className="flex flex-wrap gap-2">
          {providers.map((p) => (
            <img
              key={p.provider_id}
              src={`https://image.tmdb.org/t/p/w92${p.logo_path}`}
              alt={p.provider_name}
              title={p.provider_name}
              className="w-9 h-9 rounded-lg border border-gray-700 object-cover"
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="mt-4 bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl">
      <h3 className="text-sm font-bold text-white mb-3">Dónde ver</h3>

      {renderFila('Suscripción', data.flatrate)}
      {renderFila('Alquiler', data.rent)}
      {renderFila('Compra', data.buy)}

      {data.link ? (
        <a
          href={data.link}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-[10px] text-gray-500 hover:text-gray-300 transition mt-3 pt-3 border-t border-gray-800"
        >
          Datos de streaming proporcionados por JustWatch
        </a>
      ) : null}
    </div>
  );
}
