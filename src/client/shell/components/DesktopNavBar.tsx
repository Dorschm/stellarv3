import { useEffect, useState } from "react";
import { UserMeResponse } from "../../../core/ApiSchemas";
import { getDiscordAvatarUrl, translateText } from "../../Utils";
import { useNavigation, type PageId } from "../contexts/NavigationContext";
import { useNotifications } from "../hooks/useNotifications";
import { NotificationDot } from "./NotificationDot";
import { StellarGameLogo } from "./StellarGameLogo";

function NavButton({
  pageId,
  i18nKey,
  isActive,
  onClick,
  children,
}: {
  pageId: PageId;
  i18nKey: string;
  isActive: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const { showPage } = useNavigation();

  return (
    <div className="relative">
      <button
        className={`nav-menu-item ${
          isActive ? "active" : ""
        } text-white/70 hover:text-cyan-400 font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-cyan-400`}
        data-page={pageId}
        data-i18n={i18nKey}
        onClick={() => {
          onClick?.();
          showPage(pageId);
        }}
      />
      {children}
    </div>
  );
}

export function DesktopNavBar() {
  const { currentPage, showPage } = useNavigation();
  const notifications = useNotifications();
  const [userMe, setUserMe] = useState<UserMeResponse | false>(false);

  useEffect(() => {
    const handler = (e: Event) => {
      setUserMe((e as CustomEvent).detail);
    };
    document.addEventListener("userMeResponse", handler);
    return () => document.removeEventListener("userMeResponse", handler);
  }, []);

  const discord = userMe !== false ? userMe.user.discord : undefined;
  const email = userMe !== false ? userMe.user.email : undefined;
  const avatarUrl = discord ? getDiscordAvatarUrl(discord) : null;

  return (
    <nav className="hidden lg:flex w-full bg-[#050a18]/95 backdrop-blur-md items-center justify-center gap-8 py-4 shrink-0 z-50 relative border-b border-cyan-400/10">
      <div className="flex flex-col items-center justify-center">
        <div className="h-8 text-cyan-400">
          <StellarGameLogo className="h-full w-auto drop-shadow-[0_0_12px_rgba(34,211,238,0.3)]" />
        </div>
        <div className="l-header__highlightText text-center game-version-display" />
      </div>

      <button
        className={`nav-menu-item ${
          currentPage === "page-play" ? "active" : ""
        } text-white/70 hover:text-cyan-400 font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-cyan-400`}
        data-page="page-play"
        data-i18n="main.play"
        onClick={() => showPage("page-play")}
      />

      <NavButton
        pageId="page-news"
        i18nKey="main.news"
        isActive={currentPage === "page-news"}
        onClick={notifications.onNewsClick}
      >
        {notifications.showNewsDot && (
          <NotificationDot color="red" position="absolute" />
        )}
      </NavButton>

      <NavButton
        pageId="page-item-store"
        i18nKey="main.store"
        isActive={currentPage === "page-item-store"}
        onClick={notifications.onStoreClick}
      >
        {notifications.showStoreDot && (
          <NotificationDot color="red" position="absolute" />
        )}
      </NavButton>

      <button
        className="nav-menu-item text-white/70 hover:text-cyan-400 font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-cyan-400"
        data-page="page-settings"
        data-i18n="main.settings"
        onClick={() => showPage("page-settings")}
      />

      <button
        className="nav-menu-item text-white/70 hover:text-cyan-400 font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-cyan-400"
        data-page="page-leaderboard"
        data-i18n="main.leaderboard"
        onClick={() => showPage("page-leaderboard")}
      />

      <NavButton
        pageId="page-help"
        i18nKey="main.help"
        isActive={currentPage === "page-help"}
        onClick={notifications.onHelpClick}
      >
        {notifications.showHelpDot && (
          <NotificationDot color="yellow" position="absolute" />
        )}
      </NavButton>

      <button
        id="nav-account-button"
        className={`no-crazygames nav-menu-item relative h-10 rounded-full overflow-hidden flex items-center justify-center gap-2 px-3 bg-transparent ${
          !avatarUrl ? "border border-white/20" : ""
        } text-white/80 hover:text-white cursor-pointer transition-colors [&.active]:text-white`}
        data-page="page-account"
        data-i18n-aria-label="main.account"
        data-i18n-title="main.account"
        onClick={() => showPage("page-account")}
      >
        {avatarUrl ? (
          <img
            id="nav-account-avatar"
            className="w-8 h-8 rounded-full object-cover"
            src={avatarUrl}
            alt={
              discord
                ? translateText("main.user_avatar_alt", {
                    username: discord.username,
                  })
                : ""
            }
            referrerPolicy="no-referrer"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                "https://cdn.discordapp.com/embed/avatars/0.png";
            }}
          />
        ) : (
          <svg
            id="nav-account-person-icon"
            className="w-5 h-5"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 21a8 8 0 0 0-16 0" />
            <path d="M12 13a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
          </svg>
        )}
        {email && !avatarUrl && (
          <span
            id="nav-account-email-badge"
            className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-slate-900/80 border border-white/20 flex items-center justify-center"
            aria-hidden="true"
          >
            <svg
              className="w-2.5 h-2.5 text-white/80"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 4h16v16H4z" opacity="0" />
              <path d="M4 6h16v12H4z" />
              <path d="m4 7 8 6 8-6" />
            </svg>
          </span>
        )}
        {!avatarUrl && !email && (
          <span
            id="nav-account-signin-text"
            className="text-xs font-bold tracking-widest"
            data-i18n="main.sign_in"
          />
        )}
      </button>
    </nav>
  );
}
