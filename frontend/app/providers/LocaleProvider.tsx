"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { AbstractIntlMessages } from "next-intl";
import enMessages from "../../messages/en.json";
import esMessages from "../../messages/es.json";
import frMessages from "../../messages/fr.json";
import zhMessages from "../../messages/zh.json";

type Locale = "en" | "es" | "fr" | "zh";

interface LocaleContextType {
  locale: Locale;
  messages: AbstractIntlMessages;
  setLocale: (locale: Locale) => void;
}

const SUPPORTED_LOCALES: Locale[] = ["en", "es", "fr", "zh"];

const STORAGE_KEY = "soropad:locale";

const MESSAGE_MAP: Record<Locale, AbstractIntlMessages> = {
  en: enMessages,
  es: esMessages,
  fr: frMessages,
  zh: zhMessages,
};

// All four supported locales are left-to-right today; keyed by locale (rather
// than hardcoded "ltr") so adding a future RTL locale (e.g. Arabic, Hebrew) is
// a one-line addition here instead of a second pass over this file.
const LOCALE_DIR: Record<Locale, "ltr" | "rtl"> = {
  en: "ltr",
  es: "ltr",
  fr: "ltr",
  zh: "ltr",
};

const LocaleContext = createContext<LocaleContextType>({
  locale: "en",
  messages: MESSAGE_MAP.en,
  setLocale: () => {},
});

export function useLocale() {
  return useContext(LocaleContext);
}

function getInitialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored && SUPPORTED_LOCALES.includes(stored)) {
      return stored;
    }
  } catch {}
  return "en";
}

interface LocaleProviderProps {
  children: ReactNode;
}

export function LocaleProvider({ children }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>("en");
  const [messages, setMessages] = useState<AbstractIntlMessages>(MESSAGE_MAP.en);

  // Seed from localStorage only after mount to avoid hydration mismatch; a
  // lazy initializer would read a different value on server vs client.
  useEffect(() => {
    const storedLocale = getInitialLocale();
    if (storedLocale !== "en") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- external-store seed (localStorage), must run post-hydration
      setLocaleState(storedLocale);
      setMessages(MESSAGE_MAP[storedLocale]);
    }
  }, []);

  // Keep the document's declared language and direction in sync with the
  // selected locale. Screen readers, "translate this page" prompts, and
  // hyphenation/quotation/font-fallback all resolve against `lang`, not the
  // rendered text — leaving it at "en" breaks all of those for every other
  // locale even though the visible strings are correctly translated.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
    document.documentElement.dir = LOCALE_DIR[locale];
  }, [locale]);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    setMessages(MESSAGE_MAP[newLocale]);
    try {
      localStorage.setItem(STORAGE_KEY, newLocale);
    } catch {}
  };

  return (
    <LocaleContext.Provider value={{ locale, messages, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}
