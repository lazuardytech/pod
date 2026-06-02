export const metadata = {
  title: "Offline | Pod",
};

export default function OfflinePage() {
  return (
    <main className="min-h-screen bg-pitch-black text-porcelain flex items-center justify-center px-6">
      <section className="w-full max-w-md rounded-lg border border-white/10 bg-white/5 p-6">
        <h1 className="text-xl font-semibold">You are offline</h1>
        <p className="mt-2 text-sm text-slate-300">
          Pod cannot reach the server right now. Reconnect to continue syncing data and running API actions.
        </p>
      </section>
    </main>
  );
}
