import { Icon } from "@iconify/react";

export function Stack() {
  return (
    <div className="min-h-screen bg-background text-foreground pb-36">
      <header className="px-5 pt-12 pb-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-1">
          Night Bloom Radio
        </div>
        <h1 className="font-heading text-3xl tracking-[-0.03em]">Library</h1>
      </header>
      <main className="px-5">
        <div className="grid grid-cols-2 p-1 bg-secondary rounded-[0.875rem] border border-border mb-6">
          <button className="py-2 text-xs font-bold bg-primary text-primary-foreground rounded-[0.625rem]">
            Station Stack
          </button>
          <button className="py-2 text-xs font-medium text-muted-foreground">My Stash (8)</button>
        </div>
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading text-base">Projects & Releases</h2>
            <span className="text-xs text-muted-foreground">3 Collections</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[0.875rem] border border-border bg-card p-3">
              <div className="aspect-square rounded-lg bg-[#251D2A] flex items-center justify-center mb-2 text-primary">
                <Icon icon="solar:album-bold" className="size-8" />
              </div>
              <div className="font-semibold text-xs truncate">Field Recordings</div>
              <div className="text-[11px] text-muted-foreground">4 tracks · Supporter Tier</div>
            </div>
            <div className="rounded-[0.875rem] border border-border bg-card p-3">
              <div className="aspect-square rounded-lg bg-[#1B2421] flex items-center justify-center mb-2 text-accent">
                <Icon icon="solar:music-note-2-bold" className="size-8" />
              </div>
              <div className="font-semibold text-xs truncate">Studio Jam Session</div>
              <div className="text-[11px] text-muted-foreground">2 tracks · Free</div>
            </div>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading text-base">On-Demand Tracks</h2>
            <span className="text-xs text-muted-foreground">Station Catalog</span>
          </div>
          <div className="space-y-2">
            <div className="rounded-[0.875rem] border border-border bg-card p-3.5 flex items-center gap-3">
              <button
                aria-label="Play track"
                className="size-9 rounded-full bg-secondary flex items-center justify-center text-foreground"
              >
                <Icon icon="solar:play-bold" className="size-4" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-xs truncate">Midnight Transmission #09</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">38:10 · 320kbps MP3</div>
              </div>
              <button
                aria-label="Download for offline"
                className="size-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground"
              >
                <Icon icon="solar:download-minimalistic-linear" className="size-4" />
              </button>
            </div>
            <div className="rounded-[0.875rem] border border-border bg-card p-3.5 flex items-center gap-3">
              <button
                aria-label="Play track"
                className="size-9 rounded-full bg-secondary flex items-center justify-center text-foreground"
              >
                <Icon icon="solar:play-bold" className="size-4" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-xs truncate">Acoustic Modular Set</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">14:22 · Stream only</div>
              </div>
              <button
                disabled
                aria-label="Offline disabled by creator"
                className="size-8 rounded-full bg-secondary/50 flex items-center justify-center text-muted-foreground/30"
              >
                <Icon icon="solar:lock-linear" className="size-4" />
              </button>
            </div>
          </div>
        </div>
        <div className="mt-6 rounded-[0.875rem] border border-border bg-card p-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold">Local Stash Storage</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">312 MB used of 8 tracks</div>
          </div>
          <button className="text-xs font-semibold text-destructive">Clear</button>
        </div>
      </main>
      <aside className="fixed bottom-[65px] left-3 right-3 z-30 rounded-[0.875rem] border border-border bg-card/95 backdrop-blur-md p-2.5 flex items-center gap-3 shadow-xl">
        <div className="size-9 rounded-lg bg-[#271632] flex items-center justify-center text-primary">
          <Icon icon="solar:radio-bold" className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-xs truncate">Signals from the Conservatory</div>
          <div className="text-[10px] text-accent flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-accent animate-pulse" />
            Live Broadcast
          </div>
        </div>
        <button
          aria-label="Pause"
          className="size-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center"
        >
          <Icon icon="solar:pause-bold" className="size-4" />
        </button>
      </aside>
      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-background/95 backdrop-blur-xl px-3 pt-2 pb-5 flex">
        <a className="flex-1 flex flex-col items-center gap-1 text-muted-foreground" href="#">
          <Icon icon="solar:compass-linear" className="size-5" />
          <span className="text-[10px]">Discover</span>
        </a>
        <a className="flex-1 flex flex-col items-center gap-1 text-muted-foreground" href="#">
          <Icon icon="solar:play-circle-linear" className="size-5" />
          <span className="text-[10px]">Play</span>
        </a>
        <a className="flex-1 flex flex-col items-center gap-1 text-primary" href="#">
          <Icon icon="solar:layers-bold" className="size-5" />
          <span className="text-[10px] font-bold">Stack</span>
        </a>
        <a className="flex-1 flex flex-col items-center gap-1 text-muted-foreground" href="#">
          <Icon icon="solar:tuning-2-linear" className="size-5" />
          <span className="text-[10px]">Studio</span>
        </a>
      </nav>
    </div>
  );
}
