'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { urlEstudio, urlPersona } from '@/lib/slug';

const API_URL = 'http://localhost:3001';

export default function MediaTabs({
  sinopsis,
  detalles,
  tmdbId,
  mediaId,
  tipo,
}: {
  sinopsis: string;
  detalles: any;
  tmdbId?: number;
  mediaId?: number;
  tipo?: string;
}) {
  const [tab, setTab] = useState<'descripcion' | 'cast' | 'crew' | 'mas' | 'adaptation'>('descripcion');
  const [seriesInfo, setSeriesInfo] = useState<any>(null);

  useEffect(() => {
    if (tipo !== 'SERIE' || !mediaId) return;
    let cancelado = false;
    fetch(`${API_URL}/media/${mediaId}/series-info`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelado) setSeriesInfo(d);
      })
      .catch((err) => console.error('Error cargando info de la serie', err));
    return () => {
      cancelado = true;
    };
  }, [tipo, mediaId]);

  // Igual que ya se hace con "Cast" (oculta si tipo === 'LIBRO'), aquí se
  // comprueba si de verdad hay algo que mostrar en "Crew" e "Info" antes de
  // dejarlas en la lista de pestañas — así un libro/manga sin autores
  // conocidos, o una ficha sin studio/country/presupuesto, no muestra una
  // pestaña vacía con solo un "No information available.".
  const hayCrew =
    (detalles?.mangaAutores?.length || 0) > 0 ||
    !!detalles?.director ||
    (detalles?.guionistas?.length || 0) > 0;

  const hayInfo =
    (detalles?.mangaRevistas?.length || 0) > 0 ||
    (detalles?.estudios?.length || 0) > 0 ||
    (tipo !== 'LIBRO' && (detalles?.paises?.length || 0) > 0) ||
    !!detalles?.mangaPublicado ||
    !!seriesInfo ||
    !!detalles?.presupuesto ||
    !!detalles?.ganancias;

  // "Cast" no tiene sentido para libros/manga/cómics — no son medios con
  // reparto de actores. Se oculta directamente en vez de mostrarla vacía
  // con "No cast information available.".
  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'descripcion', label: 'Description' },
    ...(tipo !== 'LIBRO' ? [{ key: 'cast' as const, label: 'Cast' }] : []),
    ...(hayCrew ? [{ key: 'crew' as const, label: 'Crew' }] : []),
    ...(hayInfo ? [{ key: 'mas' as const, label: 'Info' }] : []),
  ];

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
        <div>
          {detalles?.tagline && (
            <p className="text-gray-400 italic text-base mb-3">{detalles.tagline}</p>
          )}
          <p className="text-gray-300 leading-relaxed text-base">{sinopsis}</p>
        </div>
      )}

      {/* CAST */}
      {tab === 'cast' && (
        <div className="flex flex-wrap gap-x-6 gap-y-5">
          {detalles?.cast?.length > 0 ? (
            detalles.cast.map((actor: any) => (
              <Link key={actor.id} href={urlPersona(actor.id, actor.nombre)} className="w-20 text-center group">
                <div className="w-16 h-16 mx-auto rounded-full overflow-hidden bg-gray-800 mb-2 border border-gray-700 group-hover:border-gray-400 transition">
                  {actor.foto ? (
                    <img src={actor.foto} alt={actor.nombre} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600 text-[10px]">No photo</div>
                  )}
                </div>
                <div className="text-xs font-semibold text-white leading-tight group-hover:underline">{actor.nombre}</div>
                <div className="text-xs text-gray-500 leading-tight mt-0.5">{actor.personaje}</div>
              </Link>
            ))
          ) : (
            <p className="text-gray-500 text-sm">No cast information available.</p>
          )}
        </div>
      )}

      {/* CREW */}
      {tab === 'crew' && (
        <div className="flex flex-wrap gap-x-6 gap-y-5">
          {detalles?.mangaAutores?.length > 0 && (
            detalles.mangaAutores.map((a: any, i: number) => (
              <div key={i} className="w-24 text-center">
                <div className="w-16 h-16 mx-auto rounded-full overflow-hidden bg-gray-800 mb-2 border border-gray-700 flex items-center justify-center text-gray-600 text-[10px]">
                  {a.foto ? (
                    <img src={a.foto} alt={a.nombre} className="w-full h-full object-cover" />
                  ) : (
                    'No photo'
                  )}
                </div>
                <div className="text-xs font-semibold text-white leading-tight">{a.nombre}</div>
                <div className="text-xs text-gray-500 leading-tight mt-0.5">{a.rol || 'Author'}</div>
              </div>
            ))
          )}
          {detalles?.director && (
            <Link href={urlPersona(detalles.director.id, detalles.director.nombre)} className="w-20 text-center group">
              <div className="w-16 h-16 mx-auto rounded-full overflow-hidden bg-gray-800 mb-2 border border-gray-700 group-hover:border-gray-400 transition">
                {detalles.director.foto ? (
                  <img src={detalles.director.foto} alt={detalles.director.nombre} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-600 text-[10px]">No photo</div>
                )}
              </div>
              <div className="text-xs font-semibold text-white leading-tight group-hover:underline">{detalles.director.nombre}</div>
              <div className="text-xs text-gray-500 leading-tight mt-0.5">Director</div>
            </Link>
          )}
          {detalles?.guionistas?.map((g: any, i: number) => (
            <Link key={i} href={urlPersona(g.id, g.nombre)} className="w-20 text-center group">
              <div className="w-16 h-16 mx-auto rounded-full overflow-hidden bg-gray-800 mb-2 border border-gray-700 group-hover:border-gray-400 transition">
                {g.foto ? (
                  <img src={g.foto} alt={g.nombre} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-600 text-[10px]">No photo</div>
                )}
              </div>
              <div className="text-xs font-semibold text-white leading-tight group-hover:underline">{g.nombre}</div>
              <div className="text-xs text-gray-500 leading-tight mt-0.5">Writer</div>
            </Link>
          ))}
          {(!detalles?.mangaAutores || detalles.mangaAutores.length === 0) &&
            !detalles?.director &&
            (!detalles?.guionistas || detalles.guionistas.length === 0) && (
              <p className="text-gray-500 text-sm">No crew information available.</p>
            )}
        </div>
      )}

      {/* MAS */}
      {tab === 'mas' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 text-sm pb-10">
          {(detalles?.mangaRevistas?.length > 0 || detalles?.estudios?.length > 0) && (
            <div>
              <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">
                {detalles?.mangaRevistas !== undefined ? 'Magazines' : 'Studio'}
              </div>
              <div className="text-gray-200">
                {detalles?.mangaRevistas?.length > 0 ? (
                  detalles.mangaRevistas.map((r: any) => r.nombre).join(', ')
                ) : (
                  detalles.estudios.map((e: any, i: number) => (
                    <span key={e.id ?? i}>
                      {e.id ? (
                        <Link href={urlEstudio(e.id, e.nombre)} className="hover:underline hover:text-white transition">
                          {e.nombre}
                        </Link>
                      ) : (
                        e.nombre
                      )}
                      {i < detalles.estudios.length - 1 && ', '}
                    </span>
                  ))
                )}
              </div>
            </div>
          )}
          {tipo !== 'LIBRO' && detalles?.paises?.length > 0 && (
            <div>
              <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Country</div>
              <div className="text-gray-200">{detalles.paises.join(', ')}</div>
            </div>
          )}
          {detalles?.mangaPublicado && (
            <div>
              <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Published</div>
              <div className="text-gray-200">{detalles.mangaPublicado}</div>
            </div>
          )}
          {seriesInfo && (
            <div>
              <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Total episodes</div>
              <div className="text-gray-200">{seriesInfo.totalEpisodios}</div>
              {seriesInfo.totalMinutos > 0 && (
                <>
                  <div className="text-gray-500 uppercase text-xs tracking-wide mb-1 mt-3">Total watch time</div>
                  <div className="text-gray-200">
                    {Math.floor(seriesInfo.totalMinutos / 60)}h {seriesInfo.totalMinutos % 60}m
                  </div>
                </>
              )}
            </div>
          )}
          {!!(detalles?.presupuesto || detalles?.ganancias) && (
            <div className="flex flex-col gap-4">
              {detalles?.presupuesto ? (
                <div>
                  <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Budget</div>
                  <div className="text-gray-200">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(detalles.presupuesto)}
                  </div>
                </div>
              ) : null}
              {detalles?.ganancias ? (
                <div>
                  <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Revenue</div>
                  <div className="text-gray-200">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(detalles.ganancias)}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* INFO EXTRA DE SERIE: episodios/duración total, show tracking, ranking de episodios */}
      {tab === 'mas' && tipo === 'SERIE' && seriesInfo && (
        <div className="pb-10">
        </div>
      )}
    </div>
  );
}