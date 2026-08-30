import { Icon } from "@iconify/react";

export function Discover() {
  return (
    <div className="min-h-screen bg-background text-foreground pb-28">
      <header className="px-5 pt-12 pb-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="size-2 rounded-full bg-accent shadow-[0_0_12px] shadow-accent" />
            <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
              Paperweight / Play
            </span>
          </div>
          <h1 className="font-heading text-[32px] leading-none tracking-[-0.04em]">Discover</h1>
        </div>
        <div className="flex gap-2">
          <button
            aria-label="Account settings"
            className="size-10 rounded-full bg-secondary border border-border flex items-center justify-center"
          >
            <Icon icon="solar:user-circle-linear" className="size-5 text-muted-foreground" />
          </button>
          <button
            aria-label="App settings"
            className="size-10 rounded-full bg-secondary border border-border flex items-center justify-center"
          >
            <Icon icon="solar:settings-linear" className="size-5 text-muted-foreground" />
          </button>
        </div>
      </header>
      <main className="px-5">
        <section className="rounded-[0.875rem] border border-primary/40 bg-primary/10 p-4 mb-5 relative overflow-hidden">
          <div className="absolute -right-8 -top-8 size-28 rounded-full bg-primary/15 blur-2xl" />
          <div className="flex items-center justify-between relative">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary mb-1">
                Tuned in now
              </div>
              <div className="font-heading text-lg truncate">Night Bloom Radio</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="size-1.5 rounded-full bg-accent" />
                <span className="text-xs text-muted-foreground">Live · 128 listeners</span>
              </div>
            </div>
            <button className="shrink-0 ml-3 rounded-full border border-primary/50 px-3.5 py-2 text-xs font-bold text-primary">
              Log in
            </button>
          </div>
        </section>
        <div className="relative mb-7">
          <Icon
            icon="solar:magnifer-linear"
            className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-muted-foreground"
          />
          <input
            aria-label="Search stations"
            placeholder="Search stations"
            className="w-full h-12 rounded-[0.875rem] border border-border bg-input pl-12 pr-12 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring"
          />
          <button
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 size-8 rounded-full flex items-center justify-center"
          >
            <Icon icon="solar:close-circle-linear" className="size-5 text-muted-foreground" />
          </button>
        </div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading text-lg tracking-[-0.02em]">Directory</h2>
          <span className="text-xs text-muted-foreground">12 stations</span>
        </div>
        <div className="space-y-2">
          <button className="w-full text-left rounded-[0.875rem] border border-primary/50 bg-primary/10 p-4 flex items-center gap-3">
            <div className="size-11 shrink-0 rounded-xl bg-gradient-to-br from-primary via-[#9B245C] to-[#271632] flex items-center justify-center">
              <Icon icon="solar:radio-bold" className="size-5 text-primary-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm truncate">Night Bloom Radio</span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-accent">
                  Live
                </span>
              </div>
              <div className="text-xs text-muted-foreground truncate mt-1">
                Mira Vale · After Hours FM
              </div>
              <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                <Icon icon="solar:headphones-round-linear" className="size-3.5" />
                128 listening
              </div>
            </div>
            <Icon icon="solar:check-circle-bold" className="size-5 text-primary" />
          </button>
          <button className="w-full text-left rounded-[0.875rem] border border-border bg-card p-4 flex items-center gap-3">
            <div className="size-11 shrink-0 rounded-xl bg-secondary flex items-center justify-center">
              <span className="font-heading text-lg text-[#A47CFF]">FM</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm">Faint Memory</div>
              <div className="text-xs text-muted-foreground mt-1">Off air</div>
              <div className="text-[11px] text-muted-foreground mt-1">0 listeners</div>
            </div>
            <Icon icon="solar:alt-arrow-right-linear" className="size-5 text-muted-foreground" />
          </button>
          <button className="w-full text-left rounded-[0.875rem] border border-border bg-card p-4 flex items-center gap-3">
            <div className="size-11 shrink-0 rounded-xl bg-[#172B27] flex items-center justify-center">
              <Icon icon="mdi:wave" className="size-6 text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">Lowlight FM</span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-accent">
                  Live
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1 truncate">
                Soft focus selections
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">42 listeners</div>
            </div>
            <Icon icon="solar:alt-arrow-right-linear" className="size-5 text-muted-foreground" />
          </button>
        </div>
        <div className="mt-6 rounded-[0.875rem] border border-border border-dashed p-5 text-center">
          <Icon icon="solar:satellite-linear" className="size-6 text-muted-foreground mb-2" />
          <p className="text-sm font-medium">Stations come and go</p>
          <p className="text-xs text-muted-foreground mt-1">
            Creators opt in to the directory. Pull to refresh or search for a station.
          </p>
        </div>
      </main>
      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-background/95 backdrop-blur-xl px-3 pt-2 pb-5 flex">
        <a className="flex-1 flex flex-col items-center gap-1 text-primary" href="#">
          <Icon icon="solar:compass-bold" className="size-5" />
          <span className="text-[10px] font-bold">Discover</span>
        </a>
        <a className="flex-1 flex flex-col items-center gap-1 text-muted-foreground" href="#">
          <Icon icon="solar:play-circle-linear" className="size-5" />
          <span className="text-[10px]">Play</span>
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
