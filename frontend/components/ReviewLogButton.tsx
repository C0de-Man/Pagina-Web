'use client';
import { useState } from 'react';
import ReviewLogModal from './ReviewLogModal';

export default function ReviewLogButton({ mediaId }: { mediaId: number }) {
  const [modalAbierto, setModalAbierto] = useState(false);

  return (
    <>
      <button
        onClick={() => setModalAbierto(true)}
        className="w-full bg-[#2c3440] hover:bg-gray-600 text-white font-bold py-2 rounded text-sm transition cursor-pointer"
      >
        Review or log...
      </button>

      {modalAbierto && (
        <ReviewLogModal mediaId={mediaId} onClose={() => setModalAbierto(false)} />
      )}
    </>
  );
}