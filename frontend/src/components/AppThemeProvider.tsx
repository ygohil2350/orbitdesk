import { createTheme, ThemeProvider } from "@mui/material/styles";
import { useEffect, useMemo, useState } from "react";

const themeEvent = "orbitdesk:theme";

export default function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      setDark((event as CustomEvent<{ dark: boolean }>).detail.dark);
    };
    window.addEventListener(themeEvent, handleThemeChange);
    return () => window.removeEventListener(themeEvent, handleThemeChange);
  }, []);

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: dark ? "dark" : "light",
          primary: { main: "#4f46e5" },
          background: {
            default: dark ? "#020617" : "#f8fafc",
            paper: dark ? "#0f172a" : "#ffffff",
          },
        },
        shape: { borderRadius: 10 },
        typography: {
          fontFamily:
            "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        },
        components: {
          MuiMenuItem: { styleOverrides: { root: { borderRadius: 8, margin: "2px 6px" } } },
          MuiPopover: { defaultProps: { disableScrollLock: true } },
        },
      }),
    [dark],
  );

  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
