import { useCallback, useEffect, useRef, useState } from "react";
import { GAME_ID_REGEX } from "../../../core/Schemas";
import { translateText } from "../../Utils";
import {
  LoadingSpinner,
  ModalContainer,
  ModalPage,
} from "../components/ModalPage";
import { useClient } from "../contexts/ClientContext";
import { useNavigation } from "../contexts/NavigationContext";

export function JoinLobbyModal() {
  const { showPage } = useNavigation();
  const { joinLobby, leaveLobby } = useClient();
  const [lobbyIdInput, setLobbyIdInput] = useState("");
  const [currentLobbyId, setCurrentLobbyId] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  // Flipped once `await joinLobby(...)` resolves so the spinner can swap
  // for a "Waiting for host to start…" message instead of the ambiguous
  // "Connecting…" state that previously sat forever.
  const [waitingForHost, setWaitingForHost] = useState(false);
  const [error, setError] = useState("");
  const leaveLobbyOnCloseRef = useRef(true);

  // Listen for open-join-modal events from URL handler
  useEffect(() => {
    const handler = (e: Event) => {
      const lobbyId = (e as CustomEvent).detail;
      if (lobbyId && GAME_ID_REGEX.test(lobbyId)) {
        setCurrentLobbyId(lobbyId);
        setLobbyIdInput(lobbyId);
        handleJoin(lobbyId);
      }
    };
    document.addEventListener("open-join-modal", handler);
    return () => document.removeEventListener("open-join-modal", handler);
  }, []);

  // When the server-side join flow fails, ClientGameRunner dispatches a
  // `leave-lobby` event (e.g. `full-lobby`, `host-left`). Transport also
  // dispatches one for WebSocket close-based failures (code 1002) such
  // as unknown lobby IDs that close with reason "Game not found", or
  // "Unauthorized" during the pre-join handshake. Without reacting to
  // those here, the modal would remain stuck on the connecting spinner
  // indefinitely. Reset the join state so the user can retry.
  useEffect(() => {
    const onLeaveLobby = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const cause: string | undefined = detail?.cause;
      setIsConnecting(false);
      setWaitingForHost(false);
      setCurrentLobbyId("");
      // Avoid treating our own close-time leaveLobby() as an error: callers
      // may also emit leave-lobby proactively. If a `cause` is present, it
      // indicates a server-side failure worth surfacing to the user.
      if (cause === "full-lobby") {
        setError(translateText("public_lobby.join_timeout"));
      } else if (cause === "host-left") {
        setError(translateText("kick_reason.host_left"));
      } else if (cause === "not-found") {
        setError(translateText("private_lobby.not_found"));
      } else if (cause === "unauthorized") {
        setError(translateText("private_lobby.error"));
      } else if (cause === "connection-refused") {
        setError(translateText("private_lobby.error"));
      } else if (cause) {
        setError(translateText("private_lobby.error"));
      }
      // Don't call leaveLobby() from onClose on the next close — the lobby
      // is already gone from the client's perspective.
      leaveLobbyOnCloseRef.current = false;
    };
    document.addEventListener("leave-lobby", onLeaveLobby);
    return () => document.removeEventListener("leave-lobby", onLeaveLobby);
  }, []);

  // When the host starts the game, ClientContext dispatches `game-prestart`.
  // Close this modal cleanly so the game HUD is visible — without this the
  // "Connecting…" (or "Waiting for host…") modal sits on top of the running
  // game at z-50 and the joiner can never actually play. We explicitly skip
  // leaveLobby() here because the game is active and we want to stay in it.
  useEffect(() => {
    const onPrestart = () => {
      if (!currentLobbyId) return;
      leaveLobbyOnCloseRef.current = false;
      setIsConnecting(false);
      setWaitingForHost(false);
      setCurrentLobbyId("");
      showPage("page-play");
    };
    document.addEventListener("game-prestart", onPrestart);
    return () => document.removeEventListener("game-prestart", onPrestart);
  }, [currentLobbyId, showPage]);

  const handleJoin = useCallback(
    async (lobbyId?: string) => {
      // `||` so an empty string `lobbyId` (URL handler stripped the ID on a
      // malformed link, or caller passed "") also falls back to the form
      // input. `??` would pass an empty string through and GAME_ID_REGEX
      // would then reject it with a confusing "invalid ID" error for a
      // user who never actually typed anything.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      const id = lobbyId || lobbyIdInput.trim();
      if (!id) return;

      // Validate lobby ID
      if (!GAME_ID_REGEX.test(id)) {
        setError(translateText("join_lobby.invalid_id"));
        return;
      }

      setError("");
      setIsConnecting(true);
      setWaitingForHost(false);
      setCurrentLobbyId(id);
      leaveLobbyOnCloseRef.current = true;

      try {
        await joinLobby({
          gameID: id,
          source: "private",
        });
        // joinLobby only awaits the context's synchronous setup (creating
        // the Transport handle). The server-side join races asynchronously
        // through the WS prestart/join promises. Swap to a non-alarming
        // "waiting" state so the user knows the join succeeded and we're
        // just waiting on the host. The `game-prestart` listener above
        // closes the modal once the host starts the game. `leave-lobby`
        // reverts this to the error path if the server rejects.
        setIsConnecting(false);
        setWaitingForHost(true);
      } catch (e) {
        console.error("Failed to join lobby:", e);
        setError("Failed to join lobby");
        setIsConnecting(false);
        setWaitingForHost(false);
      }
    },
    [lobbyIdInput, joinLobby],
  );

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      // Extract lobby ID from URL or use as-is
      const urlMatch = trimmed.match(/\/game\/([^/?]+)/);
      const id = urlMatch ? urlMatch[1] : trimmed;
      if (id) {
        setLobbyIdInput(id);
      }
    } catch {
      // Clipboard API not available
    }
  }, []);

  const onClose = useCallback(() => {
    if (leaveLobbyOnCloseRef.current && currentLobbyId) {
      leaveLobby();
    }
    setCurrentLobbyId("");
    setIsConnecting(false);
    setError("");
  }, [currentLobbyId, leaveLobby]);

  return (
    <ModalPage pageId="page-join-lobby" onClose={onClose}>
      <ModalContainer>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <button
            onClick={() => showPage("page-play")}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h2 className="text-lg font-bold text-white uppercase tracking-widest">
            {translateText("join_lobby.title")}
          </h2>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 flex flex-col gap-4">
          {isConnecting ? (
            <LoadingSpinner message={translateText("join_lobby.connecting")} />
          ) : waitingForHost ? (
            <LoadingSpinner
              message={translateText("private_lobby.joined_waiting")}
            />
          ) : (
            <>
              {/* Lobby ID input */}
              <div>
                <p className="text-sm text-white/60 mb-2">
                  {translateText("join_lobby.enter_id")}
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={lobbyIdInput}
                    onChange={(e) => setLobbyIdInput(e.target.value)}
                    placeholder={translateText("join_lobby.id_placeholder")}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50 font-mono"
                    onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                  />
                  <button
                    onClick={handlePaste}
                    className="px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                    title="Paste"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-5 h-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                </div>
              </div>

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <button
                onClick={() => handleJoin()}
                disabled={!lobbyIdInput.trim()}
                className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold text-white transition-colors text-base"
              >
                {translateText("join_lobby.join")}
              </button>
            </>
          )}
        </div>
      </ModalContainer>
    </ModalPage>
  );
}
