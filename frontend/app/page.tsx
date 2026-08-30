'use client';
import NewFromFriendsCarousel from '@/components/NewFromFriendsCarousel';

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-white p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        <NewFromFriendsCarousel />
      </div>
    </main>
  );
}