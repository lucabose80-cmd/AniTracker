export default function OfflineFallback() {
  return (
    <div className="flex h-screen flex-col items-center justify-center p-4 text-center bg-[#0f1115] text-white">
      <div className="text-6xl mb-4">??</div>
      <h1 className="text-2xl font-bold mb-2">Du bist offline!</h1>
      <p className="text-gray-400 mb-6">
        Diese Seite ist leider nicht im Offline-Speicher (Cache) verf&uuml;gbar.
      </p>
      <button 
        onClick={() => window.history.back()} 
        className="px-6 py-3 bg-blue-600 rounded-xl font-bold transition hover:bg-blue-700"
      >
        Zur&uuml;ck zur App
      </button>
    </div>
  );
}
