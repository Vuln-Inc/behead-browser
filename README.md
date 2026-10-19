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

**Behead Browser** probes the installed Chromium binary once per process on a local loopback origin, strips only `HeadlessChrome` while keeping the real host OS, architecture, bitness, form factors, and browser version intact, and applies consistent Client Hints across pages, popups, dedicated workers, shared workers, and service workers.

## What It Does

- Uses full Chromium's modern headless mode (`channel: "chromium"`, `headless: true`) instead of `chromium-headless-shell`.
- Derives the real browser version, platform, architecture, bitness, form factors, and UA Client Hints dynamically from the installed binary — works across Linux, macOS, and Windows with zero hardcoded values.
- Removes `HeadlessChrome` identifiers while preserving every other native browser-provided value.
- Strips Playwright's default `--hide-scrollbars` flag in headless mode so layout scrollbar measurements (`15px`) match headful desktop sessions.
- Keeps HTTP request headers, page JavaScript, popups, dedicated workers, shared workers, and service workers internally consistent.
- Attaches CDP `Emulation.setUserAgentOverride` automatically to page, iframe, `shared_worker`, and `service_worker` targets on creation so popups, `context.newPage()`, and all worker scopes inherit full high-entropy Client Hints automatically.
- Uses no `addInitScript`, navigator prototype tampering, hardcoded User-Agent strings, or Xvfb.

## Headless Comparison (`headless: true`, no Xvfb)

| Check / Detector | Patchright (Standalone) | CloakBrowser (Standalone) | Behead Browser |
| :--- | :--- | :--- | :--- |
| **CreepJS `headless`** | `67%` (`HeadlessChrome` in UA & Workers) | `0%` | **`0%`** |
| **CreepJS `stealth`** | `0%` | `0%` | **`0%`** |
| **CreepJS `lies`** | `0` | `5` (Canvas, AudioBuffer, DOMRect noise) | **`0`** |
| **CDP `Runtime.enable` Leak** | Not sent | Sent (uses stock `playwright-core`) | **Not sent** |
| **Worker High-Entropy Client Hints** | Leaks `HeadlessChrome` (or blank if `--user-agent` is set) | Populated | **Populated (`Page`, `Worker`, `SharedWorker`, `ServiceWorker`)** |
| **Headless Scrollbar Width** | `0px` (`--hide-scrollbars` injected) | `0px` (`--hide-scrollbars` injected) | **`15px` (native desktop)** |
| **Cloudflare Turnstile (`cf_clearance`)** | Fails in headless | Passes | **Passes** |
| **BrowserScan Bot Detection** | Fails (`HeadlessChrome` UA) | Normal | **Normal** |
| **SannySoft (`bot.sannysoft.com`)** | Fails (`HeadlessChrome` UA) | `0` failed checks | **`0` failed checks** |

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

`session.context` remains available for cookies, permissions, storage state, downloads, and other normal Playwright APIs. Pages created through `session.newPage()`, `session.context.newPage()`, or `window.open()` popups automatically receive the Client Hints configuration.

## Persistent Profile & Session State

Launch a persistent profile directory on disk:

```ts
import { launchPersistentBeheadSession } from "./src/index.js"

const session = await launchPersistentBeheadSession("./user-data")
const page = await session.newPage()
```

Or save and restore cookies and local storage using Playwright storage state:

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

Do not layer generic "stealth" scripts on top. In particular, avoid redefining `navigator.webdriver`, `navigator.languages`, `navigator.userAgentData`, or `window.chrome`; those modifications commonly create contradictions that are easier to detect than Patchright itself.
