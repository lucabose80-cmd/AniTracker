"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, UserPlus } from "lucide-react";
import { createUserProfile } from "@/lib/db/users";

function mapFirebaseAuthError(err: unknown, fallback: string): string {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";

  switch (code) {
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "E-Mail oder Passwort ist leider nicht korrekt.";
    case "auth/email-already-in-use":
      return "Für diese E-Mail existiert bereits ein Account.";
    case "auth/weak-password":
      return "Das Passwort muss mindestens 6 Zeichen lang sein.";
    case "auth/invalid-email":
      return "Bitte gib eine gültige E-Mail-Adresse ein.";
    case "auth/too-many-requests":
      return "Zu viele Versuche. Bitte warte kurz und probiere es erneut.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Anmeldung wurde abgebrochen.";
    case "auth/network-request-failed":
      return "Keine Netzwerkverbindung. Bitte prüfe dein Internet.";
    default:
      return fallback;
  }
}

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);
    if (!auth) {
      setError("Firebase ist nicht konfiguriert.");
      return;
    }

    setIsSubmitting(true);
    try {
      const userCredential = isLogin
        ? await signInWithEmailAndPassword(auth, email, password)
        : await createUserWithEmailAndPassword(auth, email, password);

      const user = userCredential.user;

      try {
        await createUserProfile(
          user.uid,
          user.email?.split("@")[0] || "User",
          user.email || ""
        );
      } catch (dbError) {
        console.error("Konnte User Profil nicht in Firestore anlegen:", dbError);
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(
        mapFirebaseAuthError(
          err,
          isLogin
            ? "Anmeldung fehlgeschlagen. Bitte prüfe deine Daten."
            : "Registrierung fehlgeschlagen. Bitte versuche es erneut."
        )
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleAuth = async () => {
    if (isSubmitting) return;
    setError(null);
    if (!auth) {
      setError("Firebase ist nicht konfiguriert.");
      return;
    }

    setIsSubmitting(true);
    const provider = new GoogleAuthProvider();
    try {
      const userCredential = await signInWithPopup(auth, provider);
      const user = userCredential.user;

      try {
        await createUserProfile(
          user.uid,
          user.displayName || user.email?.split("@")[0] || "User",
          user.email || ""
        );
      } catch (dbError) {
        console.error("Konnte User Profil nicht in Firestore anlegen:", dbError);
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(mapFirebaseAuthError(err, "Google Login fehlgeschlagen."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-800 bg-surface-elevated p-6 shadow-xl">
        <h2 className="mb-6 text-center text-2xl font-bold text-white">
          {isLogin ? "Willkommen zurück" : "Account erstellen"}
        </h2>

        {error && (
          <div className="mb-4 rounded-lg bg-red-900/50 border border-red-500/30 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleEmailAuth} className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">
              E-Mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isSubmitting}
              className="w-full rounded-lg border border-gray-700 bg-app p-3 text-white focus:border-accent-border-strong focus:outline-none disabled:opacity-50"
              placeholder="deine@email.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">
              Passwort
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isSubmitting}
              className="w-full rounded-lg border border-gray-700 bg-app p-3 text-white focus:border-accent-border-strong focus:outline-none disabled:opacity-50"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-accent p-3 font-semibold text-white transition hover:bg-accent-hover active:scale-95 disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 size={18} className="animate-spin" />
            ) : isLogin ? (
              <LogIn size={20} />
            ) : (
              <UserPlus size={20} />
            )}
            {isSubmitting
              ? "Bitte warten..."
              : isLogin
              ? "Anmelden"
              : "Registrieren"}
          </button>
        </form>

        <div className="my-6 flex items-center gap-4">
          <div className="h-px flex-1 bg-gray-800" />
          <span className="text-sm text-gray-500">ODER</span>
          <div className="h-px flex-1 bg-gray-800" />
        </div>

        <button
          type="button"
          onClick={handleGoogleAuth}
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-700 bg-app p-3 font-semibold text-white transition hover:bg-gray-800 active:scale-95 disabled:opacity-50"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Mit Google anmelden
        </button>

        <p className="mt-6 text-center text-sm text-gray-400">
          {isLogin ? "Noch keinen Account?" : "Bereits einen Account?"}{" "}
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              setIsLogin(!isLogin);
              setError(null);
            }}
            className="font-semibold text-accent-text hover:underline"
          >
            {isLogin ? "Hier registrieren" : "Hier anmelden"}
          </button>
        </p>
      </div>
    </div>
  );
}
