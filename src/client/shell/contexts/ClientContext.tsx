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
import { GAME_ID_REGEX, LobbyInfoEvent } from "../../../core/Schemas";
import { GameEnv } from "../../../core/configuration/Config";
import { getRuntimeClientServerConfig } from "../../../core/configuration/ConfigLoader";
import { GameType } from "../../../core/game/Game";
import { UserSettings } from "../../../core/game/UserSettings";
import { getUserMe } from "../../Api";
import { userAuth } from "../../Auth";
import { joinLobby, type JoinLobbyResult } from "../../ClientGameRunner";
import { getPlayerCosmeticsRefs } from "../../Cosmetics";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import {
  SendKickPlayerIntentEvent,
  SendUpdateGameConfigIntentEvent,
} from "../../Transport";
import { genAnonUsername } from "../../AnonUsername";
import {
  getDiscordAvatarUrl,
  incrementGamesPlayed,
  translateText,
} from "../../Utils";
import type { GameStartInfo, GameRecord, GameInfo, PublicGameInfo } from "../../../core/Schemas";

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        console.error(`Turnstile error: ${errorCode}`);
        alert(`Turnstile error: ${errorCode}. Please refresh and try again.`);
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
        window.adsEnabled = !hasLinkedAccount && !crazyGamesSDK.isOnCrazyGames();
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resolveTurnstileToken = useCallback(
    async (lobby: JoinLobbyEvent): Promise<string | null> => {
      const config = await getRuntimeClientServerConfig();
      if (
        config.env() === GameEnv.Dev ||
        lobby.gameStartInfo?.config.gameType === GameType.Singleplayer
      ) {
        return null;
      }

      if (
        turnstilePromiseRef.current === null ||
        crazyGamesSDK.isOnCrazyGames()
      ) {
        console.log("No prefetched turnstile token, getting new token");
        return (await getTurnstileToken())?.token ?? null;
      }

      const token = await turnstilePromiseRef.current;
      turnstilePromiseRef.current = null;
      if (!token) {
        console.log("No turnstile token");
        return null;
      }

      const tokenTTL = 3 * 60 * 1000;
      if (Date.now() < token.createdAt + tokenTTL) {
        console.log("Prefetched turnstile token is valid");
        return token.token;
      } else {
        console.log("Turnstile token expired, getting new token");
        return (await getTurnstileToken())?.token ?? null;
      }
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
      const handle = joinLobby(eventBus, {
        gameID: lobby.gameID,
        serverConfig: config,
        cosmetics: await getPlayerCosmeticsRefs(),
        turnstileToken: await resolveTurnstileToken(lobby),
        playerName: getUsername?.() ?? genAnonUsername(),
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
          history.replaceState(
            null,
            "",
            window.location.origin + "#refresh",
          );
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

  const handleLeaveLobby = useCallback(
    (cause?: string) => {
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
    },
    [],
  );

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
