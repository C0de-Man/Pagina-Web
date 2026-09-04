'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { urlFicha } from '@/lib/slug';
import { withLangRegion } from '@/lib/preferences';

const API_URL = 'http://localhost:3001';

interface FaseUniverso {
  id: number;
  nombre: string;
}

interface UniverseItem {
  id: number;
  tmdbId: number;
  tipo: string;
  titulo: string
  anio: number | null;
  fechaEstreno: string | null;
  orden: number;
  ordenUniverso: number | null;
  faseId: number | null;
  portada: string | null;
}

interface UniverseTab {
  nombre: string;
  items: UniverseItem[];
}

interface Universo {
  id: number;
  nombre: string;
  fases: FaseUniverso[];
  pestañas: UniverseTab[];
}

interface ItemSaga {
  id: number;
  tmdbId: number;
  tipo: string;
  titulo: string;
  anio: number | null;
  portada: string | null;
}

interface CollectionResponse {
  collection: { id: number; nombre: string; tmdbCollectionId: number | null } | null;
  items: ItemSaga[];
  prequel: ItemSaga | null;
  sequel: ItemSaga | null;
  // "universo" se mantiene solo por compatibilidad hacia atrás (el backend
  // lo sigue mandando como el primero de "universos") — la lógica de este
  // componente ya no lo usa directamente, usa "universos" (el array
  // completo) para poder mostrar TODOS los universos a los que pertenece
  // esta película/serie a la vez, no solo el primero.
  universo: Universo | null;
  universos: Universo[];
}

interface UniversoResumen {
  id: number;
  nombre: string;
}

interface ResultadoTmdb {
  id: number;
  media_type: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
}

function useEsAdmin() {
  const [esAdmin, setEsAdmin] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('user');
      if (raw) setEsAdmin(!!JSON.parse(raw).isAdmin);
    } catch {
      setEsAdmin(false);
    }
  }, []);
  return esAdmin;
}

