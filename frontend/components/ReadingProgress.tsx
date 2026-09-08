'use client';
import { useState, useEffect } from 'react';

export default function ReadingProgress({ mediaId, tipo, className }: { mediaId: number; tipo?: string; className?: string }) {
  const [actual, setActual] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [editandoTotal, setEditandoTotal] = useState(false);
  const [totalInput, setTotalInput] = useState('');

  useEffect(() => {
    if (tipo !== 'LIBRO') return;
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch(`http://localhost:3001/media/${mediaId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        setActual(data.progresoActual ?? 0);
        setTotal(data.progresoTotal ?? null);
      })
      .catch(() => {});
  }, [mediaId, tipo]);

  const guardar = async (nuevoActual: number, nuevoTotal: number | null) => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const actualAnterior = actual;
    const totalAnterior = total;
    setActual(nuevoActual);
    setTotal(nuevoTotal);

    try {
      const res = await fetch(`http://localhost:3001/media/${mediaId}/progress`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ progresoActual: nuevoActual, progresoTotal: nuevoTotal }),
      });
      if (!res.ok) throw new Error('fallo al guardar');
    } catch {
      setActual(actualAnterior);
      setTotal(totalAnterior);
    }
  };

  if (tipo !== 'LIBRO' || actual === null) return null;

  const restar = () => guardar(Math.max(0, actual - 1), total);
  const sumar = () => guardar(total !== null ? Math.min(total, actual + 1) : actual + 1, total);

  const confirmarTotal = () => {
    const n = parseInt(totalInput, 10);
    guardar(actual, Number.isNaN(n) || n <= 0 ? null : n);
    setEditandoTotal(false);
  };

  return (
    <div className={className ?? 'bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl mt-4'}>
      <h3 className="text-sm font-bold text-white mb-3">Reading progress</h3>

      <div className="flex items-center justify-center gap-4">
        <button
          onClick={restar}
          disabled={actual <= 0}
          className="w-8 h-8 rounded bg-[#2c3440] hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold transition cursor-pointer"
        >
          −
        </button>

        <div className="text-2xl font-extrabold text-white min-w-[80px] text-center">
          {actual}
          <span className="text-gray-500"> / </span>
          {editandoTotal ? (
            <input
              type="number"
              min={1}
              autoFocus
              value={totalInput}
              onChange={(e) => setTotalInput(e.target.value)}
              onBlur={confirmarTotal}
              onKeyDown={(e) => e.key === 'Enter' && confirmarTotal()}
              className="w-14 bg-[#2c3440] border border-gray-600 rounded text-center text-lg font-bold text-white focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          ) : (
            <button
              onClick={() => {
                setTotalInput(total ? String(total) : '');
                setEditandoTotal(true);
              }}
              className="text-gray-400 hover:text-white transition cursor-pointer"
            >
              {total ?? '?'}
            </button>
          )}
        </div>

        <button
          onClick={sumar}
          disabled={total !== null && actual >= total}
          className="w-8 h-8 rounded bg-[#2c3440] hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold transition cursor-pointer"
        >
          +
        </button>
      </div>
    </div>
  );
}