import PersonFilmography from '@/components/PersonFilmography';
import { cookies } from 'next/headers';
import { extraerIdDeSlug } from '@/lib/slug';

export default async function PersonaDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const personId = extraerIdDeSlug(slug);

  if (!personId) {
    return (
      <div className="p-8 text-white text-center min-h-screen bg-gray-950 flex items-center justify-center">
        Persona no encontrada
      </div>
    );
  }

  const cookieStore = await cookies();
  const idioma = cookieStore.get('idioma')?.value || 'es-ES';

  const res = await fetch(`http://localhost:3001/tmdb/person/${personId}?language=${idioma}`, { cache: 'no-store' });
  const persona = await res.json();

  if (!persona || persona.error) {
    return (
      <div className="p-8 text-white text-center min-h-screen bg-gray-950 flex items-center justify-center">
        Persona no encontrada
      </div>
    );
  }

  // Cruzamos con tu base de datos local para poder enlazar directo a la
  // ficha si ya la tienes guardada (en vez de pasar siempre por la
  // resolvedora), y para usar tu carátula personalizada si la elegiste.
  const resDb = await fetch('http://localhost:3001/media', { cache: 'no-store' });
  const db = await resDb.json();
  const localesPorClave: Record<string, { dbId: number; portada: string | null }> = {};
  for (const m of db) {
    if (m.tmdbId && (m.tipo === 'PELICULA' || m.tipo === 'SERIE')) {
      localesPorClave[`${m.tipo}-${m.tmdbId}`] = { dbId: m.id, portada: m.portada };
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white font-sans pb-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex flex-col md:flex-row gap-8">
          <div className="flex-grow order-2 md:order-1">
            <h1 className="text-3xl md:text-4xl font-extrabold text-white mb-6">{persona.nombre}</h1>
            <PersonFilmography porRol={persona.porRol} localesPorClave={localesPorClave} />
          </div>

          <div className="flex-shrink-0 w-full md:w-72 order-1 md:order-2 space-y-4">
            {persona.foto && (
              <img
                src={persona.foto}
                alt={persona.nombre}
                className="w-full rounded-lg shadow-2xl border-2 border-gray-800 object-cover aspect-[2/3]"
              />
            )}

            {persona.biografia && (
              <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">{persona.biografia}</p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}