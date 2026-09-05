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
              // Mitad izquierda del carácter = media estrella (i*2 - 1),
              // mitad derecha = estrella entera (i*2) — mismo principio que
              // StarRating.tsx, adaptado a botones por estrella en vez de
              // una franja continua.
              const rect = e.currentTarget.getBoundingClientRect();
              const clicEnMitadIzquierda = e.clientX - rect.left < rect.width / 2;
              const valor = clicEnMitadIzquierda ? i * 2 - 1 : i * 2;
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
      className={`w-9 h-9 rounded-full flex items-center justify-center text-lg transition flex-shrink-0 ${onToggle ? 'cursor-pointer hover:bg-gray-700' : 'cursor-default'
        } ${visto ? 'text-teal-300 bg-teal-500/20 ring-1 ring-teal-500/40' : 'text-gray-500 bg-gray-800/70'}`}
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
  // Recuerda qué valor de nota sugerida ya descartaste (con "Cancel" o
  // "Apply"), para no repetirte el mismo aviso una y otra vez mientras nada
  // cambie — solo reaparece si el cálculo da un valor distinto.
  const [notaDescartada, setNotaDescartada] = useState<number | null>(null);

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
      .catch(() => { })
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
    } catch { }
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
    } catch { }
  };

  const revisarSiSerieCompleta = async (estadosTemporadasActualizados: Record<number, EstadoTemporada>) => {
    // Excluye "Especiales" (temporada 0), igual que el backend en
    // comprobarYCompletarProgreso — si no, nunca se detecta la serie como
    // completa a menos que también marques los especiales.
    const temporadasReales = temporadas.filter((t) => t.numero > 0);
    const todasVistas = temporadasReales.length > 0 && temporadasReales.every((t) => estadosTemporadasActualizados[t.numero]?.watched);
    if (!todasVistas) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      await fetch(`http://localhost:3001/media/${mediaId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ watched: true, playStatus: null }),
      });
      window.dispatchEvent(new CustomEvent('media-status-changed', { detail: { mediaId } }));
    } catch { }
  };

  const marcarTemporadaCompleta = async (numeroTemporada: number) => {
    await actualizarTemporada(numeroTemporada, { watched: true });
    const estadoActual = estadosTemporadas[numeroTemporada];
    const estadosTemporadasActualizados = {
      ...estadosTemporadas,
      [numeroTemporada]: {
        seasonNumber: numeroTemporada,
        watched: true,
        rating: estadoActual?.rating ?? null,
        customPoster: estadoActual?.customPoster ?? null,
      },
    };
    await revisarSiSerieCompleta(estadosTemporadasActualizados);
  };

  const marcarVistoConAnteriores = async (ep: Episodio) => {
    if (!temporadaAbierta) return;
    const numeroTemporada = temporadaAbierta.numero;
    const idsAMarcar = episodios
      .filter((e) => e.numero <= ep.numero && !estadosEpisodios[e.numero]?.watched)
      .map((e) => e.numero);

    setEstadosEpisodios((prev) => {
      const nuevo = { ...prev };
      idsAMarcar.forEach((n) => {
        nuevo[n] = { episodeNumber: n, watched: true, rating: prev[n]?.rating ?? null };
      });
      return nuevo;
    });

    const token = localStorage.getItem('token');
    if (token) {
      // omitirCascada: true — el resultado de esta cascada ya se comprueba
      // una sola vez más abajo (marcarTemporadaCompleta), así que no hace
      // falta que CADA episodio del lote dispare su propia comprobación
      // pesada contra TMDB en el backend.
      await Promise.all(
        idsAMarcar.map((n) =>
          fetch(`http://localhost:3001/media/${mediaId}/seasons/${numeroTemporada}/episodes/${n}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ watched: true, omitirCascada: true }),
          }).catch(() => { })
        )
      );
    }

    const totalVistos = episodios.filter(
      (e) => idsAMarcar.includes(e.numero) || estadosEpisodios[e.numero]?.watched
    ).length;
    if (episodios.length > 0 && totalVistos === episodios.length) {
      await marcarTemporadaCompleta(numeroTemporada);
    }
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

  // --- SUGERENCIA DE NOTA MEDIA PROPIA ---
  // Cuando TODAS las temporadas reales (sin contar "Especiales") están
  // vistas Y tienen nota puesta, se calcula la media y se ofrece aplicarla
  // como tu nota general de la serie — sin forzar nada, el usuario decide.
  const temporadasReales = temporadas.filter((t) => t.numero > 0);
  const todasConNotaYVistas =
    temporadasReales.length > 0 &&
    temporadasReales.every((t) => {
      const est = estadosTemporadas[t.numero];
      return est?.watched && est?.rating != null;
    });
  const notaSugerida = todasConNotaYVistas
    ? Math.round(
      temporadasReales.reduce((suma, t) => suma + (estadosTemporadas[t.numero]?.rating || 0), 0) /
      temporadasReales.length
    )
    : null;
  const mostrarSugerenciaNota = notaSugerida !== null && notaSugerida !== notaDescartada;

  const aplicarNotaSugerida = async () => {
    if (notaSugerida === null) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      await fetch(`http://localhost:3001/media/${mediaId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rating: notaSugerida }),
      });
      window.dispatchEvent(new CustomEvent('mediaWatchedChanged', { detail: { mediaId, watched: true } }));
      window.dispatchEvent(new CustomEvent('media-rating-applied', { detail: { mediaId, rating: notaSugerida } }));
    } catch { }
    setNotaDescartada(notaSugerida);
  };

  const estadoTemporadaAbierta = temporadaAbierta ? estadosTemporadas[temporadaAbierta.numero] : null;
  const posterModal = estadoTemporadaAbierta?.customPoster || detalleTemporada?.portada || temporadaAbierta?.portada || null;
  const totalEpisodiosModal = temporadaAbierta ? (episodios.length || temporadaAbierta.episodios) : 0;
  const vistosModal = episodios.filter((ep) => estadosEpisodios[ep.numero]?.watched).length;
  const porcentajeModal = totalEpisodiosModal > 0 ? (vistosModal / totalEpisodiosModal) * 100 : 0;

  return (
    <section className="mt-8">
      <h2 className="text-xl font-bold text-white mb-4">Seasons ({temporadas.length})</h2>

      {mostrarSugerenciaNota && (
        <div className="mb-4 bg-teal-950/30 border border-teal-800/60 rounded-lg p-4 flex flex-col items-center gap-2 text-center">
          <p className="text-sm text-gray-200">
            Your calculated average rating is{' '}
            <span className="font-bold text-teal-300">{(notaSugerida! / 2).toFixed(1)}</span>
          </p>
          <EstrellasVisual rating={notaSugerida} size="text-xl" />
          <div className="flex gap-3 mt-1">
            <button
              type="button"
              onClick={() => setNotaDescartada(notaSugerida)}
              className="text-xs font-semibold text-gray-400 hover:text-white px-3 py-1.5 rounded transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={aplicarNotaSugerida}
              className="text-xs font-semibold text-white bg-teal-600 hover:bg-teal-500 px-4 py-1.5 rounded transition cursor-pointer"
            >
              Apply
            </button>
          </div>
        </div>
      )}

      <div className="bg-[#1c2228] rounded-lg border border-gray-700 divide-y divide-gray-800/80 overflow-hidden">
        {temporadas.map((t) => {
          const estado = estadosTemporadas[t.numero];
          const visto = estado?.watched || false;
          const posterFila = estado?.customPoster || t.portada;
          return (
            <div
              key={t.numero}
              onClick={() => abrirTemporada(t)}
              className="flex items-center gap-4 p-3.5 hover:bg-[#242b33] transition cursor-pointer group"
            >
              <div className="w-12 h-16 flex-shrink-0 rounded-md overflow-hidden bg-gray-800 shadow-sm ring-1 ring-white/5 group-hover:ring-white/10 transition">
                {posterFila && <img src={posterFila} alt={t.nombre} className="w-full h-full object-cover" />}
              </div>

              <div className="flex-grow min-w-0">
                <p className="text-white font-semibold truncate">{t.nombre}</p>
                <p className="text-gray-500 text-xs mt-0.5">
                  {t.fechaEstreno ? new Date(t.fechaEstreno).getFullYear() : '—'} · {t.episodios} episodes
                </p>
              </div>

              <OjoVisto
                visto={visto}
                onToggle={async () => {
                  const nuevoEstado = !visto;
                  const token = localStorage.getItem('token');
                  if (token) {
                    fetch(`http://localhost:3001/media/${mediaId}/seasons/${t.numero}/mark-all`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ watched: nuevoEstado, totalEpisodios: t.episodios }),
                    }).catch(() => { });
                  }
                  if (temporadaAbierta?.numero === t.numero) {
                    setEstadosEpisodios((prev) => {
                      const nuevo: Record<number, EstadoEpisodio> = {};
                      episodios.forEach((ep) => {
                        nuevo[ep.numero] = { episodeNumber: ep.numero, watched: nuevoEstado, rating: prev[ep.numero]?.rating ?? null };
                      });
                      return nuevo;
                    });
                  }
                  if (nuevoEstado) {
                    await marcarTemporadaCompleta(t.numero);
                  } else {
                    await actualizarTemporada(t.numero, { watched: false });
                  }
                }}
              />

              <EstrellasVisual
                rating={estado?.rating ?? null}
                onSelect={(r) => actualizarTemporada(t.numero, { rating: r })}
              />

              <span className="text-gray-600 group-hover:text-gray-400 transition">→</span>
            </div>
          );
        })}
      </div>

      {temporadaAbierta && (
        <div
          className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4"
          onClick={() => setTemporadaAbierta(null)}
        >
          <div
            className="bg-[#1c2228] rounded-xl border border-gray-700/80 shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-7"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-5">
              <div className="flex gap-5">
                <div className="w-28 flex-shrink-0">
                  <div className="w-28 aspect-[2/3] rounded-lg overflow-hidden bg-gray-800 mb-2 shadow-lg ring-1 ring-white/10">
                    {posterModal && <img src={posterModal} alt={temporadaAbierta.nombre} className="w-full h-full object-cover" />}
                  </div>
                  <button
                    onClick={abrirSelectorPoster}
                    className="text-[11px] text-gray-400 hover:text-white underline cursor-pointer transition"
                  >
                    Change poster
                  </button>
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-white leading-tight">{temporadaAbierta.nombre}</h3>
                  <p className="text-gray-500 text-sm mt-1 mb-3">
                    {(detalleTemporada?.fechaEstreno || temporadaAbierta.fechaEstreno)
                      ? new Date(detalleTemporada?.fechaEstreno || temporadaAbierta.fechaEstreno!).getFullYear()
                      : '—'} · {totalEpisodiosModal} episodes
                  </p>
                  {detalleTemporada?.sinopsis && (
                    <p className="text-gray-300 text-sm leading-relaxed max-w-md">{detalleTemporada.sinopsis}</p>
                  )}
                </div>
              </div>
              <button onClick={() => setTemporadaAbierta(null)} className="text-gray-500 hover:text-white text-xl cursor-pointer flex-shrink-0 transition">
                ✕
              </button>
            </div>

            <div className="flex items-center gap-3 mb-6">
              <div className="flex-grow h-2 rounded-full bg-gray-800/80 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-teal-600 to-teal-400 transition-all duration-500 rounded-full"
                  style={{ width: `${porcentajeModal}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 flex-shrink-0 tabular-nums">{vistosModal} / {totalEpisodiosModal}</p>
            </div>

            <div className="flex items-center gap-4 mb-7 pb-6 border-b border-gray-800">
              <button
                onClick={async () => {
                  const nuevoEstado = !(estadoTemporadaAbierta?.watched);
                  episodios.forEach((ep) => actualizarEpisodio(temporadaAbierta.numero, ep.numero, { watched: nuevoEstado }));
                  if (nuevoEstado) {
                    await marcarTemporadaCompleta(temporadaAbierta.numero);
                  } else {
                    await actualizarTemporada(temporadaAbierta.numero, { watched: false });
                  }
                }}
                className={`text-sm font-bold px-4 py-2 rounded-lg transition cursor-pointer ${estadoTemporadaAbierta?.watched
                  ? 'bg-teal-600/90 text-white shadow-sm shadow-teal-900/40'
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
              <div className="space-y-3">
                {episodios.map((ep) => {
                  const estado = estadosEpisodios[ep.numero];
                  const visto = estado?.watched || false;
                  return (
                    <div
                      key={ep.numero}
                      className={`flex gap-4 items-start p-3 rounded-lg transition ${visto ? 'bg-teal-950/20' : 'hover:bg-gray-800/40'
                        }`}
                    >
                      <div className="w-32 h-[72px] flex-shrink-0 rounded-md overflow-hidden bg-gray-800 shadow-sm">
                        {ep.imagen && <img src={ep.imagen} alt={ep.titulo} className="w-full h-full object-cover" />}
                      </div>

                      <div className="flex-grow min-w-0 pt-0.5">
                        <p className="text-white text-sm font-semibold leading-snug">
                          {ep.numero}. {ep.titulo}
                        </p>
                        <p className="text-gray-500 text-xs mt-0.5 mb-1.5">
                          {ep.fechaEmision ? new Date(ep.fechaEmision).toLocaleDateString() : ''}
                          {ep.duracion ? ` · ${ep.duracion}m` : ''}
                        </p>
                        <p className="text-gray-400 text-xs leading-relaxed line-clamp-2 mb-2">{ep.sinopsis}</p>

                        <div className="flex items-center gap-2">
                          {ep.notaMedia != null && (
                            <div className="inline-flex items-center gap-1 bg-gray-800/80 px-2 py-0.5 rounded-full text-xs" title="Average rating (TMDB)">
                              <span className="text-yellow-400">★</span>
                              <span className="text-gray-300">{ep.notaMedia.toFixed(1)}</span>
                            </div>
                          )}
                          {estado?.rating != null && (
                            <div className="inline-flex items-center gap-1 bg-teal-900/30 px-2 py-0.5 rounded-full text-xs" title="Your rating">
                              <span className="text-teal-400">★</span>
                              <span className="text-teal-100">{(estado.rating / 2).toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-center gap-2 flex-shrink-0 pt-0.5">
                        <OjoVisto
                          visto={visto}
                          onToggle={() => {
                            if (!visto) {
                              marcarVistoConAnteriores(ep);
                            } else {
                              actualizarEpisodio(temporadaAbierta.numero, ep.numero, { watched: false });
                            }
                          }}
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
            className="bg-[#1c2228] rounded-xl border border-gray-700/80 shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-white">Choose a poster</h3>
              <button onClick={() => setSelectorPosterAbierto(false)} className="text-gray-500 hover:text-white text-xl cursor-pointer transition">
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
                    className="aspect-[2/3] rounded-lg overflow-hidden border-2 border-transparent hover:border-teal-500 transition cursor-pointer shadow-sm"
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