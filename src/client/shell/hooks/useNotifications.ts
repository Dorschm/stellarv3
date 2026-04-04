import { useCallback, useEffect, useState } from "react";
import version from "resources/version.txt?raw";
import { getCosmeticsHash } from "../../Cosmetics";
import { getGamesPlayed } from "../../Utils";

const HELP_SEEN_KEY = "helpSeen";
const STORE_SEEN_HASH_KEY = "storeSeenHash";
const NEWS_SEEN_VERSION_KEY = "newsSeenVersion";

function getNormalizedVersion(): string {
  const trimmed = version.trim();
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

export interface NotificationState {
  showNewsDot: boolean;
  showStoreDot: boolean;
  showHelpDot: boolean;
  onNewsClick: () => void;
  onStoreClick: () => void;
  onHelpClick: () => void;
}

export function useNotifications(): NotificationState {
  const [helpSeen, setHelpSeen] = useState(
    localStorage.getItem(HELP_SEEN_KEY) === "true",
  );
  const [hasNewCosmetics, setHasNewCosmetics] = useState(false);
  const [hasNewVersion, setHasNewVersion] = useState(false);

  useEffect(() => {
    // Check cosmetics
    getCosmeticsHash()
      .then((hash: string | null) => {
        const seenHash = localStorage.getItem(STORE_SEEN_HASH_KEY);
        setHasNewCosmetics(hash !== null && hash !== seenHash);
      })
      .catch(() => {});

    // Check version
    const currentVersion = getNormalizedVersion();
    const seenVersion = localStorage.getItem(NEWS_SEEN_VERSION_KEY);
    setHasNewVersion(seenVersion !== null && seenVersion !== currentVersion);
    if (seenVersion === null) {
      localStorage.setItem(NEWS_SEEN_VERSION_KEY, currentVersion);
    }
  }, []);

  const showNewsDot = hasNewVersion;
  const showStoreDot = hasNewCosmetics && !showNewsDot;
  const showHelpDot =
    getGamesPlayed() < 10 && !helpSeen && !showNewsDot && !showStoreDot;

  const onNewsClick = useCallback(() => {
    setHasNewVersion(false);
    localStorage.setItem(NEWS_SEEN_VERSION_KEY, getNormalizedVersion());
  }, []);

  const onStoreClick = useCallback(() => {
    setHasNewCosmetics(false);
    getCosmeticsHash()
      .then((hash: string | null) => {
        if (hash !== null) {
          localStorage.setItem(STORE_SEEN_HASH_KEY, hash);
        }
      })
      .catch(() => {});
  }, []);

  const onHelpClick = useCallback(() => {
    localStorage.setItem(HELP_SEEN_KEY, "true");
    setHelpSeen(true);
  }, []);

  return {
    showNewsDot,
    showStoreDot,
    showHelpDot,
    onNewsClick,
    onStoreClick,
    onHelpClick,
  };
}
