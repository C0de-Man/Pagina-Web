'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AvatarCropModal from '@/components/AvatarCropModal';
import FavoritePickerModal from '@/components/FavoritePickerModal';
import SettingsIdiomaRegion from '@/components/SettingsIdiomaRegion';

export default function Settings() {
  const router = useRouter();
  const [tab, setTab] = useState<'perfil' | 'account' | 'admin'>('perfil');
  const [username, setUsername] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [favoritos, setFavoritos] = useState<any[]>(new Array(7).fill(null));
  const [cropAbierto, setCropAbierto] = useState(false);
  const [slotAbierto, setSlotAbierto] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [reseteando, setReseteando] = useState(false);
  const [resultadoReset, setResultadoReset] = useState<string | null>(null);
  const [confirmandoReset, setConfirmandoReset] = useState(false);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
  const [usernameConfirmacion, setUsernameConfirmacion] = useState('');
  const [borrandoCuenta, setBorrandoCuenta] = useState(false);
  const [errorBorrado, setErrorBorrado] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [guardandoPrivacidad, setGuardandoPrivacidad] = useState(false);

  // --- Ocultar contenido NSFW de SteamGridDB (preferencia local, activada
  // por defecto — solo se desactiva si el usuario lo hace explícitamente) ---
  const [ocultarNsfw, setOcultarNsfw] = useState(true);

  // --- Cambiar email/contraseña ---
  const [currentPassword, setCurrentPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [guardandoCredenciales, setGuardandoCredenciales] = useState(false);
  const [errorCredenciales, setErrorCredenciales] = useState<string | null>(null);
  const [okCredenciales, setOkCredenciales] = useState<string | null>(null);

  // --- Reiniciar cuenta (solo admin) ---
  const [confirmandoResetCuenta, setConfirmandoResetCuenta] = useState(false);
  const [usernameConfirmacionReset, setUsernameConfirmacionReset] = useState('');
  const [reseteandoCuenta, setReseteandoCuenta] = useState(false);
  const [errorResetCuenta, setErrorResetCuenta] = useState<string | null>(null);

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
        setUsernameInput(data.username);
        setAvatarPreview(data.avatar || null);
        setIsPrivate(!!data.isPrivate);
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
    const guardado = localStorage.getItem('ocultarNsfw');
    setOcultarNsfw(guardado === null ? true : guardado === 'true');
  }, []);

  // Si en algún momento dejas de ser admin (o esta pestaña quedó activa de
  // antes) y no lo eres, no te dejamos quedarte en una pestaña que ya no
  // deberías ver — te devuelve a Profile.
  useEffect(() => {
    if (tab === 'admin' && !isAdmin) setTab('perfil');
  }, [tab, isAdmin]);

  const alternarOcultarNsfw = () => {
    const nuevoValor = !ocultarNsfw;
    setOcultarNsfw(nuevoValor);
    localStorage.setItem('ocultarNsfw', String(nuevoValor));
  };

  const guardarCambios = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setGuardando(true);
    setErrorGuardar(null);

    try {
      // El username solo se manda si de verdad ha cambiado — así no
      // disparamos el error de "ya en uso" contra tu propio nombre actual.
      if (usernameInput.trim() && usernameInput.trim() !== username) {
        const resUsername = await fetch('http://localhost:3001/auth/me/username', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ username: usernameInput.trim() }),
        });
        const dataUsername = await resUsername.json();
        if (!resUsername.ok) {
          setErrorGuardar(dataUsername.error || 'No se pudo actualizar el nombre de usuario');
          setGuardando(false);
          return;
        }
        setUsername(dataUsername.username);
      }

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
        localStorage.setItem('user', JSON.stringify({ ...user, avatar: avatarPreview, username: usernameInput.trim() || username }));
        window.dispatchEvent(new Event('authchange'));
      }
    } finally {
      setGuardando(false);
    }
  };

  const guardarCredenciales = async () => {
    const token = localStorage.getItem('token');
    if (!token || guardandoCredenciales) return;

    setErrorCredenciales(null);
    setOkCredenciales(null);

    if (!currentPassword) {
      setErrorCredenciales('Introduce tu contraseña actual.');
      return;
    }
    if (!newEmail && !newPassword) {
      setErrorCredenciales('Cambia al menos el email o la contraseña.');
      return;
    }
    if (newPassword && newPassword !== confirmNewPassword) {
      setErrorCredenciales('Las contraseñas nuevas no coinciden.');
      return;
    }

    setGuardandoCredenciales(true);
    try {
      const res = await fetch('http://localhost:3001/auth/me/credentials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          currentPassword,
          newEmail: newEmail.trim() || undefined,
          newPassword: newPassword || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorCredenciales(data.error || 'Something went wrong, please try again.');
        setGuardandoCredenciales(false);
        return;
      }
      setOkCredenciales('Updated successfully.');
      setCurrentPassword('');
      setNewEmail('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch {
      setErrorCredenciales('Something went wrong, please try again.');
    }
    setGuardandoCredenciales(false);
  };

  const resetearCaratulas = async () => {
    const token = localStorage.getItem('token');
    if (!token || reseteando) return;

    setConfirmandoReset(false);
    setReseteando(true);
    setResultadoReset(null);
    try {
      const res = await fetch('http://localhost:3001/auth/me/reset-custom-posters', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setResultadoReset(
        res.ok
          ? `Done — ${data.actualizados} custom cover${data.actualizados === 1 ? '' : 's'} reset.`
          : 'Something went wrong, please try again.'
      );
    } catch {
      setResultadoReset('Something went wrong, please try again.');
    }
    setReseteando(false);
  };

  const alternarPrivacidad = async () => {
    const token = localStorage.getItem('token');
    if (!token || guardandoPrivacidad) return;

    setGuardandoPrivacidad(true);
    const nuevoValor = !isPrivate;
    setIsPrivate(nuevoValor); // optimista

    try {
      const res = await fetch('http://localhost:3001/auth/me/privacy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isPrivate: nuevoValor }),
      });
      if (!res.ok) throw new Error('fallo al actualizar');
    } catch {
      setIsPrivate(!nuevoValor); // revertimos si falla
    }
    setGuardandoPrivacidad(false);
  };

  const reiniciarCuenta = async () => {
    const token = localStorage.getItem('token');
    if (!token || reseteandoCuenta) return;

    if (usernameConfirmacionReset !== username) {
      setErrorResetCuenta("That doesn't match your username.");
      return;
    }

    setReseteandoCuenta(true);
    setErrorResetCuenta(null);
    try {
      const res = await fetch('http://localhost:3001/auth/me/reset-account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorResetCuenta(data.error || 'Something went wrong, please try again.');
        setReseteandoCuenta(false);
        return;
      }
      setConfirmandoResetCuenta(false);
      setReseteandoCuenta(false);
      window.location.href = '/';
    } catch {
      setErrorResetCuenta('Something went wrong, please try again.');
      setReseteandoCuenta(false);
    }
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
          {/* Pestaña "Admin": solo se pinta si eres admin — un usuario normal
              nunca la ve ni puede llegar a ella (y por si acaso, el useEffect
              de arriba te saca de esta pestaña si dejas de ser admin). */}
          {isAdmin && (
            <button
              onClick={() => setTab('admin')}
              className={`pb-3 text-sm font-bold uppercase tracking-wider cursor-pointer ${tab === 'admin' ? 'text-white border-b-2 border-amber-500' : 'text-gray-400'
                }`}
            >
              Admin
            </button>
          )}
        </div>

        {tab === 'perfil' ? (
          <div>
            <div className="flex flex-col md:flex-row gap-8">
              <div className="flex-grow">
                <h2 className="text-lg font-bold mb-4">Profile</h2>
                <label className="text-xs text-gray-400 uppercase tracking-wider">Username</label>
                <input
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 mt-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
                {errorGuardar && <p className="text-red-400 text-xs mt-1">{errorGuardar}</p>}

                <button
                  onClick={guardarCambios}
                  disabled={guardando}
                  className="mt-6 bg-green-600 hover:bg-green-500 disabled:opacity-50 px-5 py-2 rounded font-bold text-sm transition cursor-pointer"
                >
                  {guardando ? 'Saving...' : 'Save Changes'}
                </button>

                {/* Idioma/región: dentro de la columna izquierda, justo
                    debajo del botón — así no hereda la altura de la columna
                    derecha (Avatar/Favorites) por el "stretch" del flex, que
                    antes dejaba un hueco enorme antes de llegar aquí. */}
                <div className="mt-10 pt-6 border-t border-gray-800 max-w-md">
                  <SettingsIdiomaRegion />
                </div>
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
                        className="group relative aspect-[2/3] rounded bg-gray-800 border border-gray-700 hover:border-gray-500 cursor-pointer overflow-hidden flex items-center justify-center transition"
                      >
                        {item?.portada ? (
                          <>
                            <img src={item.portada} alt={item.titulo} className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const nuevos = [...favoritos];
                                nuevos[i] = null;
                                setFavoritos(nuevos);
                              }}
                              title="Remove from favorites"
                              className="absolute top-1 right-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/80 text-xs font-bold text-white opacity-0 transition hover:bg-red-600 group-hover:opacity-100 cursor-pointer"
                            >
                              ×
                            </button>
                          </>
                        ) : (
                          <span className="text-gray-500 text-xl">+</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : tab === 'account' ? (
          <div className="max-w-md">
            <h2 className="text-lg font-bold mb-4">Account</h2>

            <div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Private account</h3>
                  <p className="text-gray-500 text-sm">
                    Only people you approve can see your catalog, lists and reviews. New followers need your acceptance first.
                  </p>
                </div>
                <button
                  onClick={alternarPrivacidad}
                  disabled={guardandoPrivacidad}
                  role="switch"
                  aria-checked={isPrivate}
                  className={`relative flex-shrink-0 w-11 h-6 rounded-full transition cursor-pointer disabled:opacity-50 ${
                    isPrivate ? 'bg-blue-600' : 'bg-gray-700'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                      isPrivate ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-gray-800">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Hide adult content</h3>
                  <p className="text-gray-500 text-sm">
                    Hide adult/NSFW-tagged covers and banners when browsing SteamGridDB images. On by default.
                  </p>
                </div>
                <button
                  onClick={alternarOcultarNsfw}
                  role="switch"
                  aria-checked={ocultarNsfw}
                  className={`relative flex-shrink-0 w-11 h-6 rounded-full transition cursor-pointer ${
                    ocultarNsfw ? 'bg-blue-600' : 'bg-gray-700'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                      ocultarNsfw ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Change email / password: movido justo debajo de "Hide adult
                content" (antes estaba después de "Custom covers"). */}
            <div className="mt-8 pt-6 border-t border-gray-800">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Change email / password</h3>
              <p className="text-gray-500 text-sm mb-3">
                Confirm your current password to change your email and/or set a new password.
              </p>

              <label className="text-xs text-gray-400 uppercase tracking-wider">Current password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 mt-1 mb-4 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-600"
              />

              <label className="text-xs text-gray-400 uppercase tracking-wider">New email (optional)</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Leave blank to keep current email"
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 mt-1 mb-4 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />

              <label className="text-xs text-gray-400 uppercase tracking-wider">New password (optional)</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Leave blank to keep current password"
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 mt-1 mb-4 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />

              {newPassword && (
                <>
                  <label className="text-xs text-gray-400 uppercase tracking-wider">Confirm new password</label>
                  <input
                    type="password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 mt-1 mb-4 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />
                </>
              )}

              {errorCredenciales && <p className="text-red-400 text-xs mb-2">{errorCredenciales}</p>}
              {okCredenciales && <p className="text-green-400 text-xs mb-2">{okCredenciales}</p>}

              <button
                onClick={guardarCredenciales}
                disabled={guardandoCredenciales}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded text-sm font-semibold transition cursor-pointer"
              >
                {guardandoCredenciales ? 'Saving...' : 'Update credentials'}
              </button>
            </div>

            <div className="mt-8 pt-6 border-t border-gray-800">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Custom covers</h3>
              <p className="text-gray-500 text-sm mb-3">
                Remove every custom poster and banner you've personally set across your whole catalog, and go back to the original default cover for everything.
              </p>
              <button
                onClick={() => setConfirmandoReset(true)}
                disabled={reseteando}
                className="bg-red-900/40 hover:bg-red-900/60 disabled:opacity-50 text-red-300 hover:text-red-200 px-4 py-2 rounded text-sm font-semibold transition cursor-pointer"
              >
                {reseteando ? 'Resetting...' : 'Reset all custom covers'}
              </button>
              {resultadoReset && <p className="text-gray-400 text-sm mt-2">{resultadoReset}</p>}
            </div>

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
        ) : (
          // Pestaña Admin: solo se llega aquí si isAdmin es true (el botón de
          // la pestaña ni se pinta si no lo eres, y el useEffect de arriba te
          // saca de esta pestaña si en algún momento dejas de serlo).
          <div className="max-w-md">
            <h2 className="text-lg font-bold mb-4">Admin</h2>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-2">Reset account (admin)</h3>
              <p className="text-gray-500 text-sm mb-3">
                Wipe every bit of activity on this account — watched history, ratings, reviews, lists, favorites, follows and notifications. Your email, username, password and avatar stay exactly as they are. This cannot be undone.
              </p>
              <button
                onClick={() => {
                  setUsernameConfirmacionReset('');
                  setErrorResetCuenta(null);
                  setConfirmandoResetCuenta(true);
                }}
                className="bg-amber-900/40 hover:bg-amber-900/60 text-amber-300 hover:text-amber-200 px-4 py-2 rounded text-sm font-semibold transition cursor-pointer"
              >
                Reset account data
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
            <h3 className="text-lg font-bold text-white mb-2">Reset all custom covers?</h3>
            <p className="text-gray-400 text-sm mb-6">
              You're about to remove every custom poster and banner you've set, on every movie, series, game or book. Everything will go back to the original default cover. This won't remove anything from your catalog — only your custom covers.
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
                className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded text-sm font-bold transition cursor-pointer"
              >
                Yes, reset
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmandoResetCuenta && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c2228] border border-amber-900 rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-amber-300 mb-2">Reset account data?</h3>
            <p className="text-gray-400 text-sm mb-4">
              This wipes your watched history, ratings, reviews, lists, favorites, follows and notifications. Your email, username, password and avatar are NOT touched. There's no way to undo this.
            </p>
            <label className="text-xs text-gray-400 uppercase tracking-wider">
              Type <span className="text-white font-bold">{username}</span> to confirm
            </label>
            <input
              type="text"
              value={usernameConfirmacionReset}
              onChange={(e) => setUsernameConfirmacionReset(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 mt-1 mb-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-600"
              autoFocus
            />
            {errorResetCuenta && <p className="text-red-400 text-xs mb-2">{errorResetCuenta}</p>}
            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setConfirmandoResetCuenta(false)}
                className="px-4 py-2 rounded text-sm font-semibold text-gray-300 hover:text-white transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={reiniciarCuenta}
                disabled={reseteandoCuenta || usernameConfirmacionReset !== username}
                className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-sm font-bold transition cursor-pointer"
              >
                {reseteandoCuenta ? 'Resetting...' : 'Yes, reset my account'}
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