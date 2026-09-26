import Link from 'next/link';
import { urlGenero } from '@/lib/slug';

export default async function GenrePage({
  params,
  searchParams,
}: {
  params: Promise<{ nombre: string; id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const { page } = await searchParams;
  const currentPage = parseInt(page || '1');

  const genreId = parseInt(id, 10);
  if (Number.isNaN(genreId)) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        Genre not found
      </main>
    );
  }

  const [res, resDb] = await Promise.all([
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/igdb/genre/${genreId}?page=${currentPage}`, { cache: 'no-store' }),
    fetch('${process.env.NEXT_PUBLIC_API_URL}/media', { cache: 'no-store' }),
  ]);

  if (!res.ok) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        Genre not found
      </main>
    );
  }

  const data = await res.json();
  const myDb = await resDb.json();
  const slugCanonico = urlGenero(genreId, data.nombre);

  const getPortada = (juego: any) => {
    const local = myDb.find((m: any) => m.igdbId === juego.igdbId);
    return local?.portada || juego.portada;
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white font-sans py-10">
      <div className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-16">
        <div className="border-b border-gray-800 pb-6 mb-8">
          <h1 className="text-2xl font-bold">{data.nombre}</h1>
        </div>

        {data.juegos.length === 0 ? (
          <p className="text-gray-500">No games found for this genre.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
            {data.juegos.map((juego: any) => {
              const portada = getPortada(juego);
              return (
                <Link key={juego.igdbId} href={`/game/igdb/${juego.igdbId}`} className="group relative block">
                  {portada ? (
                    <img
                      src={portada}
                      alt={juego.titulo}
                      className="w-full aspect-[2/3] object-cover rounded-md border border-gray-700 group-hover:border-gray-400 transition shadow-lg"
                    />
                  ) : (
                    <div className="w-full aspect-[2/3] bg-gray-800 rounded-md border border-gray-700 flex items-center justify-center text-xs text-center p-2">
                      {juego.titulo}
                    </div>
                  )}
                  <div className="absolute inset-0 rounded-md bg-black/90 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-center p-2 pointer-events-none">
                    <p className="text-sm font-bold text-white">
                      {juego.titulo} <span className="font-normal text-gray-300">({juego.anio})</span>
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {data.totalPaginas > 1 && (
          <div className="border-t border-gray-800 mt-8 pt-6 flex items-center justify-center gap-1 flex-wrap">
            {currentPage > 1 && (
              <Link href={`${slugCanonico}?page=${currentPage - 1}`} className="px-2 py-1 text-sm text-gray-400 hover:text-white transition">
                ‹
              </Link>
            )}

            {(() => {
              const total = data.totalPaginas;
              const paginas: (number | 'ellipsis')[] = [];
              const ventana = 2;

              paginas.push(1);
              if (currentPage - ventana > 2) paginas.push('ellipsis');
              for (let p = Math.max(2, currentPage - ventana); p <= Math.min(total - 1, currentPage + ventana); p++) {
                paginas.push(p);
              }
              if (currentPage + ventana < total - 1) paginas.push('ellipsis');
              if (total > 1) paginas.push(total);

              return paginas.map((p, i) =>
                p === 'ellipsis' ? (
                  <span key={`ellipsis-${i}`} className="px-2 py-1 text-sm text-gray-600">
                    …
                  </span>
                ) : (
                  <Link
                    key={p}
                    href={`${slugCanonico}?page=${p}`}
                    className={`px-3 py-1 rounded text-sm transition ${
                      p === currentPage
                        ? 'bg-white text-black font-bold'
                        : 'text-gray-400 hover:text-white hover:bg-gray-800'
                    }`}
                  >
                    {p}
                  </Link>
                )
              );
            })()}

            {currentPage < data.totalPaginas && (
              <Link href={`${slugCanonico}?page=${currentPage + 1}`} className="px-2 py-1 text-sm text-gray-400 hover:text-white transition">
                ›
              </Link>
            )}
          </div>
        )}
      </div>
    </main>
  );
}