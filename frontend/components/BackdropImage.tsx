'use client';
import { useEffect, useState } from 'react';

export default function BackdropImage({
  mediaId,
  backdropDefault,
}: {
  mediaId: number;
  backdropDefault: string | null;
}) {
  const [backdrop, setBackdrop] = useState(backdropDefault);

  // Mismo motivo que PosterImage: la carga inicial en el servidor no puede
  // saber quién eres (no hay token ahí), así que aquí, ya en el navegador,
  // pisamos el backdrop compartido por el personalizado si el usuario tiene uno.
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch(`http://localhost:3001/media/${mediaId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.customBackdrop) setBackdrop(data.customBackdrop);
      })
      .catch(() => { });
  }, [mediaId]);

  // Sin backdrop, no queremos ni la franja gris ni el texto "SIN BACKDROP"
  // — pero el layout de la página usa un margen negativo pensado para que
  // el contenido "suba" sobre el backdrop, así que un simple `return null`
  // deja el título pegado al navbar. Este espaciador da algo de aire sin
  // ocupar tanto como el backdrop real.
  if (!backdrop) {
    return <div className="w-full h-40 md:h-56" />;
  }

  return (
    <div className="w-full h-64 md:h-80 relative border-b border-gray-800 overflow-hidden">
      <img src={backdrop} alt="Backdrop" className="w-full h-full object-cover opacity-60" />
      <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/20 to-transparent" />
    </div>
  );
}