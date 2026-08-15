'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('http://localhost:3001/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Error al iniciar sesión');
        setLoading(false);
        return;
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      window.dispatchEvent(new Event('authchange'));
      router.push('/');
      router.refresh();
    } catch (err) {
      setError('No se pudo conectar con el servidor');
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-extrabold text-center mb-8">Iniciar sesión</h1>

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
              Contraseña
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-2 rounded text-sm transition cursor-pointer"
          >
            {loading ? 'Entrando...' : 'Iniciar sesión'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-400 mt-6">
          ¿No tienes cuenta?{' '}
          <Link href="/register" className="text-blue-400 hover:underline">
            Regístrate
          </Link>
        </p>
      </div>
    </main>
  );
}