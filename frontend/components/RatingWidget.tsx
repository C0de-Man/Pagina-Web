'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import StarRating from './StarRating';

export default function RatingWidget({ mediaId }: { mediaId: number }) {
  const [miNota, setMiNota] = useState<number>(0); // 0-10 (0 = sin puntuar)
  const [media, setMedia] = useState<{ average: number | null; count: number }>({ average: null, count: 0 });
  const router = useRouter();

  const cargarMedia = () => {
    fetch(`http://localhost:3001/media/${mediaId}/rating`)
      .then((res) => res.json())
      .then(setMedia)
      .catch(() => {});
  };

  useEffect(() => {
    cargarMedia();
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch(`http://localhost:3001/media/${mediaId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => setMiNota(data.rating ?? 0))
      .catch(() => {});
  }, [mediaId]);

  // Escucha el aviso de SeasonsList: si se aplica la nota media sugerida,
  // "Your rating" se actualiza aquí mismo sin recargar la página.
  useEffect(() => {
    const handleRatingApplied = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.mediaId === mediaId) {
        setMiNota(detail.rating);
        cargarMedia();
      }
    };
    window.addEventListener('media-rating-applied', handleRatingApplied);
    return () => window.removeEventListener('media-rating-applied', handleRatingApplied);
  }, [mediaId]);

  const puntuar = async (valor: number | null) => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }

    setMiNota(valor ?? 0);

    try {
      await fetch(`http://localhost:3001/media/${mediaId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rating: valor }),
      });
      cargarMedia(); // refrescamos la media tras puntuar

      // Avisamos a ActionButtons: si se puso una nota, ya está visto (el ojo se abre)
      if (valor !== null) {
        window.dispatchEvent(new CustomEvent('mediaWatchedChanged', { detail: { mediaId, watched: true } }));
      }
    } catch {
      // si falla, se queda como está (podemos afinar esto más adelante)
    }
  };

  return (
    <>
      {/* MI NOTA (interactiva) */}
      <div className="flex flex-col items-center gap-1 bg-gray-900 rounded p-3 mb-4">
        <span className="text-xs text-gray-400 uppercase tracking-wide">
          {miNota > 0 ? `Your rating: ${miNota}/10` : 'Rate'}
        </span>
        <StarRating value={miNota} onRate={puntuar} size="md" />
      </div>

      {/* NOTA MEDIA REAL (solo lectura) */}
      <div className="bg-[#1c2228] rounded-lg border border-gray-700 p-4 text-center shadow-xl">
        <div className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">SCORE</div>
        <div className="text-3xl font-extrabold text-blue-400">
          {media.average !== null ? media.average.toFixed(2) : '—'}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {media.count > 0 ? `${media.count} ${media.count === 1 ? 'rating' : 'ratings'}` : 'No ratings yet'}
        </div>
      </div>
    </>
  );
}