'use client';
import { urlPlataforma, urlGenero } from '@/lib/slug';
import { useEffect, useState } from 'react';
import Link from 'next/link';

const API_URL = '${process.env.NEXT_PUBLIC_API_URL}';
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

interface EdicionConPlataformas {
  igdbId: number;
  nombreVersion: string;
  plataformas: { id: number; name: string }[];
}

function ListaLinks({
  items,
  urlDe,
  keyPrefix,
}: {
  items: { id: number; nombre: string }[];
  urlDe: (id: number, nombre: string) => string;
  keyPrefix: string;
}) {
  if (!items || items.length === 0) return <>Not available</>;
  return (
    <>
      {items.map((item, i) => (
        <span key={`${keyPrefix}-${item.id}-${i}`}>
          <Link href={urlDe(item.id, item.nombre)} className="hover:underline hover:text-white transition">
            {item.nombre}
          </Link>
          {i < items.length - 1 && ', '}
        </span>
      ))}
    </>
  );
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
  const [ediciones, setEdiciones] = useState<EdicionConPlataformas[]>([]);
  const [dlcsData, setDlcsData] = useState<DlcsUpdatesResponse | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [timeToBeat, setTimeToBeat] = useState<{ hastily: number | null; normally: number | null; completely: number | null } | null>(null);

  // Cruce con TU base de datos: si un DLC/update/mod ya está guardado con
  // una carátula compartida distinta, o TÚ la has personalizado a mano, esa
  // debe ganar por encima de lo que IGDB devuelva en este momento — mismo
  // patrón que ya usa CollectionLinks.tsx para la saga.
  const [myDb, setMyDb] = useState<any[]>([]);
  const [personalizaciones, setPersonalizaciones] = useState<Record<number, { customPoster: string | null }>>({});

  // igdbIds cuya carátula ha fallado al cargar (URL rota) — se tratan igual
  // que si no tuvieran portada, en vez de dejar un hueco vacío.
  const [fallosImagen, setFallosImagen] = useState<Set<number>>(new Set());
  const marcarFalloImagen = (id: number) =>
    setFallosImagen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

  // Miniatura reutilizable: portada real si hay y carga bien, si no caja
  // negra con el título — igual que GameCollectionLinks.tsx.
  function Portada({ juego, className }: { juego: JuegoDlc; className: string }) {
    const localMedia = myDb.find((m: any) => m.igdbId === juego.igdbId);
    const portadaReal = (localMedia && personalizaciones[localMedia.id]?.customPoster)
      || localMedia?.portada
      || juego.portada;
    const mostrarImagen = portadaReal && !fallosImagen.has(juego.igdbId);
    if (mostrarImagen) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={portadaReal!}
          alt={juego.titulo}
          onError={() => marcarFalloImagen(juego.igdbId)}
          className={className}
        />
      );
    }
    return (
      <div className={`${className} bg-black flex items-center justify-center text-center p-2`}>
        <p className="text-xs font-semibold text-white">{juego.titulo}</p>
      </div>
    );
  }

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

  useEffect(() => {
    fetch(`${API_URL}/media`, { cache: 'no-store' })
      .then((r) => r.json())
      .then(setMyDb)
      .catch(() => { });
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || myDb.length === 0 || !dlcsData) return;

    const idsIgdb = [...dlcsData.dlcs, ...dlcsData.updates, ...dlcsData.mods].map((j) => j.igdbId);
    const dbIds = idsIgdb
      .map((id) => myDb.find((m: any) => m.igdbId === id)?.id)
      .filter(Boolean);
    if (dbIds.length === 0) return;

    fetch(`${API_URL}/media/personalizaciones?ids=${[...new Set(dbIds)].join(',')}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((res) => res.json())
      .then(setPersonalizaciones)
      .catch(() => { });
  }, [myDb, dlcsData]);

  useEffect(() => {
    if (!igdbId) return;
    let cancelado = false;
    fetch(`${API_URL}/igdb/ediciones/${igdbId}`)
      .then((r) => r.json())
      .then((d: EdicionConPlataformas[]) => {
        if (!cancelado) setEdiciones(Array.isArray(d) ? d : []);
      })
      .catch((err) => console.error('Error cargando ediciones', err));
    return () => {
      cancelado = true;
    };
  }, [igdbId]);

  useEffect(() => {
    if (!igdbId) return;
    let cancelado = false;
    fetch(`${API_URL}/igdb/time-to-beat/${igdbId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelado) setTimeToBeat(d);
      })
      .catch((err) => console.error('Error cargando time to beat', err));
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
              <Portada juego={j} className="w-full aspect-[2/3] object-cover rounded transition" />

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
                    <Portada juego={g} className="w-full aspect-[2/3] object-cover rounded transition group-hover:opacity-80" />
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
                    <Portada juego={g} className="w-full aspect-[2/3] object-cover rounded transition group-hover:opacity-80" />
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
                    <Portada juego={g} className="w-full aspect-[2/3] object-cover rounded transition group-hover:opacity-80" />
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
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 text-sm">
            <div className="col-span-2 sm:col-span-3">
              <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Platforms</div>
              {ediciones.length > 1 ? (
                <div className="space-y-1">
                  {ediciones.map((ed) => (
                    <div key={ed.igdbId} className="text-gray-200">
                      <span className="font-semibold">{ed.nombreVersion}:</span>{' '}
                      <ListaLinks
                        items={ed.plataformas.map((p) => ({ id: p.id, nombre: p.name }))}
                        urlDe={urlPlataforma}
                        keyPrefix={`${ed.igdbId}`}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-gray-200">
                  <ListaLinks items={detalles?.plataformas || []} urlDe={urlPlataforma} keyPrefix="plat" />
                </div>
              )}
            </div>
            <div>
              <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Genres</div>
              <div className="text-gray-200">
                <ListaLinks items={detalles?.generos || []} urlDe={urlGenero} keyPrefix="genre" />
              </div>
            </div>
            <div>
              <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Developer</div>
              <div className="text-gray-200">
                {detalles?.desarrolladoras?.length > 0 ? (
                  detalles.desarrolladoras.map((d: any, i: number) => (
                    <span key={`${d.id ?? 'sin-id'}-${i}`}>
                      {d.id ? (
                        <Link href={`/developer/${d.id}`} className="hover:underline hover:text-white transition">
                          {d.nombre}
                        </Link>
                      ) : (
                        d.nombre
                      )}
                      {i < detalles.desarrolladoras.length - 1 && ', '}
                    </span>
                  ))
                ) : (
                  'Not available'
                )}
              </div>
            </div>
            <div>
              <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Publisher</div>
              <div className="text-gray-200">
                {detalles?.distribuidoras?.length > 0 ? (
                  detalles.distribuidoras.map((d: any, i: number) => (
                    <span key={`${d.id ?? 'sin-id'}-${i}`}>
                      {d.id ? (
                        <Link href={`/developer/${d.id}`} className="hover:underline hover:text-white transition">
                          {d.nombre}
                        </Link>
                      ) : (
                        d.nombre
                      )}
                      {i < detalles.distribuidoras.length - 1 && ', '}
                    </span>
                  ))
                ) : (
                  'Not available'
                )}
              </div>
            </div>
          </div>

          {timeToBeat && (timeToBeat.hastily || timeToBeat.normally || timeToBeat.completely) && (
            <div className="mt-8">
              <h3 className="text-lg font-bold text-white mb-3">Time to beat</h3>
              <div className="grid grid-cols-3 gap-3 max-w-md">
                {[
                  { label: 'Hastily', valor: timeToBeat.hastily },
                  { label: 'Normally', valor: timeToBeat.normally },
                  { label: 'Completely', valor: timeToBeat.completely },
                ]
                  .filter(({ valor }) => valor !== null)
                  .map(({ label, valor }) => (
                    <div key={label} className="text-center">
                      <div className="text-xs text-gray-400 mb-1">{label}</div>
                      <div className="rounded bg-[#2a1a3e] py-3 text-lg font-bold text-white">
                        {valor} H
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
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