import { useState, useEffect, useRef } from "react";
import { Colord } from "colord";
import { base64url } from "jose";
import { PlayerPattern } from "../../../core/Schemas";
import { PatternDecoder } from "../../../core/PatternDecoder";
import { getPlayerCosmetics } from "../../Cosmetics";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { translateText } from "../../Utils";

interface PatternInputProps {
  showSelectLabel?: boolean;
  adaptiveSize?: boolean;
  onClick?: () => void;
  className?: string;
}

const DEFAULT_PRIMARY = new Colord("#ffffff").toRgb(); // White
const DEFAULT_SECONDARY = new Colord("#000000").toRgb(); // Black
const patternCache = new Map<string, string>();

function generatePreviewDataUrl(
  pattern?: PlayerPattern,
  width?: number,
  height?: number,
): string {
  if (!pattern) return "";
  const patternLookupKey = [
    pattern.name,
    pattern.colorPalette?.primaryColor ?? "undefined",
    pattern.colorPalette?.secondaryColor ?? "undefined",
    width,
    height,
  ].join("-");

  if (patternCache.has(patternLookupKey)) {
    return patternCache.get(patternLookupKey)!;
  }

  // Calculate canvas size
  let decoder: PatternDecoder;
  try {
    decoder = new PatternDecoder(
      {
        name: pattern.name,
        patternData: pattern.patternData,
        colorPalette: pattern.colorPalette,
      },
      base64url.decode,
    );
  } catch (e) {
    console.error("Error decoding pattern", e);
    return "";
  }

  const scaledWidth = decoder.scaledWidth();
  const scaledHeight = decoder.scaledHeight();

  width =
    width === undefined
      ? scaledWidth
      : Math.max(1, Math.floor(width / scaledWidth)) * scaledWidth;
  height =
    height === undefined
      ? scaledHeight
      : Math.max(1, Math.floor(height / scaledHeight)) * scaledHeight;

  // Create the canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context not supported");

  // Create an image
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  const primary = pattern.colorPalette?.primaryColor
    ? new Colord(pattern.colorPalette.primaryColor).toRgb()
    : DEFAULT_PRIMARY;
  const secondary = pattern.colorPalette?.secondaryColor
    ? new Colord(pattern.colorPalette.secondaryColor).toRgb()
    : DEFAULT_SECONDARY;
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgba = decoder.isPrimary(x, y) ? primary : secondary;
      data[i++] = rgba.r;
      data[i++] = rgba.g;
      data[i++] = rgba.b;
      data[i++] = 255; // Alpha
    }
  }

  // Create a data URL
  ctx.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  patternCache.set(patternLookupKey, dataUrl);
  return dataUrl;
}

export function PatternInput({
  showSelectLabel = false,
  adaptiveSize = false,
  onClick,
  className = "",
}: PatternInputProps) {
  const [pattern, setPattern] = useState<PlayerPattern | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const previewRef = useRef<HTMLSpanElement>(null);

  // Initialize on mount
  useEffect(() => {
    const initPattern = async () => {
      try {
        const cosmetics = await getPlayerCosmetics();
        if (cosmetics.pattern) {
          setPattern(cosmetics.pattern);
          if (cosmetics.pattern.colorPalette?.primaryColor) {
            setSelectedColor(cosmetics.pattern.colorPalette.primaryColor);
          }
        }
      } catch (err) {
        console.warn("Failed to get player cosmetics:", err);
      } finally {
        setIsLoading(false);
      }
    };

    initPattern();
  }, []);

  // Listen to pattern change events
  useEffect(() => {
    const handlePatternChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      const newPattern = customEvent.detail?.pattern ?? null;

      if (newPattern) {
        setPattern(newPattern);
        if (newPattern.colorPalette?.primaryColor) {
          setSelectedColor(newPattern.colorPalette.primaryColor);
        }
      } else {
        setPattern(null);
        setSelectedColor(null);
      }
    };

    window.addEventListener(
      "event:user-settings-changed:pattern",
      handlePatternChange,
    );

    return () => {
      window.removeEventListener(
        "event:user-settings-changed:pattern",
        handlePatternChange,
      );
    };
  }, []);

  // Update preview when pattern or color changes
  useEffect(() => {
    if (!previewRef.current) return;

    if (pattern) {
      const dataUrl = generatePreviewDataUrl(pattern, 128, 128);
      previewRef.current.innerHTML = "";
      const img = document.createElement("img");
      img.src = dataUrl;
      img.className =
        "w-full h-full object-contain [image-rendering:pixelated] pointer-events-none";
      img.draggable = false;
      img.alt = "Pattern preview";
      previewRef.current.appendChild(img);
    } else {
      previewRef.current.innerHTML = "";
    }
  }, [pattern, selectedColor]);

  // Don't render if on CrazyGames
  if (crazyGamesSDK.isOnCrazyGames()) {
    return null;
  }

  const showSelect = showSelectLabel && !pattern && !selectedColor;

  // Show loading spinner
  if (isLoading) {
    return (
      <button
        className={`pattern-btn m-0 p-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 transition-all duration-200 hover:scale-105 bg-[color-mix(in_oklab,var(--frenchBlue)_75%,black)] hover:brightness-[1.08] active:brightness-[0.95] rounded-lg overflow-hidden ${className}`}
        disabled
      >
        <div className="animate-spin rounded-full h-8 w-8 border border-white/20 border-t-white"></div>
      </button>
    );
  }

  return (
    <button
      className={`pattern-btn m-0 p-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 transition-all duration-200 hover:scale-105 bg-[color-mix(in_oklab,var(--frenchBlue)_75%,black)] hover:brightness-[1.08] active:brightness-[0.95] rounded-lg overflow-hidden ${className}`}
      title={translateText("territory_patterns.title")}
      onClick={onClick}
    >
      {!showSelect && (
        <span
          ref={previewRef}
          className="w-full h-full overflow-hidden flex items-center justify-center [&>img]:object-cover [&>img]:w-full [&>img]:h-full [&>img]:pointer-events-none"
        />
      )}
      {showSelect && (
        <span
          className={`${
            adaptiveSize
              ? "text-[7px] leading-tight px-0.5"
              : "text-[10px] leading-none break-words px-1"
          } font-black text-white uppercase w-full text-center`}
        >
          {translateText("territory_patterns.select_skin")}
        </span>
      )}
    </button>
  );
}
