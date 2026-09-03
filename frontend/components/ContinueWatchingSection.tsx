'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { urlFicha } from '@/lib/slug';
import { withLangRegion } from '@/lib/preferences';

interface ProximoEpisodio {
  temporada: number;
  episodio: number;
  titulo: string;
  duracion: number | null;
  imagen: string | null;
  fechaEmision: string | null;
}

interface SerieConProgreso {
  id: number;
  titulo: string;
  portada: string | null;
  proximoEpisodio: ProximoEpisodio;
}

export default function ContinueWatchingSection() {
  const [continuando, setContinuando] = useState<SerieConProgreso[]>([]);
  const [proximamente, setProximamente] = useState<SerieConProgreso[]>([]);
  const [cargando, setCargando] = useState(true);
  // Ids de serie cuyo episodio se está marcando como visto ahora mismo — se
  // usa para deshabilitar el botón y evitar doble clic mientras se procesa.
  const [marcandoId, setMarcandoId] = useState<number | null>(null);

  const cargarDatos = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setCargando(false);
      return;
    }
    return fetch(withLangRegion('http://localhost:3001/media/continue-watching'), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setContinuando(data.continuando || []);
        setProximamente(data.proximamente || []);
      })
      .catch(() => {})
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  // Marca el episodio actualmente mostrado como visto, y vuelve a pedir la
  // lista entera — así la serie pasa sola al siguiente episodio pendiente
  // (o desaparece de la sección si ya no quedan episodios emitidos por ver).
  const marcarComoVisto = async (serie: SerieConProgreso) => {
    const token = localStorage.getItem('token');
    if (!token || marcandoId !== null) return;
    setMarcandoId(serie.id);
    try {
      await fetch(
        `http://localhost:3001/media/${serie.id}/seasons/${serie.proximoEpisodio.temporada}/episodes/${serie.proximoEpisodio.episodio}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ watched: true }),
        }
      );
      await cargarDatos();
    } catch (e) {
      console.error('Error al marcar el episodio como visto', e);
    }
    setMarcandoId(null);
  };

  const formatFecha = (iso: string | null) => {
    if (!iso) return '';
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  if (cargando || (continuando.length === 0 && proximamente.length === 0)) return null;

  const Fila = ({
    titulo,
    items,
    mostrarFecha,
    mostrarBotonVisto,
  }: {
    titulo: string;
    items: SerieConProgreso[];
    mostrarFecha: boolean;
    mostrarBotonVisto: boolean;
  }) => {
    const scrollRef = useRef<HTMLDivElement>(null);

    if (items.length === 0) return null;

    // Se desplaza aproximadamente "una pantalla" de tarjetas cada vez que se
    // pulsa una flecha, no una tarjeta suelta — mismo criterio que el resto
    // de carruseles horizontales del proyecto.
    const desplazar = (direccion: 1 | -1) => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollBy({ left: direccion * el.clientWidth * 0.9, behavior: 'smooth' });
    };

    return (
      <div className="mb-10">
        <div className="flex justify-between items-end mb-4 border-b border-gray-800 pb-2">
          <h2 className="text-xl font-bold text-white tracking-wide">{titulo}</h2>
        </div>

        <div className="relative group/carrusel">
          {items.length > 5 && (
            <>
              <button
                type="button"
                onClick={() => desplazar(-1)}
                className="absolute left-0 top-0 bottom-0 z-20 w-10 flex items-center justify-center bg-gradient-to-r from-gray-950/90 to-transparent text-white opacity-0 group-hover/carrusel:opacity-100 transition cursor-pointer"
                aria-label="Scroll left"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => desplazar(1)}
                className="absolute right-0 top-0 bottom-0 z-20 w-10 flex items-center justify-center bg-gradient-to-l from-gray-950/90 to-transparent text-white opacity-0 group-hover/carrusel:opacity-100 transition cursor-pointer"
                aria-label="Scroll right"
              >
                ›
              </button>
            </>
          )}

          <div
            ref={scrollRef}
            className="flex gap-4 overflow-x-auto pb-1"
            style={{ scrollbarWidth: 'none' }}
          >
            {items.map((s) => (
              <div key={s.id} className="group relative flex-shrink-0 w-56">
                <Link href={urlFicha({ ...s, tipo: 'SERIE' })} className="block">
                  <div className="relative aspect-video rounded overflow-hidden bg-gray-800 border border-gray-700 group-hover:border-gray-500 transition">
                    {s.proximoEpisodio.imagen ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.proximoEpisodio.imagen}
                        alt={s.proximoEpisodio.titulo}
                        className="w-full h-full object-cover"
                      />
                    ) : s.portada ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.portada} alt={s.titulo} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-center p-2 bg-black">
                        <p className="text-xs font-semibold text-white">{s.titulo}</p>
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-bold text-white truncate group-hover:underline">{s.titulo}</p>
                  <p className="text-xs text-gray-400 truncate">
                    S{String(s.proximoEpisodio.temporada).padStart(2, '0')}E{String(s.proximoEpisodio.episodio).padStart(2, '0')}
                    {s.proximoEpisodio.titulo ? ` · ${s.proximoEpisodio.titulo}` : ''}
                    {s.proximoEpisodio.duracion ? ` · ${s.proximoEpisodio.duracion}m` : ''}
                  </p>
                  {mostrarFecha && s.proximoEpisodio.fechaEmision && (
                    <p className="text-xs text-blue-400 mt-0.5 capitalize">{formatFecha(s.proximoEpisodio.fechaEmision)}</p>
                  )}
                </Link>

                {mostrarBotonVisto && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      marcarComoVisto(s);
                    }}
                    disabled={marcandoId === s.id}
                    title="Mark episode as watched"
                    className="absolute top-1.5 right-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/80 text-white opacity-0 transition hover:bg-green-600 group-hover:opacity-100 disabled:opacity-100 disabled:cursor-wait cursor-pointer"
                  >
                    {marcandoId === s.id ? (
                      <span className="h-3.5 w-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path
                          fillRule="evenodd"
                          d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <Fila titulo="Coming Up" items={proximamente} mostrarFecha mostrarBotonVisto={false} />
      <Fila titulo="Continue Watching" items={continuando} mostrarFecha={false} mostrarBotonVisto />
    </div>
  );
}