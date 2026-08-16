'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import AvatarCropModal from '@/components/AvatarCropModal';
import FavoritePickerModal from '@/components/FavoritePickerModal';

export default function Settings() {
  const [tab, setTab] = useState<'perfil' | 'account'>('perfil');
  const [username, setUsername] = useState('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [favoritos, setFavoritos] = useState<any[]>(new Array(7).fill(null));
  const [cropAbierto, setCropAbierto] = useState(false);
  const [slotAbierto, setSlotAbierto] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargarDatos = () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    fetch('http://localhost:3001/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => {
        setUsername(data.username);
        setAvatarPreview(data.avatar || null);
      })
      .catch(() => {});

    fetch('http://localhost:3001/favorites', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => {
        const slots = new Array(7).fill(null);
        data.slice(0, 7).forEach((m: any, i: number) => (slots[i] = m));
        setFavoritos(slots);
      })
      .catch(() => {});
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  const guardarCambios = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setGuardando(true);

    try {
      if (avatarPreview) {
        await fetch('http://localhost:3001/auth/me/avatar', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ avatar: avatarPreview }),
        });
      }

      const mediaIds = favoritos.filter(Boolean).map((f) => f.id);
      await fetch('http://localhost:3001/favorites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mediaIds }),
      });

      const rawUser = localStorage.getItem('user');
      if (rawUser) {
        const user = JSON.parse(rawUser);
        localStorage.setItem('user', JSON.stringify({ ...user, avatar: avatarPreview }));
        window.dispatchEvent(new Event('authchange'));
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="border-b border-gray-800 px-6 py-6">
        <h1 className="text-xl font-bold">Account Settings</h1>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-6 border-b border-gray-800 mb-8">
          <button
            onClick={() => setTab('perfil')}
            className={`pb-3 text-sm font-bold uppercase tracking-wider cursor-pointer ${
              tab === 'perfil' ? 'text-white border-b-2 border-blue-500' : 'text-gray-400'
            }`}
          >
            Profile
          </button>
          <button
            onClick={() => setTab('account')}
            className={`pb-3 text-sm font-bold uppercase tracking-wider cursor-pointer ${
              tab === 'account' ? 'text-white border-b-2 border-blue-500' : 'text-gray-400'
            }`}
          >
            Account
          </button>
        </div>

        {tab === 'perfil' ? (
          <div className="flex flex-col md:flex-row gap-8">
            <div className="flex-grow">
              <h2 className="text-lg font-bold mb-4">Profile</h2>
              <label className="text-xs text-gray-400 uppercase tracking-wider">Username</label>
              <input
                readOnly
                value={username}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 mt-1 text-sm text-gray-400"
              />

              <button
                onClick={guardarCambios}
                disabled={guardando}
                className="mt-6 bg-green-600 hover:bg-green-500 disabled:opacity-50 px-5 py-2 rounded font-bold text-sm transition cursor-pointer"
              >
                {guardando ? 'Guardando...' : 'Save Changes'}
              </button>
            </div>

            <div className="w-full md:w-[420px] flex-shrink-0">
              <div className="bg-[#1c2228] border border-gray-700 rounded-lg p-4 mb-6">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Avatar</h3>
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-full overflow-hidden bg-gray-800 border border-gray-700 flex-shrink-0">
                    <img
                      src={avatarPreview || `https://api.dicebear.com/7.x/avataaars/svg?seed=${username || 'user'}`}
                      alt="Avatar"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <button
                    onClick={() => setCropAbierto(true)}
                    className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm font-semibold transition cursor-pointer"
                  >
                    Change
                  </button>
                </div>
              </div>

              <div className="bg-[#1c2228] border border-gray-700 rounded-lg p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Favoritos</h3>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                  {favoritos.map((item, i) => (
                    <div
                      key={i}
                      onClick={() => setSlotAbierto(i)}
                      className="aspect-[2/3] rounded bg-gray-800 border border-gray-700 hover:border-gray-500 cursor-pointer overflow-hidden flex items-center justify-center transition"
                    >
                      {item?.portada ? (
                        <img src={item.portada} alt={item.titulo} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-gray-500 text-xl">+</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <h2 className="text-lg font-bold mb-4">Account</h2>
            <p className="text-gray-500 text-sm">
              <Link href="/perfil/settings" className="underline">Cambio de email/contraseña</Link> — pendiente de implementar.
            </p>
          </div>
        )}
      </div>

      {cropAbierto && (
        <AvatarCropModal
          onClose={() => setCropAbierto(false)}
          onSave={(dataUrl) => {
            setAvatarPreview(dataUrl);
            setCropAbierto(false);
          }}
        />
      )}

      {slotAbierto !== null && (
        <FavoritePickerModal
          onClose={() => setSlotAbierto(null)}
          onSelect={(media) => {
            const nuevos = [...favoritos];
            nuevos[slotAbierto] = media;
            setFavoritos(nuevos);
            setSlotAbierto(null);
          }}
        />
      )}
    </main>
  );
}