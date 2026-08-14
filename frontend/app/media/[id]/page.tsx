export default async function MediaDetail({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const resolvedParams = await params;
  const id = resolvedParams.id;

  const res = await fetch(`http://localhost:3001/media/${id}`, { cache: 'no-store' });
  const media = await res.json();

  if (!media || media.error) {
    return <div className="p-8 text-white text-center">Medio no encontrado</div>;
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white font-sans pb-16">
      
      {/* ZONA BACKDROP REAL */}
      {media.backdrop ? (
        <div className="w-full h-64 md:h-80 relative border-b border-gray-800 overflow-hidden">
          <img 
            src={media.backdrop} 
            alt="Backdrop" 
            className="w-full h-full object-cover opacity-60" 
          />
          <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/20 to-transparent" />
        </div>
      ) : (
        <div className="w-full h-64 md:h-80 bg-gradient-to-b from-gray-800 to-gray-950 flex items-center justify-center border-b border-gray-800">
           <span className="text-gray-600 font-bold tracking-widest">SIN BACKDROP</span>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-24 md:-mt-32 relative z-10">
        <div className="flex flex-col md:flex-row gap-8">
          
          <div className="flex-shrink-0 w-48 md:w-64">
            {media.portada ? (
              <img src={media.portada} alt={media.titulo} className="w-full rounded-lg shadow-2xl border-2 border-gray-800 object-cover aspect-[2/3]" />
            ) : (
              <div className="w-full aspect-[2/3] bg-gray-800 rounded-lg shadow-2xl border-2 border-gray-800 flex items-center justify-center">Sin imagen</div>
            )}
            <button className="w-full mt-3 text-xs text-gray-500 hover:text-white text-center underline cursor-pointer">
              Botón para cambiar el poster
            </button>
          </div>

          <div className="flex-grow pt-24 md:pt-32">
            <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-2">{media.titulo}</h1>
            <div className="flex items-center gap-4 text-gray-400 mb-6 border-b border-gray-800 pb-4">
              <span className="text-lg">{media.anio}</span>
              <span className="bg-gray-800 px-2 py-1 rounded text-xs font-semibold">{media.tipo}</span>
            </div>
            <p className="text-gray-300 leading-relaxed text-lg">{media.sinopsis}</p>
          </div>

          <div className="flex-shrink-0 w-full md:w-72 pt-24 md:pt-32">
            <div className="bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl">
              <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-4">
                <button className="flex flex-col items-center text-gray-400 hover:text-green-400 transition">
                  <span className="text-2xl mb-1">👁️</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider">Watched</span>
                </button>
                <button className="flex flex-col items-center text-gray-400 hover:text-orange-400 transition">
                  <span className="text-2xl mb-1">❤️</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider">Liked</span>
                </button>
                <button className="flex flex-col items-center text-gray-400 hover:text-blue-400 transition">
                  <span className="text-2xl mb-1">⏱️</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider">Watchlist</span>
                </button>
              </div>
              
              <div className="flex justify-between items-center bg-gray-900 rounded p-3 mb-4 cursor-pointer hover:bg-gray-800 transition">
                <span className="text-sm font-semibold text-gray-300">(5) Average</span>
                <span className="text-yellow-500">⭐ ▽</span>
              </div>

              <div className="space-y-2">
                <button className="w-full bg-[#2c3440] hover:bg-gray-600 text-white font-bold py-2 rounded text-sm transition">
                  Review or log...
                </button>
                <button className="w-full bg-[#2c3440] hover:bg-gray-600 text-white font-bold py-2 rounded text-sm transition">
                  Add to lists...
                </button>
              </div>
            </div>

            <div className="mt-4 bg-[#1c2228] rounded-lg border border-gray-700 p-4 text-center shadow-xl">
              <div className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">SCORE</div>
              <div className="text-3xl font-extrabold text-blue-400">8.00</div>
              <div className="text-xs text-gray-500 mt-1">1,278,028 users</div>
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}