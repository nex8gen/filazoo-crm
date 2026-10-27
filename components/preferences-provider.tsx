"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { defaultUserPreferences, type UserPreferences } from "@/lib/user-preferences";

const PreferencesContext = createContext<{ preferences: UserPreferences; setPreferences: (value: UserPreferences) => void }>({ preferences: defaultUserPreferences, setPreferences: () => {} });

export function PreferencesProvider({ initial, children }: { initial: UserPreferences; children: React.ReactNode }) {
  const [preferences, setPreferences] = useState(initial);
  useEffect(() => {
    document.documentElement.dataset.density = preferences.density;
    document.documentElement.dataset.reduceMotion = String(preferences.reduceMotion);
    return () => {
      delete document.documentElement.dataset.density;
      delete document.documentElement.dataset.reduceMotion;
    };
  }, [preferences.density, preferences.reduceMotion]);
  return <PreferencesContext.Provider value={{ preferences, setPreferences }}>{children}</PreferencesContext.Provider>;
}

export const usePreferences = () => useContext(PreferencesContext);
