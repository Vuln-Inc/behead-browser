<div align="center">
  <img src="./logo.png" alt="Behead Browser" width="180" />
  <summary><h1>Behead Browser (Cloak Engine)</h1></summary>
  <sup>by <b>vuln.industries</b></sup>
</div>

---

<p align="center">
  Undetected, display-free headless Chromium combining <a href="https://github.com/Kaliiiiiiiiii-Vinyzu/patchright">Patchright</a>'s CDP driver with <a href="https://github.com/CloakHQ/cloakbrowser">CloakBrowser</a>'s C++-patched Chromium binary for hardware/GPU spoofing and per-session fingerprint rotation on GPU-less VPS servers.
</p>

---

## Overview

- **Hardware / GPU Spoofing on GPU-less VPS (`no SwiftShader`):** Replaces `SwiftShader` in headless mode with seed-rotated hardware GPUs (`RTX 4070 SUPER`, `RTX 3070`, `RTX 3050 Ti`), CPU cores, and RAM via `--fingerprint=<seed>`.
- **No `Runtime.enable` Leak:** Drives CloakBrowser's binary via **Patchright** instead of standalone CloakBrowser's `playwright-core`.
- **Zero-Lie Mode by Default (`fingerprintNoise: false`):** Disables CloakBrowser's Canvas/Audio/DOMRect noise perturbations by default (`0 lies` on CreepJS) while keeping hardware/GPU seed rotation active. Pass `fingerprintNoise: true` to enable Canvas/Audio/DOMRect perturbation.
- **Coherent Headless Window & Worker Alignment:** Defaults to `viewport: null`, strips `--hide-scrollbars`, and synchronizes high-entropy Client Hints across pages, popups, dedicated workers, shared workers, and service workers (including cached Service Workers on reopened persistent profiles).

## Headless Comparison (`headless: true`, no Xvfb, GPU-less Linux VPS)

Reproduce locally with `bun run bench` (`src/bench.ts`).

| Metric / Detector | Stock Playwright | Puppeteer-Extra-Stealth | Patchright (Standalone) | CloakBrowser (Standalone) | Behead ([`main`](https://github.com/Vuln-Inc/behead-browser)) | Behead (`cloak` — this branch) |
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
bun test
bun run bench
```

## Usage

```ts
import { launchBeheadBrowser, launchPersistentBeheadSession } from "./src/index.js"

// Ephemeral session with seed-rotated hardware
const browser = await launchBeheadBrowser({
  fingerprintSeed: 55123,
  timezone: "America/New_York",
  locale: "en-US",
})
const session = await browser.newSession()
const page = await session.newPage()
await page.goto("https://example.com")
await browser.close()

// Persistent profile on disk
const persistent = await launchPersistentBeheadSession("./user-data", {
  fingerprintSeed: 55123,
})
const persistentPage = await persistent.newPage()
await persistent.close()
```
