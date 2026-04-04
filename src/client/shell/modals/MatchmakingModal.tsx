import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase, getUserMe, hasLinkedAccount } from "../../Api";
import { getPlayToken, userAuth } from "../../Auth";
import { translateText } from "../../Utils";
import { LoadingSpinner, ModalContainer, ModalPage } from "../components/ModalPage";
import { useNavigation } from "../contexts/NavigationContext";

export function MatchmakingModal() {
  const { showPage } = useNavigation();
  const [connected, setConnected] = useState(false);
  const [gameID, setGameID] = useState<string | null>(null);
  const [elo, setElo] = useState<number | string>("...");
  const socketRef = useRef<WebSocket | null>(null);
  const gameCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instanceIdCacheRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    if (gameCheckRef.current) {
      clearInterval(gameCheckRef.current);
      gameCheckRef.current = null;
    }
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    setConnected(false);
    setGameID(null);
    setElo("...");
  }, []);

  const getInstanceId = useCallback(async (): Promise<string | null> => {
    if (instanceIdCacheRef.current) return instanceIdCacheRef.current;
    try {
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}/matchmaking/instance`);
      if (!res.ok) return null;
      const data = await res.json();
      instanceIdCacheRef.current = data.instanceId;
      return data.instanceId;
    } catch {
      return null;
    }
  }, []);

  const checkGame = useCallback(async (gid: string) => {
    try {
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}/game/${gid}/exists`);
      if (res.ok) {
        const data = await res.json();
        if (data.exists) {
          if (gameCheckRef.current) clearInterval(gameCheckRef.current);
          document.dispatchEvent(
            new CustomEvent("join-lobby", {
              detail: { gameID: gid, source: "matchmaking" },
              bubbles: true,
            }),
          );
          showPage("page-play");
        }
      }
    } catch {
      // retry
    }
  }, [showPage]);

  const connect = useCallback(async () => {
    try {
      const jwt = await getPlayToken();
      const instanceId = await getInstanceId();

      // Derive WS URL from API base
      const apiBase = getApiBase();
      const wsBase = apiBase.replace(/^http/, "ws");
      const wsUrl = `${wsBase}/matchmaking?token=${encodeURIComponent(jwt)}`;
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        connectTimeoutRef.current = setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "join",
              mode: "1v1",
              ...(instanceId ? { instanceId } : {}),
            }));
          }
        }, 500);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "match" && msg.gameID) {
            setGameID(msg.gameID);
            gameCheckRef.current = setInterval(() => checkGame(msg.gameID), 1000);
          }
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        console.error("Matchmaking WebSocket error");
      };

      ws.onclose = () => {
        setConnected(false);
      };
    } catch (e) {
      console.error("Failed to connect to matchmaking:", e);
      setConnected(false);
    }
  }, [getInstanceId, checkGame]);

  const onOpen = useCallback(async () => {
    // Check if logged in
    if ((await userAuth()) === false) {
      alert(translateText("matchmaking_modal.login_required"));
      showPage("page-account");
      return;
    }

    // Check if has linked account
    const userMe = await getUserMe();
    if (!hasLinkedAccount(userMe)) {
      alert(translateText("matchmaking_modal.link_required"));
      showPage("page-account");
      return;
    }

    // Set ELO
    if (userMe !== false) {
      const eloVal = userMe.player.leaderboard?.oneVone?.elo;
      setElo(eloVal ?? translateText("matchmaking_modal.no_elo"));
    }

    connect();
  }, [connect, showPage]);

  const onClose = useCallback(() => {
    cleanup();
  }, [cleanup]);

  // Listen for trigger-matchmaking event
  useEffect(() => {
    const handler = () => {
      showPage("page-matchmaking");
    };
    document.addEventListener("trigger-matchmaking", handler);
    return () => document.removeEventListener("trigger-matchmaking", handler);
  }, [showPage]);

  return (
    <ModalPage pageId="page-matchmaking" onOpen={onOpen} onClose={onClose}>
      <ModalContainer>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <button onClick={() => showPage("page-play")} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <h2 className="text-lg font-bold text-white uppercase tracking-widest">{translateText("mode_selector.ranked_title")}</h2>
          <span className="ml-auto text-sm text-white/50">{translateText("matchmaking_modal.elo", { elo })}</span>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          {!connected ? (
            <LoadingSpinner message={translateText("matchmaking_modal.connecting")} color="blue" />
          ) : !gameID ? (
            <LoadingSpinner message={translateText("matchmaking_modal.searching")} color="green" />
          ) : (
            <LoadingSpinner message={translateText("matchmaking_modal.waiting_for_game")} color="yellow" />
          )}
        </div>
      </ModalContainer>
    </ModalPage>
  );
}
