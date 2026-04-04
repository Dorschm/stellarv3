import { useCallback, useState } from "react";
import type { UserMeResponse } from "../../../core/ApiSchemas";
import { fetchPlayerById, getUserMe } from "../../Api";
import { discordLogin, logOut, sendMagicLink, userAuth } from "../../Auth";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { getDiscordAvatarUrl, translateText } from "../../Utils";
import { LoadingSpinner, ModalContainer, ModalPage } from "../components/ModalPage";
import { useNavigation } from "../contexts/NavigationContext";

export function AccountModal() {
  const { showPage } = useNavigation();
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [userMe, setUserMe] = useState<UserMeResponse | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const onOpen = useCallback(async () => {
    setIsLoading(true);
    try {
      if ((await userAuth()) === false) {
        setIsLoggedIn(false);
        setUserMe(null);
        setIsLoading(false);
        return;
      }
      const response = await getUserMe();
      if (response) {
        setUserMe(response);
        setIsLoggedIn(true);
      } else {
        setIsLoggedIn(false);
      }
    } catch {
      setIsLoggedIn(false);
    }
    setIsLoading(false);
  }, []);

  const handleDiscordLogin = useCallback(() => {
    discordLogin();
  }, []);

  const handleEmailSubmit = useCallback(async () => {
    if (!email.trim()) return;
    const success = await sendMagicLink(email.trim());
    if (success) {
      alert(translateText("account_modal.magic_link_sent"));
    } else {
      alert(translateText("account_modal.magic_link_failed"));
    }
  }, [email]);

  const handleLogout = useCallback(async () => {
    await logOut();
    window.location.reload();
  }, []);

  const handleCopyId = useCallback(() => {
    if (userMe?.player?.publicId) {
      navigator.clipboard.writeText(userMe.player.publicId);
      window.dispatchEvent(new CustomEvent("show-message", {
        detail: { message: "Player ID copied!", color: "green", duration: 2000 },
      }));
    }
  }, [userMe]);

  const discord = userMe?.user?.discord;
  const avatarUrl = discord ? getDiscordAvatarUrl(discord) : null;

  return (
    <ModalPage pageId="page-account" onOpen={onOpen}>
      <ModalContainer>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <button onClick={() => showPage("page-play")} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <h2 className="text-lg font-bold text-white uppercase tracking-widest">{translateText("main.account")}</h2>
          {userMe?.player?.publicId && (
            <button onClick={handleCopyId} className="ml-auto text-xs text-white/40 hover:text-white/70 transition-colors" title="Copy Player ID">
              ID: {userMe.player.publicId.slice(0, 8)}...
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {isLoading ? (
            <LoadingSpinner message="Loading account..." />
          ) : isLoggedIn && userMe ? (
            <div className="flex flex-col gap-6">
              {/* User info */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Avatar" className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 21a8 8 0 0 0-16 0" /><path d="M12 13a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" /></svg>
                  </div>
                )}
                <div>
                  <p className="text-white font-bold">{discord?.username ?? userMe.user.email ?? "Player"}</p>
                  <p className="text-white/50 text-sm">
                    {discord ? "Discord" : "Email"} account
                  </p>
                </div>
              </div>

              {/* Stats summary */}
              {userMe.player?.leaderboard && (
                <div className="grid grid-cols-2 gap-3">
                  {userMe.player.leaderboard.oneVone?.elo && (
                    <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                      <p className="text-white/50 text-xs uppercase tracking-wider">1v1 ELO</p>
                      <p className="text-white font-bold text-lg">{userMe.player.leaderboard.oneVone.elo}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Logout */}
              <button onClick={handleLogout} className="w-full py-3 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors font-medium">
                {translateText("account_modal.logout")}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {/* Discord login */}
              {!crazyGamesSDK.isOnCrazyGames() && (
                <button onClick={handleDiscordLogin} className="w-full py-3 px-6 rounded-lg bg-[#5865F2] hover:bg-[#4752C4] transition-colors text-white font-bold flex items-center justify-center gap-3">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.12-.098.246-.198.373-.292a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-14.36a.074.074 0 0 0-.032-.027z" /></svg>
                  {translateText("account_modal.discord_login")}
                </button>
              )}

              {/* Email login */}
              {!crazyGamesSDK.isOnCrazyGames() && (
                <div className="flex flex-col gap-3">
                  <p className="text-white/50 text-sm text-center">{translateText("account_modal.or_email")}</p>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={translateText("account_modal.email_placeholder")}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                      onKeyDown={(e) => e.key === "Enter" && handleEmailSubmit()}
                    />
                    <button onClick={handleEmailSubmit} className="px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors text-white font-medium text-sm">
                      {translateText("account_modal.send_link")}
                    </button>
                  </div>
                </div>
              )}

              {/* Clear session */}
              <button onClick={handleLogout} className="w-full py-2 text-white/40 hover:text-white/70 transition-colors text-sm">
                {translateText("account_modal.clear_session")}
              </button>
            </div>
          )}
        </div>
      </ModalContainer>
    </ModalPage>
  );
}
