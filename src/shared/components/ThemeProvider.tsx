"use client";
import React from "react";
import { useEffect } from "react";
import useThemeStore from "@/store/themeStore";

export function ThemeProvider({ children }) {
  const initTheme = useThemeStore((s) => s.initTheme);

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  return <>{children}</>;
}
