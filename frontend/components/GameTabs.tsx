'use client';
import { useState } from 'react';

export default function GameTabs({ sinopsis, detalles }: { sinopsis: string, detalles: any }) {
  const [tab, setTab] = useState<'descripcion' | 'mas'>('descripcion');

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'descripcion', label: 'Descripcion' },
    { key: 'mas', label: 'Mas' },
  ];

  return (
    <div>
      {/* CABECERA DE PESTAÑAS */}
      <div className="flex gap-6 border-b border-gray-800 mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`pb-3 text-sm font-semibold transition cursor-pointer ${
              tab === t.key
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
        <p className="text-gray-300 leading-relaxed text-base">{sinopsis}</p>
      )}

      {/* MAS */}
      {tab === 'mas' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 text-sm">
          <div>
            <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Plataformas</div>
            <div className="text-gray-200">{detalles?.plataformas?.length > 0 ? detalles.plataformas.join(', ') : 'No disponible'}</div>
          </div>
          <div>
            <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Géneros</div>
            <div className="text-gray-200">{detalles?.generos?.length > 0 ? detalles.generos.join(', ') : 'No disponible'}</div>
          </div>
          <div>
            <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Desarrolladora</div>
            <div className="text-gray-200">{detalles?.desarrolladoras?.length > 0 ? detalles.desarrolladoras.join(', ') : 'No disponible'}</div>
          </div>
          <div>
            <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Distribuidora</div>
            <div className="text-gray-200">{detalles?.distribuidoras?.length > 0 ? detalles.distribuidoras.join(', ') : 'No disponible'}</div>
          </div>
        </div>
      )}
    </div>
  );
}