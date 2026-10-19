<div align="center">
  <img src="./logo.png" alt="Behead Browser" width="180" />
  <summary><h1>Behead Browser</h1></summary>
  <sup>by <b>vuln.industries</b></sup>
</div>

---

<p align="center">
  Undetected, display-free headless Chromium on top of <a href="https://github.com/Kaliiiiiiiiii-Vinyzu/patchright">Patchright</a> with full User-Agent Client Hints, worker target alignment, and optional C++-level hardware/GPU spoofing via the <a href="https://github.com/Vuln-Inc/behead-browser/tree/cloak"><code>cloak</code></a> branch.
</p>

---

## Overview

Running Patchright in `headless: true` avoids `Runtime.enable` leaks, but Chromium still exposes `HeadlessChrome` in `navigator.userAgent`, `sec-ch-ua` request headers, high-entropy `navigator.userAgentData` (`brands` and `fullVersionList`), and worker execution contexts (`Worker`, `SharedWorker`, `ServiceWorker`), while defaulting to headless layout flags that break viewport and rendering checks.

**Behead Browser** eliminates those headless leaks without Xvfb, `addInitScript` injection, or prototype tampering. It probes the installed Chromium binary once per process on a local loopback origin, preserves the native host OS, architecture, bitness, form factors, and browser version, and attaches browser-level CDP target listeners to synchronize Client Hints across pages, iframes, popups, dedicated workers, shared workers, and service workers before worker scripts execute.

## Branches: Stock Engine (`main`) vs Hardware Spoofing Engine (`cloak`)

- **`main` (Stock Patchright Engine):** Zero-lie headless wrapper around stock Patchright Chromium. Preserves your machine's real native hardware and OS while eliminating `HeadlessChrome` leaks across HTTP headers, pages, popups, and all worker scopes (`0% headless`, `0% stealth`, `0 lies` on CreepJS).
- **[`cloak` branch](https://github.com/Vuln-Inc/behead-browser/tree/cloak) (CloakBrowser C++ Engine over Patchright):** Drives CloakBrowser's C++-patched Chromium binary through Patchright instead of unpatched `playwright-core`. Eliminates `SwiftShader` WebGL hardware leaks on GPU-less Linux VPS servers (`likeHeadlessRating: 25%`, `headlessRating: 0%`, `stealthRating: 0%`), rotates hardware GPUs (`NVIDIA GeForce RTX 4070 SUPER`, `RTX 3070`, `RTX 3050 Ti`), CPU cores, RAM, and Canvas/Audio/DOMRect fingerprints per session seed (`fingerprintSeed`), and supports a zero-lie hardware rotation mode (`fingerprintNoise: false` -> `0 lies` on CreepJS).

## What It Does

- Uses full Chromium's modern headless mode (`channel: "chromium"`, `headless: true`) instead of `chromium-headless-shell`.
- Derives the real browser version, platform, architecture, bitness, form factors, and UA Client Hints dynamically from the installed binary — works across Linux, macOS, and Windows with zero hardcoded values.
- Removes `HeadlessChrome` identifiers while preserving every other native browser-provided value.
- Keeps HTTP request headers, page JavaScript, popups, dedicated workers, shared workers, and service workers internally consistent.
- Attaches CDP `Emulation.setUserAgentOverride` automatically to page, iframe, `shared_worker`, and `service_worker` targets on creation so popups, `context.newPage()`, and all worker scopes (including cached Service Workers on reopened persistent profiles) inherit full high-entropy Client Hints automatically.
- Uses no `addInitScript`, navigator prototype tampering, hardcoded User-Agent strings, or Xvfb.

## Headless Comparison (`headless: true`, no Xvfb, GPU-less Linux VPS)

| Detector / Metric | Patchright (Standalone) | CloakBrowser (Standalone) | Behead Browser (`main`) | Behead Browser ([`cloak` branch](https://github.com/Vuln-Inc/behead-browser/tree/cloak)) |
| :--- | :--- | :--- | :--- | :--- |
| **CreepJS `headlessRating`** | `67%` (`HeadlessChrome` in UA & Workers) | `0%` | **`0%`** | **`0%`** |
| **CreepJS `stealthRating`** | `0%` | `0%` | **`0%`** | **`0%`** |
| **CreepJS `likeHeadlessRating` (GPU-less VPS)** | `50%` (`SwiftShader`) | `31%` (`hasVvpScreenRes` viewport mismatch) | **`50%`** (`SwiftShader`) | **`25%` (Hardware GPU, no SwiftShader)** |
| **CreepJS `liesCount`** | `0` | `5` (Canvas, AudioBuffer, DOMRect noise) | **`0`** | **`0`** (`fingerprintNoise: false`) / `5` (noise on) |
| **CDP `Runtime.enable` Leak** | Not sent | Sent (uses stock `playwright-core`) | **Not sent** | **Not sent** |
| **Worker High-Entropy Client Hints** | Leaks `HeadlessChrome` (or blank if `--user-agent` is set) | Populated | **Populated (`Page`, `Worker`, `SharedWorker`, `ServiceWorker`)** | **Populated (`Page`, `Worker`, `SharedWorker`, `ServiceWorker`)** |
| **Hardware / GPU Fingerprint Rotation** | None (`SwiftShader` on VPS) | Per-seed (`--fingerprint=<seed>`) | Native host hardware | **Per-seed (`fingerprintSeed`, real RTX GPUs)** |
| **Cloudflare Turnstile (`cf_clearance`)** | Fails in headless | Passes | **Passes** | **Passes** |
| **BrowserScan Bot Detection** | Fails (`HeadlessChrome` UA) | Normal | **Normal** | **Normal** |
| **SannySoft (`bot.sannysoft.com`)** | Fails (`HeadlessChrome` UA) | `0` failed checks | **`0` failed checks** | **`0` failed checks** |

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

## Hardware Spoofing & Fingerprint Rotation (`cloak` branch)

When running headless on a GPU-less Linux VPS where `SwiftShader` WebGL rendering or identical hardware hashes across sessions are undesirable, switch to the [`cloak`](https://github.com/Vuln-Inc/behead-browser/tree/cloak) branch:

```bash
git checkout cloak
bun install
```

```ts
import { launchBeheadBrowser } from "./src/index.js"

const browser = await launchBeheadBrowser({
  fingerprintSeed: 55123,
  fingerprintNoise: false, // 0 lies on CreepJS while rotating hardware/GPU profile per seed
  timezone: "America/New_York",
  locale: "en-US",
})
```

Do not layer generic "stealth" scripts on top. In particular, avoid redefining `navigator.webdriver`, `navigator.languages`, `navigator.userAgentData`, or `window.chrome`; those modifications commonly create contradictions that are easier to detect than Patchright itself.
