'use client';
import { useState } from 'react';

export default function MediaTabs({ sinopsis, detalles }: { sinopsis: string, detalles: any }) {
  const [tab, setTab] = useState<'descripcion' | 'cast' | 'crew' | 'mas'>('descripcion');

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'descripcion', label: 'Descripcion' },
    { key: 'cast', label: 'Cast' },
    { key: 'crew', label: 'Crew' },
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

      {/* CAST */}
      {tab === 'cast' && (
        <div className="flex flex-wrap gap-x-6 gap-y-5">
          {detalles?.cast?.length > 0 ? (
            detalles.cast.map((actor: any) => (
              <div key={actor.id} className="w-20 text-center">
                <div className="w-16 h-16 mx-auto rounded-full overflow-hidden bg-gray-800 mb-2 border border-gray-700">
                  {actor.foto ? (
                    <img src={actor.foto} alt={actor.nombre} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600 text-[10px]">Sin foto</div>
                  )}
                </div>
                <div className="text-xs font-semibold text-white leading-tight">{actor.nombre}</div>
                <div className="text-xs text-gray-500 leading-tight mt-0.5">{actor.personaje}</div>
              </div>
            ))
          ) : (
            <p className="text-gray-500 text-sm">No hay información de reparto.</p>
          )}
        </div>
      )}

      {/* CREW */}
      {tab === 'crew' && (
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          {detalles?.director && (
            <div>
              <div className="font-semibold text-white">{detalles.director.nombre}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Director</div>
            </div>
          )}
          {detalles?.guionistas?.map((g: any, i: number) => (
            <div key={i}>
              <div className="font-semibold text-white">{g.nombre}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Guion</div>
            </div>
          ))}
          {!detalles?.director && (!detalles?.guionistas || detalles.guionistas.length === 0) && (
            <p className="text-gray-500 text-sm">No hay información de equipo técnico.</p>
          )}
        </div>
      )}

      {/* MAS */}
      {tab === 'mas' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 text-sm">
          <div>
            <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Estudio</div>
            <div className="text-gray-200">{detalles?.estudios?.length > 0 ? detalles.estudios.join(', ') : 'No disponible'}</div>
          </div>
          <div>
            <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">País</div>
            <div className="text-gray-200">{detalles?.paises?.length > 0 ? detalles.paises.join(', ') : 'No disponible'}</div>
          </div>
          <div>
            <div className="text-gray-500 uppercase text-xs tracking-wide mb-1">Presupuesto</div>
            <div className="text-gray-200">
              {detalles?.presupuesto
                ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(detalles.presupuesto)
                : 'No disponible'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}