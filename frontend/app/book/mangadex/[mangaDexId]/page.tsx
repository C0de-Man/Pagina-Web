import { redirect } from 'next/navigation';
import { urlFicha } from '@/lib/slug';

export default async function BookMangaDexResolver({ params }: { params: Promise<{ mangaDexId: string }> }) {
  const { mangaDexId } = await params;

  const res = await fetch('http://localhost:3001/media/mangadex', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mangaDexId }),
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