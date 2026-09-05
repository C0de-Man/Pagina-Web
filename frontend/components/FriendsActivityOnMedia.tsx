'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import StarRating from './StarRating';

interface AmigoActividad {
  username: string;
  avatar: string | null;
  rating: number | null;
}

export default function FriendsActivityOnMedia({ mediaId }: { mediaId: number }) {
  const [amigos, setAmigos] = useState<AmigoActividad[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch(`http://localhost:3001/media/${mediaId}/friends-activity`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => setAmigos(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [mediaId]);

  if (amigos.length === 0) return null;

  return (
    <div className="mt-4 bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl">
      <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Activity from friends</p>
      <div className="flex flex-wrap gap-4">
        {amigos.map((amigo) => (
          <Link
            key={amigo.username}
            href={`/user/${amigo.username}`}
            className="flex flex-col items-center gap-1 group w-16"
          >
            <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-800 border-2 border-gray-700 group-hover:border-teal-500 transition">
              {amigo.avatar ? (
                <img src={amigo.avatar} alt={amigo.username} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs font-bold">
                  {amigo.username[0]?.toUpperCase()}
                </div>
              )}
            </div>
            {amigo.rating != null && <StarRating value={amigo.rating} readOnly size="sm" />}
          </Link>
        ))}
      </div>
    </div>
  );
}