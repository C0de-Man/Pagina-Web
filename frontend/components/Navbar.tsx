'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function Navbar() {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [peliculasOpen, setPeliculasOpen] = useState(false);
  const [juegosOpen, setJuegosOpen] = useState(false);
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [user, setUser] = useState<{ username: string } | null>(null);
  const [notificaciones, setNotificaciones] = useState<any[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const [panelNotisAbierto, setPanelNotisAbierto] = useState(false);
  const notisRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const cargarUsuario = () => {
    const raw = localStorage.getItem('user');
    setUser(raw ? JSON.parse(raw) : null);
  };

  const cargarContadorNoLeidas = () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch('http://localhost:3001/notifications/unread-count', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((res) => res.json())
      .then((data) => setNoLeidas(data.count || 0))
      .catch(() => { });
  };

  const abrirPanelNotis = () => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }
    setPanelNotisAbierto((v) => !v);

    if (!panelNotisAbierto) {
      fetch('http://localhost:3001/notifications', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
        .then((res) => res.json())
        .then((data) => setNotificaciones(Array.isArray(data) ? data : []))
        .catch(() => { });

      // Se marcan como leídas nada más abrir, y el contador baja a 0 al
      // instante — no hace falta esperar a la respuesta del servidor para
      // que el numerito desaparezca.
      if (noLeidas > 0) {
        setNoLeidas(0);
        fetch('http://localhost:3001/notifications/mark-read', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => { });
      }
    }
  };

  function textoNotificacion(n: any) {
    if (n.tipo === 'FOLLOW') return 'started following you';
    if (n.tipo === 'FOLLOW_REQUEST') return 'wants to follow you';
    if (n.tipo === 'FOLLOW_ACCEPTED') return 'accepted your follow request';
    if (n.tipo === 'LIST_LIKE') return `liked your list "${n.lista?.nombre || 'Untitled'}"`;
    return '';
  }

  const responderSolicitud = async (e: React.MouseEvent, actorId: number, accion: 'accept' | 'decline', notiId: number) => {
    e.preventDefault(); // no navegar al hacer clic en Accept/Decline
    e.stopPropagation();
    const token = localStorage.getItem('token');
    if (!token) return;

    // Quita la notificación de la lista al instante, tanto si se acepta
    // como si se rechaza — ya no hay nada más que decidir sobre ella.
    setNotificaciones((prev) => prev.filter((n) => n.id !== notiId));

    try {
      await fetch(`http://localhost:3001/follow-requests/${actorId}/${accion}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // si falla, no revertimos — el usuario puede volver a intentarlo
      // desde /perfil/friends si hace falta; no merece la pena la
      // complejidad de restaurar el estado exacto aquí.
    }
  };

  function hrefNotificacion(n: any) {
    if (n.tipo === 'FOLLOW') return `/user/${n.actor?.username}`;
    if (n.tipo === 'LIST_LIKE') return `/user/${n.actor?.username}`; // la lista es TUYA, no de él — no hay ficha propia a la que enlazar de forma más específica todavía
    return '#';
  }

  function formatFechaNoti(fecha: string) {
    const diffMs = Date.now() - new Date(fecha).getTime();
    const minutos = Math.floor(diffMs / 60000);
    if (minutos < 1) return 'now';
    if (minutos < 60) return `${minutos}m`;
    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `${horas}h`;
    const dias = Math.floor(horas / 24);
    return `${dias}d`;
  }

  useEffect(() => {
    cargarUsuario();
    cargarContadorNoLeidas();
    // Se actualiza cuando login/register/logout avisan del cambio
    window.addEventListener('authchange', cargarUsuario);
    window.addEventListener('authchange', cargarContadorNoLeidas);
    return () => {
      window.removeEventListener('authchange', cargarUsuario);
      window.removeEventListener('authchange', cargarContadorNoLeidas);
    };
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery)}`);
      setIsSearchOpen(false);
      setSearchQuery('');
    }
  };

  const handleSignOut = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.dispatchEvent(new Event('authchange'));
    setIsProfileOpen(false);
    router.push('/');
  };

  // Cierra el desplegable si se hace clic fuera de él
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
      if (notisRef.current && !notisRef.current.contains(event.target as Node)) {
        setPanelNotisAbierto(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const menuLinks = [
    { label: 'Home', href: '/' },
    { label: 'Profile', href: '/perfil' },
    { label: 'Films', href: '/perfil/movies' },
    { label: 'Watchlist', href: '/perfil/watchlist' },
    { label: 'Lists', href: '/perfil/lists' },
    { label: 'Likes', href: '/perfil/likes' },
    { label: 'Friends', href: '/perfil/friends' },
  ];

  return (
    <nav className="bg-[#14181c] text-gray-300 font-sans border-b border-gray-800 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">

          {/* LOGO */}
          <div className="flex-shrink-0 flex items-center">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex gap-1">
                <span className="w-3 h-3 rounded-full bg-orange-500"></span>
                <span className="w-3 h-3 rounded-full bg-green-500"></span>
                <span className="w-3 h-3 rounded-full bg-blue-500"></span>
              </div>
              <span className="font-extrabold text-white text-xl tracking-tight hover:text-gray-300 transition">
                MediaTracker
              </span>
            </Link>
          </div>

          {/* ENLACES Y BUSCADOR */}
          <div className="flex items-center gap-6">
            {!isSearchOpen ? (
              <>
                <div
                  className="relative group"
                  onMouseEnter={() => setPeliculasOpen(true)}
                  onMouseLeave={() => setPeliculasOpen(false)}
                >
                  <Link href="/movie" className="text-sm font-semibold hover:text-white uppercase tracking-wider transition">
                    Movies
                  </Link>
                  {peliculasOpen && (
                    <div className="absolute left-0 top-full pt-2 w-40 z-50">
                      <div className="bg-[#2c3440] rounded-md shadow-2xl border border-gray-700 py-2">
                        <Link href="/perfil/movies" className="block px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition">Films</Link>
                        <Link href="/perfil/watchlist" className="block px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition">Watchlist</Link>
                        <Link href="/perfil/likes" className="block px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition">Likes</Link>
                      </div>
                    </div>
                  )}
                </div>
                <div
                  className="relative group"
                  onMouseEnter={() => setSeriesOpen(true)}
                  onMouseLeave={() => setSeriesOpen(false)}
                >
                  <Link href="/series" className="text-sm font-semibold hover:text-white uppercase tracking-wider transition">
                    Series
                  </Link>
                  {seriesOpen && (
                    <div className="absolute left-0 top-full pt-2 w-40 z-50">
                      <div className="bg-[#2c3440] rounded-md shadow-2xl border border-gray-700 py-2">
                        <Link href="/perfil/series" className="block px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition">Watched</Link>
                        <Link href="/perfil/watchlist" className="block px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition">Watchlist</Link>
                        <Link href="/perfil/likes" className="block px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition">Likes</Link>
                      </div>
                    </div>
                  )}
                </div>
                <Link href="/books" className="text-sm font-semibold hover:text-white uppercase tracking-wider transition">Books</Link>
                <div
                  className="relative group"
                  onMouseEnter={() => setJuegosOpen(true)}
                  onMouseLeave={() => setJuegosOpen(false)}
                >
                  <Link href="/game" className="text-sm font-semibold hover:text-white uppercase tracking-wider transition">
                    Games
                  </Link>
                  {juegosOpen && (
                    <div className="absolute left-0 top-full pt-2 w-40 z-50">
                      <div className="bg-[#2c3440] rounded-md shadow-2xl border border-gray-700 py-2">
                        <Link href="/perfil/games" className="block px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition">Played</Link>
                        <Link href="/perfil/watchlist" className="block px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition">Watchlist</Link>
                        <Link href="/perfil/likes" className="block px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition">Likes</Link>
                      </div>
                    </div>
                  )}
                </div>

                {/* LUPA */}
                <button
                  onClick={() => setIsSearchOpen(true)}
                  className="text-gray-400 hover:text-white transition"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
              </>
            ) : (
              <form onSubmit={handleSearch} className="flex items-center w-full max-w-md animate-fade-in">
                <button
                  type="button"
                  onClick={() => setIsSearchOpen(false)}
                  className="text-gray-400 hover:text-white mr-2"
                >
                  ✕
                </button>
                <div className="relative w-full">
                  <input
                    type="text"
                    autoFocus
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search for a movie, series..."
                    className="w-full bg-[#2c3440] text-white text-sm rounded-full pl-4 pr-10 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  />
                  <button type="submit" className="absolute right-3 top-1.5 text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </button>
                </div>
              </form>
            )}

            {/* CAMPANA DE NOTIFICACIONES */}
            {user && !isSearchOpen && (
              <div className="relative" ref={notisRef}>
                <button
                  onClick={abrirPanelNotis}
                  className="relative text-gray-400 hover:text-white transition cursor-pointer"
                  aria-label="Notifications"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {noLeidas > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                      {noLeidas > 9 ? '9+' : noLeidas}
                    </span>
                  )}
                </button>

                {panelNotisAbierto && (
                  <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto bg-[#2c3440] rounded-md shadow-2xl border border-gray-700 py-2 z-50">
                    {notificaciones.length === 0 ? (
                      <p className="text-gray-400 text-sm text-center py-6">No notifications yet.</p>
                    ) : (
                      notificaciones.map((n) => (
                        <Link
                          key={n.id}
                          href={hrefNotificacion(n)}
                          onClick={() => setPanelNotisAbierto(false)}
                          className={`flex items-start gap-3 px-4 py-2.5 text-sm hover:bg-gray-700 transition ${!n.leida ? 'bg-blue-900/20' : ''}`}
                        >
                          <div className="w-8 h-8 rounded-full overflow-hidden bg-blue-600 flex-shrink-0">
                            <img
                              src={n.actor?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${n.actor?.username || '?'}`}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="flex-grow min-w-0">
                            <p className="text-gray-200 leading-snug">
                              <span className="font-bold text-white">{n.actor?.username || 'Someone'}</span>{' '}
                              {textoNotificacion(n)}
                            </p>
                            <p className="text-gray-500 text-xs mt-0.5">{formatFechaNoti(n.fecha)}</p>

                            {n.tipo === 'FOLLOW_REQUEST' && n.actor && (
                              <div className="flex gap-2 mt-2">
                                <button
                                  onClick={(e) => responderSolicitud(e, n.actor.id, 'accept', n.id)}
                                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded transition cursor-pointer"
                                >
                                  Accept
                                </button>
                                <button
                                  onClick={(e) => responderSolicitud(e, n.actor.id, 'decline', n.id)}
                                  className="bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-bold px-3 py-1 rounded transition cursor-pointer"
                                >
                                  Decline
                                </button>
                              </div>
                            )}
                          </div>
                        </Link>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ZONA DE SESIÓN */}
            {user ? (
              /* CON SESIÓN: AVATAR + NOMBRE + DESPLEGABLE */
              <div className="relative border-l border-gray-700 pl-6 ml-2" ref={profileRef}>
                <div
                  onClick={() => setIsProfileOpen(!isProfileOpen)}
                  className="flex items-center gap-2 cursor-pointer group"
                >
                  <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white uppercase overflow-hidden">
                    <img src={(user as any).avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`} alt="Avatar" className="w-full h-full object-cover" />
                  </div>
                  <span className="text-sm font-bold uppercase tracking-wider group-hover:text-white transition">{user.username}</span>
                  <span className={`text-xs transition-transform ${isProfileOpen ? 'rotate-180' : ''}`}>▼</span>
                </div>

                {isProfileOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-[#2c3440] rounded-md shadow-2xl border border-gray-700 py-2 z-50">
                    {menuLinks.map((link) => (
                      <Link
                        key={link.label}
                        href={link.href}
                        onClick={() => setIsProfileOpen(false)}
                        className="block px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition"
                      >
                        {link.label}
                      </Link>
                    ))}
                    <div className="border-t border-gray-700 my-2"></div>
                    <Link
                      href="/perfil/settings"
                      onClick={() => setIsProfileOpen(false)}
                      className="block px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition"
                    >
                      Settings
                    </Link>
                    <button
                      onClick={handleSignOut}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                    >
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* SIN SESIÓN: BOTONES DE ACCESO */
              <div className="flex items-center gap-4 border-l border-gray-700 pl-6 ml-2">
                <Link href="/login" className="text-sm font-semibold text-gray-300 hover:text-white uppercase tracking-wider transition">
                  Sign In
                </Link>
                <Link href="/register" className="text-sm font-semibold text-gray-300 hover:text-white uppercase tracking-wider transition">
                  Create Account
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}