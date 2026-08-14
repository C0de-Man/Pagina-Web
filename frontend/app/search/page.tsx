import SearchResultItem from '@/components/SearchResultItem';

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q: string }> }) {
  const resolvedParams = await searchParams;
  const query = resolvedParams.q;

  // 1. Buscamos en la API de TMDB
  const res = await fetch(`http://localhost:3001/search?q=${query}`, { cache: 'no-store' });
  const results = await res.json();

  // 2. Obtenemos TU base de datos local para comparar
  const resDb = await fetch('http://localhost:3001/media', { cache: 'no-store' });
  const myDb = await resDb.json();

  const getLocalData = (tmdbId: number) => {
    const local = myDb.find((m: any) => m.tmdbId === tmdbId);
    return {
      dbId: local ? local.id : null,
      customPoster: local ? local.portada : null
    };
  };

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="border-b border-gray-700 pb-2 mb-6">
          <h1 className="text-xs text-gray-400 font-bold uppercase tracking-wider">
            Showing matches for "{query}"
          </h1>
        </div>

        <div className="space-y-6">
          {results.length === 0 ? (
            <p className="text-gray-400">No se encontraron resultados.</p>
          ) : (
            results.map((item: any) => {
              const { dbId, customPoster } = getLocalData(item.id);
              return (
                <SearchResultItem 
                  key={item.id} 
                  item={item} 
                  dbId={dbId} 
                  customPoster={customPoster} 
                />
              );
            })
          )}
        </div>

      </div>
    </main>
  );
}