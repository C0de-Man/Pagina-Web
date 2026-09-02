'use client';
import { useState, useEffect } from 'react';
import { getRegion, getIdioma } from '@/lib/preferences';

interface Temporada {
  numero: number;
  nombre: string;
  episodios: number;
  fechaEstreno: string | null;
  portada: string | null;
}

interface DetalleTemporada {
  nombre: string;
  sinopsis: string;
  fechaEstreno: string | null;
  portada: string | null;
}

interface EstadoTemporada {
  seasonNumber: number;
  watched: boolean;
  rating: number | null;
  customPoster: string | null;
}

interface Episodio {
  numero: number;
  titulo: string;
  sinopsis: string;
  fechaEmision: string | null;
  duracion: number | null;
  imagen: string | null;
  notaMedia: number | null;
}

interface EstadoEpisodio {
  episodeNumber: number;
  watched: boolean;
  rating: number | null;
}

interface PosterAlternativo {
  url: string;
  idioma: string | null;
}

function EstrellasVisual({ rating, onSelect, size = 'text-sm' }: { rating: number | null; onSelect?: (r: number | null) => void; size?: string }) {
  const sobreCinco = rating ? rating / 2 : 0;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => {
        const lleno = sobreCinco >= i;
        const medio = !lleno && sobreCinco >= i - 0.5;
        return (
          <button
            key={i}
            type="button"
            disabled={!onSelect}
            onClick={(e) => {
              e.stopPropagation();
              if (!onSelect) return;
              const valor = i * 2;
              // Volver a pulsar la MISMA estrella que ya marca tu nota actual
              // quita la nota (null), en vez de dejarla fija para siempre —
              // mismo gesto que ya tienes en películas/juegos.
              onSelect(rating === valor ? null : valor);
            }}
            className={`${size} leading-none ${onSelect ? 'cursor-pointer hover:scale-110 transition' : 'cursor-default'} ${lleno || medio ? 'text-teal-400' : 'text-gray-600'}`}
          >
            {lleno ? '★' : medio ? '⯨' : '☆'}
          </button>
        );
      })}
    </div>
  );
}

function OjoVisto({ visto, onToggle }: { visto: boolean; onToggle?: () => void }) {
  return (
    <button
      type="button"
      disabled={!onToggle}
      onClick={(e) => {
        e.stopPropagation();
        if (onToggle) onToggle();
      }}
      title={visto ? 'Watched' : 'Not watched'}
      className={`w-9 h-9 rounded-full flex items-center justify-center text-lg transition flex-shrink-0 ${
        onToggle ? 'cursor-pointer hover:bg-gray-700' : 'cursor-default'
      } ${visto ? 'text-teal-400 bg-teal-900/30' : 'text-gray-600 bg-gray-800/60'}`}
    >
      👁
    </button>
  );
}

