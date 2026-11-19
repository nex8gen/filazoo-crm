"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { type AppLanguage, LANGUAGE_STORAGE_KEY } from "@/lib/app-language";
import { createUiLocalizer, type UiTranslator } from "@/lib/ui-localization";

type LanguageContextValue = { language: AppLanguage; setLanguage: (language: AppLanguage) => void; t: (value: string) => string };
const LanguageContext = createContext<LanguageContextValue | null>(null);
const languageChangeEvent = "filazoo-language-change";
type Translator = UiTranslator;
const identityTranslator: Translator = (value) => value;
let translatorRequest: Promise<Translator> | undefined;
function loadTranslator() {
  return translatorRequest ??= import("@/lib/i18n").then(module => module.translateUiText).catch(error => {
    translatorRequest = undefined;
    throw error;
  });
}

function subscribeToLanguage(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(languageChangeEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(languageChangeEvent, onStoreChange);
  };
}

function getLanguageSnapshot(): AppLanguage {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === "zh-CN" ? "zh-CN" : "en";
  } catch {
    return document.documentElement.lang === "zh-CN" ? "zh-CN" : "en";
  }
}

function getServerLanguageSnapshot(): AppLanguage {
  return "en";
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const language = useSyncExternalStore(subscribeToLanguage, getLanguageSnapshot, getServerLanguageSnapshot);
  const [translateUiText, setTranslator] = useState<Translator>(() => identityTranslator);
  const localizer = useMemo(() => createUiLocalizer((value, locale) => translateUiText(value, locale)), [translateUiText]);
  const languageRequest = useRef(0);
  useEffect(() => {
    if (language !== "zh-CN") return;
    let active = true;
    void loadTranslator().then((translate) => { if (active) setTranslator(() => translate); }).catch(() => { /* A later selection retries the language download. */ });
    return () => { active = false; };
  }, [language]);
  const setLanguage = useCallback((next: AppLanguage) => {
    const request = ++languageRequest.current;
    const apply = () => {
      if (request !== languageRequest.current) return;
      document.documentElement.lang = next;
      try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Keep language switching available when storage is blocked. */ }
      window.dispatchEvent(new Event(languageChangeEvent));
    };
    // Load copy before committing the preference, so switching never selects a
    // Chinese interface while its controls are still waiting for translations.
    if (next === "zh-CN") void loadTranslator().then(translate => {
      if (request !== languageRequest.current) return;
      setTranslator(() => translate);
      apply();
    }).catch(() => { /* Keep the current language; selecting again retries. */ });
    else apply();
  }, []);
  const t = useCallback((value: string) => translateUiText(value, language), [language, translateUiText]);
  const context = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  useLayoutEffect(() => {
    document.documentElement.lang = language === "zh-CN" ? "zh-CN" : "en";
    document.documentElement.dataset.language = language;
    if (translateUiText === identityTranslator) return;
    return localizer.observe(document, language);
  }, [language, translateUiText, localizer]);

  return <LanguageContext.Provider value={context}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
