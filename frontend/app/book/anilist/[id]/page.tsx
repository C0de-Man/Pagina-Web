import { redirect } from 'next/navigation';
import { urlFicha } from '@/lib/slug';

export default async function BookAniListResolver({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const res = await fetch('${process.env.NEXT_PUBLIC_API_URL}/media/anilist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anilistId: id }),
    cache: 'no-store',
  });
  const media = await res.json();

  if (!media || media.error) {
    return (
      <div className="p-8 text-white text-center min-h-screen bg-gray-950 flex items-center justify-center">
        Manga no encontrado
      </div>
    );
  }

  redirect(urlFicha(media));
}