export default function CollectionLinks({ tmdbId, tipo = 'PELICULA', tituloActual, anioActual }: { tmdbId: number; tipo?: string; tituloActual?: string; anioActual?: number | null }) {
  const esAdmin = useEsAdmin();
  const router = useRouter();
  const idPeticionRef = useRef(0);

  const [collection, setCollection] = useState<CollectionResponse | null>(null);
  // tmdbIds cuya carátula ha fallado al cargar (URL rota — típico en títulos
  // anunciados/futuros que TMDB aún no tiene bien puesta) — se tratan igual
  // que si no tuvieran carátula, en vez de quedarse en blanco.
  const [fallosImagen, setFallosImagen] = useState<Set<number>>(new Set());
  const marcarFalloImagen = (tmdbId: number) =>
    setFallosImagen((prev) => (prev.has(tmdbId) ? prev : new Set(prev).add(tmdbId)));
  const [myDb, setMyDb] = useState<any[]>([]);
  const [personalizaciones, setPersonalizaciones] = useState<
    Record<number, { customPoster: string | null; customBackdrop: string | null }>
  >({});
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [pestañaActiva, setPestañaActiva] = useState(0);
  const [arrastrandoId, setArrastrandoId] = useState<number | null>(null);
  const [borrandoId, setBorrandoId] = useState<number | null>(null);
  const [reiniciando, setReiniciando] = useState(false);
  const [borrandoUniverso, setBorrandoUniverso] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const [resultadoRefresco, setResultadoRefresco] = useState<string | null>(null);
  const [nuevaFaseNombre, setNuevaFaseNombre] = useState('');
  const [creandoFase, setCreandoFase] = useState(false);
  const [sobreFaseId, setSobreFaseId] = useState<number | 'sin-fase' | null>(null);

  async function refrescarUniverso() {
    if (!universoActivo) return;
    setRefrescando(true);
    setResultadoRefresco(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${universoActivo.id}/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo refrescar');
      setResultadoRefresco(`+${body.añadidos} new movie(s) (checked ${body.fuentesRevisadas} source(s)).`);
      if (body.añadidos > 0) cargarColeccion();
    } catch (err) {
      console.error('Error al refrescar el universo', err);
    }
    setRefrescando(false);
  }

  const [busquedaTexto, setBusquedaTexto] = useState('');
  const [resultadosBusqueda, setResultadosBusqueda] = useState<ResultadoTmdb[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [anadiendoId, setAnadiendoId] = useState<number | null>(null);
  const [errorAnadir, setErrorAnadir] = useState<string | null>(null);

  const [mostrarFormUniverso, setMostrarFormUniverso] = useState(false);
  const [universosExistentes, setUniversosExistentes] = useState<UniversoResumen[]>([]);
  const [universoElegido, setUniversoElegido] = useState<'nuevo' | number>('nuevo');
  const [nombreNuevoUniverso, setNombreNuevoUniverso] = useState('');
  const [nombrePestañaNueva, setNombrePestañaNueva] = useState('');
  const [guardandoUniverso, setGuardandoUniverso] = useState(false);
  const [errorUniverso, setErrorUniverso] = useState<string | null>(null);

  const [mostrarFormSaga, setMostrarFormSaga] = useState(false);
  const [nombreNuevaSaga, setNombreNuevaSaga] = useState('');
  const [guardandoSaga, setGuardandoSaga] = useState(false);
  const [errorSaga, setErrorSaga] = useState<string | null>(null);

  const [mostrarAñadirColeccion, setMostrarAñadirColeccion] = useState(false);
  const [modoAñadir, setModoAñadir] = useState<'coleccion' | 'compañia' | 'keyword' | 'pelicula' | 'serie'>('coleccion');
  const [nuevoTmdbCollectionId, setNuevoTmdbCollectionId] = useState('');
  const [nuevaEtiquetaPestaña, setNuevaEtiquetaPestaña] = useState('');
  const [tmdbCompanyId, setTmdbCompanyId] = useState('');
  const [tmdbKeywordId, setTmdbKeywordId] = useState('');
  const [tmdbMovieId, setTmdbMovieId] = useState('');
  const [etiquetaPestañaPelicula, setEtiquetaPestañaPelicula] = useState('');
  const [tmdbSeriesId, setTmdbSeriesId] = useState('');
  const [etiquetaPestañaSerie, setEtiquetaPestañaSerie] = useState('');
  const [añadiendoColeccion, setAñadiendoColeccion] = useState(false);
  const [errorAñadirColeccion, setErrorAñadirColeccion] = useState<string | null>(null);
  const [resultadoImportacion, setResultadoImportacion] = useState<string | null>(null);

  const [borrandoSagaId, setBorrandoSagaId] = useState<number | null>(null);
  const [reiniciandoSaga, setReiniciandoSaga] = useState(false);

  function cargarColeccion() {
    const miId = ++idPeticionRef.current;
    const endpoint = tipo === 'SERIE' ? `${API_URL}/tmdb/tv/${tmdbId}/universe` : `${API_URL}/tmdb/collection/${tmdbId}`;
    fetch(withLangRegion(endpoint))
      .then((r) => r.json())
      .then((d: CollectionResponse) => {
        if (miId === idPeticionRef.current) setCollection(d);
      })
      .catch((err) => console.error('Error cargando colección/universo', err));
  }

  useEffect(() => {
    if (!tmdbId) return;
    cargarColeccion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId]);

  useEffect(() => {
    fetch(`${API_URL}/media`, { cache: 'no-store' })
      .then((r) => r.json())
      .then(setMyDb)
      .catch(() => { });
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || myDb.length === 0 || !collection) return;

    const idsUniverso = (collection.universos || []).flatMap((u) =>
      u.pestañas.flatMap((p) => p.items.map((it) => it.tmdbId))
    );
    const idsSaga = (collection.items || []).map((it) => it.tmdbId);

    const idsTmdb = [
      collection.prequel?.tmdbId,
      collection.sequel?.tmdbId,
      ...idsSaga,
      ...idsUniverso,
    ].filter(Boolean);

    const dbIds = idsTmdb
      .map((id) => myDb.find((m: any) => m.tmdbId === id)?.id)
      .filter(Boolean);
    if (dbIds.length === 0) return;

    fetch(`${API_URL}/media/personalizaciones?ids=${[...new Set(dbIds)].join(',')}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((res) => res.json())
      .then(setPersonalizaciones)
      .catch(() => { });
  }, [myDb, collection]);

  // Antes se guardaba solo el id del único universo posible. Ahora la
  // película/serie puede pertenecer a varios universos a la vez, así que la
  // clave que evita reinicializar en cada render es la combinación de TODOS
  // sus ids (ordenados, para que no importe en qué orden los devuelva la API).
  const universosInicializadosRef = useRef<string | null>(null);
  useEffect(() => {
    if (!collection?.universos || collection.universos.length === 0) return;
    const clave = collection.universos.map((u) => u.id).sort((a, b) => a - b).join(',');
    if (universosInicializadosRef.current === clave) return;
    universosInicializadosRef.current = clave;
    // La pestaña "propia" por defecto se calcula a partir del PRIMER universo
    // (mismo criterio que calcularTabsVisuales más abajo) — el resto de
    // universos siempre aparecen después, así que el índice 0/1 por defecto
    // sigue siendo correcto aunque haya más de un universo.
    const primerUniverso = collection.universos[0];
    const pestañaPropia = primerUniverso.pestañas.find((p) => p.items.some((it) => it.tmdbId === tmdbId));
    setPestañaActiva(pestañaPropia?.nombre === 'Other' && !esAdmin ? 1 : 0);
  }, [collection?.universos, tmdbId, esAdmin]);

  useEffect(() => {
    if (!esAdmin || busquedaTexto.trim().length < 2) {
      setResultadosBusqueda([]);
      return;
    }
    setBuscando(true);
    const timeout = setTimeout(() => {
      fetch(withLangRegion(`${API_URL}/tmdb/buscar?q=${encodeURIComponent(busquedaTexto)}`))
        .then((r) => r.json())
        .then((d) =>
          setResultadosBusqueda(
            (Array.isArray(d) ? d : []).filter((r: ResultadoTmdb) => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 20)
          )
        )
        .catch((err) => console.error('Error buscando en TMDB', err))
        .finally(() => setBuscando(false));
    }, 350);
    return () => clearTimeout(timeout);
  }, [busquedaTexto, esAdmin]);

  const puedeArrancarUniverso = esAdmin && (tipo === 'SERIE' || !collection?.collection);
  const hayItemsSaga = (collection?.items?.length || 0) > 0;
  const hayUniversos = !!(collection?.universos && collection.universos.length > 0);
  if (
    !collection ||
    (!hayUniversos && !hayItemsSaga && !collection.prequel && !collection.sequel && !puedeArrancarUniverso)
  ) {
    return null;
  }

  // universoId identifica de qué universo viene cada pestaña — hace falta
  // para que las acciones de admin (Reset, Delete, Refresh, Add collection,
  // Phases, añadir por búsqueda...) sepan sobre CUÁL de los varios universos
  // posibles actuar, según la pestaña que esté activa en cada momento.
  type TabVisual = { tipo: 'propia' | 'universo'; nombre: string; items: UniverseItem[]; pestañaOrigen?: string; universoId: number };

  // Antes solo existía un universo posible. Ahora una película/serie puede
  // pertenecer a VARIOS a la vez (p. ej. "AVP: Alien vs. Predator" en
  // "Aliens" y en "Predator") — esta función recorre TODOS los universos
  // recibidos y genera una pestaña por cada uno, en vez de quedarse solo con
  // el primero.
  function calcularTabsVisuales(universos: Universo[]): TabVisual[] {
    if (universos.length === 0) return [];

    // La pestaña "propia" (p. ej. "AVP Collection") se calcula a partir del
    // PRIMER universo al que pertenece — si aparece en varios universos con
    // agrupaciones propias distintas, esta pestaña muestra la del primero;
    // cada universo aporta ADEMÁS su propia pestaña "mezclada" (ver abajo),
    // así que ninguno queda oculto.
    const primerUniverso = universos[0];
    const pestañaPropia =
      primerUniverso.pestañas.find((p) => p.items.some((it) => it.tmdbId === tmdbId)) || primerUniverso.pestañas[0];

    const tabPropia: TabVisual = {
      tipo: 'propia',
      nombre: pestañaPropia.nombre,
      items: [...pestañaPropia.items].sort((a, b) => {
        const fechaA = a.fechaEstreno ? new Date(a.fechaEstreno).getTime() : a.anio ? new Date(a.anio, 0, 1).getTime() : Infinity;
        const fechaB = b.fechaEstreno ? new Date(b.fechaEstreno).getTime() : b.anio ? new Date(b.anio, 0, 1).getTime() : Infinity;
        return fechaA - fechaB;
      }),
      pestañaOrigen: pestañaPropia.nombre,
      universoId: primerUniverso.id,
    };

    // Una pestaña "mezclada" (todo el universo junto) POR CADA universo al
    // que pertenezca este título — esto es lo que hace que ahora se vean
    // "Aliens" Y "Predator" a la vez, en vez de solo el primero.
    const tabsUniverso: TabVisual[] = universos.map((universo) => {
      const vistos = new Set<number>();
      const todas: UniverseItem[] = [];
      for (const p of universo.pestañas) {
        for (const it of p.items) {
          if (vistos.has(it.tmdbId)) continue;
          vistos.add(it.tmdbId);
          todas.push(it);
        }
      }
      todas.sort((a, b) => {
        const tieneOrdenA = a.ordenUniverso != null;
        const tieneOrdenB = b.ordenUniverso != null;
        if (tieneOrdenA || tieneOrdenB) {
          return (a.ordenUniverso ?? Infinity) - (b.ordenUniverso ?? Infinity);
        }
        const fechaA = a.fechaEstreno ? new Date(a.fechaEstreno).getTime() : a.anio ? new Date(a.anio, 0, 1).getTime() : Infinity;
        const fechaB = b.fechaEstreno ? new Date(b.fechaEstreno).getTime() : b.anio ? new Date(b.anio, 0, 1).getTime() : Infinity;
        return fechaA - fechaB;
      });
      return { tipo: 'universo' as const, nombre: universo.nombre, items: todas, universoId: universo.id };
    });

    return [tabPropia, ...tabsUniverso];
  }

  const tabsVisuales = hayUniversos ? calcularTabsVisuales(collection.universos) : [];
  const tabActiva = tabsVisuales[pestañaActiva];
  // El universo "activo" es el que corresponde a la pestaña que se está
  // viendo ahora mismo — todas las acciones de admin (Reset, Delete,
  // Refresh, Phases, añadir por búsqueda...) actúan sobre ESTE universo,
  // no siempre sobre "el primero" como antes.
  const universoActivo = tabActiva ? (collection.universos || []).find((u) => u.id === tabActiva.universoId) || null : null;

  const modoSaga = !hayUniversos && !!collection.collection;

  const getLocalData = (id: number) => {
    const local = myDb.find((m: any) => m.tmdbId === id);
    const dbId = local?.id || null;
    const miPersonalizacion = dbId ? personalizaciones[dbId] : undefined;
    return {
      dbId,
      customPoster: miPersonalizacion?.customPoster || local?.portada || null,
    };
  };

  const handleClick = async (item: { tmdbId: number; tipo?: string; titulo?: string }, dbId: number | null) => {
    if (loadingId) return;
    setLoadingId(item.tmdbId);
    if (dbId) {
      router.push(urlFicha({ tipo: item.tipo || 'PELICULA', titulo: item.titulo, id: dbId } as any));
    } else {
      try {
        const esSerie = item.tipo === 'SERIE';
        const endpoint = esSerie ? `${API_URL}/media/tmdb?tipo=SERIE` : `${API_URL}/media/tmdb`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tmdbId: item.tmdbId, tipo: esSerie ? 'SERIE' : 'PELICULA' }),
        });
        const nueva = await res.json();
        router.push(urlFicha(nueva));
      } catch (e) {
        setLoadingId(null);
      }
    }
  };

  const renderItem = (item: ItemSaga | null, label: string) => {
    if (!item) return null;
    const { dbId, customPoster } = getLocalData(item.tmdbId);
    const posterUrl = customPoster || item.portada;
    const mostrarImagen = posterUrl && !fallosImagen.has(item.tmdbId);

    return (
      <div onClick={() => handleClick(item, dbId)} className="flex flex-col items-center gap-1.5 cursor-pointer group w-24">
        <div className="relative w-full aspect-[2/3] rounded border border-gray-700 group-hover:border-gray-400 transition shadow-lg overflow-hidden bg-black">
          {mostrarImagen ? (
            <img
              src={posterUrl}
              alt={item.titulo}
              onError={() => marcarFalloImagen(item.tmdbId)}
              className={`w-full h-full object-cover ${loadingId === item.tmdbId ? 'opacity-50 blur-sm' : ''}`}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-center p-2">
              <p className="text-xs font-semibold text-white">{item.titulo}</p>
            </div>
          )}
          {loadingId === item.tmdbId && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <span className="text-white text-[10px] font-bold">...</span>
            </div>
          )}
        </div>
        <span className="text-xs text-gray-400 group-hover:text-white transition font-medium">{label}</span>
      </div>
    );
  };

  const renderSagaCard = (item: ItemSaga) => {
    const { dbId, customPoster } = getLocalData(item.tmdbId);
    const posterUrl = customPoster || item.portada;
    const esActual = item.tmdbId === tmdbId;
    const mostrarImagen = posterUrl && !fallosImagen.has(item.tmdbId);

    return (
      <div key={item.id} className="group relative">
        {esAdmin && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              borrarDeSaga(item);
            }}
            disabled={borrandoSagaId !== null}
            title="Remove from saga"
            className="absolute top-1 left-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/80 text-sm font-bold text-white opacity-0 transition hover:bg-red-600 group-hover:opacity-100 cursor-pointer disabled:cursor-default"
          >
            ×
          </button>
        )}
        <div
          onClick={() => handleClick(item, dbId)}
          className={`flex flex-col items-center gap-2 p-2 rounded-lg cursor-pointer transition ${esActual ? 'bg-gray-800/80 ring-1 ring-blue-500' : 'hover:bg-gray-800/50'
            }`}
        >
          <div className="w-full aspect-[2/3] rounded overflow-hidden border border-gray-700 bg-black">
            {mostrarImagen ? (
              <img
                src={posterUrl}
                alt={item.titulo}
                onError={() => marcarFalloImagen(item.tmdbId)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-center p-2">
                <p className="text-xs font-semibold text-white">{item.titulo}</p>
              </div>
            )}
          </div>
          <div className="text-center">
            <p className="font-semibold text-white text-sm leading-tight">{item.titulo}</p>
            <p className="text-xs text-gray-400">{item.anio ?? '—'}{esActual ? " · You're viewing this" : ''}</p>
          </div>
        </div>
      </div>
    );
  };

  async function borrarDeSaga(item: ItemSaga) {
    if (borrandoSagaId !== null) return;
    setBorrandoSagaId(item.id);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/movie-collections/items/${item.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('No se pudo eliminar');
      setCollection((prev) => (prev ? { ...prev, items: prev.items.filter((it) => it.id !== item.id) } : prev));
    } catch (err) {
      console.error('Error al borrar de la saga', err);
    }
    setBorrandoSagaId(null);
  }

  async function reiniciarSaga() {
    if (!collection?.collection) return;
    if (!collection.collection.tmdbCollectionId) {
      alert("This saga doesn't have a TMDB collection to recalculate from.");
      return;
    }
    if (!window.confirm(`Delete ALL edits from "${collection.collection.nombre}" and recalculate from TMDB? This can't be undone.`)) {
      return;
    }
    setReiniciandoSaga(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/movie-collections/${collection.collection.id}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tmdbIdActual: tmdbId }),
      });
      if (!res.ok) throw new Error('No se pudo reiniciar la saga');
      cargarColeccion();
    } catch (err) {
      console.error('Error al reiniciar la saga', err);
    }
    setReiniciandoSaga(false);
  }

  async function añadirPelicula(resultado: ResultadoTmdb) {
    setAnadiendoId(resultado.id);
    setErrorAnadir(null);
    try {
      const token = localStorage.getItem('token');

      if (modoSaga && collection?.collection) {
        const esSerieResultado = resultado.media_type === 'tv';
        const tituloResultado = resultado.title || resultado.name || '';
        const posterUrl = resultado.poster_path ? `https://image.tmdb.org/t/p/w780${resultado.poster_path}` : null;
        const fechaResultado = resultado.release_date || resultado.first_air_date || null;

        const res = await fetch(`${API_URL}/admin/movie-collections/${collection.collection.id}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            tmdbId: resultado.id,
            tipo: esSerieResultado ? 'SERIE' : 'PELICULA',
            titulo: tituloResultado,
            anio: fechaResultado ? new Date(fechaResultado).getFullYear() : null,
            portada: posterUrl,
          }),
        });
        const body = await res.json();
        if (!res.ok) {
          setErrorAnadir(body.error || 'No se pudo añadir el título');
          return;
        }
        setBusquedaTexto('');
        setResultadosBusqueda([]);
        cargarColeccion();
        return;
      }

      if (!universoActivo || !tabActiva?.pestañaOrigen) return;

      const esSerieResultado = resultado.media_type === 'tv';
      const tituloResultado = resultado.title || resultado.name || '';
      const fechaResultado = resultado.release_date || resultado.first_air_date || null;
      const res = await fetch(`${API_URL}/admin/cinematic-universe-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          universeId: universoActivo.id,
          tmdbId: resultado.id,
          tipo: esSerieResultado ? 'SERIE' : 'PELICULA',
          titulo: tituloResultado,
          anio: fechaResultado ? new Date(fechaResultado).getFullYear() : null,
          fechaEstreno: fechaResultado,
          portada: resultado.poster_path ? `https://image.tmdb.org/t/p/w780${resultado.poster_path}` : null,
          pestaña: tabActiva.pestañaOrigen,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrorAnadir(body.error || 'No se pudo añadir el título');
        return;
      }
      setBusquedaTexto('');
      setResultadosBusqueda([]);
      cargarColeccion();
    } catch (err: any) {
      console.error('Error al añadir el título', err);
      setErrorAnadir(err.message || 'No se pudo añadir el título');
    } finally {
      setAnadiendoId(null);
    }
  }

  const hrefDeItemUniverso = (item: UniverseItem) =>
    item.tipo === 'SERIE' ? `/series/tmdb/${item.tmdbId}` : `/movie/tmdb/${item.tmdbId}`;

  function listaDeLaPestañaActual(): UniverseItem[] {
    return tabActiva?.items || [];
  }

  function actualizarPestañaActual(nuevaLista: UniverseItem[]) {
    const origen = tabActiva?.pestañaOrigen;
    const universeId = tabActiva?.universoId;
    if (!origen || universeId == null) return;
    setCollection((prev) => {
      if (!prev?.universos) return prev;
      const universos = prev.universos.map((u) =>
        u.id === universeId
          ? { ...u, pestañas: u.pestañas.map((p) => (p.nombre === origen ? { ...p, items: nuevaLista } : p)) }
          : u
      );
      return { ...prev, universos };
    });
  }

  async function crearFase() {
    if (!universoActivo || !nuevaFaseNombre.trim()) return;
    setCreandoFase(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${universoActivo.id}/phases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nombre: nuevaFaseNombre.trim() }),
      });
      if (!res.ok) throw new Error('No se pudo crear la fase');
      setNuevaFaseNombre('');
      cargarColeccion();
    } catch (err) {
      console.error('Error al crear la fase', err);
    }
    setCreandoFase(false);
  }

  async function borrarFase(faseId: number) {
    try {
      const token = localStorage.getItem('token');
      await fetch(`${API_URL}/admin/cinematic-universe-phases/${faseId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      cargarColeccion();
    } catch (err) {
      console.error('Error al borrar la fase', err);
    }
  }

  async function asignarFase(itemId: number, faseId: number | null) {
    const universeId = tabActiva?.universoId;
    setCollection((prev) => {
      if (!prev?.universos || universeId == null) return prev;
      const universos = prev.universos.map((u) =>
        u.id === universeId
          ? {
            ...u,
            pestañas: u.pestañas.map((p) => ({
              ...p,
              items: p.items.map((it) => (it.id === itemId ? { ...it, faseId } : it)),
            })),
          }
          : u
      );
      return { ...prev, universos };
    });
    try {
      const token = localStorage.getItem('token');
      await fetch(`${API_URL}/admin/cinematic-universe-items/${itemId}/phase`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ faseId }),
      });
    } catch (err) {
      console.error('Error al asignar la fase', err);
    }
  }

  function agruparPorFase(items: UniverseItem[], fases: FaseUniverso[]) {
    const porAnioAsc = (a: UniverseItem, b: UniverseItem) => {
      const fechaA = a.fechaEstreno ? new Date(a.fechaEstreno).getTime() : a.anio ? new Date(a.anio, 0, 1).getTime() : Infinity;
      const fechaB = b.fechaEstreno ? new Date(b.fechaEstreno).getTime() : b.anio ? new Date(b.anio, 0, 1).getTime() : Infinity;
      return fechaA - fechaB;
    };

    const grupos: { fase: FaseUniverso | null; items: UniverseItem[] }[] = fases.map((fase) => ({
      fase,
      items: items.filter((it) => it.faseId === fase.id).sort(porAnioAsc),
    }));
    grupos.push({ fase: null, items: items.filter((it) => it.faseId == null).sort(porAnioAsc) });
    return grupos;
  }

  function actualizarOrdenUniversoLocal(nuevoOrdenIds: number[]) {
    const posicion = new Map(nuevoOrdenIds.map((id, i) => [id, i]));
    const universeId = tabActiva?.universoId;
    setCollection((prev) => {
      if (!prev?.universos || universeId == null) return prev;
      const universos = prev.universos.map((u) =>
        u.id === universeId
          ? {
            ...u,
            pestañas: u.pestañas.map((p) => ({
              ...p,
              items: p.items.map((it) => (posicion.has(it.id) ? { ...it, ordenUniverso: posicion.get(it.id)! } : it)),
            })),
          }
          : u
      );
      return { ...prev, universos };
    });
  }

  function handleDragStart(id: number) {
    if (!esAdmin) return;
    setArrastrandoId(id);
  }

  function handleDragOver(e: React.DragEvent, idDebajo: number) {
    if (!esAdmin || arrastrandoId === null) return;
    e.preventDefault();
    if (arrastrandoId === idDebajo) return;
    const lista = listaDeLaPestañaActual();
    const idxOrigen = lista.findIndex((it) => it.id === arrastrandoId);
    const idxDestino = lista.findIndex((it) => it.id === idDebajo);
    if (idxOrigen === -1 || idxDestino === -1) return;
    const nueva = [...lista];
    const [movido] = nueva.splice(idxOrigen, 1);
    nueva.splice(idxDestino, 0, movido);

    if (tabActiva?.tipo === 'propia') {
      actualizarPestañaActual(nueva);
    } else {
      actualizarOrdenUniversoLocal(nueva.map((it) => it.id));
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (!esAdmin || arrastrandoId === null) return;
    setArrastrandoId(null);
    try {
      const token = localStorage.getItem('token');
      const ids = listaDeLaPestañaActual().map((it) => it.id);
      const endpoint =
        tabActiva?.tipo === 'propia'
          ? `${API_URL}/admin/cinematic-universe-items/reorder`
          : `${API_URL}/admin/cinematic-universe-items/reorder-universo`;
      await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids }),
      });
    } catch (err) {
      console.error('Error al guardar el nuevo orden', err);
    }
  }

  function cambiarPestaña(i: number) {
    setPestañaActiva(i);
    setBusquedaTexto('');
    setResultadosBusqueda([]);
    setErrorAnadir(null);
  }

  async function borrarItem(item: UniverseItem) {
    if (borrandoId !== null) return;
    setBorrandoId(item.id);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universe-items/${item.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('No se pudo eliminar');
      setCollection((prev) => {
        const universeId = tabActiva?.universoId;
        if (!prev?.universos || universeId == null) return prev;
        const universos = prev.universos.map((u) =>
          u.id === universeId
            ? { ...u, pestañas: u.pestañas.map((p) => ({ ...p, items: p.items.filter((it) => it.id !== item.id) })) }
            : u
        );
        return { ...prev, universos };
      });
    } catch (err) {
      console.error('Error al borrar de la colección', err);
    }
    setBorrandoId(null);
  }

  async function crearSagaDesdeCero() {
    if (!nombreNuevaSaga.trim() || !tmdbId) return;
    setGuardandoSaga(true);
    setErrorSaga(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/movie-collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nombre: nombreNuevaSaga.trim(), tmdbId, tipo, titulo: tituloActual, anio: anioActual }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo crear la saga');

      setMostrarFormSaga(false);
      setNombreNuevaSaga('');
      cargarColeccion();
    } catch (err: any) {
      setErrorSaga(err.message || 'Algo falló');
    }
    setGuardandoSaga(false);
  }

  function abrirFormUniverso() {
    setNombrePestañaNueva(collection?.collection?.nombre || '');
    setErrorUniverso(null);
    setMostrarFormUniverso(true);
    const token = localStorage.getItem('token');
    fetch(`${API_URL}/admin/cinematic-universes`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setUniversosExistentes)
      .catch(() => { });
  }

  async function guardarUniversoItemSuelto() {
    if (!tmdbId) return;
    setGuardandoUniverso(true);
    setErrorUniverso(null);
    try {
      const token = localStorage.getItem('token');
      let universeId: number;

      if (universoElegido === 'nuevo') {
        if (!nombreNuevoUniverso.trim()) {
          setErrorUniverso('Ponle un nombre al universo');
          setGuardandoUniverso(false);
          return;
        }
        const resCrear = await fetch(`${API_URL}/admin/cinematic-universes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ nombre: nombreNuevoUniverso.trim() }),
        });
        const nuevo = await resCrear.json();
        if (!resCrear.ok) throw new Error(nuevo.error || 'No se pudo crear el universo');
        universeId = nuevo.id;
      } else {
        universeId = universoElegido;
      }

      const endpoint = tipo === 'SERIE' ? 'add-series' : 'add-movie';
      const resAñadir = await fetch(`${API_URL}/admin/cinematic-universes/${universeId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tmdbId,
          pestaña: nombrePestañaNueva.trim() || 'Other',
        }),
      });
      const bodyAñadir = await resAñadir.json();
      if (!resAñadir.ok) throw new Error(bodyAñadir.error || `No se pudo añadir ${tipo === 'SERIE' ? 'la serie' : 'la película'} al universo`);

      setMostrarFormUniverso(false);
      cargarColeccion();
    } catch (err: any) {
      setErrorUniverso(err.message || 'Algo falló');
    }
    setGuardandoUniverso(false);
  }

  async function guardarUniverso() {
    if (!collection?.collection?.tmdbCollectionId) return;
    setGuardandoUniverso(true);
    setErrorUniverso(null);
    try {
      const token = localStorage.getItem('token');
      let universeId: number;

      if (universoElegido === 'nuevo') {
        if (!nombreNuevoUniverso.trim()) {
          setErrorUniverso('Ponle un nombre al universo');
          setGuardandoUniverso(false);
          return;
        }
        const resCrear = await fetch(`${API_URL}/admin/cinematic-universes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ nombre: nombreNuevoUniverso.trim() }),
        });
        const nuevo = await resCrear.json();
        if (!resCrear.ok) throw new Error(nuevo.error || 'No se pudo crear el universo');
        universeId = nuevo.id;
      } else {
        universeId = universoElegido;
      }

      const resAñadir = await fetch(`${API_URL}/admin/cinematic-universes/${universeId}/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tmdbCollectionId: collection.collection.tmdbCollectionId,
          nombrePestaña: nombrePestañaNueva.trim() || undefined,
        }),
      });
      const bodyAñadir = await resAñadir.json();
      if (!resAñadir.ok) throw new Error(bodyAñadir.error || 'No se pudo añadir la colección al universo');

      setMostrarFormUniverso(false);
      cargarColeccion();
    } catch (err: any) {
      setErrorUniverso(err.message || 'Algo falló');
    }
    setGuardandoUniverso(false);
  }

  async function añadirOtraColeccion() {
    if (!universoActivo) return;
    const idNum = parseInt(nuevoTmdbCollectionId, 10);
    if (Number.isNaN(idNum)) {
      setErrorAñadirColeccion('Ese id de colección de TMDB no es válido');
      return;
    }
    setAñadiendoColeccion(true);
    setErrorAñadirColeccion(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${universoActivo.id}/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tmdbCollectionId: idNum,
          nombrePestaña: nuevaEtiquetaPestaña.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo añadir la colección');

      setMostrarAñadirColeccion(false);
      setNuevoTmdbCollectionId('');
      setNuevaEtiquetaPestaña('');
      cargarColeccion();
    } catch (err: any) {
      setErrorAñadirColeccion(err.message || 'Algo falló');
    }
    setAñadiendoColeccion(false);
  }

  async function añadirPeliculaPorId() {
    if (!universoActivo) return;
    const idNum = parseInt(tmdbMovieId, 10);
    if (Number.isNaN(idNum)) {
      setErrorAñadirColeccion('Ese id de película de TMDB no es válido');
      return;
    }
    if (!etiquetaPestañaPelicula.trim()) {
      setErrorAñadirColeccion('Ponle un nombre a la pestaña donde quieres que caiga');
      return;
    }
    setAñadiendoColeccion(true);
    setErrorAñadirColeccion(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${universoActivo.id}/add-movie`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tmdbId: idNum, pestaña: etiquetaPestañaPelicula.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo añadir la película');

      setMostrarAñadirColeccion(false);
      setTmdbMovieId('');
      setEtiquetaPestañaPelicula('');
      cargarColeccion();
    } catch (err: any) {
      setErrorAñadirColeccion(err.message || 'Algo falló');
    }
    setAñadiendoColeccion(false);
  }

  async function añadirSeriePorId() {
    if (!universoActivo) return;
    const idNum = parseInt(tmdbSeriesId, 10);
    if (Number.isNaN(idNum)) {
      setErrorAñadirColeccion('Ese id de serie de TMDB no es válido');
      return;
    }
    if (!etiquetaPestañaSerie.trim()) {
      setErrorAñadirColeccion('Ponle un nombre a la pestaña donde quieres que caiga');
      return;
    }
    setAñadiendoColeccion(true);
    setErrorAñadirColeccion(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${universoActivo.id}/add-series`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tmdbId: idNum, pestaña: etiquetaPestañaSerie.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo añadir la serie');

      setMostrarAñadirColeccion(false);
      setTmdbSeriesId('');
      setEtiquetaPestañaSerie('');
      cargarColeccion();
    } catch (err: any) {
      setErrorAñadirColeccion(err.message || 'Algo falló');
    }
    setAñadiendoColeccion(false);
  }

  async function importarPorKeyword() {
    if (!universoActivo) return;
    const idNum = parseInt(tmdbKeywordId, 10);
    if (Number.isNaN(idNum)) {
      setErrorAñadirColeccion('Ese id de keyword de TMDB no es válido');
      return;
    }
    setAñadiendoColeccion(true);
    setErrorAñadirColeccion(null);
    setResultadoImportacion(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${universoActivo.id}/import-by-keyword`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tmdbKeywordId: idNum }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo importar');

      setResultadoImportacion(`Added ${body.añadidos} of ${body.total} movies found.`);
      cargarColeccion();
    } catch (err: any) {
      setErrorAñadirColeccion(err.message || 'Algo falló');
    }
    setAñadiendoColeccion(false);
  }

  async function importarPorCompañia() {
    if (!universoActivo) return;
    const idNum = parseInt(tmdbCompanyId, 10);
    if (Number.isNaN(idNum)) {
      setErrorAñadirColeccion('Ese id de productora de TMDB no es válido');
      return;
    }
    setAñadiendoColeccion(true);
    setErrorAñadirColeccion(null);
    setResultadoImportacion(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${universoActivo.id}/import-by-company`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tmdbCompanyId: idNum }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo importar');

      setResultadoImportacion(`Added ${body.añadidos} of ${body.total} movies found.`);
      cargarColeccion();
    } catch (err: any) {
      setErrorAñadirColeccion(err.message || 'Algo falló');
    }
    setAñadiendoColeccion(false);
  }

  async function reiniciarUniverso() {
    if (!universoActivo) return;
    if (!window.confirm(`Delete ALL movies from "${universoActivo.nombre}"? This can't be undone — you'll need to re-import afterward.`)) {
      return;
    }
    setReiniciando(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${universoActivo.id}/reset`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('No se pudo vaciar el universo');
      setPestañaActiva(0);
      cargarColeccion();
    } catch (err) {
      console.error('Error al vaciar el universo', err);
    }
    setReiniciando(false);
  }

  async function borrarUniverso() {
    if (!universoActivo) return;
    if (!window.confirm(`Permanently delete the universe "${universoActivo.nombre}"? This can't be undone.`)) {
      return;
    }
    setBorrandoUniverso(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${universoActivo.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('No se pudo borrar el universo');
      setIsModalOpen(false);
      cargarColeccion();
    } catch (err) {
      console.error('Error al borrar el universo', err);
    }
    setBorrandoUniverso(false);
  }

  function renderTarjetaUniverso(it: UniverseItem) {
    const esActual = it.tmdbId === tmdbId;
    const local = myDb.find((m: any) => m.tmdbId === it.tmdbId);
    const miPersonalizacion = local ? personalizaciones[local.id] : undefined;
    const portadaReal = miPersonalizacion?.customPoster || local?.portada || it.portada;
    return (
      <div
        key={it.id}
        className={`group relative ${arrastrandoId === it.id ? 'opacity-40' : ''}`}
        onDragStart={() => handleDragStart(it.id)}
        onDragOver={(e) => handleDragOver(e, it.id)}
        onDrop={handleDrop}
        onDragEnd={() => {
          setArrastrandoId(null);
          setSobreFaseId(null);
        }}
      >
        <BotonBorrar item={it} />
        <a href={hrefDeItemUniverso(it)} className="block w-full rounded text-left cursor-pointer">
          {portadaReal && (
            <img
              src={portadaReal}
              alt={it.titulo}
              draggable={esAdmin}
              className={`w-full aspect-[2/3] object-cover rounded transition ${esActual ? 'ring-2 ring-blue-500' : 'group-hover:opacity-80 group-hover:scale-[1.02]'
                } ${esAdmin ? 'cursor-grab active:cursor-grabbing' : ''}`}
            />
          )}
          <p className="mt-2 text-sm font-semibold text-white select-text">{it.titulo}</p>
          <p className="text-xs text-gray-400">{it.anio}{esActual ? " · You're viewing this" : ''}</p>
        </a>
      </div>
    );
  }

  function BotonBorrar({ item }: { item: UniverseItem }) {
    if (!esAdmin) return null;
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          borrarItem(item);
        }}
        disabled={borrandoId !== null}
        title="Remove from universe"
        className="absolute top-1 left-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/80 text-sm font-bold text-white opacity-0 transition hover:bg-red-600 group-hover:opacity-100 cursor-pointer disabled:cursor-default"
      >
        ×
      </button>
    );
  }

  // El título del modal ahora sigue a la pestaña activa: si estás viendo
  // "Predator" muestra "Predator", si cambias a "Aliens" muestra "Aliens" —
  // así queda claro en cuál de los varios universos posibles estás.
  const nombreSagaOUniverso = universoActivo?.nombre || collection.collection?.nombre || 'Full saga';
  const nombrePestañaActivaMostrar = hayUniversos ? tabActiva?.nombre : collection.collection?.nombre;
  const yaEnLaListaDeSaga = (r: ResultadoTmdb, tipoResultado: string) =>
    modoSaga ? (collection.items || []).some((it) => it.tmdbId === r.id && it.tipo === tipoResultado) : false;

  return (
    <>
      <div className="mt-4 bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl">
        <div className="flex justify-center gap-4">
          {collection.prequel && (
            <div className={collection.sequel ? 'w-1/2' : 'w-1/2 max-w-[200px]'}>
              {renderItem(collection.prequel, 'Prequel')}
            </div>
          )}
          {collection.sequel && (
            <div className={collection.prequel ? 'w-1/2' : 'w-1/2 max-w-[200px]'}>
              {renderItem(collection.sequel, 'Sequel')}
            </div>
          )}
        </div>

        {((collection.items && collection.items.length > 1) || hayUniversos || (esAdmin && collection.collection)) && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="w-full mt-4 text-xs text-gray-400 hover:text-white text-center underline cursor-pointer bg-gray-900/80 py-2 rounded border border-gray-800 transition"
          >
            See full saga
          </button>
        )}

        {esAdmin && !collection.collection && !hayUniversos && (
          <>
            {!mostrarFormSaga ? (
              <button
                onClick={() => setMostrarFormSaga(true)}
                className="w-full mt-4 text-xs text-blue-400 hover:text-blue-300 text-center underline cursor-pointer bg-gray-900/80 py-2 rounded border border-gray-800 transition"
              >
                Start a saga
              </button>
            ) : (
              <div className="mt-4 bg-gray-900/80 p-3 rounded border border-gray-800 space-y-2">
                <input
                  type="text"
                  value={nombreNuevaSaga}
                  onChange={(e) => setNombreNuevaSaga(e.target.value)}
                  placeholder="Saga name (e.g. John Wick Collection)"
                  className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-500"
                />
                {errorSaga && <p className="text-xs text-red-400">{errorSaga}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setMostrarFormSaga(false)}
                    disabled={guardandoSaga}
                    className="px-3 py-1 text-xs text-gray-300 hover:text-white transition cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={crearSagaDesdeCero}
                    disabled={guardandoSaga || !nombreNuevaSaga.trim()}
                    className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold transition cursor-pointer disabled:opacity-40"
                  >
                    {guardandoSaga ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {esAdmin && !hayUniversos && (tipo === 'SERIE' || !collection.collection) && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="w-full mt-4 text-xs text-blue-400 hover:text-blue-300 text-center underline cursor-pointer bg-gray-900/80 py-2 rounded border border-gray-800 transition"
          >
            Add to a Cinematic Universe
          </button>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setIsModalOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-gray-900 border border-gray-700 rounded-lg max-w-5xl w-full max-h-[85vh] text-white shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-700 flex-shrink-0">
              <h2 className="text-xl font-bold">{nombreSagaOUniverso}</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-white text-2xl font-bold cursor-pointer">✕</button>
            </div>

            {hayUniversos && (
              <div className="flex items-center justify-between px-6 pt-3 border-b border-gray-800 flex-shrink-0">
                <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                  {tabsVisuales
                    .filter((t) => esAdmin || t.nombre !== 'Other')
                    .map((t) => {
                      const i = tabsVisuales.indexOf(t);
                      return (
                        <button
                          // Antes bastaba con t.tipo como key porque solo había
                          // como mucho una pestaña 'propia' y una 'universo'.
                          // Ahora puede haber VARIAS pestañas 'universo' (una
                          // por cada universo al que pertenezca el título), así
                          // que hace falta una key única por pestaña de verdad.
                          key={`tab-${t.universoId}-${t.tipo}-${i}`}
                          onClick={() => cambiarPestaña(i)}
                          className={`px-3 py-2 text-sm font-semibold whitespace-nowrap border-b-2 transition cursor-pointer ${pestañaActiva === i ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
                            }`}
                        >
                          {t.nombre}
                        </button>
                      );
                    })}
                </div>
                {esAdmin && (
                  <div className="mb-2 flex items-center gap-4">
                    <button
                      onClick={reiniciarUniverso}
                      disabled={reiniciando}
                      className="text-xs font-semibold text-amber-400 hover:text-amber-300 underline cursor-pointer transition whitespace-nowrap disabled:opacity-50"
                    >
                      {reiniciando ? 'Resetting...' : 'Reset'}
                    </button>
                    <button
                      onClick={borrarUniverso}
                      disabled={borrandoUniverso}
                      className="text-xs font-semibold text-red-400 hover:text-red-300 underline cursor-pointer transition whitespace-nowrap disabled:opacity-50"
                    >
                      {borrandoUniverso ? 'Deleting...' : 'Delete universe'}
                    </button>
                    <button
                      onClick={refrescarUniverso}
                      disabled={refrescando}
                      className="text-xs font-semibold text-green-400 hover:text-green-300 underline cursor-pointer transition whitespace-nowrap disabled:opacity-50"
                      title="Re-check saved sources (collections/studio/keyword) for new movies"
                    >
                      {refrescando ? 'Refreshing...' : 'Refresh'}
                    </button>
                    <button
                      onClick={() => setMostrarAñadirColeccion(true)}
                      className="text-xs font-semibold text-blue-400 hover:text-blue-300 underline cursor-pointer transition whitespace-nowrap"
                    >
                      + Add collection
                    </button>
                  </div>
                )}
              </div>
            )}

            {modoSaga && esAdmin && collection.collection?.tmdbCollectionId && (
              <div className="flex items-center justify-end px-6 pt-3 border-b border-gray-800 flex-shrink-0 pb-2">
                <button
                  onClick={reiniciarSaga}
                  disabled={reiniciandoSaga}
                  className="text-xs font-semibold text-amber-400 hover:text-amber-300 underline cursor-pointer transition whitespace-nowrap disabled:opacity-50"
                >
                  {reiniciandoSaga ? 'Resetting...' : 'Reset'}
                </button>
              </div>
            )}

            {resultadoRefresco && (
              <p className="px-6 pt-1 text-xs text-gray-500">{resultadoRefresco}</p>
            )}

            {esAdmin && (tabActiva?.tipo === 'propia' || modoSaga) && (
              <div className="relative px-6 pt-4">
                <input
                  type="text"
                  value={busquedaTexto}
                  onChange={(e) => setBusquedaTexto(e.target.value)}
                  placeholder={`Add a movie or series to "${nombrePestañaActivaMostrar || 'this saga'}"...`}
                  className="w-full max-w-md bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
                />
                {errorAnadir && <p className="mt-1 text-xs text-red-400">{errorAnadir}</p>}
                {busquedaTexto.trim().length >= 2 && (
                  <div className="absolute z-10 mt-1 w-full max-w-md max-h-72 overflow-y-auto rounded border border-gray-700 bg-[#20262e] shadow-xl">
                    {buscando ? (
                      <p className="px-3 py-2 text-sm text-gray-400">Searching...</p>
                    ) : resultadosBusqueda.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-gray-400">No results.</p>
                    ) : (
                      resultadosBusqueda.map((r) => {
                        const esSerieResultado = r.media_type === 'tv';
                        const fechaResultado = r.release_date || r.first_air_date;
                        const anioResultado = fechaResultado ? new Date(fechaResultado).getFullYear() : null;
                        const tipoResultado = esSerieResultado ? 'SERIE' : 'PELICULA';
                        const yaEnLaLista = modoSaga
                          ? yaEnLaListaDeSaga(r, tipoResultado)
                          : universoActivo
                            ? universoActivo.pestañas.some((p) => p.items.some((it) => it.tmdbId === r.id && it.tipo === tipoResultado))
                            : false;
                        return (
                          <button
                            key={`${r.media_type}-${r.id}`}
                            onClick={() => !yaEnLaLista && añadirPelicula(r)}
                            disabled={yaEnLaLista || anadiendoId !== null}
                            className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition cursor-pointer disabled:cursor-default ${yaEnLaLista ? 'text-gray-600' : 'text-blue-400 hover:bg-white/5 hover:text-blue-300'
                              }`}
                          >
                            <span>
                              {r.title || r.name}{anioResultado ? ` (${anioResultado})` : ''}
                              <span className="ml-1.5 text-[10px] uppercase text-gray-500">{esSerieResultado ? 'TV' : 'Movie'}</span>
                            </span>
                            {anadiendoId === r.id && <span className="text-xs text-gray-400">Adding...</span>}
                            {yaEnLaLista && <span className="text-xs text-gray-600">Already added</span>}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}

            {esAdmin && !hayUniversos && collection.collection?.tmdbCollectionId && (
              <div className="px-6 pt-4">
                {!mostrarFormUniverso ? (
                  <button
                    onClick={abrirFormUniverso}
                    className="text-xs font-semibold text-blue-400 hover:text-blue-300 underline cursor-pointer transition"
                  >
                    Add this collection to a Cinematic Universe
                  </button>
                ) : (
                  <div className="rounded border border-gray-700 bg-[#20262e] p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <select
                        value={universoElegido}
                        onChange={(e) => setUniversoElegido(e.target.value === 'nuevo' ? 'nuevo' : parseInt(e.target.value, 10))}
                        className="bg-[#2c3440] text-white text-sm rounded px-2 py-1.5 focus:outline-none"
                      >
                        <option value="nuevo">+ New universe...</option>
                        {universosExistentes.map((u) => (
                          <option key={u.id} value={u.id}>{u.nombre}</option>
                        ))}
                      </select>
                      {universoElegido === 'nuevo' && (
                        <input
                          type="text"
                          value={nombreNuevoUniverso}
                          onChange={(e) => setNombreNuevoUniverso(e.target.value)}
                          placeholder="Universe name (e.g. Marvel Cinematic Universe)"
                          className="flex-1 bg-[#2c3440] text-white text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-500"
                        />
                      )}
                    </div>
                    <input
                      type="text"
                      value={nombrePestañaNueva}
                      onChange={(e) => setNombrePestañaNueva(e.target.value)}
                      placeholder="Tab label for this collection (e.g. Avengers)"
                      className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-500"
                    />
                    {errorUniverso && <p className="text-xs text-red-400">{errorUniverso}</p>}
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => setMostrarFormUniverso(false)}
                        disabled={guardandoUniverso}
                        className="px-3 py-1.5 text-sm text-gray-300 hover:text-white transition cursor-pointer disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={guardarUniverso}
                        disabled={guardandoUniverso}
                        className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold transition cursor-pointer disabled:opacity-50"
                      >
                        {guardandoUniverso ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {esAdmin && !hayUniversos && (tipo === 'SERIE' || !collection.collection) && tmdbId && (
              <div className="px-6 pt-4">
                {!mostrarFormUniverso ? (
                  <button
                    onClick={abrirFormUniverso}
                    className="text-xs font-semibold text-blue-400 hover:text-blue-300 underline cursor-pointer transition"
                  >
                    Add this {tipo === 'SERIE' ? 'series' : 'movie'} to a Cinematic Universe
                  </button>
                ) : (
                  <div className="rounded border border-gray-700 bg-[#20262e] p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <select
                        value={universoElegido}
                        onChange={(e) => setUniversoElegido(e.target.value === 'nuevo' ? 'nuevo' : parseInt(e.target.value, 10))}
                        className="bg-[#2c3440] text-white text-sm rounded px-2 py-1.5 focus:outline-none"
                      >
                        <option value="nuevo">+ New universe...</option>
                        {universosExistentes.map((u) => (
                          <option key={u.id} value={u.id}>{u.nombre}</option>
                        ))}
                      </select>
                      {universoElegido === 'nuevo' && (
                        <input
                          type="text"
                          value={nombreNuevoUniverso}
                          onChange={(e) => setNombreNuevoUniverso(e.target.value)}
                          placeholder="Universe name (e.g. Chucky)"
                          className="flex-1 bg-[#2c3440] text-white text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-500"
                        />
                      )}
                    </div>
                    <input
                      type="text"
                      value={nombrePestañaNueva}
                      onChange={(e) => setNombrePestañaNueva(e.target.value)}
                      placeholder="Tab label for this title (e.g. Chucky TV Series, or Other)"
                      className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-500"
                    />
                    {errorUniverso && <p className="text-xs text-red-400">{errorUniverso}</p>}
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => setMostrarFormUniverso(false)}
                        disabled={guardandoUniverso}
                        className="px-3 py-1.5 text-sm text-gray-300 hover:text-white transition cursor-pointer disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={guardarUniversoItemSuelto}
                        disabled={guardandoUniverso}
                        className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold transition cursor-pointer disabled:opacity-50"
                      >
                        {guardandoUniverso ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {esAdmin && universoActivo && tabActiva?.tipo === 'universo' && (
              <div className="px-6 pt-4">
                <p className="text-xs text-gray-500 mb-2">Phases (drag a movie onto one to file it there):</p>
                <div className="flex flex-wrap items-center gap-2">
                  {universoActivo.fases.map((fase) => (
                    <div
                      key={fase.id}
                      onDragOver={(e) => {
                        if (!esAdmin || arrastrandoId === null) return;
                        e.preventDefault();
                        setSobreFaseId(fase.id);
                      }}
                      onDragLeave={() => setSobreFaseId((prev) => (prev === fase.id ? null : prev))}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (!esAdmin || arrastrandoId === null) return;
                        asignarFase(arrastrandoId, fase.id);
                        setArrastrandoId(null);
                        setSobreFaseId(null);
                      }}
                      className={`group flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition ${sobreFaseId === fase.id ? 'border-blue-400 bg-blue-500/20 text-white' : 'border-gray-700 bg-[#20262e] text-gray-300'
                        }`}
                    >
                      {fase.nombre}
                      <button
                        onClick={() => borrarFase(fase.id)}
                        title="Delete phase"
                        className="text-gray-500 opacity-0 transition hover:text-red-400 group-hover:opacity-100 cursor-pointer"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <div
                    onDragOver={(e) => {
                      if (!esAdmin || arrastrandoId === null) return;
                      e.preventDefault();
                      setSobreFaseId('sin-fase');
                    }}
                    onDragLeave={() => setSobreFaseId((prev) => (prev === 'sin-fase' ? null : prev))}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!esAdmin || arrastrandoId === null) return;
                      asignarFase(arrastrandoId, null);
                      setArrastrandoId(null);
                      setSobreFaseId(null);
                    }}
                    className={`rounded-md border border-dashed px-3 py-1.5 text-xs text-gray-500 transition ${sobreFaseId === 'sin-fase' ? 'border-blue-400 bg-blue-500/20 text-white' : 'border-gray-700'
                      }`}
                  >
                    Unsorted
                  </div>
                  <input
                    type="text"
                    value={nuevaFaseNombre}
                    onChange={(e) => setNuevaFaseNombre(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && crearFase()}
                    placeholder="New phase name..."
                    className="w-40 bg-[#2c3440] text-white text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  />
                  <button
                    onClick={crearFase}
                    disabled={creandoFase || !nuevaFaseNombre.trim()}
                    className="text-xs font-semibold text-blue-400 hover:text-blue-300 cursor-pointer disabled:opacity-40"
                  >
                    + Add
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-y-auto p-6">
              {hayUniversos ? (
                tabActiva?.tipo === 'universo' ? (
                  agruparPorFase(listaDeLaPestañaActual(), universoActivo?.fases || []).map((grupo) => {
                    if (!grupo.fase && grupo.items.length === 0) return null;
                    const idDeEsteGrupo = grupo.fase?.id ?? 'sin-fase';
                    return (
                      <div
                        key={idDeEsteGrupo}
                        onDragOver={(e) => {
                          if (!esAdmin || arrastrandoId === null) return;
                          e.preventDefault();
                          setSobreFaseId(idDeEsteGrupo);
                        }}
                        onDragLeave={() => setSobreFaseId((prev) => (prev === idDeEsteGrupo ? null : prev))}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (!esAdmin || arrastrandoId === null) return;
                          asignarFase(arrastrandoId, grupo.fase?.id ?? null);
                          setArrastrandoId(null);
                          setSobreFaseId(null);
                        }}
                        className={`mb-8 last:mb-0 rounded-lg transition ${sobreFaseId === idDeEsteGrupo ? 'ring-2 ring-blue-400 bg-blue-500/5 -m-2 p-2' : ''
                          }`}
                      >
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                          {grupo.fase ? grupo.fase.nombre : 'Unsorted'}
                        </h3>
                        {grupo.items.length === 0 ? (
                          <p className="text-xs text-gray-600">Drag movies here to file them under this phase.</p>
                        ) : (
                          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-6">
                            {grupo.items.map((it) => renderTarjetaUniverso(it))}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-6">
                    {listaDeLaPestañaActual().map((it) => renderTarjetaUniverso(it))}
                  </div>
                )
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
                  {[...(collection.items || [])]
                    .sort((a, b) => (a.anio ?? Infinity) - (b.anio ?? Infinity))
                    .map((it) => renderSagaCard(it))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {mostrarAñadirColeccion && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
          onClick={() => !añadiendoColeccion && setMostrarAñadirColeccion(false)}
        >
          <div className="w-[90vw] max-w-md rounded-lg bg-[#1c2228] border border-gray-700 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-4">Add to "{universoActivo?.nombre}"</h3>

            <div className="flex gap-1 mb-4 border-b border-gray-800">
              <button
                onClick={() => setModoAñadir('coleccion')}
                className={`px-3 py-2 text-sm font-semibold cursor-pointer border-b-2 transition ${modoAñadir === 'coleccion' ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
                  }`}
              >
                By collection
              </button>
              <button
                onClick={() => setModoAñadir('compañia')}
                className={`px-3 py-2 text-sm font-semibold cursor-pointer border-b-2 transition ${modoAñadir === 'compañia' ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
                  }`}
              >
                Import whole studio
              </button>
              <button
                onClick={() => setModoAñadir('keyword')}
                className={`px-3 py-2 text-sm font-semibold cursor-pointer border-b-2 transition ${modoAñadir === 'keyword' ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
                  }`}
              >
                By keyword
              </button>
              <button
                onClick={() => setModoAñadir('pelicula')}
                className={`px-3 py-2 text-sm font-semibold cursor-pointer border-b-2 transition ${modoAñadir === 'pelicula' ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
                  }`}
              >
                By movie
              </button>
              <button
                onClick={() => setModoAñadir('serie')}
                className={`px-3 py-2 text-sm font-semibold cursor-pointer border-b-2 transition ${modoAñadir === 'serie' ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
                  }`}
              >
                By series
              </button>
            </div>

            {modoAñadir === 'coleccion' && (
              <>
                <p className="text-sm text-gray-400 mb-4">
                  Paste the TMDB collection id (found in the collection's URL on themoviedb.org) — every movie in it
                  will be added under its own tab.
                </p>
                <div className="space-y-3">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={nuevoTmdbCollectionId}
                    onChange={(e) => setNuevoTmdbCollectionId(e.target.value)}
                    placeholder="TMDB collection id (e.g. 131296)"
                    className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  />
                  <input
                    type="text"
                    value={nuevaEtiquetaPestaña}
                    onChange={(e) => setNuevaEtiquetaPestaña(e.target.value)}
                    placeholder="Tab label (optional, defaults to TMDB's collection name)"
                    className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  />
                </div>
              </>
            )}

            {modoAñadir === 'compañia' && (
              <>
                <p className="text-sm text-gray-400 mb-4">
                  Paste the TMDB company id (e.g. Marvel Studios is <span className="text-gray-300">420</span>) — every
                  movie from that studio gets added, automatically grouped into a tab per collection it belongs to.
                  Not perfect (co-productions or one-offs may need a manual fix afterward), but a fast starting point.
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  value={tmdbCompanyId}
                  onChange={(e) => setTmdbCompanyId(e.target.value)}
                  placeholder="TMDB company id (e.g. 420)"
                  className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
                />
                {resultadoImportacion && <p className="mt-2 text-xs text-green-400">{resultadoImportacion}</p>}
              </>
            )}

            {modoAñadir === 'keyword' && (
              <>
                <p className="text-sm text-gray-400 mb-4">
                  Paste the TMDB keyword id — found in the keyword page's URL, e.g.{' '}
                  <span className="text-gray-300">themoviedb.org/keyword/180547-marvel-cinematic-universe-mcu</span>{' '}
                  → id <span className="text-gray-300">180547</span>. Usually more precise than importing by studio,
                  since keywords are hand-curated for exactly this kind of grouping.
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  value={tmdbKeywordId}
                  onChange={(e) => setTmdbKeywordId(e.target.value)}
                  placeholder="TMDB keyword id (e.g. 180547)"
                  className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
                />
                {resultadoImportacion && <p className="mt-2 text-xs text-green-400">{resultadoImportacion}</p>}
              </>
            )}

            {modoAñadir === 'pelicula' && (
              <>
                <p className="text-sm text-gray-400 mb-4">
                  Paste the TMDB movie id directly (found in the movie's URL on themoviedb.org, e.g.{' '}
                  <span className="text-gray-300">themoviedb.org/movie/299536</span> → id{' '}
                  <span className="text-gray-300">299536</span>) and pick which tab it should land in.
                </p>
                <div className="space-y-3">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={tmdbMovieId}
                    onChange={(e) => setTmdbMovieId(e.target.value)}
                    placeholder="TMDB movie id (e.g. 299536)"
                    className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  />
                  <input
                    type="text"
                    value={etiquetaPestañaPelicula}
                    onChange={(e) => setEtiquetaPestañaPelicula(e.target.value)}
                    placeholder="Tab it belongs to (e.g. Avengers, or Other)"
                    className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  />
                </div>
              </>
            )}

            {modoAñadir === 'serie' && (
              <>
                <p className="text-sm text-gray-400 mb-4">
                  Paste the TMDB TV series id directly (found in the series' URL on themoviedb.org, e.g.{' '}
                  <span className="text-gray-300">themoviedb.org/tv/1622</span> → id{' '}
                  <span className="text-gray-300">1622</span>) and pick which tab it should land in — useful for
                  universes that mix movies and series, like Chucky or Game of Thrones.
                </p>
                <div className="space-y-3">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={tmdbSeriesId}
                    onChange={(e) => setTmdbSeriesId(e.target.value)}
                    placeholder="TMDB TV series id (e.g. 1622)"
                    className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  />
                  <input
                    type="text"
                    value={etiquetaPestañaSerie}
                    onChange={(e) => setEtiquetaPestañaSerie(e.target.value)}
                    placeholder="Tab it belongs to (e.g. Chucky, or Other)"
                    className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  />
                </div>
              </>
            )}

            {errorAñadirColeccion && <p className="text-xs text-red-400 mt-3">{errorAñadirColeccion}</p>}

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setMostrarAñadirColeccion(false)}
                disabled={añadiendoColeccion}
                className="px-4 py-2 text-sm text-gray-300 hover:text-white transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={
                  modoAñadir === 'coleccion'
                    ? añadirOtraColeccion
                    : modoAñadir === 'compañia'
                      ? importarPorCompañia
                      : modoAñadir === 'keyword'
                        ? importarPorKeyword
                        : modoAñadir === 'serie'
                          ? añadirSeriePorId
                          : añadirPeliculaPorId
                }
                disabled={añadiendoColeccion}
                className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold transition cursor-pointer disabled:opacity-50"
              >
                {añadiendoColeccion
                  ? modoAñadir === 'coleccion' || modoAñadir === 'pelicula' || modoAñadir === 'serie'
                    ? 'Adding...'
                    : 'Importing... (this can take a while)'
                  : modoAñadir === 'coleccion'
                    ? 'Add collection'
                    : modoAñadir === 'pelicula'
                      ? 'Add movie'
                      : modoAñadir === 'serie'
                        ? 'Add series'
                        : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}