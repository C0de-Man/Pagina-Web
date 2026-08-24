'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

const API_URL = 'http://localhost:3001';
const VISIBLES = 5;

interface JuegoDlc {
  igdbId: number;
  titulo: string;
  portada: string | null;
  anio: number | null;
}

interface DlcsUpdatesResponse {
  dlcs: JuegoDlc[];
  updates: JuegoDlc[];
  mods: JuegoDlc[];
}

export default function GameTabs({
  sinopsis,
  detalles,
  igdbId,
}: {
  sinopsis: string;
  detalles: any;
  igdbId?: number;
}) {
  const [tab, setTab] = useState<'descripcion' | 'mas' | 'dlcs'>('descripcion');
  const [dlcsData, setDlcsData] = useState<DlcsUpdatesResponse | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);

  // Href real a la resolvedora /game/igdb/[igdbId]: guarda el juego (si no
  // lo tienes ya) y redirige a su ficha — como es un <Link> normal, esto
  // hace que el click central / Ctrl+click / "abrir en pestaña nueva"
  // funcionen sin necesidad de interceptar el clic con JS.
  const hrefDeJuego = (juego: JuegoDlc) => `/game/igdb/${juego.igdbId}`;

  useEffect(() => {
    if (!igdbId) return;
    let cancelado = false;
    fetch(`${API_URL}/igdb/dlcs-updates/${igdbId}`)
      .then((r) => r.json())
      .then((d: Partial<DlcsUpdatesResponse>) => {
        if (!cancelado) {
          // Nos aseguramos de que dlcs/updates sean siempre arrays, aunque el
          // backend falle y devuelva algo distinto a la forma esperada (p. ej.
          // { error: '...' }), para que el resto del componente no reviente.
          setDlcsData({
            dlcs: Array.isArray(d?.dlcs) ? d.dlcs : [],
            updates: Array.isArray(d?.updates) ? d.updates : [],
            mods: Array.isArray(d?.mods) ? d.mods : [],
          });
        }
      })
      .catch((err) => console.error('Error cargando DLCs/updates', err));
    return () => {
      cancelado = true;
    };
  }, [igdbId]);

  const hayMasContenido =
    (dlcsData?.dlcs?.length || 0) > 0 ||
    (dlcsData?.updates?.length || 0) > 0 ||
    (dlcsData?.mods?.length || 0) > 0;

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'descripcion', label: 'Description' },
    { key: 'mas', label: 'More' },
    ...(hayMasContenido ? [{ key: 'dlcs' as const, label: 'More content' }] : []),
  ];

  // --- Carrusel de 5 con flechas, sin texto debajo de cada carátula ---
  function CarruselJuegos({ juegos }: { juegos: JuegoDlc[] }) {
    const [inicio, setInicio] = useState(0);
    const puedeIzquierda = inicio > 0;
    const puedeDerecha = inicio + VISIBLES < juegos.length;

    const visibles = juegos.slice(inicio, inicio + VISIBLES);

    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => setInicio((i) => Math.max(0, i - VISIBLES))}
          disabled={!puedeIzquierda}
          className="shrink-0 text-2xl text-gray-400 hover:text-white disabled:opacity-20 disabled:hover:text-gray-400 cursor-pointer disabled:cursor-default"
        >
          ‹
        </button>

        <div className="grid grid-cols-5 gap-3 flex-1">
          {visibles.map((j) => (
            <Link
              key={j.igdbId}
              href={hrefDeJuego(j)}
              className="relative overflow-hidden rounded cursor-pointer group block"
            >
              {j.portada && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={j.portada}
                  alt={j.titulo}
                  className="w-full aspect-[2/3] object-cover rounded transition"
                />
              )}

              <div className="absolute inset-0 rounded bg-black/90 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-center p-2 pointer-events-none">
                <p className="text-sm font-bold text-white">
                  {j.titulo} <span className="font-normal text-gray-300">({j.anio})</span>
                </p>
              </div>
            </Link>
          ))}
        </div>

        <button
          onClick={() => setInicio((i) => Math.min(juegos.length - VISIBLES, i + VISIBLES))}
          disabled={!puedeDerecha}
          className="shrink-0 text-2xl text-gray-400 hover:text-white disabled:opacity-20 disabled:hover:text-gray-400 cursor-pointer disabled:cursor-default"
        >
          ›
        </button>
      </div>
    );
  }

  function GrupoJuegos({ titulo, juegos }: { titulo: string; juegos: JuegoDlc[] }) {
    if (juegos.length === 0) return null;
    return (
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-white">{titulo}</h3>
          {juegos.length > VISIBLES && (
            <button
              onClick={() => setModalAbierto(true)}
              className="text-sm text-gray-300 underline cursor-pointer"
            >
              See more
            </button>
          )}
        </div>
        <CarruselJuegos juegos={juegos} />
      </div>
    );
  }

  // --- Modal con todo, mismo estilo que el de la saga ---
  function ModalTodos() {
    if (!dlcsData) return null;
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
        onClick={() => setModalAbierto(false)}
      >
        <div
          className="max-h-[85vh] w-[90vw] max-w-5xl overflow-y-auto rounded-lg bg-[#1c2228] border border-gray-700 p-8 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">More content</h2>
            <button
              onClick={() => setModalAbierto(false)}
              className="text-2xl text-gray-400 hover:text-white cursor-pointer transition"
            >
              ×
            </button>
          </div>

          {dlcsData.dlcs.length > 0 && (
            <div className="mb-8">
              <h3 className="text-lg font-bold text-white mb-3">DLCs</h3>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-5">
                {dlcsData.dlcs.map((g) => (
                  <Link
                    key={g.igdbId}
                    href={hrefDeJuego(g)}
                    className="cursor-pointer group text-left block"
                  >
                    {g.portada && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={g.portada}
                        alt={g.titulo}
                        className="w-full aspect-[2/3] object-cover rounded transition group-hover:opacity-80"
                      />
                    )}
                    <p className="mt-2 text-sm font-semibold text-white">{g.titulo}</p>
                    <p className="text-xs text-gray-400">{g.anio}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {dlcsData.updates.length > 0 && (
            <div className="mb-8">
              <h3 className="text-lg font-bold text-white mb-3">Updates</h3>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-5">
                {dlcsData.updates.map((g) => (
                  <Link
                    key={g.igdbId}
                    href={hrefDeJuego(g)}
                    className="cursor-pointer group text-left block"
                  >
                    {g.portada && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={g.portada}
                        alt={g.titulo}
                        className="w-full aspect-[2/3] object-cover rounded transition group-hover:opacity-80"
                      />
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {dlcsData.mods.length > 0 && (
            <div>
              <h3 className="text-lg font-bold text-white mb-3">Mods</h3>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-5">
                {dlcsData.mods.map((g) => (
                  <Link
                    key={g.igdbId}
                    href={hrefDeJuego(g)}
                    className="cursor-pointer group text-left block"
                  >
                    {g.portada && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={g.portada}
                        alt={g.titulo}
                        className="w-full aspect-[2/3] object-cover rounded transition group-hover:opacity-80"
                      />
                    )}
                    <p className="mt-2 text-sm font-semibold text-white">{g.titulo}</p>
                    <p className="text-xs text-gray-400">{g.anio}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* CABECERA DE PESTAÑAS */}
      <div className="flex gap-6 border-b border-gray-800 mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`pb-3 text-sm font-semibold transition cursor-pointer ${tab === t.key
              ? 'text-white border-b-2 border-white'
              : 'text-gray-500 hover:text-gray-300'
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* DESCRIPCIÓN */}
      {tab === 'descripcion' && (
        <p className="text-gray-300 leading-relaxed text-base">{sinopsis}</p>
      )}

      {/* MAS */}
      {tab === 'mas' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 text-sm">
          <div>
            <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Platforms</div>
            <div className="text-gray-200">{detalles?.plataformas?.length > 0 ? detalles.plataformas.join(', ') : 'Not available'}</div>
          </div>
          <div>
            <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Genres</div>
            <div className="text-gray-200">{detalles?.generos?.length > 0 ? detalles.generos.join(', ') : 'Not available'}</div>
          </div>
          <div>
            <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Developer</div>
            <div className="text-gray-200">{detalles?.desarrolladoras?.length > 0 ? detalles.desarrolladoras.join(', ') : 'Not available'}</div>
          </div>
          <div>
            <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Publisher</div>
            <div className="text-gray-200">{detalles?.distribuidoras?.length > 0 ? detalles.distribuidoras.join(', ') : 'Not available'}</div>
          </div>
        </div>
      )}

      {/* MÁS CONTENIDO */}
      {tab === 'dlcs' && dlcsData && (
        <div>
          <GrupoJuegos titulo="DLCs" juegos={dlcsData.dlcs} />
          <GrupoJuegos titulo="Updates" juegos={dlcsData.updates} />
          <GrupoJuegos titulo="Mods" juegos={dlcsData.mods} />
        </div>
      )}

      {modalAbierto && <ModalTodos />}
    </div>
  );
}