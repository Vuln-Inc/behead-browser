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

## Branches

- **`main` (Stock Patchright Engine):** Zero-lie headless wrapper around stock Patchright Chromium. Preserves your real native OS and hardware while stripping `HeadlessChrome` across HTTP headers, pages, popups, and all worker scopes.
- **`cloak` (CloakBrowser Engine — this branch):** Drives CloakBrowser's C++-patched Chromium binary through Patchright instead of stock `playwright-core`. Eliminates `SwiftShader` WebGL leaks on GPU-less Linux VPS servers (`likeHeadlessRating: 25%`, `headlessRating: 0%`, `stealthRating: 0%`), rotates hardware/GPU profiles per seed (`fingerprintSeed`), and fixes CloakBrowser's standalone headless leaks (`Runtime.enable`, `innerHeight > outerHeight` viewport mismatch, and `--hide-scrollbars`).

## What This Branch Fixes Over Standalone CloakBrowser & Stock Patchright

- **Hardware WebGL / GPU Spoofing on GPU-less VPS (`no SwiftShader`):** Stock Chromium in headless mode on a VPS without a GPU falls back to `SwiftShader`. This branch uses CloakBrowser's C++ binary to report real hardware GPUs (`NVIDIA GeForce RTX 4070 SUPER`, `RTX 3070`, `RTX 3050 Ti`, etc.) selected deterministically by seed.
- **No `Runtime.enable` CDP Leak:** Standalone `cloakbrowser` drives its binary with unpatched `playwright-core`, which sends `Runtime.enable`. This branch drives the CloakBrowser binary with **Patchright**.
- **Coherent Headless Window Geometry:** Standalone `cloakbrowser` defaults to an emulated `1920x1080` viewport against a `1032px` taskbar height in headless mode (`window.innerHeight > window.outerHeight`). This branch defaults to `viewport: null` so window dimensions stay coherent without Xvfb.
- **Zero-Lie Mode by Default (`fingerprintNoise: false`):** CloakBrowser's default Canvas/Audio/DOMRect noise perturbations are disabled by default (`--fingerprint-noise=false`) to achieve **`0 lies`** on CreepJS while still rotating hardware/GPU profiles per seed. Pass `fingerprintNoise: true` if you explicitly want Canvas/Audio/DOMRect hash perturbation.
- **Full Worker & Persistent Session Alignment:** Automatically propagates Client Hints across pages, popups, dedicated workers, shared workers, and service workers (including cached Service Workers on reopened persistent profiles).

## Verified Detector Results (`headless: true`, no Xvfb, GPU-less Linux)

| Detector / Metric | Patchright (Standalone) | CloakBrowser (Standalone) | Behead Browser (`main`) | Behead Browser (`cloak`) |
| :--- | :--- | :--- | :--- | :--- |
| **CreepJS `headlessRating`** | `67%` | `0%` | `0%` | **`0%`** |
| **CreepJS `stealthRating`** | `0%` | `0%` | `0%` | **`0%`** |
| **CreepJS `likeHeadlessRating` (no GPU)** | `50%` (`SwiftShader`) | `31%` (`hasVvpScreenRes`) | `50%` (`SwiftShader`) | **`25%` (Hardware GPU, no SwiftShader)** |
| **CreepJS `liesCount`** | `0` | `5` (Canvas/Audio/Rects) | `0` | **`0`** |
| **CDP `Runtime.enable`** | Not sent | Sent (`playwright-core`) | Not sent | **Not sent** |
| **Cloudflare Turnstile (`cf_clearance`)** | Fails in headless | Passes | Passes | **Passes** |
| **BrowserScan Bot Detection** | Fails (`HeadlessChrome` UA) | Normal | Normal | **Normal** |
| **SannySoft (`bot.sannysoft.com`)** | Fails (`HeadlessChrome` UA) | `0` failed checks | `0` failed checks | **`0` failed checks** |

## Setup

```bash
bun install
bun test
bun run build
```

## Usage

```ts
import { launchBeheadBrowser } from "./src/index.js"

const browser = await launchBeheadBrowser({
  fingerprintSeed: 55123,
  timezone: "America/New_York",
  locale: "en-US",
})

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

## Persistent Profile

```ts
import { launchPersistentBeheadSession } from "./src/index.js"

const session = await launchPersistentBeheadSession("./user-data", {
  fingerprintSeed: 55123,
})
const page = await session.newPage()
```
