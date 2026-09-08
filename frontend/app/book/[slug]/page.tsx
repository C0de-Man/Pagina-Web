import RatingWidget from '@/components/RatingWidget';
import ActionButtons from '@/components/ActionButtons';
import PosterButtonModal from '@/components/PosterButtonModal';
import MediaTabs from '@/components/MediaTabs';
import AddToListModal from '@/components/AddToListModal';
import ReviewLogButton from '@/components/ReviewLogButton';
import PosterImage from '@/components/PosterImage';
import BackdropImage from '@/components/BackdropImage';
import { extraerIdDeSlug, urlFicha } from '@/lib/slug';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import FriendsActivityOnMedia from '@/components/FriendsActivityOnMedia';

export default async function BookDetail({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const id = extraerIdDeSlug(resolvedParams.slug);

  if (!id || isNaN(id)) {
    return <div className="p-8 text-white text-center min-h-screen bg-gray-950 flex items-center justify-center">Medio no encontrado</div>;
  }

  const cookieStore = await cookies();
  const idioma = cookieStore.get('idioma')?.value || 'es-ES';
  const region = cookieStore.get('region')?.value || 'ES';

  const res = await fetch(`http://localhost:3001/media/${id}?language=${idioma}&region=${region}`, { cache: 'no-store' });
  const media = await res.json();

  if (!media || media.error) {
    return <div className="p-8 text-white text-center min-h-screen bg-gray-950 flex items-center justify-center">Medio no encontrado</div>;
  }

  // Esta plantilla es solo para libros. Si el id resulta ser de otro tipo
  // (link viejo, o el slug apunta al id equivocado), mandamos a su ficha
  // correcta.
  if (media.tipo !== 'LIBRO') {
    redirect(urlFicha(media));
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white font-sans pb-16">

      <BackdropImage mediaId={media.id} backdropDefault={media.backdrop} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-24 md:-mt-32 relative z-10">
        <div className="flex flex-col md:flex-row gap-8">

          <div className="flex-shrink-0 w-48 md:w-64">
            <PosterImage mediaId={media.id} portadaDefault={media.portada} titulo={media.titulo} />
            <PosterButtonModal tmdbId={media.tmdbId} mediaId={media.id} />
          </div>

          <div className="flex-grow pt-24 md:pt-32">
            <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-2">{media.titulo}</h1>
            <div className="flex items-center gap-2 text-gray-400 mb-6">
              <span className="text-lg">{media.anio}</span>
              <span className="bg-gray-800 px-2 py-1 rounded text-xs font-semibold ml-2">Book</span>
            </div>

            <MediaTabs sinopsis={media.sinopsis} detalles={null} />
          </div>

          <div className="flex-shrink-0 w-full md:w-72 pt-24 md:pt-32">
            <div className="bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl">
              <ActionButtons mediaId={media.id} tipo={media.tipo} />

              <div className="border-t border-dashed border-gray-700 my-4"></div>

              <div className="space-y-2 mb-4">
                <ReviewLogButton mediaId={media.id} />
                <AddToListModal mediaId={media.id} />
              </div>

              <RatingWidget mediaId={media.id} />
            </div>

            <FriendsActivityOnMedia mediaId={media.id} />
          </div>

        </div>
      </div>
    </main>
  );
}