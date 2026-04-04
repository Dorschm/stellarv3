/**
 * Animated notification dot indicator.
 */
export function NotificationDot({
  color,
  position = "inline",
}: {
  color: "red" | "yellow";
  position?: "inline" | "absolute";
}) {
  const colorClass = color === "red" ? "bg-red-500" : "bg-yellow-400";

  if (position === "absolute") {
    return (
      <>
        <span
          className={`absolute -top-1 -right-1 w-2 h-2 ${colorClass} rounded-full animate-ping`}
        />
        <span
          className={`absolute -top-1 -right-1 w-2 h-2 ${colorClass} rounded-full`}
        />
      </>
    );
  }

  return (
    <span className="relative ml-2 shrink-0 -mt-2 w-2 h-2">
      <span
        className={`absolute inset-0 ${colorClass} rounded-full animate-ping`}
      />
      <span className={`absolute inset-0 ${colorClass} rounded-full`} />
    </span>
  );
}
