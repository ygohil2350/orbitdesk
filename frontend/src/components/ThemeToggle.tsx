import { Moon, Sun } from "lucide-react";
import { useState } from "react";

const storageKey = "orbitdesk_theme";

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  function toggleTheme() {
    const nextDark = !dark;
    document.documentElement.classList.toggle("dark", nextDark);
    document.documentElement.style.colorScheme = nextDark ? "dark" : "light";
    localStorage.setItem(storageKey, nextDark ? "dark" : "light");
    setDark(nextDark);
    window.dispatchEvent(new CustomEvent("orbitdesk:theme", { detail: { dark: nextDark } }));
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
      title={`Switch to ${dark ? "light" : "dark"} mode`}
      className={`grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white ${className}`}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
