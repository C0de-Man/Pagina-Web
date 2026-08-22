'use client';
import { useEffect, useState } from 'react';

export default function PersonWatchedStat({ tmdbIdsUnicos }: { tmdbIdsUnicos: number[] }) {
  const [stat, setStat] = useState<{ vistas: number; total: number } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || tmdbIdsUnicos.length === 0) return;

    fetch('http://localhost:3001/media/watched', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data: any[]) => {
        if (!Array.isArray(data)) return;
        const idsVistos = new Set(data.map((m) => m.tmdbId));
        const vistas = tmdbIdsUnicos.filter((id) => idsVistos.has(id)).length;
        setStat({ vistas, total: tmdbIdsUnicos.length });
      })
      .catch(() => {});
  }, [tmdbIdsUnicos]);

  if (!stat || stat.total === 0) return null;

  const porcentaje = Math.round((stat.vistas / stat.total) * 100);

  return (
    <div className="bg-[#1c2228] rounded-lg border border-gray-700 p-4 flex items-center justify-between">
      <div>
        <p className="text-sm text-gray-300">
          Has visto <span className="font-bold text-white">{stat.vistas}</span> de{' '}
          <span className="font-bold text-white">{stat.total}</span>
        </p>
      </div>
      <span className="text-2xl font-extrabold text-blue-400">{porcentaje}%</span>
    </div>
  );
}