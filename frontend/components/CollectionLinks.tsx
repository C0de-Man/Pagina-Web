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
  id: number; // id de la fila CinematicUniverseItem — hace falta para borrar/reordenar
  tmdbId: number;
  tipo: string; // "PELICULA" | "SERIE" — un universo puede mezclar ambos
  titulo: string
  anio: number | null;
  fechaEstreno: string | null; // fecha completa de estreno, para ordenar por año/mes/día real
  ordenUniverso: number | null; // orden manual solo para la pestaña mezclada; null = todavía sin arrastrar, se ordena por fecha
  faseId: number | null; // a qué "ventana"/fase pertenece dentro de la pestaña mezclada
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

interface CollectionResponse {
  prequel: any;
  sequel: any;
  nombreColeccion: string | null;
  collectionId: number | null;
  parts: any[];
  universo: Universo | null;
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

// Mismo patrón que el resto de la app: usuario y token en localStorage.
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

export default function CollectionLinks({ tmdbId, tipo = 'PELICULA' }: { tmdbId: number; tipo?: string }) {
  const esAdmin = useEsAdmin();
  const router = useRouter();
  const idPeticionRef = useRef(0);

  const [collection, setCollection] = useState<CollectionResponse | null>(null);
  const [myDb, setMyDb] = useState<any[]>([]);
  const [personalizaciones, setPersonalizaciones] = useState<
    Record<number, { customPoster: string | null; customBackdrop: string | null }>
  >({});
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // --- Modo universo: pestaña activa, drag&drop, borrado ---
  const [pestañaActiva, setPestañaActiva] = useState(0);
  const [arrastrandoId, setArrastrandoId] = useState<number | null>(null);
  const [borrandoId, setBorrandoId] = useState<number | null>(null);
  const [reiniciando, setReiniciando] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const [resultadoRefresco, setResultadoRefresco] = useState<string | null>(null);
  const [nuevaFaseNombre, setNuevaFaseNombre] = useState('');
  const [creandoFase, setCreandoFase] = useState(false);
  const [sobreFaseId, setSobreFaseId] = useState<number | 'sin-fase' | null>(null); // para resaltar la ventana al arrastrar por encima

  async function refrescarUniverso() {
    if (!collection?.universo) return;
    setRefrescando(true);
    setResultadoRefresco(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${collection.universo.id}/refresh`, {
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

  // --- Buscador para añadir películas sueltas a la pestaña actual (solo admin) ---
  const [busquedaTexto, setBusquedaTexto] = useState('');
  const [resultadosBusqueda, setResultadosBusqueda] = useState<ResultadoTmdb[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [anadiendoId, setAnadiendoId] = useState<number | null>(null);
  const [errorAnadir, setErrorAnadir] = useState<string | null>(null);

  // --- Admin: crear universo / añadir esta colección a uno existente ---
  const [mostrarFormUniverso, setMostrarFormUniverso] = useState(false);
  const [universosExistentes, setUniversosExistentes] = useState<UniversoResumen[]>([]);
  const [universoElegido, setUniversoElegido] = useState<'nuevo' | number>('nuevo');
  const [nombreNuevoUniverso, setNombreNuevoUniverso] = useState('');
  const [nombrePestañaNueva, setNombrePestañaNueva] = useState('');
  const [guardandoUniverso, setGuardandoUniverso] = useState(false);
  const [errorUniverso, setErrorUniverso] = useState<string | null>(null);

  // --- Admin (ya dentro de un universo): añadir OTRA colección de TMDB entera ---
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
      .catch(() => {});
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || myDb.length === 0 || !collection) return;

    const idsUniverso = collection.universo
      ? collection.universo.pestañas.flatMap((p) => p.items.map((it) => it.tmdbId))
      : [];

    const idsTmdb = [
      collection.prequel?.id,
      collection.sequel?.id,
      ...(collection.parts || []).map((p) => p.id),
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
      .catch(() => {});
  }, [myDb, collection]);

  useEffect(() => {
    if (!isModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  // Buscador de películas para añadir a la pestaña actual (con debounce)
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

  const puedeArrancarUniversoSerie = esAdmin && tipo === 'SERIE';
  if (!collection || (!collection.universo && !collection.prequel && !collection.sequel && !puedeArrancarUniversoSerie)) return null;

  // SIEMPRE dos pestañas de cara al usuario, aunque el universo tenga más
  // de dos sub-colecciones guardadas en el backend: la saga PROPIA de esta
  // película (la sub-colección a la que pertenece), y el universo entero
  // con TODAS las películas de todas las sub-colecciones mezcladas y
  // ordenadas por fecha de estreno (no agrupadas). Las sub-colecciones
  // individuales solo existen como concepto interno/admin — el visitante
  // nunca navega pestaña por pestaña entre ellas.
  type TabVisual = { tipo: 'propia' | 'universo'; nombre: string; items: UniverseItem[]; pestañaOrigen?: string };

  function calcularTabsVisuales(universo: Universo): TabVisual[] {
    const pestañaPropia =
      universo.pestañas.find((p) => p.items.some((it) => it.tmdbId === tmdbId)) || universo.pestañas[0];

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
        // en cuanto una película tiene orden manual, ese pasa a mandar; las
        // que todavía no lo tienen (recién importadas) se quedan al final
        return (a.ordenUniverso ?? Infinity) - (b.ordenUniverso ?? Infinity);
      }
      const fechaA = a.fechaEstreno ? new Date(a.fechaEstreno).getTime() : a.anio ? new Date(a.anio, 0, 1).getTime() : Infinity;
      const fechaB = b.fechaEstreno ? new Date(b.fechaEstreno).getTime() : b.anio ? new Date(b.anio, 0, 1).getTime() : Infinity;
      return fechaA - fechaB;
    });

    return [
      { tipo: 'propia', nombre: pestañaPropia.nombre, items: pestañaPropia.items, pestañaOrigen: pestañaPropia.nombre },
      { tipo: 'universo', nombre: universo.nombre, items: todas },
    ];
  }

  const tabsVisuales = collection.universo ? calcularTabsVisuales(collection.universo) : [];
  const tabActiva = tabsVisuales[pestañaActiva];

  const getLocalData = (id: number) => {
    const local = myDb.find((m: any) => m.tmdbId === id);
    const dbId = local?.id || null;
    const miPersonalizacion = dbId ? personalizaciones[dbId] : undefined;
    return {
      dbId,
      customPoster: miPersonalizacion?.customPoster || local?.portada || null,
    };
  };

  const handleClick = async (item: any, dbId: number | null) => {
    if (loadingId) return;
    setLoadingId(item.id);
    if (dbId) {
      router.push(urlFicha({ ...item, id: dbId }));
    } else {
      try {
        const res = await fetch(`${API_URL}/media/tmdb`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tmdbId: item.id, tipo: 'PELICULA' }),
        });
        const nueva = await res.json();
        router.push(urlFicha(nueva));
      } catch (e) {
        setLoadingId(null);
      }
    }
  };

  const renderItem = (item: any, label: string) => {
    if (!item) return null;
    const { dbId, customPoster } = getLocalData(item.id);
    const posterUrl = customPoster || (item.poster_path ? `https://image.tmdb.org/t/p/w200${item.poster_path}` : null);

    return (
      <div onClick={() => handleClick(item, dbId)} className="flex flex-col items-center gap-1.5 cursor-pointer group w-24">
        <div className="relative w-full aspect-[2/3] rounded border border-gray-700 group-hover:border-gray-400 transition shadow-lg overflow-hidden bg-gray-800">
          {posterUrl ? (
            <img src={posterUrl} alt={item.title} className={`w-full h-full object-cover ${loadingId === item.id ? 'opacity-50 blur-sm' : ''}`} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-center p-1">{item.title}</div>
          )}
          {loadingId === item.id && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <span className="text-white text-[10px] font-bold">...</span>
            </div>
          )}
        </div>
        <span className="text-xs text-gray-400 group-hover:text-white transition font-medium">{label}</span>
      </div>
    );
  };

  // Tarjeta de la colección "plana" (sin universo) — igual que antes.
  const renderFullCard = (item: any) => {
    const { dbId, customPoster } = getLocalData(item.id);
    const posterUrl = customPoster || (item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null);
    const anio = item.release_date ? item.release_date.split('-')[0] : '—';
    const esActual = item.id === tmdbId;

    return (
      <div
        key={item.id}
        onClick={() => handleClick(item, dbId)}
        className={`flex flex-col items-center gap-2 p-2 rounded-lg cursor-pointer transition ${
          esActual ? 'bg-gray-800/80 ring-1 ring-blue-500' : 'hover:bg-gray-800/50'
        }`}
      >
        <div className="w-full aspect-[2/3] rounded overflow-hidden border border-gray-700 bg-gray-800">
          {posterUrl ? (
            <img src={posterUrl} alt={item.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-center p-1 text-gray-400">{item.title}</div>
          )}
        </div>
        <div className="text-center">
          <p className="font-semibold text-white text-sm leading-tight">{item.title}</p>
          <p className="text-xs text-gray-400">{anio}{esActual ? " · You're viewing this" : ''}</p>
        </div>
      </div>
    );
  };

  // Portada real de un item de universo: tu personalización si existe, si no
  // la guardada en tu base de datos, si no la que trae el propio universo.
  function getPortadaUniverso(item: UniverseItem): string | null {
    const local = myDb.find((m: any) => m.tmdbId === item.tmdbId);
    const miPersonalizacion = local ? personalizaciones[local.id] : undefined;
    return miPersonalizacion?.customPoster || local?.portada || item.portada;
  }

  const hrefDeItemUniverso = (item: UniverseItem) =>
    item.tipo === 'SERIE' ? `/series/tmdb/${item.tmdbId}` : `/movie/tmdb/${item.tmdbId}`;

  function listaDeLaPestañaActual(): UniverseItem[] {
    return tabActiva?.items || [];
  }

  function actualizarPestañaActual(nuevaLista: UniverseItem[]) {
    const origen = tabActiva?.pestañaOrigen;
    if (!origen) return; // no se reordena la pestaña "universo" (mezclada, orden por fecha)
    setCollection((prev) => {
      if (!prev?.universo) return prev;
      const pestañas = prev.universo.pestañas.map((p) => (p.nombre === origen ? { ...p, items: nuevaLista } : p));
      return { ...prev, universo: { ...prev.universo, pestañas } };
    });
  }

  async function crearFase() {
    if (!collection?.universo || !nuevaFaseNombre.trim()) return;
    setCreandoFase(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${collection.universo.id}/phases`, {
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
    setCollection((prev) => {
      if (!prev?.universo) return prev;
      const pestañas = prev.universo.pestañas.map((p) => ({
        ...p,
        items: p.items.map((it) => (it.id === itemId ? { ...it, faseId } : it)),
      }));
      return { ...prev, universo: { ...prev.universo, pestañas } };
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
    // Dentro de cada fase, siempre de más antiguo a más reciente por fecha
    // de estreno — automático, sin depender del orden manual (que solo
    // aplica a la pestaña "universo" en conjunto, no a cómo se ven dentro
    // de una fase concreta).
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
    setCollection((prev) => {
      if (!prev?.universo) return prev;
      const pestañas = prev.universo.pestañas.map((p) => ({
        ...p,
        items: p.items.map((it) => (posicion.has(it.id) ? { ...it, ordenUniverso: posicion.get(it.id)! } : it)),
      }));
      return { ...prev, universo: { ...prev.universo, pestañas } };
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
    if (borrandoId !== null) return; // ya hay un borrado en curso, ignora el clic
    setBorrandoId(item.id);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universe-items/${item.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('No se pudo eliminar');
      setCollection((prev) => {
        if (!prev?.universo) return prev;
        const pestañas = prev.universo.pestañas.map((p) => ({
          ...p,
          items: p.items.filter((it) => it.id !== item.id),
        }));
        return { ...prev, universo: { ...prev.universo, pestañas } };
      });
    } catch (err) {
      console.error('Error al borrar de la colección', err);
    }
    setBorrandoId(null);
  }

  async function añadirPelicula(resultado: ResultadoTmdb) {
    if (!collection?.universo || !tabActiva?.pestañaOrigen) return;
    setAnadiendoId(resultado.id);
    setErrorAnadir(null);
    try {
      const token = localStorage.getItem('token');
      const esSerieResultado = resultado.media_type === 'tv';
      const tituloResultado = resultado.title || resultado.name || '';
      const fechaResultado = resultado.release_date || resultado.first_air_date || null;
      const res = await fetch(`${API_URL}/admin/cinematic-universe-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          universeId: collection.universo.id,
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
    } catch (err) {
      console.error('Error al añadir el título al universo', err);
      setErrorAnadir('No se pudo añadir el título');
    } finally {
      setAnadiendoId(null);
    }
  }

  // Abre el formulario de "convertir en universo" y precarga el nombre de
  // pestaña con el de esta propia colección (se puede editar).
  function abrirFormUniverso() {
    setNombrePestañaNueva(collection?.nombreColeccion || '');
    setErrorUniverso(null);
    setMostrarFormUniverso(true);
    const token = localStorage.getItem('token');
    fetch(`${API_URL}/admin/cinematic-universes`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setUniversosExistentes)
      .catch(() => {});
  }

  async function guardarUniversoSerie() {
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

      const resAñadir = await fetch(`${API_URL}/admin/cinematic-universes/${universeId}/add-series`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tmdbId,
          pestaña: nombrePestañaNueva.trim() || 'Other',
        }),
      });
      const bodyAñadir = await resAñadir.json();
      if (!resAñadir.ok) throw new Error(bodyAñadir.error || 'No se pudo añadir la serie al universo');

