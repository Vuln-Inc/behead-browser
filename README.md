<div align="center">
  <img src="./logo.png" alt="Behead Browser" width="180" />
  <summary><h1>Behead Browser</h1></summary>
  <sup>by <b>vuln.industries</b></sup>
</div>

---

<p align="center">
  Undetected, display-free headless Chromium on top of <a href="https://github.com/Kaliiiiiiiiii-Vinyzu/patchright">Patchright</a> with full User-Agent Client Hints, worker target alignment, and optional C++ hardware/GPU spoofing via the <a href="https://github.com/Vuln-Inc/behead-browser/tree/cloak"><code>cloak</code></a> branch.
</p>

---

## Overview

Stock Patchright in `headless: true` avoids `Runtime.enable` leaks, but Chromium still exposes `HeadlessChrome` in `navigator.userAgent`, `sec-ch-ua` headers, high-entropy `navigator.userAgentData` (`brands` and `fullVersionList`), and worker scopes (`Worker`, `SharedWorker`, `ServiceWorker`), while passing `--user-agent` on the CLI wipes high-entropy Client Hints inside workers.

**Behead Browser** eliminates these headless leaks without Xvfb, `addInitScript` injection, or prototype tampering:
- Probes the installed Chromium binary once per process on a local loopback origin and preserves the native host OS, architecture, bitness, form factors, and browser version.
- Attaches browser-level CDP target listeners (`Target.setAutoAttach`) to apply `Emulation.setUserAgentOverride` across pages, iframes, popups, dedicated workers, shared workers, and service workers (including cached Service Workers on reopened persistent profiles).
- Strips Playwright's default headless `--hide-scrollbars` flag and defaults to `viewport: null`.

## Branches

- **`main` (Stock Patchright Engine):** Zero-lie wrapper around stock Patchright Chromium. Preserves native host hardware and OS (`0% headless`, `0% stealth`, `0 lies` on CreepJS).
- **[`cloak` branch](https://github.com/Vuln-Inc/behead-browser/tree/cloak) (CloakBrowser C++ Engine over Patchright):** Drives CloakBrowser's C++-patched Chromium binary via Patchright instead of unpatched `playwright-core`. Replaces `SwiftShader` on GPU-less Linux VPS servers with seed-rotated hardware GPUs (`RTX 4070 SUPER`, `RTX 3070`, `RTX 3050 Ti`), CPU cores, and RAM (`fingerprintSeed`), and defaults to zero-lie mode (`fingerprintNoise: false` -> `0 lies`, `25% likeHeadlessRating` on CreepJS, `0` failed checks on SannySoft).

## Headless Comparison (`headless: true`, no Xvfb, GPU-less Linux VPS)

Reproduce locally with `bun run bench` (`src/bench.ts`).

| Metric / Detector | Stock Playwright | Puppeteer-Extra-Stealth | Patchright (Standalone) | CloakBrowser (Standalone) | Behead (`main`) | Behead ([`cloak` branch](https://github.com/Vuln-Inc/behead-browser/tree/cloak)) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **CDP `Runtime.enable` Leak** | Leaked | Leaked | **Not sent** | Leaked (`playwright-core`) | **Not sent** | **Not sent** |
| **CreepJS `headlessRating`** | `100%` | `38%+` | `67%` | `0%` | **`0%`** | **`0%`** |
| **CreepJS `stealthRating`** | `0%` | `40%+` (JS proxy traps) | `0%` | `0%` | **`0%`** | **`0%`** |
| **CreepJS `likeHeadlessRating` (no GPU)** | `69%+` | `56%+` | `50%` (`SwiftShader`) | `31%` (`hasVvpScreenRes`) | **`50%`** (`SwiftShader`) | **`25%` (Hardware GPU)** |
| **CreepJS `liesCount`** | `0` | `12+` (prototype lies) | `0` | `5` (Canvas/Audio/Rects) | **`0`** | **`0`** (default) |
| **Worker High-Entropy Client Hints** | `HeadlessChrome` | Blank / Mismatched | `HeadlessChrome` | Populated | **Populated (All Workers)** | **Populated (All Workers)** |
| **Hardware / GPU Rotation** | None (`SwiftShader`) | None (`SwiftShader`) | None (`SwiftShader`) | Per-seed (`--fingerprint`) | Native host hardware | **Per-seed (`fingerprintSeed`)** |
| **SannySoft Failed Checks** | `5` (`webdriver` + UA + WebGL) | `1` (`SwiftShader` WebGL) | `4` (`HeadlessChrome` UA + WebGL) | `0` | **`1`** (`SwiftShader` WebGL) | **`0` (Hardware GPU)** |
| **Cloudflare Turnstile (`cf_clearance`)** | Fails | Fails | Passes | Passes | **Passes** | **Passes** |

## Setup

```bash
bun install
bunx patchright install chromium
bun test
bun run bench
```

## Usage

```ts
import { launchBeheadBrowser, launchPersistentBeheadSession } from "./src/index.js"

// Ephemeral session
const browser = await launchBeheadBrowser({
  proxy: { server: "http://127.0.0.1:8080" }, // optional
})
const session = await browser.newSession()
const page = await session.newPage()
await page.goto("https://example.com")
await browser.close()

// Persistent profile on disk
const persistent = await launchPersistentBeheadSession("./user-data")
const persistentPage = await persistent.newPage()
await persistent.close()
```

### Hardware Spoofing & Seed Rotation (`cloak` branch)

```bash
git checkout cloak && bun install
```

```ts
import { launchBeheadBrowser } from "./src/index.js"

const browser = await launchBeheadBrowser({
  fingerprintSeed: 55123, // rotates hardware GPU, cores, and RAM (0 lies by default)
  timezone: "America/New_York",
  locale: "en-US",
})
```
