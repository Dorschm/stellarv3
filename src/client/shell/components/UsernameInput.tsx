import { useState, useEffect, useCallback } from "react";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { sanitizeClanTag } from "../../../core/Util";
import {
  MAX_CLAN_TAG_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_CLAN_TAG_LENGTH,
  MIN_USERNAME_LENGTH,
  validateClanTag,
  validateUsername,
} from "../../../core/validations/username";
import { translateText } from "../../Utils";
import { genAnonUsername } from "../../UsernameInput";
import { useClient } from "../contexts/ClientContext";

export function UsernameInput() {
  const [baseUsername, setBaseUsername] = useState<string>("");
  const [clanTag, setClanTag] = useState<string>("");
  const [validationError, setValidationError] = useState<string>("");
  const client = useClient();

  // Initialize on mount
  useEffect(() => {
    const initUsername = async () => {
      // Try to load from localStorage
      let username = localStorage.getItem("username") || "";
      let tag = localStorage.getItem("clanTag") || "";

      // If no username stored, generate anonymous
      if (!username) {
        username = genAnonUsername();
      }

      setBaseUsername(username);
      setClanTag(tag);

      // Check CrazyGames SDK for override
      try {
        const sdkUsername = await crazyGamesSDK.getUsername();
        if (sdkUsername) {
          setBaseUsername(sdkUsername);
        }
      } catch (err) {
        console.warn("Failed to get CrazyGames username:", err);
      }

      // Add auth listener for CrazyGames
      crazyGamesSDK.addAuthListener((isAuthed) => {
        if (isAuthed) {
          crazyGamesSDK.getUsername().then((sdkUsername) => {
            if (sdkUsername) {
              setBaseUsername(sdkUsername);
            }
          });
        }
      });
    };

    initUsername();
  }, []);

  // Register refs with client context
  useEffect(() => {
    client.getUsernameRef.current = () => baseUsername.trim();
    client.getClanTagRef.current = () => getComputedClanTag();
    client.getValidateUsernameRef.current = () => validateOrShowError();
  }, [baseUsername, clanTag, client]);

  const getComputedClanTag = useCallback(() => {
    if (!clanTag.trim()) return null;
    return clanTag.trim();
  }, [clanTag]);

  const validateOrShowError = useCallback((): boolean => {
    const trimmedUsername = baseUsername.trim();
    const trimmedTag = clanTag.trim();

    // Validate username
    if (trimmedUsername) {
      const usernameResult = validateUsername(trimmedUsername);
      if (!usernameResult.isValid) {
        setValidationError(usernameResult.error ?? "");
        return false;
      }
    }

    // Validate clan tag if provided
    if (trimmedTag) {
      const tagResult = validateClanTag(trimmedTag);
      if (!tagResult.isValid) {
        setValidationError(tagResult.error ?? "");
        return false;
      }
    }

    setValidationError("");
    return true;
  }, [baseUsername, clanTag]);

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;

    // Check for invalid characters
    const validCharRegex = /^[a-zA-Z0-9\s\-_]*$/;
    if (value && !validCharRegex.test(value)) {
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("username.invalid_characters"),
            color: "red",
            duration: 2000,
          },
        }),
      );
      return;
    }

    setBaseUsername(value);
    setValidationError(""); // Clear error when user starts typing
    localStorage.setItem("username", value);
  };

  const handleClanTagChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.currentTarget.value.toUpperCase();

    // Sanitize clan tag
    value = sanitizeClanTag(value);

    // Check for invalid characters
    const validCharRegex = /^[A-Z0-9\-_]*$/;
    if (value && !validCharRegex.test(value)) {
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("username.invalid_characters"),
            color: "red",
            duration: 2000,
          },
        }),
      );
      return;
    }

    setClanTag(value);
    setValidationError(""); // Clear error when user starts typing
    localStorage.setItem("clanTag", value);
  };

  return (
    <div className="relative w-full h-full">
      <div className="flex items-center w-full h-full gap-2">
        <input
          type="text"
          value={clanTag}
          onChange={handleClanTagChange}
          placeholder={translateText("username.tag")}
          minLength={MIN_CLAN_TAG_LENGTH}
          maxLength={MAX_CLAN_TAG_LENGTH}
          className="w-[6rem] text-xl font-medium tracking-wider text-center uppercase shrink-0 bg-transparent text-white placeholder-white/70 focus:placeholder-transparent border-0 border-b border-white/40 focus:outline-none focus:border-white/60"
        />
        <input
          type="text"
          value={baseUsername}
          onChange={handleUsernameChange}
          placeholder={translateText("username.enter_username")}
          minLength={MIN_USERNAME_LENGTH}
          maxLength={MAX_USERNAME_LENGTH}
          className="flex-1 min-w-0 border-0 text-2xl font-medium tracking-wider text-left text-white placeholder-white/70 focus:outline-none focus:ring-0 overflow-x-auto whitespace-nowrap text-ellipsis pr-2 bg-transparent"
        />
      </div>
      {validationError && (
        <div
          id="username-validation-error"
          className="absolute top-full left-0 z-50 w-full mt-1 px-3 py-2 text-sm font-medium border border-red-500/50 rounded-lg bg-red-900/90 text-red-200 backdrop-blur-md shadow-lg"
        >
          {validationError}
        </div>
      )}
    </div>
  );
}
