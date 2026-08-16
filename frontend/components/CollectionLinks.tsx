'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { urlFicha } from '@/lib/slug';
import { withLangRegion } from '@/lib/preferences';

export default function CollectionLinks({ tmdbId }: { tmdbId: number }) {
  const [collection, setCollection] = useState<{ prequel: any, sequel: any, nombreColeccion: string | null, parts: any[] } | null>(null);
  const [myDb, setMyDb] = useState<any[]>([]);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!tmdbId) return;
    const fetchData = async () => {
      const resCol = await fetch(withLangRegion(`http://localhost:3001/tmdb/collection/${tmdbId}`));
      const colData = await resCol.json();
      setCollection(colData);

      const resDb = await fetch('http://localhost:3001/media');
      const dbData = await resDb.json();
      setMyDb(dbData);
    };
    fetchData();
  }, [tmdbId]);

  useEffect(() => {
    if (!isModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  if (!collection || (!collection.prequel && !collection.sequel)) return null;

  const getLocalData = (id: number) => {
    const local = myDb.find((m: any) => m.tmdbId === id);
    return { dbId: local?.id || null, customPoster: local?.portada || null };
  };

  const handleClick = async (item: any, dbId: number | null) => {
    if (loadingId) return;
    setLoadingId(item.id);

    if (dbId) {
      router.push(urlFicha({ ...item, id: dbId }));
    } else {
      try {
        const res = await fetch('http://localhost:3001/media/tmdb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tmdbId: item.id, tipo: 'PELICULA' })
        });
        const nueva = await res.json();
        router.push(urlFicha(nueva));
      } catch (e) {
        setLoadingId(null);
      }
    }
  };

  const renderItem = (item: any, label: string) => {
    if (!item) return null;
    const { dbId, customPoster } = getLocalData(item.id);
    const posterUrl = customPoster || (item.poster_path ? `https://image.tmdb.org/t/p/w200${item.poster_path}` : null);

    return (
      <div onClick={() => handleClick(item, dbId)} className="flex flex-col items-center gap-1.5 cursor-pointer group w-24">
        <div className="relative w-full aspect-[2/3] rounded border border-gray-700 group-hover:border-gray-400 transition shadow-lg overflow-hidden bg-gray-800">
          {posterUrl ? (
            <img src={posterUrl} alt={item.title} className={`w-full h-full object-cover ${loadingId === item.id ? 'opacity-50 blur-sm' : ''}`} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-center p-1">{item.title}</div>
          )}
          {loadingId === item.id && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <span className="text-white text-[10px] font-bold">...</span>
            </div>
          )}
        </div>
        <span className="text-xs text-gray-400 group-hover:text-white transition font-medium">{label}</span>
      </div>
    );
  };

  const renderFullCard = (item: any) => {
    const { dbId, customPoster } = getLocalData(item.id);
    const posterUrl = customPoster || (item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null);
    const anio = item.release_date ? item.release_date.split('-')[0] : '—';
    const esActual = item.id === tmdbId;

    return (
      <div
        key={item.id}
        onClick={() => handleClick(item, dbId)}
        className={`flex flex-col items-center gap-2 p-2 rounded-lg cursor-pointer transition ${
          esActual ? 'bg-gray-800/80 ring-1 ring-blue-500' : 'hover:bg-gray-800/50'
        }`}
      >
        <div className="w-full aspect-[2/3] rounded overflow-hidden border border-gray-700 bg-gray-800">
          {posterUrl ? (
            <img src={posterUrl} alt={item.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-center p-1 text-gray-400">{item.title}</div>
          )}
        </div>
        <div className="text-center">
          <p className="font-semibold text-white text-sm leading-tight">{item.title}</p>
          <p className="text-xs text-gray-400">{anio}{esActual ? ' · Estás viendo esta' : ''}</p>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="mt-4 bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl">
        <div className="flex justify-around items-center">
          {renderItem(collection.prequel, 'Precuela')}
          {renderItem(collection.sequel, 'Secuela')}
        </div>

        {collection.parts && collection.parts.length > 2 && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="w-full mt-4 text-xs text-gray-400 hover:text-white text-center underline cursor-pointer bg-gray-900/80 py-2 rounded border border-gray-800 transition"
          >
            Ver más de la saga
          </button>
        )}
      </div>

      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-gray-900 border border-gray-700 rounded-lg max-w-5xl w-full max-h-[85vh] text-white shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-700 flex-shrink-0">
              <h2 className="text-xl font-bold">
                {collection.nombreColeccion || 'Saga completa'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-white text-2xl font-bold cursor-pointer">✕</button>
            </div>

            <div className="overflow-y-auto p-6">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
                {collection.parts.map(renderFullCard)}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}