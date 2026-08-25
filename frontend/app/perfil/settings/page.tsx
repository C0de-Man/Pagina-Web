'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AvatarCropModal from '@/components/AvatarCropModal';
import FavoritePickerModal from '@/components/FavoritePickerModal';
import SettingsIdiomaRegion from '@/components/SettingsIdiomaRegion';

export default function Settings() {
  const router = useRouter();
  const [tab, setTab] = useState<'perfil' | 'account'>('perfil');
  const [username, setUsername] = useState('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [favoritos, setFavoritos] = useState<any[]>(new Array(7).fill(null));
  const [cropAbierto, setCropAbierto] = useState(false);
  const [slotAbierto, setSlotAbierto] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [reseteando, setReseteando] = useState(false);
  const [resultadoReset, setResultadoReset] = useState<string | null>(null);
  const [confirmandoReset, setConfirmandoReset] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const [resultadoRefresh, setResultadoRefresh] = useState<string | null>(null);
  const [confirmandoRefresh, setConfirmandoRefresh] = useState(false);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
  const [usernameConfirmacion, setUsernameConfirmacion] = useState('');
  const [borrandoCuenta, setBorrandoCuenta] = useState(false);
  const [errorBorrado, setErrorBorrado] = useState<string | null>(null);

  const cargarDatos = () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    fetch('http://localhost:3001/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((res) => res.json())
      .then((data) => {
        setUsername(data.username);
        setAvatarPreview(data.avatar || null);
        setIsAdmin(!!data.isAdmin);
      })
      .catch(() => { });

    fetch('http://localhost:3001/favorites', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((res) => res.json())
      .then((data) => {
        const slots = new Array(7).fill(null);
        data.slice(0, 7).forEach((m: any, i: number) => (slots[i] = m));
        setFavoritos(slots);
      })
      .catch(() => { });
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

  const resetearCaratulas = async () => {
    const token = localStorage.getItem('token');
    if (!token || reseteando) return;

    setConfirmandoReset(false);
    setReseteando(true);
    setResultadoReset(null);
    try {
      const res = await fetch('http://localhost:3001/auth/me/set-covers-english', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setResultadoReset(
        res.ok
          ? `Done — ${data.actualizados} set to English, ${data.sinCambios} unchanged, ${data.fallidos} failed (of ${data.total} total).`
          : 'Something went wrong, please try again.'
      );
    } catch {
      setResultadoReset('Something went wrong, please try again.');
    }
    setReseteando(false);
  };

  const refrescarCaratulasIngles = async () => {
    const token = localStorage.getItem('token');
    if (!token || refrescando) return;

    setConfirmandoRefresh(false);
    setRefrescando(true);
    setResultadoRefresh(null);
    try {
      const res = await fetch('http://localhost:3001/admin/media/refresh-covers-english', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setResultadoRefresh(
        res.ok
          ? `Done — ${data.actualizados} updated, ${data.sinCambios} unchanged, ${data.fallidos} failed (of ${data.total} total).`
          : 'Something went wrong, please try again.'
      );
    } catch {
      setResultadoRefresh('Something went wrong, please try again.');
    }
    setRefrescando(false);
  };

  const borrarCuenta = async () => {
    const token = localStorage.getItem('token');
    if (!token || borrandoCuenta) return;

    if (usernameConfirmacion !== username) {
      setErrorBorrado('That doesn\'t match your username.');
      return;
    }

    setBorrandoCuenta(true);
    setErrorBorrado(null);
    try {
      const res = await fetch('http://localhost:3001/auth/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username: usernameConfirmacion }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorBorrado(data.error || 'Something went wrong, please try again.');
        setBorrandoCuenta(false);
        return;
      }
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.dispatchEvent(new Event('authchange'));
      router.push('/');
    } catch {
      setErrorBorrado('Something went wrong, please try again.');
      setBorrandoCuenta(false);
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
            className={`pb-3 text-sm font-bold uppercase tracking-wider cursor-pointer ${tab === 'perfil' ? 'text-white border-b-2 border-blue-500' : 'text-gray-400'
              }`}
          >
            Profile
          </button>
          <button
            onClick={() => setTab('account')}
            className={`pb-3 text-sm font-bold uppercase tracking-wider cursor-pointer ${tab === 'account' ? 'text-white border-b-2 border-blue-500' : 'text-gray-400'
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
                {guardando ? 'Saving...' : 'Save Changes'}
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
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Favorites</h3>
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
          <div className="max-w-md">
            <h2 className="text-lg font-bold mb-4">Account</h2>

            <SettingsIdiomaRegion />

            <div className="mt-8 pt-6 border-t border-gray-800">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Covers</h3>
              <p className="text-gray-500 text-sm mb-3">
                Set every movie and series poster/banner in your catalog to English, as your own personal covers. This only changes what you see — it doesn't affect anyone else's account.
              </p>
              <button
                onClick={() => setConfirmandoReset(true)}
                disabled={reseteando}
                className="bg-blue-900/40 hover:bg-blue-900/60 disabled:opacity-50 text-blue-300 hover:text-blue-200 px-4 py-2 rounded text-sm font-semibold transition cursor-pointer"
              >
                {reseteando ? 'Working... this can take a while' : 'Set all my covers to English'}
              </button>
              {resultadoReset && <p className="text-gray-400 text-sm mt-2">{resultadoReset}</p>}
            </div>

            {isAdmin && (
              <div className="mt-8 pt-6 border-t border-gray-800">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Admin: default covers for everyone</h3>
                <p className="text-gray-500 text-sm mb-3">
                  Change the shared default poster/banner (what any account sees before personalizing anything, including brand new accounts) to English, for every saved movie and series. This is different from the button above — that one only changes your own view.
                </p>
                <button
                  onClick={() => setConfirmandoRefresh(true)}
                  disabled={refrescando}
                  className="bg-red-900/40 hover:bg-red-900/60 disabled:opacity-50 text-red-300 hover:text-red-200 px-4 py-2 rounded text-sm font-semibold transition cursor-pointer"
                >
                  {refrescando ? 'Refreshing... this can take a while' : 'Refresh default covers for everyone'}
                </button>
                {resultadoRefresh && <p className="text-gray-400 text-sm mt-2">{resultadoRefresh}</p>}
              </div>
            )}

            <p className="text-gray-500 text-sm mt-8 pt-6 border-t border-gray-800">
              <Link href="/perfil/settings" className="underline">Change email/password</Link> — not implemented yet.
            </p>

            <div className="mt-8 pt-6 border-t border-red-950">
              <h3 className="text-xs font-bold uppercase tracking-wider text-red-400 mb-2">Danger zone</h3>
              <p className="text-gray-500 text-sm mb-3">
                Permanently delete your account and everything tied to it — your watched history, ratings, reviews, lists, favorites and follows. This cannot be undone.
              </p>
              <button
                onClick={() => {
                  setUsernameConfirmacion('');
                  setErrorBorrado(null);
                  setConfirmandoBorrado(true);
                }}
                className="bg-red-950 hover:bg-red-900 border border-red-800 text-red-300 hover:text-red-200 px-4 py-2 rounded text-sm font-semibold transition cursor-pointer"
              >
                Delete my account
              </button>
            </div>
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

      {confirmandoReset && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c2228] border border-gray-700 rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">Set all covers to English?</h3>
            <p className="text-gray-400 text-sm mb-6">
              This sets the poster and banner of every movie and series in your catalog to their English version, saved as your own personal covers. It can take a while with a large catalog. It only affects your account — nobody else's covers change.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmandoReset(false)}
                className="px-4 py-2 rounded text-sm font-semibold text-gray-300 hover:text-white transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={resetearCaratulas}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-bold transition cursor-pointer"
              >
                Yes, set to English
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmandoRefresh && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c2228] border border-gray-700 rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">Refresh default covers for everyone?</h3>
            <p className="text-gray-400 text-sm mb-6">
              This re-fetches the shared default poster and banner (in English) for every saved movie and series, for ALL users and any future new account. It can take a while with a large catalog, and won't touch anyone's personal custom covers. Continue?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmandoRefresh(false)}
                className="px-4 py-2 rounded text-sm font-semibold text-gray-300 hover:text-white transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={refrescarCaratulasIngles}
                className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded text-sm font-bold transition cursor-pointer"
              >
                Yes, refresh for everyone
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmandoBorrado && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c2228] border border-red-900 rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-red-300 mb-2">Delete your account?</h3>
            <p className="text-gray-400 text-sm mb-4">
              This permanently deletes your account and everything in it — watched history, ratings, reviews, lists, favorites and follows. There's no way to undo this.
            </p>
            <label className="text-xs text-gray-400 uppercase tracking-wider">
              Type <span className="text-white font-bold">{username}</span> to confirm
            </label>
            <input
              type="text"
              value={usernameConfirmacion}
              onChange={(e) => setUsernameConfirmacion(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 mt-1 mb-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-600"
              autoFocus
            />
            {errorBorrado && <p className="text-red-400 text-xs mb-2">{errorBorrado}</p>}
            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setConfirmandoBorrado(false)}
                className="px-4 py-2 rounded text-sm font-semibold text-gray-300 hover:text-white transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={borrarCuenta}
                disabled={borrandoCuenta || usernameConfirmacion !== username}
                className="bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-sm font-bold transition cursor-pointer"
              >
                {borrandoCuenta ? 'Deleting...' : 'Yes, permanently delete my account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}