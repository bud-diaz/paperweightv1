import { Icon } from "@iconify/react";

export function Play() {
  return (
    <div className="min-h-screen bg-background text-foreground pb-28">
      <header className="px-5 pt-12 pb-4 flex items-center justify-between">
        <button
          aria-label="Collapse player"
          className="size-9 rounded-full bg-secondary border border-border flex items-center justify-center"
        >
          <Icon icon="solar:alt-arrow-down-linear" className="size-5" />
        </button>
        <div className="text-center">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent flex items-center justify-center gap-1.5">
            <span className="size-2 rounded-full bg-accent animate-pulse" />
            Live Broadcast
          </span>
          <div className="text-xs text-muted-foreground mt-0.5">Night Bloom Radio</div>
        </div>
        <button
          aria-label="More options"
          className="size-9 rounded-full bg-secondary border border-border flex items-center justify-center"
        >
          <Icon icon="solar:menu-dots-bold" className="size-5 text-muted-foreground" />
        </button>
      </header>
      <main className="px-5">
        <div className="aspect-square w-full rounded-[0.875rem] overflow-hidden border border-border shadow-2xl relative mb-6">
          <img
            src="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/y508u7uU4yR/components/4uLkZ3P9QQP.jpeg"
            alt="Current broadcast artwork"
            className="size-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
        </div>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="font-heading text-2xl tracking-[-0.03em] leading-tight">
              Signals from the Conservatory
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Mira Vale · Live Stream</p>
          </div>
          <button
            aria-label="Bookmark track"
            className="size-10 rounded-full bg-secondary border border-border flex items-center justify-center mt-1"
          >
            <Icon icon="solar:bookmark-linear" className="size-5" />
          </button>
        </div>
        <div className="rounded-[0.875rem] border border-border bg-card p-4 mb-6">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-2">
            <span>LIVE LEVEL METER</span>
            <span>-6 dBFS</span>
          </div>
          <div className="flex items-end gap-1.5 h-10 w-full">
            <div className="flex-1 bg-accent/30 rounded-t h-[40%]" />
            <div className="flex-1 bg-accent/40 rounded-t h-[65%]" />
            <div className="flex-1 bg-accent/60 rounded-t h-[80%]" />
            <div className="flex-1 bg-accent rounded-t h-[95%]" />
            <div className="flex-1 bg-accent rounded-t h-[85%]" />
            <div className="flex-1 bg-accent/70 rounded-t h-[70%]" />
            <div className="flex-1 bg-accent/40 rounded-t h-[50%]" />
            <div className="flex-1 bg-accent/20 rounded-t h-[30%]" />
          </div>
        </div>
        <div className="flex items-center justify-center gap-6 mb-7">
          <button
            aria-label="Rewind 15 seconds"
            className="size-11 rounded-full bg-secondary flex items-center justify-center text-muted-foreground"
          >
            <Icon icon="solar:restart-square-linear" className="size-5" />
          </button>
          <button
            aria-label="Pause live stream"
            className="size-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-[0_0_20px] shadow-primary/30"
          >
            <Icon icon="solar:pause-bold" className="size-7" />
          </button>
          <button
            aria-label="Forward 15 seconds"
            className="size-11 rounded-full bg-secondary flex items-center justify-center text-muted-foreground"
          >
            <Icon icon="solar:rewind-15-seconds-forward-linear" className="size-5" />
          </button>
        </div>
        <div className="rounded-[0.875rem] border border-border bg-card p-4">
          <h2 className="font-heading text-sm mb-3">Recently Played</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs pb-2 border-b border-border/50">
              <div>
                <div className="font-medium">Glass Pavilion</div>
                <div className="text-[11px] text-muted-foreground">Mira Vale · 12m ago</div>
              </div>
              <span className="text-[11px] text-muted-foreground">04:12</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <div>
                <div className="font-medium">Nocturne 03</div>
                <div className="text-[11px] text-muted-foreground">K. Tanaka · 18m ago</div>
              </div>
              <span className="text-[11px] text-muted-foreground">05:40</span>
            </div>
          </div>
        </div>
      </main>
      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-background/95 backdrop-blur-xl px-3 pt-2 pb-5 flex">
        <a className="flex-1 flex flex-col items-center gap-1 text-muted-foreground" href="#">
          <Icon icon="solar:compass-linear" className="size-5" />
          <span className="text-[10px]">Discover</span>
        </a>
        <a className="flex-1 flex flex-col items-center gap-1 text-primary" href="#">
          <Icon icon="solar:play-circle-bold" className="size-5" />
          <span className="text-[10px] font-bold">Play</span>
        </a>
        <a className="flex-1 flex flex-col items-center gap-1 text-muted-foreground" href="#">
          <Icon icon="solar:layers-linear" className="size-5" />
          <span className="text-[10px]">Stack</span>
        </a>
        <a className="flex-1 flex flex-col items-center gap-1 text-muted-foreground" href="#">
          <Icon icon="solar:tuning-2-linear" className="size-5" />
          <span className="text-[10px]">Studio</span>
        </a>
      </nav>
    </div>
  );
}
