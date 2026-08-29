/**
 * Tests for LocaleProvider syncing <html lang>/dir to the selected locale
 * (issue #403). Previously the visible text changed but `document.documentElement.lang`
 * stayed "en" forever, breaking screen readers, "translate this page", and
 * hyphenation/font-fallback for the other three locales.
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocaleProvider, useLocale } from "../LocaleProvider";

function LocaleSwitcher() {
  const { locale, setLocale } = useLocale();
  return (
    <div>
      <span data-testid="current-locale">{locale}</span>
      <button onClick={() => setLocale("es")}>Spanish</button>
      <button onClick={() => setLocale("fr")}>French</button>
      <button onClick={() => setLocale("zh")}>Chinese</button>
      <button onClick={() => setLocale("en")}>English</button>
    </div>
  );
}

describe("LocaleProvider — <html lang>/dir sync", () => {
  beforeEach(() => {
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";
    window.localStorage.clear();
  });

  it("sets document.documentElement.lang to the default locale on mount", () => {
    render(
      <LocaleProvider>
        <LocaleSwitcher />
      </LocaleProvider>,
    );

    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("updates document.documentElement.lang when the locale changes", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <LocaleSwitcher />
      </LocaleProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Spanish" }));

    expect(screen.getByTestId("current-locale")).toHaveTextContent("es");
    expect(document.documentElement.lang).toBe("es");
  });

  it("updates lang for every supported locale, not just the default", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <LocaleSwitcher />
      </LocaleProvider>,
    );

    await user.click(screen.getByRole("button", { name: "French" }));
    expect(document.documentElement.lang).toBe("fr");

    await user.click(screen.getByRole("button", { name: "Chinese" }));
    expect(document.documentElement.lang).toBe("zh");

    await user.click(screen.getByRole("button", { name: "English" }));
    expect(document.documentElement.lang).toBe("en");
  });

  it("keeps dir in sync alongside lang so a future RTL locale needs no second pass", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <LocaleSwitcher />
      </LocaleProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Chinese" }));

    expect(document.documentElement.lang).toBe("zh");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("restores a previously stored locale on mount and syncs lang immediately", async () => {
    window.localStorage.setItem("soropad:locale", "fr");

    await act(async () => {
      render(
        <LocaleProvider>
          <LocaleSwitcher />
        </LocaleProvider>,
      );
    });

    expect(screen.getByTestId("current-locale")).toHaveTextContent("fr");
    expect(document.documentElement.lang).toBe("fr");
  });
});
