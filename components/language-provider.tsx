"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { type AppLanguage, LANGUAGE_STORAGE_KEY, translateUiText } from "@/lib/i18n";

type LanguageContextValue = { language: AppLanguage; setLanguage: (language: AppLanguage) => void; t: (value: string) => string };
const LanguageContext = createContext<LanguageContextValue | null>(null);
const originalText = new WeakMap<Text, string>();
const translatedText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const translatedAttributes = new WeakMap<Element, Map<string, string>>();
const localizedAttributes = ["aria-label", "placeholder", "title"] as const;
const languageChangeEvent = "filazoo-language-change";

function subscribeToLanguage(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(languageChangeEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(languageChangeEvent, onStoreChange);
  };
}

function getLanguageSnapshot(): AppLanguage {
  return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === "zh-CN" ? "zh-CN" : "en";
}

function getServerLanguageSnapshot(): AppLanguage {
  return "en";
}

function shouldSkip(node: Text) {
  const parent = node.parentElement;
  return !parent || Boolean(parent.closest("script, style, code, pre, [data-no-translate], [contenteditable='true']"));
}

function localizeTextNode(node: Text, language: AppLanguage) {
  if (shouldSkip(node)) return;
  const current = node.data;
  const previousTranslation = translatedText.get(node);
  if (!originalText.has(node) || (language === "zh-CN" && current !== previousTranslation)) originalText.set(node, current);
  const next = translateUiText(originalText.get(node) ?? current, language);
  translatedText.set(node, next);
  if (current !== next) node.data = next;
}

function localizeAttributes(element: Element, language: AppLanguage) {
  if (element.closest("[data-no-translate]")) return;
  let sources = originalAttributes.get(element);
  let translations = translatedAttributes.get(element);
  if (!sources) { sources = new Map(); originalAttributes.set(element, sources); }
  if (!translations) { translations = new Map(); translatedAttributes.set(element, translations); }
  for (const attribute of localizedAttributes) {
    const current = element.getAttribute(attribute);
    if (current == null) continue;
    if (!sources.has(attribute) || (language === "zh-CN" && current !== translations.get(attribute))) sources.set(attribute, current);
    const next = translateUiText(sources.get(attribute) ?? current, language);
    translations.set(attribute, next);
    if (current !== next) element.setAttribute(attribute, next);
  }
}

function localizeTree(root: Node, language: AppLanguage) {
  if (root.nodeType === Node.TEXT_NODE) { localizeTextNode(root as Text, language); return; }
  if (!(root instanceof Element)) return;
  localizeAttributes(root, language);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) localizeTextNode(node as Text, language);
    else localizeAttributes(node as Element, language);
    node = walker.nextNode();
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const language = useSyncExternalStore(subscribeToLanguage, getLanguageSnapshot, getServerLanguageSnapshot);
  const setLanguage = useCallback((next: AppLanguage) => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    window.dispatchEvent(new Event(languageChangeEvent));
  }, []);
  const t = useCallback((value: string) => translateUiText(value, language), [language]);
  const context = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  useEffect(() => {
    document.documentElement.lang = language === "zh-CN" ? "zh-CN" : "en";
    document.documentElement.dataset.language = language;
    localizeTree(document.body, language);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") localizeTextNode(mutation.target as Text, language);
        if (mutation.type === "attributes") localizeAttributes(mutation.target as Element, language);
        for (const node of mutation.addedNodes) localizeTree(node, language);
      }
    });
    observer.observe(document.body, { childList: true, characterData: true, attributes: true, attributeFilter: [...localizedAttributes], subtree: true });
    return () => observer.disconnect();
  }, [language]);

  return <LanguageContext.Provider value={context}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
