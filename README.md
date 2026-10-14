<div align="center">
  <img src="./logo.png" alt="Behead Browser" width="180" />
  <summary><h1>Behead Browser</h1></summary>
  <sup>by <b>vuln.industries</b></sup>
</div>

---

<p align="center">
  Undetected, display-free headless Chromium on top of <a href="https://github.com/Kaliiiiiiiiii-Vinyzu/patchright">Patchright</a> that strips <code>HeadlessChrome</code> from User-Agent Client Hints and worker contexts without Xvfb or hardcoded fingerprints.
</p>

---

## Overview

Running Patchright in `headless: true` avoids `Runtime.enable` leaks, but Chromium still exposes `HeadlessChrome` in `navigator.userAgent`, `sec-ch-ua` request headers, high-entropy `navigator.userAgentData` (`brands` and `fullVersionList`), and worker execution contexts.

**Behead Browser** probes the installed Chromium binary once per process on a local loopback origin, strips only `HeadlessChrome` while keeping the real host OS, architecture, bitness, form factors, and browser version intact, and applies consistent Client Hints across pages, popups, and dedicated workers.

## What It Does

- Uses full Chromium's modern headless mode (`channel: "chromium"`, `headless: true`) instead of `chromium-headless-shell`.
- Derives the real browser version, platform, architecture, bitness, form factors, and UA Client Hints dynamically from the installed binary — works across Linux, macOS, and Windows with zero hardcoded values.
- Removes `HeadlessChrome` identifiers while preserving every other native browser-provided value.
- Keeps HTTP request headers, page JavaScript, popups, and dedicated workers internally consistent.
- Disables service and shared workers (`--disable-features=SharedWorker`, `serviceWorkers: "block"`) because Chromium does not propagate high-entropy metadata overrides to those targets.
- Uses no `addInitScript`, navigator prototype tampering, hardcoded User-Agent strings, or Xvfb.

## Setup

```bash
bun install
bunx patchright install chromium
bun test
bun run build
```

Run the example:

```bash
bun run start
```

Run an optional live Google smoke test:

```bash
bun run smoke:google -- "your query"
```

## Usage

```ts
import { launchBeheadBrowser } from "./src/index.js"

const browser = await launchBeheadBrowser()

try {
  const session = await browser.newSession()
  const page = await session.newPage()

  await page.goto("https://example.com")
  console.log(await page.title())

  await session.close()
} finally {
  await browser.close()
}
```

Always create pages through `session.newPage()`. Calling `session.context.newPage()` directly bypasses the per-page Client Hints configuration.

`session.context` remains available for cookies, permissions, storage state, downloads, and other normal Playwright APIs.

Prepare a popup before interacting with it:

```ts
const popupPromise = page.waitForEvent("popup")
await page.getByRole("link", { name: "Open" }).click()
const popup = await session.preparePage(await popupPromise)
```

## Session State

Save and restore cookies and local storage using normal Playwright storage state:

```ts
const state = await session.context.storageState({ path: "state.json" })
const nextSession = await browser.newSession({ storageState: state })
```

## Proxy

```ts
const browser = await launchBeheadBrowser({
  proxy: {
    server: "http://127.0.0.1:8080",
    username: "user",
    password: "password",
  },
})
```

## Important Limits

Patchright's maintainer explicitly states that perfect headless indistinguishability requires a custom Chromium build. Behead Browser closes the concrete leaks verified in request headers and JavaScript execution contexts, but no automation configuration can guarantee permanent invisibility against every site.

Service and shared workers are intentionally unavailable. If a target requires either feature, use a purpose-built Chromium fork or headed browser instead of reintroducing an inconsistent headless fingerprint.

Do not layer generic "stealth" scripts on top. In particular, avoid redefining `navigator.webdriver`, `navigator.languages`, `navigator.userAgentData`, or `window.chrome`; those modifications commonly create contradictions that are easier to detect than Patchright itself.
