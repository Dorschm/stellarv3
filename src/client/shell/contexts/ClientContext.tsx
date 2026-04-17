import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { UserMeResponse } from "../../../core/ApiSchemas";
import { EventBus } from "../../../core/EventBus";
import type {
  GameInfo,
  GameRecord,
  GameStartInfo,
  PublicGameInfo,
} from "../../../core/Schemas";
import { GAME_ID_REGEX, LobbyInfoEvent } from "../../../core/Schemas";
import { GameEnv } from "../../../core/configuration/Config";
import { getRuntimeClientServerConfig } from "../../../core/configuration/ConfigLoader";
import { GameType } from "../../../core/game/Game";
import { UserSettings } from "../../../core/game/UserSettings";
import { genAnonUsername } from "../../AnonUsername";
import { getUserMe } from "../../Api";
import { userAuth } from "../../Auth";
import { joinLobby, type JoinLobbyResult } from "../../ClientGameRunner";
import { getPlayerCosmeticsRefs } from "../../Cosmetics";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { syncRunHistoryOnLogin } from "../../RunHistorySync";
import {
  SendKickPlayerIntentEvent,
  SendUpdateGameConfigIntentEvent,
} from "../../Transport";
import { incrementGamesPlayed, translateText } from "../../Utils";

export interface JoinLobbyEvent {
  gameID: string;
  gameStartInfo?: GameStartInfo;
  gameRecord?: GameRecord;
  source?: "public" | "private" | "host" | "matchmaking" | "singleplayer";
  publicLobbyInfo?: GameInfo | PublicGameInfo;
}

interface TurnstileToken {
  token: string;
  createdAt: number;
}

interface ClientContextValue {
  eventBus: EventBus;
  userSettings: UserSettings;
  userMe: UserMeResponse | false;
  isInGame: boolean;
  lobbyHandle: JoinLobbyResult | null;
  joinLobby: (event: JoinLobbyEvent) => Promise<void>;
  leaveLobby: (cause?: string) => void;
  openMatchmaking: () => void;
  kickPlayer: (target: string) => void;

  updateGameConfig: (config: any) => void;
  /** Ref to get current username from the username input */
  getUsernameRef: React.MutableRefObject<(() => string) | null>;
  getClanTagRef: React.MutableRefObject<(() => string | null) | null>;
  getValidateUsernameRef: React.MutableRefObject<(() => boolean) | null>;
}

const ClientContext = createContext<ClientContextValue | null>(null);

async function getTurnstileToken(): Promise<TurnstileToken> {
  let attempts = 0;
  while (typeof window.turnstile === "undefined" && attempts < 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts++;
  }

  if (typeof window.turnstile === "undefined") {
    throw new Error("Failed to load Turnstile script");
  }

  const config = await getRuntimeClientServerConfig();
  const widgetId = window.turnstile.render("#turnstile-container", {
    sitekey: config.turnstileSiteKey(),
    size: "normal",
    appearance: "interaction-only",
    theme: "light",
  });

  return new Promise((resolve, reject) => {
    window.turnstile.execute(widgetId, {
      callback: (token: string) => {
        window.turnstile.remove(widgetId);
        console.log(`Turnstile token received: ${token}`);
        resolve({ token, createdAt: Date.now() });
      },
      "error-callback": (errorCode: string) => {
        window.turnstile.remove(widgetId);
        // Downgraded from console.error + alert() to console.warn +
        // rejection: (1) a modal alert breaks the lobby flow entirely
        // with no clear recovery, (2) the 600010 "invalid challenge
        // state" code is routinely transient and resolves on a
        // subsequent render, and (3) `resolveTurnstileToken` now
        // catches this rejection and falls back to the last-known-good
        // token, which the server accepts via its
        // `timeout-or-duplicate` fail-open path in Turnstile.ts. Real
        // token-rejection failures still flow through the server's
        // 1002 close path and surface as a leave-lobby event.
        console.warn(`Turnstile error: ${errorCode}`);
        reject(new Error(`Turnstile failed: ${errorCode}`));
      },
    });
  });
}