      setMostrarFormUniverso(false);
      cargarColeccion();
    } catch (err: any) {
      setErrorUniverso(err.message || 'Algo falló');
    }
    setGuardandoUniverso(false);
  }

  async function guardarUniverso() {
    if (!collection?.collectionId) return;
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
          tmdbCollectionId: collection.collectionId,
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
    if (!collection?.universo) return;
    const idNum = parseInt(nuevoTmdbCollectionId, 10);
    if (Number.isNaN(idNum)) {
      setErrorAñadirColeccion('Ese id de colección de TMDB no es válido');
      return;
    }
    setAñadiendoColeccion(true);
    setErrorAñadirColeccion(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${collection.universo.id}/collections`, {
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
    if (!collection?.universo) return;
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
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${collection.universo.id}/add-movie`, {
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
    if (!collection?.universo) return;
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
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${collection.universo.id}/add-series`, {
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
    if (!collection?.universo) return;
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
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${collection.universo.id}/import-by-keyword`, {
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
    if (!collection?.universo) return;
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
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${collection.universo.id}/import-by-company`, {
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
    if (!collection?.universo) return;
    if (!window.confirm(`Delete ALL movies from "${collection.universo.nombre}"? This can't be undone — you'll need to re-import afterward.`)) {
      return;
    }
    setReiniciando(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${collection.universo.id}/reset`, {
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

  function renderTarjetaUniverso(it: UniverseItem) {
    const esActual = it.tmdbId === tmdbId;
    const portadaReal = getPortadaUniverso(it);
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
              className={`w-full aspect-[2/3] object-cover rounded transition ${
                esActual ? 'ring-2 ring-blue-500' : 'group-hover:opacity-80 group-hover:scale-[1.02]'
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

        {((collection.parts && collection.parts.length > 1) || collection.universo) && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="w-full mt-4 text-xs text-gray-400 hover:text-white text-center underline cursor-pointer bg-gray-900/80 py-2 rounded border border-gray-800 transition"
          >
            See full saga
          </button>
        )}

        {/* Puerta de entrada para series sin universo todavía: "See full
            saga" no sirve aquí (las series nunca tienen collection.parts),
            así que este botón es la única forma de abrir el modal y poder
            crear/añadirse a un universo desde la propia serie. */}
        {esAdmin && !collection.universo && tipo === 'SERIE' && (
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
              <h2 className="text-xl font-bold">
                {collection.universo?.nombre || collection.nombreColeccion || 'Full saga'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-white text-2xl font-bold cursor-pointer">✕</button>
            </div>

            {collection.universo && (
              <div className="flex items-center justify-between px-6 pt-3 border-b border-gray-800 flex-shrink-0">
                <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                  {tabsVisuales.map((t, i) => (
                    <button
                      key={t.tipo}
                      onClick={() => cambiarPestaña(i)}
                      className={`px-3 py-2 text-sm font-semibold whitespace-nowrap border-b-2 transition cursor-pointer ${
                        pestañaActiva === i ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
                      }`}
                    >
                      {t.nombre}
                    </button>
                  ))}
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
            {resultadoRefresco && (
              <p className="px-6 pt-1 text-xs text-gray-500">{resultadoRefresco}</p>
            )}

            {esAdmin && collection.universo && tabActiva?.tipo === 'propia' && (
              <div className="relative px-6 pt-4">
                <input
                  type="text"
                  value={busquedaTexto}
                  onChange={(e) => setBusquedaTexto(e.target.value)}
                  placeholder={`Add a movie or series to "${tabActiva.nombre}"...`}
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
                        const yaEnLaLista = collection.universo!.pestañas.some((p) => p.items.some((it) => it.tmdbId === r.id && it.tipo === tipoResultado));
                        return (
                          <button
                            key={`${r.media_type}-${r.id}`}
                            onClick={() => !yaEnLaLista && añadirPelicula(r)}
                            disabled={yaEnLaLista || anadiendoId !== null}
                            className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition cursor-pointer disabled:cursor-default ${
                              yaEnLaLista ? 'text-gray-600' : 'text-blue-400 hover:bg-white/5 hover:text-blue-300'
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

            {esAdmin && !collection.universo && collection.collectionId && (
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

            {/* Mismo bloque que arriba, pero para SERIES: TMDB no tiene
                "Collection" para series, así que en vez de collectionId
                comprobamos tipo === 'SERIE' — y al guardar se llama a
                add-series en vez de a /collections. */}
            {esAdmin && !collection.universo && tipo === 'SERIE' && tmdbId && (
              <div className="px-6 pt-4">
                {!mostrarFormUniverso ? (
                  <button
                    onClick={abrirFormUniverso}
                    className="text-xs font-semibold text-blue-400 hover:text-blue-300 underline cursor-pointer transition"
                  >
                    Add this series to a Cinematic Universe
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
                      placeholder="Tab label for this series (e.g. Chucky TV Series, or Other)"
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
                        onClick={guardarUniversoSerie}
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

            {esAdmin && collection.universo && tabActiva?.tipo === 'universo' && (
              <div className="px-6 pt-4">
                <p className="text-xs text-gray-500 mb-2">Phases (drag a movie onto one to file it there):</p>
                <div className="flex flex-wrap items-center gap-2">
                  {collection.universo.fases.map((fase) => (
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
                      className={`group flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                        sobreFaseId === fase.id ? 'border-blue-400 bg-blue-500/20 text-white' : 'border-gray-700 bg-[#20262e] text-gray-300'
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
                    className={`rounded-md border border-dashed px-3 py-1.5 text-xs text-gray-500 transition ${
                      sobreFaseId === 'sin-fase' ? 'border-blue-400 bg-blue-500/20 text-white' : 'border-gray-700'
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
              {collection.universo ? (
                tabActiva?.tipo === 'universo' ? (
                  agruparPorFase(listaDeLaPestañaActual(), collection.universo.fases).map((grupo) => {
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
                        className={`mb-8 last:mb-0 rounded-lg transition ${
                          sobreFaseId === idDeEsteGrupo ? 'ring-2 ring-blue-400 bg-blue-500/5 -m-2 p-2' : ''
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
                  {collection.parts.map(renderFullCard)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal para añadir otra colección de TMDB entera al universo actual */}
      {mostrarAñadirColeccion && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
          onClick={() => !añadiendoColeccion && setMostrarAñadirColeccion(false)}
        >
          <div className="w-[90vw] max-w-md rounded-lg bg-[#1c2228] border border-gray-700 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-4">Add to "{collection.universo?.nombre}"</h3>

            <div className="flex gap-1 mb-4 border-b border-gray-800">
              <button
                onClick={() => setModoAñadir('coleccion')}
                className={`px-3 py-2 text-sm font-semibold cursor-pointer border-b-2 transition ${
                  modoAñadir === 'coleccion' ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                By collection
              </button>
              <button
                onClick={() => setModoAñadir('compañia')}
                className={`px-3 py-2 text-sm font-semibold cursor-pointer border-b-2 transition ${
                  modoAñadir === 'compañia' ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                Import whole studio
              </button>
              <button
                onClick={() => setModoAñadir('keyword')}
                className={`px-3 py-2 text-sm font-semibold cursor-pointer border-b-2 transition ${
                  modoAñadir === 'keyword' ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                By keyword
              </button>
              <button
                onClick={() => setModoAñadir('pelicula')}
                className={`px-3 py-2 text-sm font-semibold cursor-pointer border-b-2 transition ${
                  modoAñadir === 'pelicula' ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                By movie
              </button>
              <button
                onClick={() => setModoAñadir('serie')}
                className={`px-3 py-2 text-sm font-semibold cursor-pointer border-b-2 transition ${
                  modoAñadir === 'serie' ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
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