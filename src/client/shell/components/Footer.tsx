export function Footer() {
  return (
    <footer className="[.in-game_&]:hidden bg-[#050a18]/95 backdrop-blur-md flex flex-col items-center justify-center gap-1 pt-1 pb-3 text-white/50 w-full border-t border-cyan-400/10 shrink-0 relative z-50">
      {/*
        The four social links (github.com/openfrontio/OpenFrontIO,
        reddit.com/r/OpenFront, discord.gg/openfront, openfront.wiki)
        were removed at the user's request — they point to the
        upstream OpenFrontIO communities, not the stellar.game
        deployment, and were misleading for players landing here.
        The lang-selector that previously sat absolutely-positioned
        inside this row is kept and rendered standalone so locale
        switching still works on the lobby page.
      */}
      <div className="flex items-center justify-end w-full pt-2 pr-4 relative">
        <lang-selector />
      </div>
      <div className="text-xs mt-1 lg:mt-2 flex items-center justify-center gap-4 px-4">
        <a
          href="/terms-of-service.html"
          data-i18n="main.terms_of_service"
          target="_blank"
          className="hover:text-white transition-colors"
        />
        <span data-i18n="main.copyright" />
        <a
          href="/privacy-policy.html"
          data-i18n="main.privacy_policy"
          target="_blank"
          className="hover:text-white transition-colors"
        />
      </div>
    </footer>
  );
}