export function ClientProvider({ children }: { children: React.ReactNode }) {
  const [eventBus] = useState(() => new EventBus());
  const [userSettings] = useState(() => new UserSettings());
  const [userMe, setUserMe] = useState<UserMeResponse | false>(false);
  const [isInGame, setIsInGame] = useState(false);
  const [lobbyHandle, setLobbyHandle] = useState<JoinLobbyResult | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  const turnstilePromiseRef = useRef<Promise<TurnstileToken> | null>(null);
  // Last successful turnstile token, kept so we can reuse it when the
  // widget fails on the NEXT render (common: error 600010 "invalid
  // challenge state" on repeated render+execute cycles). The server's
  // Turnstile verifier treats Cloudflare's `timeout-or-duplicate`
  // error-code as fail-open (see fix(turnstile) in src/server/Turnstile.ts),
  // so handing back a token we've already consumed lets the join
  // succeed instead of silently dying. Without this fallback the user
  // reported the exact symptom we reproduced: click a public lobby
  // card → `join-lobby` event fires → `resolveTurnstileToken` throws
  // → handleJoinLobby's unhandled rejection drops the entire flow →
  // no modal, no error, page just sits on "/".
  const lastTurnstileTokenRef = useRef<TurnstileToken | null>(null);
  const getUsernameRef = useRef<(() => string) | null>(null);
  const getClanTagRef = useRef<(() => string | null) | null>(null);
  const getValidateUsernameRef = useRef<(() => boolean) | null>(null);
  const lobbyHandleRef = useRef<JoinLobbyResult | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    lobbyHandleRef.current = lobbyHandle;
  }, [lobbyHandle]);

  // Expose a deterministic body data-attribute when the client has
  // connected to a lobby WebSocket and received the server's lobby_info
  // acknowledgement. E2E fixtures can wait on this signal to confirm the
  // join has completed rather than relying on timing.
  useEffect(() => {
    const onLobbyInfo = () => {
      document.body.dataset.lobbyConnected = "true";
    };
    eventBus.on(LobbyInfoEvent, onLobbyInfo);
    return () => eventBus.off(LobbyInfoEvent, onLobbyInfo);
  }, [eventBus]);

  // Initialize CrazyGames and Turnstile
  useEffect(() => {
    crazyGamesSDK.maybeInit();
    turnstilePromiseRef.current = getTurnstileToken();

    // Apply dark mode
    if (userSettings.darkMode()) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    // Auth flow
    const doAuth = async () => {
      const onUserMe = async (response: UserMeResponse | false) => {
        setUserMe(response);
        const hasLinkedAccount =
          !crazyGamesSDK.isOnCrazyGames() &&
          ((response || null)?.player?.flares?.length ?? 0) > 0;
        window.adsEnabled =
          !hasLinkedAccount && !crazyGamesSDK.isOnCrazyGames();
        document.dispatchEvent(
          new CustomEvent("userMeResponse", {
            detail: response,
            bubbles: true,
            cancelable: true,
          }),
        );
        if (response !== false) {
          console.log(
            `Your player ID is ${response.player.publicId}\n` +
              "Sharing this ID will allow others to view your game history and stats.",
          );
          void syncRunHistoryOnLogin();
        }
      };

      if ((await userAuth()) === false) {
        onUserMe(false);
      } else {
        getUserMe().then(onUserMe);
      }
    };
    doAuth();

    // beforeunload handler
    const handleUnload = async () => {
      console.log("Browser is closing");
      if (lobbyHandleRef.current !== null) {
        lobbyHandleRef.current.stop(true);
        await crazyGamesSDK.gameplayStop();
      }
    };
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, []);

  const resolveTurnstileToken = useCallback(
    async (lobby: JoinLobbyEvent): Promise<string | null> => {
      const config = await getRuntimeClientServerConfig();
      if (
        config.env() === GameEnv.Dev ||
        lobby.gameStartInfo?.config.gameType === GameType.Singleplayer
      ) {
        return null;
      }

      const tokenTTL = 3 * 60 * 1000;

      // Helper: try getting a fresh token, fall back to the last
      // known-good one if the widget fails. The server's
      // timeout-or-duplicate fail-open path accepts the reused token.
      // Any error path returns `null` so the caller never throws.
      const tryFresh = async (): Promise<string | null> => {
        try {
          const fresh = await getTurnstileToken();
          lastTurnstileTokenRef.current = fresh;
          return fresh.token;
        } catch (e) {
          console.warn("Turnstile widget failed; attempting fallback:", e);
          if (lastTurnstileTokenRef.current) {
            console.log(
              "Reusing last turnstile token (server fail-open handles duplicate)",
            );
            return lastTurnstileTokenRef.current.token;
          }
          return null;
        }
      };

      if (
        turnstilePromiseRef.current === null ||
        crazyGamesSDK.isOnCrazyGames()
      ) {
        return tryFresh();
      }

      let prefetched: TurnstileToken | null = null;
      try {
        prefetched = await turnstilePromiseRef.current;
      } catch (e) {
        console.warn("Prefetched turnstile token rejected:", e);
      }
      turnstilePromiseRef.current = null;

      if (prefetched && Date.now() < prefetched.createdAt + tokenTTL) {
        lastTurnstileTokenRef.current = prefetched;
        return prefetched.token;
      }
      return tryFresh();
    },
    [],
  );

  const handleJoinLobby = useCallback(
    async (lobby: JoinLobbyEvent) => {
      const validate = getValidateUsernameRef.current;
      if (validate && !validate()) return;

      console.log(`joining lobby ${lobby.gameID}`);
      if (lobbyHandleRef.current !== null) {
        console.log("joining lobby, stopping existing game");
        lobbyHandleRef.current.stop(true);
        document.body.classList.remove("in-game");
      }

      const config = await getRuntimeClientServerConfig();
      if (lobby.source !== "public") {
        const lobbyIdHidden = !userSettings.lobbyIdVisibility();
        const targetUrl = lobbyIdHidden
          ? "/streamer-mode"
          : `/${config.workerPath(lobby.gameID)}/game/${lobby.gameID}`;
        const currentUrl = window.location.pathname;
        if (currentUrl !== targetUrl) {
          history.replaceState(null, "", targetUrl);
        }
      }

      const getUsername = getUsernameRef.current;
      // Use `||` rather than `??` so an empty string (ref-not-yet-populated
      // race, or user cleared the input) also falls back to an anon name.
      // The server's Zod schema rejects both missing and empty usernames.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      const resolvedUsername = getUsername?.() || genAnonUsername();
      const handle = joinLobby(eventBus, {
        gameID: lobby.gameID,
        serverConfig: config,
        cosmetics: await getPlayerCosmeticsRefs(),
        turnstileToken: await resolveTurnstileToken(lobby),
        playerName: resolvedUsername,
        playerClanTag: getClanTagRef.current?.() ?? null,
        gameStartInfo: lobby.gameStartInfo ?? lobby.gameRecord?.info,
        gameRecord: lobby.gameRecord,
      });

      setLobbyHandle(handle);
      lobbyHandleRef.current = handle;

      handle.prestart.then(() => {
        console.log("Closing modals — game prestart");
        document.getElementById("settings-button")?.classList.add("hidden");
        crazyGamesSDK.loadingStart();
        // Dispatch so lobby/host/join modals can dismiss themselves without
        // calling leaveLobby(). Without this, a user who joined via URL or
        // the JoinLobbyModal sits on a "Connecting..." spinner forever while
        // the game runs underneath — the modal renders on top at z-50 and
        // blocks all gameplay interaction.
        document.dispatchEvent(
          new CustomEvent("game-prestart", {
            detail: { gameID: lobby.gameID },
          }),
        );
      });

      handle.join.then(() => {
        incrementGamesPlayed();
        if (window.PageOS?.session?.newPageView) {
          window.PageOS.session.newPageView();
        }
        crazyGamesSDK.loadingStop();
        crazyGamesSDK.gameplayStart();
        document.body.classList.add("in-game");
        setIsInGame(true);

        if (window.location.hash === "" || window.location.hash === "#") {
          history.replaceState(null, "", window.location.origin + "#refresh");
        }
        const lobbyIdHidden = !userSettings.lobbyIdVisibility();
        history.pushState(
          null,
          "",
          lobbyIdHidden
            ? "/streamer-mode"
            : `/${config.workerPath(lobby.gameID)}/game/${lobby.gameID}?live`,
        );
        currentUrlRef.current = window.location.href;
      });
    },
    [eventBus, userSettings, resolveTurnstileToken],
  );

  const handleLeaveLobby = useCallback((cause?: string) => {
    if (lobbyHandleRef.current === null) return;
    console.log("leaving lobby, cancelling game");
    lobbyHandleRef.current.stop(true);
    lobbyHandleRef.current = null;
    setLobbyHandle(null);
    currentUrlRef.current = null;
    delete document.body.dataset.lobbyConnected;

    try {
      history.replaceState(null, "", "/");
    } catch (e) {
      console.warn("Failed to restore URL on leave:", e);
    }

    document.body.classList.remove("in-game");
    setIsInGame(false);

    if (cause === "full-lobby") {
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("public_lobby.join_timeout"),
            color: "red",
            duration: 3500,
          },
        }),
      );
    }

    crazyGamesSDK.gameplayStop();
  }, []);

  const openMatchmaking = useCallback(() => {
    // This is handled by NavigationContext now
  }, []);

  const kickPlayer = useCallback(
    (target: string) => {
      eventBus.emit(new SendKickPlayerIntentEvent(target));
    },
    [eventBus],
  );

  const updateGameConfig = useCallback(
    (config: any) => {
      eventBus.emit(new SendUpdateGameConfigIntentEvent(config));
    },
    [eventBus],
  );

  // Listen to legacy document events
  useEffect(() => {
    const onJoinLobby = (e: Event) => {
      handleJoinLobby((e as CustomEvent).detail);
    };
    const onLeaveLobby = (e: Event) => {
      handleLeaveLobby((e as CustomEvent).detail?.cause);
    };
    const onKickPlayer = (e: Event) => {
      kickPlayer((e as CustomEvent).detail.target);
    };
    const onUpdateConfig = (e: Event) => {
      updateGameConfig((e as CustomEvent).detail.config);
    };

    document.addEventListener("join-lobby", onJoinLobby);
    document.addEventListener("leave-lobby", onLeaveLobby);
    document.addEventListener("kick-player", onKickPlayer);
    document.addEventListener("update-game-config", onUpdateConfig);

    return () => {
      document.removeEventListener("join-lobby", onJoinLobby);
      document.removeEventListener("leave-lobby", onLeaveLobby);
      document.removeEventListener("kick-player", onKickPlayer);
      document.removeEventListener("update-game-config", onUpdateConfig);
    };
  }, [handleJoinLobby, handleLeaveLobby, kickPlayer, updateGameConfig]);

  // Handle URL routing on mount
  useEffect(() => {
    const handleUrl = async () => {
      // CrazyGames invite
      if (crazyGamesSDK.isOnCrazyGames()) {
        const lobbyId = await crazyGamesSDK.getInviteGameId();
        if (lobbyId && GAME_ID_REGEX.test(lobbyId)) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          window.showPage?.("page-join-lobby");
          document.dispatchEvent(
            new CustomEvent("open-join-modal", { detail: lobbyId }),
          );
          return;
        }
      }

      crazyGamesSDK.isInstantMultiplayer().then((isInstant) => {
        if (isInstant) {
          window.showPage?.("page-host-lobby");
        }
      });

      const hash = window.location.hash;
      const decodedHash = decodeURIComponent(hash);
      const params = new URLSearchParams(decodedHash.split("?")[1] || "");
      const strip = () =>
        history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );

      if (decodedHash.startsWith("#purchase-completed")) {
        const status = params.get("status");
        if (status !== "true") {
          alert("purchase failed");
          strip();
          return;
        }
        const cosmeticName = params.get("cosmetic");
        if (!cosmeticName) {
          alert("Something went wrong. Please contact support.");
          return;
        }
        const setCosmetic = () => {
          if (cosmeticName.startsWith("pattern:")) {
            userSettings.setSelectedPatternName(cosmeticName);
          } else if (cosmeticName.startsWith("flag:")) {
            userSettings.setFlag(cosmeticName);
          }
        };
        const token = params.get("login-token");
        if (token) {
          strip();
          document.dispatchEvent(
            new CustomEvent("open-token-login", { detail: token }),
          );
        } else {
          alert(`purchase succeeded: ${cosmeticName}`);
          strip();
          setCosmetic();
        }
        return;
      }

      if (decodedHash.startsWith("#token-login")) {
        const token = params.get("token-login");
        if (!token) {
          alert("login failed! Please try again later or contact support.");
          strip();
          return;
        }
        strip();
        document.dispatchEvent(
          new CustomEvent("open-token-login", { detail: token }),
        );
        return;
      }

      const pathMatch = window.location.pathname.match(
        /^\/(?:w\d+\/)?game\/([^/]+)/,
      );
      const lobbyId =
        pathMatch && GAME_ID_REGEX.test(pathMatch[1]) ? pathMatch[1] : null;
      if (lobbyId) {
        window.showPage?.("page-join-lobby");
        document.dispatchEvent(
          new CustomEvent("open-join-modal", { detail: lobbyId }),
        );
        return;
      }

      if (decodedHash.startsWith("#affiliate=")) {
        const affiliateCode = decodedHash.replace("#affiliate=", "");
        strip();
        if (affiliateCode) {
          document.dispatchEvent(
            new CustomEvent("open-store-modal", { detail: affiliateCode }),
          );
        }
      }
      if (decodedHash.startsWith("#refresh")) {
        window.location.href = "/";
      }

      const searchParams = new URLSearchParams(window.location.search);
      if (searchParams.has("requeue")) {
        searchParams.delete("requeue");
        const newUrl =
          window.location.pathname +
          (searchParams.toString() ? "?" + searchParams.toString() : "") +
          window.location.hash;
        history.replaceState(null, "", newUrl);
        document.dispatchEvent(new CustomEvent("trigger-matchmaking"));
      }
    };

    handleUrl();

    // Handle browser navigation
    const onPopState = () => {
      if (currentUrlRef.current !== null && lobbyHandleRef.current !== null) {
        if (!lobbyHandleRef.current.stop()) {
          const isConfirmed = confirm(
            translateText("help_modal.exit_confirmation"),
          );
          if (!isConfirmed) {
            history.pushState(null, "", currentUrlRef.current);
            return;
          }
        }
        crazyGamesSDK.gameplayStop().then(() => {
          window.location.href = "/";
        });
      }
    };

    const onHashChange = () => {
      if (lobbyHandleRef.current !== null) {
        handleLeaveLobby();
      }
      handleUrl();
    };

    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashChange);

    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  return (
    <ClientContext.Provider
      value={{
        eventBus,
        userSettings,
        userMe,
        isInGame,
        lobbyHandle,
        joinLobby: handleJoinLobby,
        leaveLobby: handleLeaveLobby,
        openMatchmaking,
        kickPlayer,
        updateGameConfig,
        getUsernameRef,
        getClanTagRef,
        getValidateUsernameRef,
      }}
    >
      {children}
    </ClientContext.Provider>
  );
}

export function useClient(): ClientContextValue {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error("useClient must be inside ClientProvider");
  return ctx;
}
