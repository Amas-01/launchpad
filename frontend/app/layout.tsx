import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "./providers/WalletProvider";
import { SettingsProvider } from "./providers/SettingsProvider";
import { NetworkProvider } from "./providers/NetworkProvider";
import { AccessibilityProvider } from "./providers/AccessibilityProvider";
import { LocaleProvider } from "./providers/LocaleProvider";
import { I18nProvider } from "./providers/I18nProvider";
import { ToastProvider } from "./providers/ToastProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Navbar } from "./components/Navbar";
import { MainnetWarning } from "./components/MainnetWarning";
import Footer from "./components/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000",
  ),
  title: "SoroPad — Soroban Token Launchpad",
  description:
    "Deploy and manage SEP-41 compliant tokens on Stellar Soroban. No code required.",
  openGraph: {
    title: "SoroPad — Soroban Token Launchpad",
    description:
      "Deploy and manage SEP-41 compliant tokens on Stellar Soroban. No code required.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}
      >
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <LocaleProvider>
          <ToastProvider>
            <I18nProvider>
              <NetworkProvider>
                <SettingsProvider>
                  <WalletProvider>
                    <AccessibilityProvider>
                      <Navbar />
                      <MainnetWarning />
                      <main id="main-content" className="pt-16" role="main">
                        <ErrorBoundary>{children}</ErrorBoundary>
                      </main>
                      <Footer />
                    </AccessibilityProvider>
                  </WalletProvider>
                </SettingsProvider>
              </NetworkProvider>
            </I18nProvider>
          </ToastProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
