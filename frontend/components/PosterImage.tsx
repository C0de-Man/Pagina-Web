'use client';
import { useEffect, useState } from 'react';

export default function PosterImage({
  mediaId,
  portadaDefault,
  titulo,
}: {
  mediaId: number;
  portadaDefault: string | null;
  titulo: string;
}) {
  const [portada, setPortada] = useState(portadaDefault);

  // La carga inicial de la ficha (page.tsx) es un server component: no tiene
  // acceso al token en localStorage, así que siempre trae la portada
  // COMPARTIDA por defecto. Aquí, ya en el navegador, comprobamos si el
  // usuario logueado tiene una personalizada y la pisamos — mismo patrón que
  // usa ActionButtons para leer /media/:id/status tras montarse.
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch(`http://localhost:3001/media/${mediaId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.customPoster) setPortada(data.customPoster);
      })
      .catch(() => {});
  }, [mediaId]);

  return portada ? (
    <img
      src={portada}
      alt={titulo}
      className="w-full rounded-lg shadow-2xl border-2 border-gray-800 object-cover aspect-[2/3]"
    />
  ) : (
    <div className="w-full aspect-[2/3] bg-gray-800 rounded-lg shadow-2xl border-2 border-gray-800 flex items-center justify-center">
      Sin imagen
    </div>
  );
}