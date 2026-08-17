'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { urlFicha } from '@/lib/slug';

export default function CollectionGamesLinks({ igdbId }: { igdbId: number }) {
  const [collection, setCollection] = useState<{ prequel: any, sequel: any, nombreColeccion: string | null, parts: any[] } | null>(null);
  const [myDb, setMyDb] = useState<any[]>([]);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!igdbId) return;
    const fetchData = async () => {
      const resCol = await fetch(`http://localhost:3001/igdb/collection/${igdbId}`);
      const colData = await resCol.json();
      setCollection(colData);

      const resDb = await fetch('http://localhost:3001/media');
      const dbData = await resDb.json();
      setMyDb(dbData);
    };
    fetchData();
  }, [igdbId]);

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
    const local = myDb.find((m: any) => m.igdbId === id);
    return { dbId: local?.id || null, customPoster: local?.portada || null };
  };

  const getAnio = (item: any) => item.first_release_date ? new Date(item.first_release_date * 1000).getFullYear() : '—';

  const handleClick = async (item: any, dbId: number | null) => {
    if (loadingId) return;
    setLoadingId(item.id);

    if (dbId) {
      router.push(urlFicha({ ...item, id: dbId }));
    } else {
      try {
        const res = await fetch('http://localhost:3001/media/igdb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ igdbId: item.id })
        });
        const nuevo = await res.json();
        router.push(urlFicha(nuevo));
      } catch (e) {
        setLoadingId(null);
      }
    }
  };

  const renderItem = (item: any, label: string) => {
    if (!item) return null;
    const { dbId, customPoster } = getLocalData(item.id);
    const posterUrl = customPoster || item.cover?.url || null;

    return (
      <div onClick={() => handleClick(item, dbId)} className="flex flex-col items-center gap-1.5 cursor-pointer group w-24">
        <div className="relative w-full aspect-[2/3] rounded border border-gray-700 group-hover:border-gray-400 transition shadow-lg overflow-hidden bg-gray-800">
          {posterUrl ? (
            <img src={posterUrl} alt={item.name} className={`w-full h-full object-cover ${loadingId === item.id ? 'opacity-50 blur-sm' : ''}`} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-center p-1">{item.name}</div>
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
    const posterUrl = customPoster || item.cover?.url || null;
    const esActual = item.id === igdbId;

    return (
      <div
        key={item.id}
        onClick={() => handleClick(item, dbId)}
        className={`flex flex-col items-center gap-2 p-2 rounded-lg cursor-pointer transition ${esActual ? 'bg-gray-800/80 ring-1 ring-blue-500' : 'hover:bg-gray-800/50'
          }`}
      >
        <div className="w-full aspect-[2/3] rounded overflow-hidden border border-gray-700 bg-gray-800 flex items-center justify-center">
          {posterUrl ? (
            <img src={posterUrl} alt={item.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-center p-1 text-gray-400">{item.name}</div>
          )}
        </div>
        <div className="text-center">
          <p className="font-semibold text-white text-sm leading-tight">{item.name}</p>
          <p className="text-xs text-gray-400">{getAnio(item)}{esActual ? ' · Estás viendo esta' : ''}</p>
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