'use client';
import { useState, useEffect } from 'react';

type Contador = {
  actual: number;
  total: number | null;
};

export default function ReadingProgress({ mediaId, tipo, className }: { mediaId: number; tipo?: string; className?: string }) {
  const [capitulo, setCapitulo] = useState<Contador | null>(null);
  const [volumen, setVolumen] = useState<Contador | null>(null);
  const [editando, setEditando] = useState<'capitulo' | 'volumen' | null>(null);
  const [totalInput, setTotalInput] = useState('');

  useEffect(() => {
    if (tipo !== 'LIBRO') return;
    const token = localStorage.getItem('token');
    if (!token) return;

    Promise.all([
      fetch(`http://localhost:3001/media/${mediaId}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((res) => res.json()),
      // Totales por defecto desde MAL (si este libro es un manga guardado
      // desde ahí) — solo se usan cuando el usuario todavía no ha puesto
      // un total a mano; en cuanto lo edite, ese valor manda siempre.
      fetch(`http://localhost:3001/media/${mediaId}/manga-info`).then((res) => res.json()).catch(() => null),
    ])
      .then(([status, mangaInfo]) => {
        setCapitulo({
          actual: status.progresoActual ?? 0,
          total: status.progresoTotal ?? mangaInfo?.totalCapitulos ?? null,
        });
        setVolumen({
          actual: status.progresoVolumenActual ?? 0,
          total: status.progresoVolumenTotal ?? mangaInfo?.totalVolumenes ?? null,
        });
      })
      .catch(() => {});
  }, [mediaId, tipo]);

  const guardar = async (campo: 'capitulo' | 'volumen', nuevoActual: number, nuevoTotal: number | null) => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const anterior = campo === 'capitulo' ? capitulo : volumen;
    const setter = campo === 'capitulo' ? setCapitulo : setVolumen;
    setter({ actual: nuevoActual, total: nuevoTotal });

    const body = campo === 'capitulo'
      ? { progresoActual: nuevoActual, progresoTotal: nuevoTotal }
      : { progresoVolumenActual: nuevoActual, progresoVolumenTotal: nuevoTotal };

    try {
      const res = await fetch(`http://localhost:3001/media/${mediaId}/progress`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('fallo al guardar');
    } catch {
      setter(anterior);
    }
  };

  if (tipo !== 'LIBRO' || !capitulo || !volumen) return null;

  const confirmarTotal = (campo: 'capitulo' | 'volumen') => {
    const actual = campo === 'capitulo' ? capitulo : volumen;
    const n = parseInt(totalInput, 10);
    guardar(campo, actual.actual, Number.isNaN(n) || n <= 0 ? null : n);
    setEditando(null);
  };

  const Fila = ({ campo, etiqueta, contador }: { campo: 'capitulo' | 'volumen'; etiqueta: string; contador: Contador }) => (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-gray-400 uppercase tracking-wide">{etiqueta}</span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => guardar(campo, Math.max(0, contador.actual - 1), contador.total)}
          disabled={contador.actual <= 0}
          className="w-6 h-6 rounded bg-[#2c3440] hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold text-sm transition cursor-pointer"
        >
          −
        </button>

        <div className="text-base font-extrabold text-white min-w-[56px] text-center">
          {contador.actual}
          <span className="text-gray-500"> / </span>
          {editando === campo ? (
            <input
              type="number"
              min={1}
              autoFocus
              value={totalInput}
              onChange={(e) => setTotalInput(e.target.value)}
              onBlur={() => confirmarTotal(campo)}
              onKeyDown={(e) => e.key === 'Enter' && confirmarTotal(campo)}
              className="w-10 bg-[#2c3440] border border-gray-600 rounded text-center text-sm font-bold text-white focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          ) : (
            <button
              onClick={() => {
                setTotalInput(contador.total ? String(contador.total) : '');
                setEditando(campo);
              }}
              className="text-gray-400 hover:text-white transition cursor-pointer"
            >
              {contador.total ?? '?'}
            </button>
          )}
        </div>

        <button
          onClick={() => guardar(campo, contador.total !== null ? Math.min(contador.total, contador.actual + 1) : contador.actual + 1, contador.total)}
          disabled={contador.total !== null && contador.actual >= contador.total}
          className="w-6 h-6 rounded bg-[#2c3440] hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold text-sm transition cursor-pointer"
        >
          +
        </button>
      </div>
    </div>
  );

  return (
    <div className={className ?? 'bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl mt-4'}>
      <h3 className="text-sm font-bold text-white mb-3">Reading progress</h3>
      <div className="space-y-2">
        <Fila campo="capitulo" etiqueta="Chapter" contador={capitulo} />
        <Fila campo="volumen" etiqueta="Volume" contador={volumen} />
      </div>
    </div>
  );
}