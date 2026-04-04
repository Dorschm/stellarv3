import { useCallback, useEffect, useRef, useState } from "react";
import { tempTokenLogin } from "../../Auth";

export function TokenLoginModal() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const retryRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const attemptRef = useRef(0);

  const close = useCallback(() => {
    setIsOpen(false);
    setToken(null);
    setEmail(null);
    attemptRef.current = 0;
    if (retryRef.current) clearInterval(retryRef.current);
  }, []);

  const tryLogin = useCallback(async (tk: string) => {
    try {
      const result = await tempTokenLogin(tk);
      if (result) {
        setEmail(result);
        if (retryRef.current) clearInterval(retryRef.current);
        setTimeout(() => window.location.reload(), 1000);
        return;
      }
    } catch (e) {
      console.error("Token login failed:", e);
    }
    attemptRef.current++;
    if (attemptRef.current >= 3) {
      close();
    }
  }, [close]);

  // Listen for open-token-login events
  useEffect(() => {
    const handler = (e: Event) => {
      const tk = (e as CustomEvent).detail;
      if (!tk) return;
      setToken(tk);
      setIsOpen(true);
      attemptRef.current = 0;
      // Start polling
      tryLogin(tk);
      retryRef.current = setInterval(() => tryLogin(tk), 3000);
    };
    document.addEventListener("open-token-login", handler);
    return () => {
      document.removeEventListener("open-token-login", handler);
      if (retryRef.current) clearInterval(retryRef.current);
    };
  }, [tryLogin]);

  if (!isOpen || !token) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl p-8 max-w-sm w-full mx-4 text-center">
        {email ? (
          <>
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Login Successful</h3>
            <p className="text-white/60 text-sm">Logged in as {email}</p>
          </>
        ) : (
          <>
            <div className="w-12 h-12 mx-auto mb-4 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            <h3 className="text-lg font-bold text-white mb-2">Logging in...</h3>
            <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
              <div className="bg-blue-500 h-full rounded-full animate-pulse" style={{ width: "60%" }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
