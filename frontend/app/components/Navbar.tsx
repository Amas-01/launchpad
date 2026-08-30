"use client";

import Link from "next/link";
import { useNetwork } from "../providers/NetworkProvider";
import { WalletButton } from "./WalletButton";
import { SettingsModal } from "./SettingsModal";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { NotificationCenter } from "./NotificationCenter";
import { Globe, ChevronDown, Menu, X } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Top navbar — extracted as a client component so wallet state
 * (via `useWallet` inside `<WalletButton>`) works with React hooks.
 */
export function Navbar() {
  const t = useTranslations("navigation");
  const common = useTranslations("common");
  const accessibility = useTranslations("accessibility");
  const navLinks = [
    { href: "/deploy", label: t("deploy") },
    { href: "/dashboard", label: t("dashboard") },
    { href: "/dashboard/allowances", label: t("allowances") },
    { href: "/airdrop", label: t("airdrop") },
    { href: "/my-account", label: t("myAccount") },
  ] as const;

  const navClassName =
    "fixed top-0 z-50 w-full border-b border-white/5 bg-void-900/80 backdrop-blur-lg";
  const containerClassName =
    "mx-auto flex h-16 max-w-7xl items-center justify-between px-6";
  const navLinkClassName =
    "text-sm text-gray-400 transition-colors hover:text-white";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className={navClassName}>
      <div className={containerClassName}>
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 text-lg font-bold">
          <span className="text-2xl">🚀</span>
          <span className="gradient-text">SoroPad</span>
        </Link>

        {/* Desktop nav links */}
        <div className="hidden items-center gap-6 md:flex">
          {navLinks.map(({ href, label }) => (
            <Link key={href} href={href} className={navLinkClassName}>
              {label}
            </Link>
          ))}
        </div>

        {/* Right side — wallet, settings & network */}
        <div className="flex items-center gap-2 md:gap-3">
          {/* Desktop-only controls */}
          <div className="hidden items-center gap-2 md:flex md:gap-3">
            <LanguageSwitcher />
            <NetworkSwitcher />
            <NotificationCenter />
            <SettingsModal />
          </div>

          {/* Wallet connect — visible on all screens */}
          <WalletButton />

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white md:hidden"
            aria-label={
              mobileMenuOpen
                ? accessibility("closeMenu")
                : accessibility("openMenu")
            }
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu"
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile nav drawer */}
      {mobileMenuOpen && (
        <div
          id="mobile-menu"
          className="border-t border-white/5 bg-void-900/95 backdrop-blur-lg md:hidden"
        >
          <div className="flex flex-col gap-1 px-6 py-4">
            {/* Navigation links */}
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                {link.label}
              </Link>
            ))}

            {/* Divider */}
            <div className="my-2 border-t border-white/5" />

            {/* Mobile controls */}
            <div className="flex flex-col gap-3 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Language</span>
                <LanguageSwitcher />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Network</span>
                <NetworkSwitcher />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  {common("settings")}
                </span>
                <SettingsModal />
              </div>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
function NetworkSwitcher() {
  const { networkConfig, setNetwork, mounted } = useNetwork();
  const [isOpen, setIsOpen] = useState(false);

  if (!mounted) {
    return (
      <div className="h-8 w-24 animate-pulse rounded-lg border border-white/5 bg-white/5" />
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-white/10"
      >
        <Globe className="size-3.5 text-stellar-400" />
        <span className="capitalize">{networkConfig.network}</span>
        <ChevronDown className="size-3 text-gray-500" />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-32 origin-top-right rounded-xl border border-white/10 bg-void-800 p-1 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
            <button
              onClick={() => {
                setNetwork("testnet");
                setIsOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                networkConfig.network === "testnet"
                  ? "bg-stellar-500/10 text-stellar-400"
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              Testnet
            </button>
            <button
              onClick={() => {
                setNetwork("mainnet");
                setIsOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                networkConfig.network === "mainnet"
                  ? "bg-amber-500/10 text-amber-500"
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              Mainnet
            </button>
          </div>
        </>
      )}
    </div>
  );
}