export default function SeasonsList({ mediaId, tmdbId }: { mediaId: number; tmdbId: number | null }) {
  const [temporadas, setTemporadas] = useState<Temporada[]>([]);
  const [estadosTemporadas, setEstadosTemporadas] = useState<Record<number, EstadoTemporada>>({});
  const [cargando, setCargando] = useState(true);
  const [temporadaAbierta, setTemporadaAbierta] = useState<Temporada | null>(null);
  const [detalleTemporada, setDetalleTemporada] = useState<DetalleTemporada | null>(null);
  const [episodios, setEpisodios] = useState<Episodio[]>([]);
  const [estadosEpisodios, setEstadosEpisodios] = useState<Record<number, EstadoEpisodio>>({});
  const [cargandoEpisodios, setCargandoEpisodios] = useState(false);
  const [selectorPosterAbierto, setSelectorPosterAbierto] = useState(false);
  const [postersAlternativos, setPostersAlternativos] = useState<PosterAlternativo[]>([]);
  const [cargandoPosters, setCargandoPosters] = useState(false);

  const idioma = getIdioma();

  useEffect(() => {
    if (!tmdbId) {
      setCargando(false);
      return;
    }
    const token = localStorage.getItem('token');

    Promise.all([
      fetch(`http://localhost:3001/tmdb/tv/${tmdbId}/seasons?language=${idioma}`, { cache: 'no-store' }).then((r) => r.json()),
      token
        ? fetch(`http://localhost:3001/media/${mediaId}/seasons/status`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }).then((r) => r.json())
        : Promise.resolve([]),
    ])
      .then(([temps, ests]) => {
        setTemporadas(Array.isArray(temps) ? temps : []);
        const mapa: Record<number, EstadoTemporada> = {};
        (Array.isArray(ests) ? ests : []).forEach((e: EstadoTemporada) => {
          mapa[e.seasonNumber] = e;
        });
        setEstadosTemporadas(mapa);
      })
      .catch(() => {})
      .finally(() => setCargando(false));
  }, [tmdbId, mediaId, idioma]);

  const actualizarTemporada = async (numero: number, cambios: Partial<{ watched: boolean; rating: number | null; customPoster: string | null }>) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setEstadosTemporadas((prev) => ({
      ...prev,
      [numero]: {
        seasonNumber: numero,
        watched: prev[numero]?.watched ?? false,
        rating: prev[numero]?.rating ?? null,
        customPoster: prev[numero]?.customPoster ?? null,
        ...cambios,
      },
    }));
    try {
      await fetch(`http://localhost:3001/media/${mediaId}/seasons/${numero}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(cambios),
      });
    } catch {}
  };

  const actualizarEpisodio = async (numeroTemporada: number, numeroEpisodio: number, cambios: Partial<{ watched: boolean; rating: number | null }>) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setEstadosEpisodios((prev) => ({
      ...prev,
      [numeroEpisodio]: { episodeNumber: numeroEpisodio, watched: prev[numeroEpisodio]?.watched ?? false, rating: prev[numeroEpisodio]?.rating ?? null, ...cambios },
    }));
    try {
      await fetch(`http://localhost:3001/media/${mediaId}/seasons/${numeroTemporada}/episodes/${numeroEpisodio}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(cambios),
      });
    } catch {}
  };

  const abrirTemporada = async (t: Temporada) => {
    setTemporadaAbierta(t);
    setDetalleTemporada(null);
    setEpisodios([]);
    setEstadosEpisodios({});
    if (!tmdbId) return;
    setCargandoEpisodios(true);
    const token = localStorage.getItem('token');
    try {
      const [resEp, resEst] = await Promise.all([
        fetch(`http://localhost:3001/tmdb/tv/${tmdbId}/season/${t.numero}?language=${idioma}`, { cache: 'no-store' }),
        token
          ? fetch(`http://localhost:3001/media/${mediaId}/seasons/${t.numero}/episodes/status`, {
              headers: { Authorization: `Bearer ${token}` },
              cache: 'no-store',
            })
          : Promise.resolve(null),
      ]);
      const data = await resEp.json();
      setDetalleTemporada({ nombre: data.nombre, sinopsis: data.sinopsis, fechaEstreno: data.fechaEstreno, portada: data.portada });
      setEpisodios(data.episodios || []);

      if (resEst) {
        const est = await resEst.json();
        const mapa: Record<number, EstadoEpisodio> = {};
        (Array.isArray(est) ? est : []).forEach((e: EstadoEpisodio) => {
          mapa[e.episodeNumber] = e;
        });
        setEstadosEpisodios(mapa);
      }
    } catch {
      setEpisodios([]);
    } finally {
      setCargandoEpisodios(false);
    }
  };

  const abrirSelectorPoster = async () => {
    if (!tmdbId || !temporadaAbierta) return;
    setSelectorPosterAbierto(true);
    setCargandoPosters(true);
    try {
      const res = await fetch(`http://localhost:3001/tmdb/tv/${tmdbId}/season/${temporadaAbierta.numero}/images`, { cache: 'no-store' });
      const data = await res.json();
      setPostersAlternativos(Array.isArray(data) ? data : []);
    } catch {
      setPostersAlternativos([]);
    } finally {
      setCargandoPosters(false);
    }
  };

  const elegirPoster = (url: string) => {
    if (!temporadaAbierta) return;
    actualizarTemporada(temporadaAbierta.numero, { customPoster: url });
    setSelectorPosterAbierto(false);
  };

  if (cargando) return null;
  if (temporadas.length === 0) return null;

  const estadoTemporadaAbierta = temporadaAbierta ? estadosTemporadas[temporadaAbierta.numero] : null;
  const posterModal = estadoTemporadaAbierta?.customPoster || detalleTemporada?.portada || temporadaAbierta?.portada || null;
  const totalEpisodiosModal = temporadaAbierta ? (episodios.length || temporadaAbierta.episodios) : 0;
  const vistosModal = episodios.filter((ep) => estadosEpisodios[ep.numero]?.watched).length;
  const porcentajeModal = totalEpisodiosModal > 0 ? (vistosModal / totalEpisodiosModal) * 100 : 0;

  return (
    <section className="mt-8">
      <h2 className="text-xl font-bold text-white mb-4">Seasons ({temporadas.length})</h2>

      <div className="bg-[#1c2228] rounded-lg border border-gray-700 divide-y divide-gray-700">
        {temporadas.map((t) => {
          const estado = estadosTemporadas[t.numero];
          const visto = estado?.watched || false;
          const posterFila = estado?.customPoster || t.portada;
          return (
            <div
              key={t.numero}
              onClick={() => abrirTemporada(t)}
              className="flex items-center gap-4 p-3 hover:bg-[#242b33] transition cursor-pointer"
            >
              <div className="w-12 h-16 flex-shrink-0 rounded overflow-hidden bg-gray-800">
                {posterFila && <img src={posterFila} alt={t.nombre} className="w-full h-full object-cover" />}
              </div>

              <div className="flex-grow min-w-0">
                <p className="text-white font-semibold truncate">{t.nombre}</p>
                <p className="text-gray-500 text-xs">
                  {t.fechaEstreno ? new Date(t.fechaEstreno).getFullYear() : '—'} · {t.episodios} episodes
                </p>
              </div>

                            <OjoVisto
                visto={visto}
                onToggle={() => {
                  const nuevoEstado = !visto;
                  actualizarTemporada(t.numero, { watched: nuevoEstado });
                  const token = localStorage.getItem('token');
                  if (token) {
                    fetch(`http://localhost:3001/media/${mediaId}/seasons/${t.numero}/mark-all`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ watched: nuevoEstado, totalEpisodios: t.episodios }),
                    }).catch(() => {});
                  }
                  // Si la temporada está abierta en el modal ahora mismo, refleja el cambio ahí también
                  if (temporadaAbierta?.numero === t.numero) {
                    setEstadosEpisodios((prev) => {
                      const nuevo: Record<number, EstadoEpisodio> = {};
                      episodios.forEach((ep) => {
                        nuevo[ep.numero] = { episodeNumber: ep.numero, watched: nuevoEstado, rating: prev[ep.numero]?.rating ?? null };
                      });
                      return nuevo;
                    });
                  }
                }}
              />

              <EstrellasVisual
                rating={estado?.rating ?? null}
                onSelect={(r) => actualizarTemporada(t.numero, { rating: r })}
              />

              <span className="text-gray-500">→</span>
            </div>
          );
        })}
      </div>

      {temporadaAbierta && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setTemporadaAbierta(null)}
        >
          <div
            className="bg-[#1c2228] rounded-lg border border-gray-700 w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <div className="flex gap-4">
                <div className="w-28 flex-shrink-0">
                  <div className="w-28 aspect-[2/3] rounded overflow-hidden bg-gray-800 mb-2">
                    {posterModal && <img src={posterModal} alt={temporadaAbierta.nombre} className="w-full h-full object-cover" />}
                  </div>
                  <button
                    onClick={abrirSelectorPoster}
                    className="text-[11px] text-gray-400 hover:text-white underline cursor-pointer"
                  >
                    Change poster
                  </button>
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-white">{temporadaAbierta.nombre}</h3>
                  <p className="text-gray-500 text-sm mb-2">
                    {(detalleTemporada?.fechaEstreno || temporadaAbierta.fechaEstreno)
                      ? new Date(detalleTemporada?.fechaEstreno || temporadaAbierta.fechaEstreno!).getFullYear()
                      : '—'} · {totalEpisodiosModal} episodes
                  </p>
                  {detalleTemporada?.sinopsis && (
                    <p className="text-gray-300 text-sm leading-snug max-w-md">{detalleTemporada.sinopsis}</p>
                  )}
                </div>
              </div>
              <button onClick={() => setTemporadaAbierta(null)} className="text-gray-400 hover:text-white text-xl cursor-pointer flex-shrink-0">
                ✕
              </button>
            </div>

            <div className="w-full h-2 rounded-full bg-gray-800 overflow-hidden mb-2 mt-4">
              <div
                className="h-full bg-teal-500 transition-all"
                style={{
                  width: `${porcentajeModal}%`,
                  backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.15) 0, rgba(255,255,255,0.15) 8px, transparent 8px, transparent 16px)',
                }}
              />
            </div>
            <p className="text-xs text-gray-500 mb-4">{vistosModal} / {totalEpisodiosModal}</p>

            <div className="flex items-center gap-4 mb-6 pb-4 border-b border-gray-700">
              <button
                onClick={() => {
                  const nuevoEstado = !(estadoTemporadaAbierta?.watched);
                  actualizarTemporada(temporadaAbierta.numero, { watched: nuevoEstado });
                  // Marca/desmarca TODOS los episodios de la temporada a la vez
                  episodios.forEach((ep) => actualizarEpisodio(temporadaAbierta.numero, ep.numero, { watched: nuevoEstado }));
                }}
                className={`text-sm font-bold px-4 py-2 rounded transition cursor-pointer ${
                  estadoTemporadaAbierta?.watched
                    ? 'bg-teal-700 text-white'
                    : 'bg-[#2c3440] text-gray-300 hover:bg-[#3a4552]'
                }`}
              >
                {estadoTemporadaAbierta?.watched ? '✓ Season watched' : 'Mark season as watched'}
              </button>
              <EstrellasVisual
                rating={estadoTemporadaAbierta?.rating ?? null}
                onSelect={(r) => actualizarTemporada(temporadaAbierta.numero, { rating: r })}
              />
            </div>

            {cargandoEpisodios ? (
              <p className="text-gray-500 text-sm">Loading episodes...</p>
            ) : (
              <div className="space-y-5">
                {episodios.map((ep) => {
                  const estado = estadosEpisodios[ep.numero];
                  return (
                    <div key={ep.numero} className="flex gap-3 items-start">
                      <div className="w-28 h-16 flex-shrink-0 rounded overflow-hidden bg-gray-800">
                        {ep.imagen && <img src={ep.imagen} alt={ep.titulo} className="w-full h-full object-cover" />}
                      </div>

                      <div className="flex-grow min-w-0">
                        <p className="text-white text-sm font-semibold">
                          {ep.numero}. {ep.titulo}
                        </p>
                        <p className="text-gray-500 text-xs mb-1">
                          {ep.fechaEmision ? new Date(ep.fechaEmision).toLocaleDateString() : ''}
                          {ep.duracion ? ` · ${ep.duracion}m` : ''}
                        </p>
                        <p className="text-gray-400 text-xs line-clamp-2 mb-1.5">{ep.sinopsis}</p>

                        <div className="flex items-center gap-2">
                          {ep.notaMedia != null && (
                            <div className="inline-flex items-center gap-1 bg-gray-800 px-2 py-0.5 rounded text-xs" title="Average rating (TMDB)">
                              <span className="text-yellow-400">★</span>
                              <span className="text-gray-300">{ep.notaMedia.toFixed(1)}</span>
                            </div>
                          )}
                          {estado?.rating != null && (
                            <div className="inline-flex items-center gap-1 bg-gray-800 px-2 py-0.5 rounded text-xs" title="Your rating">
                              <span className="text-teal-400">★</span>
                              <span className="text-gray-200">{(estado.rating / 2).toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                        <OjoVisto
                          visto={estado?.watched || false}
                          onToggle={() => actualizarEpisodio(temporadaAbierta.numero, ep.numero, { watched: !(estado?.watched) })}
                        />
                        <EstrellasVisual
                          rating={estado?.rating ?? null}
                          onSelect={(r) => actualizarEpisodio(temporadaAbierta.numero, ep.numero, { rating: r })}
                          size="text-xs"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {selectorPosterAbierto && (
        <div
          className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4"
          onClick={() => setSelectorPosterAbierto(false)}
        >
          <div
            className="bg-[#1c2228] rounded-lg border border-gray-700 w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-white">Choose a poster</h3>
              <button onClick={() => setSelectorPosterAbierto(false)} className="text-gray-400 hover:text-white text-xl cursor-pointer">
                ✕
              </button>
            </div>

            {cargandoPosters ? (
              <p className="text-gray-500 text-sm">Loading posters...</p>
            ) : postersAlternativos.length === 0 ? (
              <p className="text-gray-500 text-sm">No alternative posters found for this season.</p>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
                {postersAlternativos.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => elegirPoster(p.url)}
                    className="aspect-[2/3] rounded overflow-hidden border-2 border-transparent hover:border-teal-500 transition cursor-pointer"
                  >
                    <img src={p.url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}