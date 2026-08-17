import RatingWidget from '@/components/RatingWidget';
import ActionButtons from '@/components/ActionButtons';
import AddToListModal from '@/components/AddToListModal';
import GameImagesModal from '@/components/GameImagesModal';
import GameTabs from '@/components/GameTabs';
import { extraerIdDeSlug, urlFicha } from '@/lib/slug';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function GameDetail({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const id = extraerIdDeSlug(resolvedParams.slug);

  if (!id || isNaN(id)) {
    return <div className="p-8 text-white text-center min-h-screen bg-gray-950 flex items-center justify-center">Medio no encontrado</div>;
  }

  const cookieStore = await cookies();
  const idioma = cookieStore.get('idioma')?.value || 'es-ES';

  const res = await fetch(`http://localhost:3001/media/${id}?language=${idioma}`, { cache: 'no-store' });
  const media = await res.json();

  let detalles: any = null;
  if (media.igdbId) {
    const resDetalles = await fetch(`http://localhost:3001/igdb/details/${media.igdbId}`, { cache: 'no-store' });
    detalles = await resDetalles.json();
  }

  if (!media || media.error) {
    return <div className="p-8 text-white text-center min-h-screen bg-gray-950 flex items-center justify-center">Medio no encontrado</div>;
  }

  // Esta plantilla es solo para videojuegos. Si el id resulta ser una película/serie,
  // mandamos a la ficha correcta en /movie/.
  if (media.tipo !== 'VIDEOJUEGO') {
    redirect(urlFicha(media));
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white font-sans pb-16">
      {media.backdrop ? (
        <div className="w-full h-64 md:h-80 relative border-b border-gray-800 overflow-hidden">
          <img src={media.backdrop} alt="Banner" className="w-full h-full object-cover opacity-60" />
          <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/20 to-transparent" />
        </div>
      ) : (
        <div className="w-full h-64 md:h-80 bg-gradient-to-b from-gray-800 to-gray-950 flex items-center justify-center border-b border-gray-800">
          <span className="text-gray-600 font-bold tracking-widest">VIDEOJUEGO</span>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-24 md:-mt-32 relative z-10">
        <div className="flex flex-col md:flex-row gap-8">

          <div className="flex-shrink-0 w-48 md:w-64">
            {media.portada ? (
              <img src={media.portada} alt={media.titulo} className="w-full rounded-lg shadow-2xl border-2 border-gray-800 object-cover aspect-[2/3]" />) : (
              <div className="w-full aspect-[2/3] bg-gray-800 rounded-lg shadow-2xl border-2 border-gray-800 flex items-center justify-center">Sin imagen</div>
            )}
            <GameImagesModal mediaId={media.id} />
          </div>

          <div className="flex-grow pt-24 md:pt-32">
            <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-2">{media.titulo}</h1>
            <div className="flex items-center gap-2 text-gray-400 mb-6">
              <span className="text-lg">{media.anio}</span>
              <span className="bg-gray-800 px-2 py-1 rounded text-xs font-semibold ml-2">{media.tipo}</span>
            </div>

            <GameTabs sinopsis={media.sinopsis} detalles={detalles} />
          </div>

          <div className="flex-shrink-0 w-full md:w-72 pt-24 md:pt-32">
            <div className="bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl">
              <ActionButtons mediaId={media.id} />

              <div className="border-t border-dashed border-gray-700 my-4"></div>

              <div className="space-y-2 mb-4">
                <button className="w-full bg-[#2c3440] hover:bg-gray-600 text-white font-bold py-2 rounded text-sm transition cursor-pointer">
                  Review or log...
                </button>
                <AddToListModal mediaId={media.id} />
              </div>

              <RatingWidget mediaId={media.id} />
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}