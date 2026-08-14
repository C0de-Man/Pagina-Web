import Link from 'next/link';

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q: string }> }) {
  const resolvedParams = await searchParams;
  const query = resolvedParams.q;

  // Hacemos la petición a nuestra ruta del backend para buscar en TMDB
  const res = await fetch(`http://localhost:3001/search?q=${query}`, { cache: 'no-store' });
  const results = await res.json();

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* COLUMNA ÚNICA: RESULTADOS */}
        <div className="border-b border-gray-700 pb-2 mb-6">
          <h1 className="text-xs text-gray-400 font-bold uppercase tracking-wider">
            Showing matches for "{query}"
          </h1>
        </div>

        <div className="space-y-6">
          {results.length === 0 ? (
            <p className="text-gray-400">No se encontraron resultados.</p>
          ) : (
            results.map((item: any) => (
              <div key={item.id} className="flex gap-4 group">
                <div className="flex-shrink-0 w-24">
                  {item.poster_path ? (
                    <img 
                      src={`https://image.tmdb.org/t/p/w200${item.poster_path}`} 
                      alt={item.title || item.name} 
                      className="w-full rounded border border-gray-700 group-hover:border-gray-500 transition object-cover aspect-[2/3]"
                    />
                  ) : (
                    <div className="w-full aspect-[2/3] bg-gray-800 rounded border border-gray-700 flex items-center justify-center text-xs text-gray-500 text-center p-2">Sin imagen</div>
                  )}
                </div>
                
                <div className="flex flex-col pt-1">
                  <div className="flex items-baseline gap-2 mb-1">
                    <h2 className="text-xl font-bold text-white group-hover:text-blue-400 transition cursor-pointer">
                      {item.title || item.name}
                    </h2>
                    <span className="text-sm text-gray-400">
                      {item.release_date ? item.release_date.split('-')[0] : (item.first_air_date ? item.first_air_date.split('-')[0] : '')}
                    </span>
                  </div>
                  
                  <p className="text-sm text-gray-400 line-clamp-3">
                    {item.overview || "Sin descripción disponible."}
                  </p>
                  
                  <div className="mt-2">
                     <span className="text-xs font-semibold bg-gray-800 px-2 py-1 rounded text-gray-400">
                       {item.media_type === 'movie' ? 'PELÍCULA' : item.media_type === 'tv' ? 'SERIE' : 'OTRO'}
                     </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

      </div>
    </main>
  );
}