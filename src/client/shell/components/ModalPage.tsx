import { useCallback, useEffect } from "react";
import { useNavigation, type PageId } from "../contexts/NavigationContext";

/**
 * Wrapper for inline modal pages that handles visibility and escape-to-close.
 * Replaces the Lit BaseModal + OModal pattern for inline pages.
 */
export function ModalPage({
  pageId,
  children,
  onOpen,
  onClose,
  confirmBeforeClose,
}: {
  pageId: PageId;
  children: React.ReactNode;
  onOpen?: () => void;
  onClose?: () => void;
  confirmBeforeClose?: () => boolean;
}) {
  const { currentPage, showPage } = useNavigation();
  const isVisible = currentPage === pageId;

  // Call onOpen when the page becomes visible
  useEffect(() => {
    if (isVisible) {
      onOpen?.();
    }
  }, [isVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = useCallback(() => {
    if (confirmBeforeClose && !confirmBeforeClose()) return;
    onClose?.();
    showPage("page-play");
  }, [confirmBeforeClose, onClose, showPage]);

  // Escape key to close
  useEffect(() => {
    if (!isVisible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isVisible, handleClose]);

  if (!isVisible) return null;

  return (
    <div
      className="w-full h-full page-content relative z-50"
      onClick={(e) => {
        // Close if clicking the backdrop (direct container click)
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      {children}
    </div>
  );
}

/**
 * Standard modal container styling — dark glassmorphic look.
 */
export function ModalContainer({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`h-full flex flex-col overflow-hidden bg-black/70 backdrop-blur-xl lg:rounded-2xl lg:border border-white/10 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Loading spinner consistent with BaseModal.renderLoadingSpinner().
 */
export function LoadingSpinner({
  message,
  color = "blue",
}: {
  message?: string;
  color?: "blue" | "green" | "yellow" | "white";
}) {
  const colorClasses = {
    blue: "border-blue-500/30 border-t-blue-500",
    green: "border-green-500/30 border-t-green-500",
    yellow: "border-yellow-500/30 border-t-yellow-500",
    white: "border-white/20 border-t-white",
  };

  return (
    <div className="flex flex-col items-center justify-center p-12 text-white h-full min-h-[400px]">
      <div
        className={`w-12 h-12 border-4 ${colorClasses[color]} rounded-full animate-spin mb-4`}
      />
      {message && (
        <p className="text-white/60 font-medium tracking-wide animate-pulse">
          {message}
        </p>
      )}
    </div>
  );
}
