"use client";

import { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { useLocale } from "./LocaleProvider";

interface I18nProviderProps {
  children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const { locale, messages: contextMessages } = useLocale();

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={contextMessages}
      timeZone="UTC"
    >
      {children}
    </NextIntlClientProvider>
  );
}
