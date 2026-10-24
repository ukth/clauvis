// Shown instantly on tab switches while the server renders the next screen
export default function LedgerTabLoading() {
  return (
    <main aria-busy="true" aria-label="불러오는 중" className="flex animate-pulse flex-col gap-6 px-5 pt-[max(24px,env(safe-area-inset-top))]">
      <div className="h-7 w-32 rounded-lg bg-[#121A30]" />
      <div className="flex flex-col gap-2">
        <div className="h-4 w-20 rounded bg-[#121A30]" />
        <div className="h-10 w-48 rounded-lg bg-[#121A30]" />
      </div>
      <div className="h-44 rounded-[20px] bg-[#121A30]" />
      <div className="h-32 rounded-[20px] bg-[#121A30]" />
      <div className="h-24 rounded-[20px] bg-[#121A30]" />
    </main>
  );
}
