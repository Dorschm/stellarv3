/**
 * Main layout wrapper — provides responsive container sizing and scroll behavior.
 */
export function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative [.in-game_&]:hidden flex flex-col flex-1 overflow-hidden w-full px-0 lg:px-[clamp(1.5rem,3vw,3rem)] pt-0 lg:pt-[clamp(0.75rem,1.5vw,1.5rem)] pb-0 lg:pb-[clamp(0.375rem,0.75vw,0.75rem)]">
      <div className="w-full lg:max-w-[20cm] 2xl:max-w-[24cm] mx-auto flex flex-col flex-1 gap-0 lg:gap-[clamp(1.5rem,3vw,3rem)] overflow-y-auto overflow-x-hidden sm:px-4 lg:px-0">
        {children}
      </div>
    </main>
  );
}
