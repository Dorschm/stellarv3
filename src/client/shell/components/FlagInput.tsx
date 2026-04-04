import { useState, useEffect } from "react";
import { UserSettings } from "../../../core/game/UserSettings";
import { resolveFlagUrl } from "../../Cosmetics";
import { translateText } from "../../Utils";

interface FlagInputProps {
  showSelectLabel?: boolean;
  onClick?: () => void;
  className?: string;
}

export function FlagInput({
  showSelectLabel = false,
  onClick,
  className = "",
}: FlagInputProps) {
  const [flag, setFlag] = useState<string>("");
  const [flagUrl, setFlagUrl] = useState<string>("");

  // Initialize on mount
  useEffect(() => {
    const userSettings = new UserSettings();
    const initialFlag = userSettings.getFlag() ?? "";
    setFlag(initialFlag);

    // Resolve and set flag URL
    if (initialFlag) {
      resolveFlagUrl(initialFlag).then((url) => {
        setFlagUrl(url ?? "");
      });
    }
  }, []);

  // Listen to flag change events
  useEffect(() => {
    const handleFlagChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      const newFlag = customEvent.detail?.flag ?? "";
      setFlag(newFlag);

      // Resolve new flag URL
      if (newFlag) {
        resolveFlagUrl(newFlag).then((url) => {
          setFlagUrl(url ?? "");
        });
      } else {
        setFlagUrl("");
      }
    };

    window.addEventListener("event:user-settings-changed:flag", handleFlagChange);

    return () => {
      window.removeEventListener(
        "event:user-settings-changed:flag",
        handleFlagChange,
      );
    };
  }, []);

  const showSelect = showSelectLabel && !flag;

  return (
    <button
      className={`flag-btn p-0 m-0 border-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 transition-all duration-200 hover:scale-105 bg-[color-mix(in_oklab,var(--frenchBlue)_75%,black)] hover:brightness-[1.08] active:brightness-[0.95] rounded-lg overflow-hidden ${className}`}
      title={
        showSelect
          ? translateText("flag_input.title")
          : translateText("flag_input.button_title")
      }
      onClick={onClick}
    >
      {flagUrl && !showSelect && (
        <img
          src={flagUrl}
          className="w-full h-full object-cover pointer-events-none"
          draggable={false}
          alt="Flag"
        />
      )}
      {showSelect && (
        <span className="text-[7px] lg:text-[10px] font-black tracking-wider text-white uppercase leading-tight lg:leading-none w-full text-center px-0.5 lg:px-1">
          {translateText("flag_input.title")}
        </span>
      )}
    </button>
  );
}
