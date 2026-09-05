import MovieCard from '@/components/MovieCard';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { extraerIdDeSlug, urlEstudio } from '@/lib/slug';

export default async function StudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page } = await searchParams;
  const currentPage = parseInt(page || '1');

  const companyId = extraerIdDeSlug(slug);
  if (!companyId) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        Studio not found
      </main>
    );
  }

  const cookieStore = await cookies();
  const idioma = cookieStore.get('idioma')?.value || 'es-ES';
  const region = cookieStore.get('region')?.value || 'ES';

  const res = await fetch(
    `http://localhost:3001/tmdb/company/${companyId}?language=${idioma}&region=${region}&page=${currentPage}`,
    { cache: 'no-store' }
  );

  if (!res.ok) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        Studio not found
      </main>
    );
  }

  const data = await res.json();

  // La URL "canónica" es siempre nombre-en-inglés + id, calculada a partir
  // de lo que devuelve el backend (data.nombre) — así, aunque alguien entre
  // con un slug desactualizado o solo el id pelado, la paginación y
  // cualquier enlace interno siempre usan el slug correcto.
  const slugCanonico = urlEstudio(data.id, data.nombre);

  const resDb = await fetch('http://localhost:3001/media', { cache: 'no-store' });
  const myDb = await resDb.json();
  const getLocalData = (tmdbId: number, esSerie: boolean) => {
    const local = myDb.find((m: any) => m.tmdbId === tmdbId && m.tipo === (esSerie ? 'SERIE' : 'PELICULA'));
    return { dbId: local ? local.id : null, portadaCompartida: local?.portada || null };
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white font-sans py-10">
      <div className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-16">
        <div className="flex items-center gap-4 border-b border-gray-800 pb-6 mb-8">
          {data.logo && (
            <div className="bg-white rounded p-3 flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.logo} alt={data.nombre} className="h-12 object-contain" />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold">{data.nombre}</h1>
            {data.pais && <p className="text-sm text-gray-500">{data.pais}</p>}
          </div>
        </div>

        {data.peliculas.length === 0 ? (
          <p className="text-gray-500">Nothing found for this studio.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
            {data.peliculas.map((pelicula: any) => {
              const { dbId, portadaCompartida } = getLocalData(pelicula.id, pelicula.media_type === 'tv');
              return (
                <div key={`${pelicula.media_type}-${pelicula.id}`} className="w-full">
                  <MovieCard
                    pelicula={portadaCompartida ? { ...pelicula, portada: portadaCompartida } : pelicula}
                    dbId={dbId}
                    customPoster={null}
                  />
                </div>
              );
            })}
          </div>
        )}

        {data.totalPaginas > 1 && (
          <div className="border-t border-gray-800 mt-8 pt-6 flex items-center justify-between">
            {currentPage > 1 ? (
              <Link href={`${slugCanonico}?page=${currentPage - 1}`} className="text-sm text-gray-400 hover:text-white transition">
                ‹ Prev
              </Link>
            ) : (
              <span className="text-sm text-gray-700">‹ Prev</span>
            )}
            <span className="text-sm text-gray-500">Page {currentPage} of {data.totalPaginas}</span>
            {currentPage < data.totalPaginas ? (
              <Link href={`${slugCanonico}?page=${currentPage + 1}`} className="text-sm text-gray-400 hover:text-white transition">
                Next ›
              </Link>
            ) : (
              <span className="text-sm text-gray-700">Next ›</span>
            )}
          </div>
        )}
      </div>
    </main>
  );
}