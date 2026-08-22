'use client';
import { useState } from 'react';

function formatFechaInput(fecha: Date) {
  return fecha.toISOString().slice(0, 10); // YYYY-MM-DD, formato de <input type="date">
}

export default function ReviewLogModal({
  mediaId,
  onClose,
}: {
  mediaId: number;
  onClose: () => void;
}) {
  const [fechaVisto, setFechaVisto] = useState(formatFechaInput(new Date()));
  const [rewatch, setRewatch] = useState(false);
  const [review, setReview] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const guardar = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    setGuardando(true);
    setErrorMsg('');
    try {
      const res = await fetch(`http://localhost:3001/media/${mediaId}/watchlogs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ fechaVisto, review: review || null, rewatch }),
      });
      if (!res.ok) throw new Error('fallo al guardar el registro');

      // Además de guardar el registro, marcamos la película/serie como vista
      // (mismo patrón que usa ActionButtons con playStatus en juegos), y
      // avisamos al ojo de ActionButtons con el mismo evento que ya usa
      // RatingWidget, sin necesitar que ambos estén en el mismo componente.
      await fetch(`http://localhost:3001/media/${mediaId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ watched: true }),
      });

      window.dispatchEvent(new CustomEvent('mediaWatchedChanged', { detail: { mediaId, watched: true } }));

      onClose();
    } catch (error) {
      console.error('Error al guardar el registro de visionado', error);
      setErrorMsg('No se pudo guardar. Inténtalo de nuevo.');
    }
    setGuardando(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-md p-6 text-white shadow-2xl"
      >
        <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
          <span className="text-gray-300">Watched on</span>
          <input
            type="date"
            value={fechaVisto}
            onChange={(e) => setFechaVisto(e.target.value)}
            className="bg-[#1c2228] border border-gray-700 rounded px-2 py-1 text-sm text-white"
          />
          <label className="flex items-center gap-2 cursor-pointer ml-auto">
            <input
              type="checkbox"
              checked={rewatch}
              onChange={(e) => setRewatch(e.target.checked)}
              className="w-4 h-4 accent-blue-500 cursor-pointer"
            />
            I&apos;ve watched this before
          </label>
        </div>

        <textarea
          value={review}
          onChange={(e) => setReview(e.target.value)}
          placeholder="Add a review..."
          rows={5}
          className="w-full bg-[#dce3ec] text-gray-900 placeholder-gray-500 rounded p-3 text-sm resize-none"
        />

        {errorMsg && <p className="text-red-400 text-xs mt-2">{errorMsg}</p>}

        <div className="flex justify-end gap-3 mt-4">
          <button onClick={onClose} className="text-gray-400 hover:text-white text-sm cursor-pointer">
            Cancel
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="bg-green-600 hover:bg-green-500 disabled:opacity-50 px-5 py-2 rounded font-bold text-sm transition cursor-pointer"
          >
            {guardando ? 'Guardando...' : 'Log'}
          </button>
        </div>
      </div>
    </div>
  );
}