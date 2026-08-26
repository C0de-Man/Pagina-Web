'use client';
import { useState } from 'react';
import Link from 'next/link';
import { urlFicha } from '@/lib/slug';
import ReviewLogModal from './ReviewLogModal';
import GameLogModal from './GameLogModal';

function Estrellas({ rating }: { rating: number }) {
  const sobreCinco = rating / 2;
  const llenas = Math.floor(sobreCinco);
  const media = sobreCinco - llenas >= 0.5;
  return (
    <span className="text-yellow-400 text-lg tracking-tight">
      {'★'.repeat(llenas)}
      {media && '½'}
      {'☆'.repeat(5 - llenas - (media ? 1 : 0))}
    </span>
  );
}

function formatFecha(fecha: string) {
  return new Date(fecha).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTiempoJugado(minutos: number) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

const ETIQUETA_TIPO: Record<string, string> = {
  PELICULA: 'Film',
  SERIE: 'Series',
  VIDEOJUEGO: 'Game',
};

export default function ReviewDetailModal({
  resena,
  onClose,
  puedeEditar = false,
}: {
  resena: any;
  onClose: () => void;
  // Solo el dueño de la reseña debe poder editarla — la página pública que
  // muestra las reseñas de OTRO usuario no debe pasar esto en true nunca.
  puedeEditar?: boolean;
}) {
  const [editando, setEditando] = useState(false);
  if (!resena) return null;

  const esJuego = resena.tipo === 'VIDEOJUEGO';
  // resena.logId viene como "watchlog-123" o "gamelog-456" — se necesita el
  // número real para llamar al endpoint de editar/borrar ESE registro.
  const watchLogId = !esJuego && resena.logId ? parseInt(String(resena.logId).replace('watchlog-', ''), 10) : undefined;
  const gameLogId = esJuego && resena.logId ? parseInt(String(resena.logId).replace('gamelog-', ''), 10) : undefined;

  const cerrarEdicion = () => {
    setEditando(false);
    onClose();
  };

  if (editando && puedeEditar) {
    if (esJuego) {
      return (
        <GameLogModal
          mediaId={resena.mediaId}
          igdbId={resena.igdbId}
          abrirAlMontar
          logIdInicial={gameLogId}
          onCerrado={cerrarEdicion}
        />
      );
    }
    return (
      <ReviewLogModal
        mediaId={resena.mediaId}
        logId={watchLogId}
        datosIniciales={{ fechaVisto: resena.fecha, review: resena.review, rewatch: resena.rewatch }}
        onClose={cerrarEdicion}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1c2228] border border-gray-700 rounded-lg max-w-lg w-full shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-4 p-5 border-b border-gray-800">
          <Link href={urlFicha(resena)} onClick={onClose} className="flex-shrink-0 w-20">
            {resena.portada ? (
              <img
                src={resena.portada}
                alt={resena.titulo}
                className="w-20 aspect-[2/3] object-cover rounded border border-gray-700"
              />
            ) : (
              <div className="w-20 aspect-[2/3] bg-gray-800 rounded border border-gray-700 flex items-center justify-center text-[10px] text-center p-1">
                {resena.titulo}
              </div>
            )}
          </Link>

          <div className="flex-grow min-w-0">
            <Link href={urlFicha(resena)} onClick={onClose} className="font-bold text-white text-lg hover:underline block">
              {resena.titulo}
            </Link>
            <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
              <span>{resena.anio}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded">
                {ETIQUETA_TIPO[resena.tipo] || resena.tipo}
              </span>
              {resena.rewatch && (
                <span className="text-[10px] font-semibold uppercase tracking-wide bg-purple-900/40 text-purple-300 px-1.5 py-0.5 rounded">
                  Rewatch
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {resena.rating != null && <Estrellas rating={resena.rating} />}
              {resena.liked && (
                <span className="flex items-center gap-1 text-pink-400 text-xs font-semibold">
                  <span className="text-sm">♥</span> Liked
                </span>
              )}
              {resena.watchlist && (
                <span className="flex items-center gap-1 text-blue-400 text-xs font-semibold">
                  <span className="text-sm">⏱</span> Watchlist
                </span>
              )}
            </div>

          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {puedeEditar && (
              <button
                onClick={() => setEditando(true)}
                className="text-gray-400 hover:text-white text-xs font-semibold cursor-pointer"
              >
                ✎ Edit
              </button>
            )}
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white text-xl leading-none cursor-pointer"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {resena.tipo === 'VIDEOJUEGO' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-xs px-5 pt-4">
            {resena.plataforma && (
              <div>
                <div className="text-gray-500 uppercase tracking-wide mb-0.5">Platform</div>
                <div className="text-gray-200">{resena.plataforma}</div>
              </div>
            )}
            {resena.jugadoEn && (
              <div>
                <div className="text-gray-500 uppercase tracking-wide mb-0.5">Played on</div>
                <div className="text-gray-200">{resena.jugadoEn}</div>
              </div>
            )}
            {resena.propiedad && (
              <div>
                <div className="text-gray-500 uppercase tracking-wide mb-0.5">Ownership</div>
                <div className="text-gray-200">{resena.propiedad}</div>
              </div>
            )}
            {resena.fechaInicio && (
              <div>
                <div className="text-gray-500 uppercase tracking-wide mb-0.5">Started on</div>
                <div className="text-gray-200">{formatFecha(resena.fechaInicio)}</div>
              </div>
            )}
            {resena.fechaFin && (
              <div>
                <div className="text-gray-500 uppercase tracking-wide mb-0.5">Finished on</div>
                <div className="text-gray-200">{formatFecha(resena.fechaFin)}</div>
              </div>
            )}
            {resena.edicion && (
              <div>
                <div className="text-gray-500 uppercase tracking-wide mb-0.5">Version played</div>
                <div className="text-gray-200">{resena.edicion}</div>
              </div>
            )}
            {resena.minutosJugados != null && (
              <div>
                <div className="text-gray-500 uppercase tracking-wide mb-0.5">Total played</div>
                <div className="text-gray-200">{formatTiempoJugado(resena.minutosJugados)}</div>
              </div>
            )}
          </div>
        )}

        <div className="p-5">
          {resena.logNombre && (
            <p className="text-gray-500 text-xs uppercase tracking-wide font-semibold mb-2">{resena.logNombre}</p>
          )}
          <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap mb-4">{resena.review}</p>
          <p className="text-gray-500 text-xs">{formatFecha(resena.fecha)}</p>
        </div>
      </div>
    </div>
  );
}