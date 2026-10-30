"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { type AppLanguage, LANGUAGE_STORAGE_KEY } from "@/lib/app-language";
import { localizedSource } from "@/lib/localized-source";

type LanguageContextValue = { language: AppLanguage; setLanguage: (language: AppLanguage) => void; t: (value: string) => string };
const LanguageContext = createContext<LanguageContextValue | null>(null);
const originalText = new WeakMap<Text, string>();
const translatedText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const translatedAttributes = new WeakMap<Element, Map<string, string>>();
const localizedAttributes = ["aria-label", "aria-description", "aria-valuetext", "placeholder", "title", "alt"] as const;
const languageChangeEvent = "filazoo-language-change";
type Translator = (value: string, language: AppLanguage) => string;
const identityTranslator: Translator = (value) => value;

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

function shouldSkip(node: Text) {
  const parent = node.parentElement;
  return !parent || Boolean(parent.closest("script, style, code, pre, [data-no-translate], [translate='no'], [contenteditable]:not([contenteditable='false'])"));
}

function localizeTextNode(node: Text, language: AppLanguage, translateUiText: Translator) {
  if (shouldSkip(node)) return;
  const current = node.data;
  const previousTranslation = translatedText.get(node);
  originalText.set(node, localizedSource(current, originalText.get(node), previousTranslation));
  const next = translateUiText(originalText.get(node) ?? current, language);
  translatedText.set(node, next);
  if (current !== next) node.data = next;
}

function localizeAttributes(element: Element, language: AppLanguage, translateUiText: Translator) {
  if (element.closest("[data-no-translate], [translate='no'], [contenteditable]:not([contenteditable='false'])")) return;
  let sources = originalAttributes.get(element);
  let translations = translatedAttributes.get(element);
  if (!sources) { sources = new Map(); originalAttributes.set(element, sources); }
  if (!translations) { translations = new Map(); translatedAttributes.set(element, translations); }
  for (const attribute of localizedAttributes) {
    const current = element.getAttribute(attribute);
    if (current == null) continue;
    sources.set(attribute, localizedSource(current, sources.get(attribute), translations.get(attribute)));
    const next = translateUiText(sources.get(attribute) ?? current, language);
    translations.set(attribute, next);
    if (current !== next) element.setAttribute(attribute, next);
  }
}

function localizeTree(root: Node, language: AppLanguage, translateUiText: Translator) {
  if (root.nodeType === Node.TEXT_NODE) { localizeTextNode(root as Text, language, translateUiText); return; }
  if (!(root instanceof Element)) return;
  localizeAttributes(root, language, translateUiText);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) localizeTextNode(node as Text, language, translateUiText);
    else localizeAttributes(node as Element, language, translateUiText);
    node = walker.nextNode();
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const language = useSyncExternalStore(subscribeToLanguage, getLanguageSnapshot, getServerLanguageSnapshot);
  const [translateUiText, setTranslator] = useState<Translator>(() => identityTranslator);
  useEffect(() => {
    if (language !== "zh-CN") return;
    let active = true;
    void import("@/lib/i18n").then((module) => { if (active) setTranslator(() => module.translateUiText); }).catch(() => { /* Keep the English interface usable if the language chunk cannot load. */ });
    return () => { active = false; };
  }, [language]);
  const setLanguage = useCallback((next: AppLanguage) => {
    document.documentElement.lang = next;
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Keep language switching available when storage is blocked. */ }
    window.dispatchEvent(new Event(languageChangeEvent));
  }, []);
  const t = useCallback((value: string) => translateUiText(value, language), [language, translateUiText]);
  const context = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  useEffect(() => {
    document.documentElement.lang = language === "zh-CN" ? "zh-CN" : "en";
    document.documentElement.dataset.language = language;
    localizeTree(document.body, language, translateUiText);
    localizeTree(document.querySelector("title") ?? document.head, language, translateUiText);
    // Server and React output is already English. Restore any translated nodes
    // above when switching back, then avoid observing every DOM update in English.
    if (language === "en") return;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") localizeTextNode(mutation.target as Text, language, translateUiText);
        if (mutation.type === "attributes") localizeAttributes(mutation.target as Element, language, translateUiText);
        for (const node of mutation.addedNodes) localizeTree(node, language, translateUiText);
      }
    });
    observer.observe(document.body, { childList: true, characterData: true, attributes: true, attributeFilter: [...localizedAttributes], subtree: true });
    observer.observe(document.head, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [language, translateUiText]);

  return <LanguageContext.Provider value={context}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
