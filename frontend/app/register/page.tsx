'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function Register() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('http://localhost:3001/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Error al registrarse');
        setLoading(false);
        return;
      }

      // Registro correcto: ahora iniciamos sesión automáticamente
      const loginRes = await fetch('http://localhost:3001/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const loginData = await loginRes.json();

      if (loginRes.ok) {
        localStorage.setItem('token', loginData.token);
        localStorage.setItem('user', JSON.stringify(loginData.user));
        window.dispatchEvent(new Event('authchange'));
        router.push('/');
      } else {
        router.push('/login');
      }
    } catch (err) {
      setError('No se pudo conectar con el servidor');
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-extrabold text-center mb-8">Crear cuenta</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-900/40 border border-red-700 text-red-300 text-sm rounded px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
              Nombre de usuario
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
              Contraseña
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
            <p className="text-xs text-gray-500 mt-1">Mínimo 6 caracteres</p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-2 rounded text-sm transition cursor-pointer"
          >
            {loading ? 'Creando cuenta...' : 'Crear cuenta'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-400 mt-6">
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="text-blue-400 hover:underline">
            Inicia sesión
          </Link>
        </p>
      </div>
    </main>
  );
}