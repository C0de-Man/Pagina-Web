import RatingWidget from '@/components/RatingWidget';
import ActionButtons from '@/components/ActionButtons';
import PosterButtonModal from '@/components/PosterButtonModal';
import CollectionLinks from '@/components/CollectionLinks';
import MediaTabs from '@/components/MediaTabs';
import RemakeOfBadge from '@/components/RemakeOfBadge';
import AddToListModal from '@/components/AddToListModal';
import WatchProviders from '@/components/WatchProviders';
import { extraerIdDeSlug } from '@/lib/slug';

function formatRuntime(minutes: number | null) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export default async function MediaDetail({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const id = extraerIdDeSlug(resolvedParams.slug);

  if (!id || isNaN(id)) {
    return <div className="p-8 text-white text-center min-h-screen bg-gray-950 flex items-center justify-center">Medio no encontrado</div>;
  }

  const res = await fetch(`http://localhost:3001/media/${id}`, { cache: 'no-store' });
  const media = await res.json();

  if (!media || media.error) {
    return <div className="p-8 text-white text-center min-h-screen bg-gray-950 flex items-center justify-center">Medio no encontrado</div>;
  }

  let detalles: any = null;
  if (media.tmdbId) {
    const resDetalles = await fetch(`http://localhost:3001/tmdb/details/${media.tmdbId}`, { cache: 'no-store' });
    detalles = await resDetalles.json();
  }

  const duracion = detalles ? formatRuntime(detalles.runtime) : null;

  return (
    <main className="min-h-screen bg-gray-950 text-white font-sans pb-16">

      {media.backdrop ? (
        <div className="w-full h-64 md:h-80 relative border-b border-gray-800 overflow-hidden">
          <img src={media.backdrop} alt="Backdrop" className="w-full h-full object-cover opacity-60" />
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
            <PosterButtonModal tmdbId={media.tmdbId} mediaId={media.id} />
          </div>

          <div className="flex-grow pt-24 md:pt-32">
            <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-2">{media.titulo}</h1>
            <div className="flex items-center gap-2 text-gray-400 mb-6">
              <span className="text-lg">{media.anio}</span>
              {duracion && <span className="text-lg text-gray-500">({duracion})</span>}
              <span className="bg-gray-800 px-2 py-1 rounded text-xs font-semibold ml-2">{media.tipo}</span>
            </div>

            <RemakeOfBadge remakeOf={media.remakeOf} />

            <MediaTabs sinopsis={media.sinopsis} detalles={detalles} />
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

            <CollectionLinks tmdbId={media.tmdbId} />
            <WatchProviders tmdbId={media.tmdbId} />
          </div>

        </div>
      </div>
    </main>
  );
}