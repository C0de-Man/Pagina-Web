'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import ReviewDetailModal from './ReviewDetailModal';

const API_URL = 'http://localhost:3001';
const TOTAL_VISIBLE = 8;

function Estrellas({ rating }: { rating: number | null }) {
  if (!rating) return null;
  const sobreCinco = rating / 2;
  return (
    <span className="text-teal-400 text-xs">
      {[1, 2, 3, 4, 5].map((i) => {
        const lleno = sobreCinco >= i;
        const medio = !lleno && sobreCinco >= i - 0.5;
        return <span key={i}>{lleno ? '★' : medio ? '⯨' : '☆'}</span>;
      })}
    </span>
  );
}

function formatearFechaCorta(fecha: string) {
  const d = new Date(fecha);
  const meses = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${meses[d.getMonth()]} ${d.getDate()}`;
}

export default function NewFromFriendsCarousel() {
  const [items, setItems] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [itemAbierto, setItemAbierto] = useState<any>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setCargando(false);
      return;
    }
    fetch(`${API_URL}/friends/activity?limit=${TOTAL_VISIBLE}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((d) => setItems(Array.isArray(d) ? d.slice(0, TOTAL_VISIBLE) : []))
      .catch(() => setItems([]))
      .finally(() => setCargando(false));
  }, []);

  if (cargando || items.length === 0) return null;

  return (
    <>
      <section className="bg-[#161b22] border border-gray-800 rounded-lg p-6 mb-10">
        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-4">New from friends</h2>

        <div className="grid grid-cols-4 sm:grid-cols-8 gap-4">
          {items.map((it, i) => (
            <div key={`${it.actor.id}-${it.id}-${i}`} className="min-w-0">
              <button onClick={() => setItemAbierto(it)} className="block w-full text-left cursor-pointer group">
                <div className="w-full aspect-[2/3] rounded overflow-hidden bg-gray-800 border border-gray-700 group-hover:border-gray-500 transition">
                  {it.portada ? (
                    <img src={it.portada} alt={it.titulo} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-center p-2 text-gray-500">
                      {it.titulo}
                    </div>
                  )}
                </div>
              </button>

              <Link href={`/user/${it.actor.username}`} className="mt-2 flex items-center gap-1.5 group/user w-fit max-w-full">
                <div className="w-4 h-4 rounded-full overflow-hidden bg-gray-700 flex-shrink-0">
                  {it.actor.avatar && <img src={it.actor.avatar} alt={it.actor.username} className="w-full h-full object-cover" />}
                </div>
                <span className="text-xs text-gray-300 truncate group-hover/user:text-white group-hover/user:underline">
                  {it.actor.username}
                </span>
              </Link>

              <button onClick={() => setItemAbierto(it)} className="block w-full text-left cursor-pointer">
                <div className="flex items-center justify-between mt-1">
                  <Estrellas rating={it.rating} />
                  {it.review && <span className="text-gray-500 text-xs" title="Has a review">☰</span>}
                </div>
                <p className="text-[11px] text-gray-600 mt-0.5">{formatearFechaCorta(it.fecha)}</p>
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* puedeEditar=false a propósito: esto es actividad de OTROS, nunca tuya */}
      <ReviewDetailModal resena={itemAbierto} onClose={() => setItemAbierto(null)} puedeEditar={false} />
    </>
  );
}