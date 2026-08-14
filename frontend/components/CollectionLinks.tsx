'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CollectionLinks({ tmdbId }: { tmdbId: number }) {
  const [collection, setCollection] = useState<{ prequel: any, sequel: any } | null>(null);
  const [myDb, setMyDb] = useState<any[]>([]);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!tmdbId) return;
    const fetchData = async () => {
      const resCol = await fetch(`http://localhost:3001/tmdb/collection/${tmdbId}`);
      const colData = await resCol.json();
      setCollection(colData);

      const resDb = await fetch('http://localhost:3001/media');
      const dbData = await resDb.json();
      setMyDb(dbData);
    };
    fetchData();
  }, [tmdbId]);

  if (!collection || (!collection.prequel && !collection.sequel)) return null;

  const getLocalData = (id: number) => {
    const local = myDb.find((m: any) => m.tmdbId === id);
    return { dbId: local?.id || null, customPoster: local?.portada || null };
  };

  const handleClick = async (item: any, dbId: number | null) => {
    if (loadingId) return;
    setLoadingId(item.id);

    if (dbId) {
      router.push(`/media/${dbId}`);
    } else {
      try {
        const res = await fetch('http://localhost:3001/media/tmdb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tmdbId: item.id, tipo: 'PELICULA' })
        });
        const nueva = await res.json();
        router.push(`/media/${nueva.id}`);
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

  return (
    <div className="mt-4 bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl flex justify-around items-center">
      {renderItem(collection.prequel, 'Precuela')}
      {renderItem(collection.sequel, 'Secuela')}
    </div>
  );
}