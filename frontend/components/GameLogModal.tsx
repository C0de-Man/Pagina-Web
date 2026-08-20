'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = 'http://localhost:3001';

const OPCIONES_PROPIEDAD = ['Physical', 'Digital', 'Subscription', 'Borrowed', 'Rented', 'Free to Play'];

interface LogForm {
  id: number | null; // null = borrador todavía sin guardar en el backend
  nombre: string;
  plataforma: string;
  jugadoEn: string;
  propiedad: string;
  fechaInicio: string; // yyyy-mm-dd, formato de <input type="date">
  fechaFin: string;
  edicion: string;
  horas: string;
  minutos: string;
  review: string;
}

const LOG_VACIO = (nombre: string): LogForm => ({
  id: null,
  nombre,
  plataforma: '',
  jugadoEn: '',
  propiedad: '',
  fechaInicio: '',
  fechaFin: '',
  edicion: '',
  horas: '',
  minutos: '',
  review: '',
});

function fechaAInput(iso: string | null) {
  return iso ? iso.slice(0, 10) : '';
}

export default function GameLogModal({ mediaId }: { mediaId: number }) {
  const [modalAbierto, setModalAbierto] = useState(false);
  const [logs, setLogs] = useState<LogForm[]>([]);
  const [activo, setActivo] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [renombrando, setRenombrando] = useState(false);
  const [nombreTemp, setNombreTemp] = useState('');
  const [plataformas, setPlataformas] = useState<{ id: number; name: string }[]>([]);
  const router = useRouter();

  const logActual = logs[activo];

  useEffect(() => {
    fetch(`${API_URL}/igdb/filtros`)
      .then((r) => r.json())
      .then((d) => setPlataformas(d.plataformas || []))
      .catch(() => {});
  }, []);

  const abrirModal = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }
    setModalAbierto(true);
    setCargando(true);
    try {
      const res = await fetch(`${API_URL}/media/${mediaId}/logs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setLogs(
          data.map((l: any) => ({
            id: l.id,
            nombre: l.nombre,
            plataforma: l.plataforma || '',
            jugadoEn: l.jugadoEn || '',
            propiedad: l.propiedad || '',
            fechaInicio: fechaAInput(l.fechaInicio),
            fechaFin: fechaAInput(l.fechaFin),
            edicion: l.edicion || '',
            horas: l.minutosJugados != null ? String(Math.floor(l.minutosJugados / 60)) : '',
            minutos: l.minutosJugados != null ? String(l.minutosJugados % 60) : '',
            review: l.review || '',
          }))
        );
        setActivo(0);
      } else {
        setLogs([LOG_VACIO('Log')]);
        setActivo(0);
      }
    } catch {
      setLogs([LOG_VACIO('Log')]);
      setActivo(0);
    }
    setCargando(false);
  };

  const actualizarCampo = (campo: keyof LogForm, valor: string) => {
    setLogs((prev) => prev.map((l, i) => (i === activo ? { ...l, [campo]: valor } : l)));
  };

  const anadirLog = () => {
    setLogs((prev) => [...prev, LOG_VACIO(prev.length === 0 ? 'Log' : `Log ${prev.length + 1}`)]);
    setActivo(logs.length);
    setMenuAbierto(false);
  };

  const empezarRenombrar = () => {
    setNombreTemp(logActual.nombre);
    setRenombrando(true);
    setMenuAbierto(false);
  };

  const confirmarRenombrar = async () => {
    const nuevoNombre = nombreTemp.trim() || logActual.nombre;
    actualizarCampo('nombre', nuevoNombre);
    setRenombrando(false);

    if (logActual.id) {
      const token = localStorage.getItem('token');
      try {
        await fetch(`${API_URL}/logs/${logActual.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ nombre: nuevoNombre }),
        });
      } catch {}
    }
  };

  const borrarLogActual = async () => {
    setMenuAbierto(false);
    if (logActual.id) {
      const token = localStorage.getItem('token');
      try {
        await fetch(`${API_URL}/logs/${logActual.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {}
    }

    const restantes = logs.filter((_, i) => i !== activo);
    if (restantes.length === 0) {
      setLogs([LOG_VACIO('Log')]);
      setActivo(0);
    } else {
      setLogs(restantes);
      setActivo(Math.max(0, activo - 1));
    }
  };

  const guardarCambios = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setGuardando(true);

    const minutosJugados =
      logActual.horas || logActual.minutos
        ? (parseInt(logActual.horas || '0', 10) || 0) * 60 + (parseInt(logActual.minutos || '0', 10) || 0)
        : null;

    const body = {
      plataforma: logActual.plataforma || null,
      jugadoEn: logActual.jugadoEn || null,
      propiedad: logActual.propiedad || null,
      fechaInicio: logActual.fechaInicio || null,
      fechaFin: logActual.fechaFin || null,
      edicion: logActual.edicion || null,
      minutosJugados,
      review: logActual.review || null,
    };

    try {
      if (logActual.id) {
        await fetch(`${API_URL}/logs/${logActual.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
      } else {
        const res = await fetch(`${API_URL}/media/${mediaId}/logs`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        const creado = await res.json();
        // El POST crea el log "en blanco" con su nombre por defecto; justo
        // después mandamos el PATCH con lo que ya haya rellenado el usuario.
        await fetch(`${API_URL}/logs/${creado.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        setLogs((prev) => prev.map((l, i) => (i === activo ? { ...l, id: creado.id, nombre: creado.nombre } : l)));
      }
      setModalAbierto(false);
    } catch {
      // si falla, dejamos el modal abierto para que se pueda reintentar
    }
    setGuardando(false);
  };

  return (
    <>
      <button
        onClick={abrirModal}
        className="w-full bg-[#2c3440] hover:bg-gray-600 text-white font-bold py-2 rounded text-sm transition cursor-pointer"
      >
        Review or log...
      </button>

      {modalAbierto && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setModalAbierto(false)}
        >
          <div
            className="bg-[#1c2228] rounded-lg border border-gray-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {cargando ? (
              <div className="p-8 text-center text-gray-400">Cargando...</div>
            ) : (
              <div className="p-6">
                {/* PESTAÑAS */}
                <div className="flex items-center gap-3 mb-6 border-b border-gray-800 pb-3">
                  {logs.map((l, i) =>
                    renombrando && i === activo ? (
                      <input
                        key={i}
                        autoFocus
                        value={nombreTemp}
                        onChange={(e) => setNombreTemp(e.target.value)}
                        onBlur={confirmarRenombrar}
                        onKeyDown={(e) => e.key === 'Enter' && confirmarRenombrar()}
                        className="bg-[#2c3440] text-white text-sm font-bold px-2 py-1 rounded w-24"
                      />
                    ) : (
                      <button
                        key={i}
                        onClick={() => setActivo(i)}
                        className={`px-3 py-1.5 rounded text-sm font-bold transition cursor-pointer ${
                          activo === i ? 'bg-pink-600 text-white' : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        {l.nombre}
                      </button>
                    )
                  )}

                  <div className="relative">
                    <button
                      onClick={() => setMenuAbierto((v) => !v)}
                      title="Opciones de este log"
                      className="text-gray-400 hover:text-white text-lg w-6 h-6 flex items-center justify-center rounded hover:bg-gray-800 cursor-pointer"
                    >
                      ⋮
                    </button>
                    {menuAbierto && (
                      <div className="absolute left-0 top-full mt-1 w-32 bg-[#2c3440] rounded-md shadow-2xl border border-gray-700 py-1 z-10">
                        <button
                          onClick={empezarRenombrar}
                          className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                          ✏️ Rename
                        </button>
                        <button
                          onClick={borrarLogActual}
                          className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={anadirLog}
                    title="Nuevo log"
                    className="text-gray-400 hover:text-white text-xl w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-800 cursor-pointer ml-auto"
                  >
                    +
                  </button>
                </div>

                {/* CAMPOS */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div>
                    <p className="text-white font-bold text-sm mb-1.5">Platform</p>
                    <select
                      value={logActual.plataforma}
                      onChange={(e) => actualizarCampo('plataforma', e.target.value)}
                      className="w-full bg-[#2c3440] border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none"
                    >
                      <option value="">Select release platfo...</option>
                      {plataformas.map((p) => (
                        <option key={p.id} value={p.name}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <p className="text-white font-bold text-sm mb-1.5">Played on</p>
                    <select
                      value={logActual.jugadoEn}
                      onChange={(e) => actualizarCampo('jugadoEn', e.target.value)}
                      className="w-full bg-[#2c3440] border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none"
                    >
                      <option value="">Played platform</option>
                      {plataformas.map((p) => (
                        <option key={p.id} value={p.name}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <p className="text-white font-bold text-sm mb-1.5">Ownership</p>
                    <select
                      value={logActual.propiedad}
                      onChange={(e) => actualizarCampo('propiedad', e.target.value)}
                      className="w-full bg-[#2c3440] border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none"
                    >
                      <option value="">owned, subscription,...</option>
                      {OPCIONES_PROPIEDAD.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <p className="text-white font-bold text-sm mb-1.5">Started on</p>
                    <input
                      type="date"
                      value={logActual.fechaInicio}
                      onChange={(e) => actualizarCampo('fechaInicio', e.target.value)}
                      className="w-full bg-[#2c3440] border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <p className="text-white font-bold text-sm mb-1.5">Finished on</p>
                    <input
                      type="date"
                      value={logActual.fechaFin}
                      onChange={(e) => actualizarCampo('fechaFin', e.target.value)}
                      className="w-full bg-[#2c3440] border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <p className="text-white font-bold text-sm mb-1.5">Edition played</p>
                    <input
                      type="text"
                      value={logActual.edicion}
                      onChange={(e) => actualizarCampo('edicion', e.target.value)}
                      placeholder="Specify an edition.."
                      className="w-full bg-[#2c3440] border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* REVIEW + TOTAL JUGADO */}
                <div className="flex gap-4 mb-6">
                  <div className="flex-1">
                    <p className="text-white font-bold text-sm mb-1.5">Review</p>
                    <textarea
                      value={logActual.review}
                      onChange={(e) => actualizarCampo('review', e.target.value)}
                      placeholder="What'd you think..."
                      rows={5}
                      className="w-full bg-[#2c3440] border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none resize-y"
                    />
                  </div>

                  <div className="flex-shrink-0 flex flex-col items-center gap-2">
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={0}
                        value={logActual.horas}
                        onChange={(e) => actualizarCampo('horas', e.target.value)}
                        className="w-16 bg-[#2c3440] border border-gray-700 rounded px-2 py-2 text-sm text-white text-center focus:outline-none"
                        placeholder="h"
                      />
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={logActual.minutos}
                        onChange={(e) => actualizarCampo('minutos', e.target.value)}
                        className="w-16 bg-[#2c3440] border border-gray-700 rounded px-2 py-2 text-sm text-white text-center focus:outline-none"
                        placeholder="m"
                      />
                    </div>
                    <span className="text-xs text-gray-400 whitespace-nowrap">total played</span>
                  </div>
                </div>

                {/* ACCIONES */}
                <div className="flex justify-between items-center pt-3 border-t border-gray-800">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setModalAbierto(false)}
                      className="bg-[#2c3440] hover:bg-gray-600 text-white text-sm font-bold px-4 py-2 rounded transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={guardarCambios}
                      disabled={guardando}
                      className="bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded transition cursor-pointer"
                    >
                      {guardando ? 'Guardando...' : 'Save Changes'}
                    </button>
                  </div>

                  {logActual.id && (
                    <button
                      onClick={borrarLogActual}
                      className="text-gray-400 hover:text-red-400 text-sm flex items-center gap-1.5 transition cursor-pointer"
                    >
                      🗑️ Delete this log
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}