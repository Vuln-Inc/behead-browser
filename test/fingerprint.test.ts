import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildBeheadFingerprint,
  launchBeheadBrowser,
  launchPersistentBeheadSession,
  type NativeHeadlessFingerprint,
} from "../src/index"

describe("Behead Patchright fingerprint", () => {
  test("derives Windows metadata from the installed browser", () => {
    const native: NativeHeadlessFingerprint = {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.8000.42 Safari/537.36",
      navigatorPlatform: "Win32",
      brands: [
        { brand: "HeadlessChrome", version: "151" },
        { brand: "Chromium", version: "151" },
        { brand: "Not_A Brand", version: "99" },
      ],
      fullVersionList: [
        { brand: "HeadlessChrome", version: "151.0.8000.42" },
        { brand: "Chromium", version: "151.0.8000.42" },
        { brand: "Not_A Brand", version: "99.0.0.0" },
      ],
      mobile: false,
      platform: "Windows",
      platformVersion: "10.0.0",
      architecture: "x86",
      bitness: "64",
      model: "",
      wow64: false,
      formFactors: ["Desktop"],
    }

    const result = buildBeheadFingerprint(native, "151.0.8000.42")

    expect(result.userAgent).toContain("Chrome/151.0.0.0")
    expect(result.platform).toBe("Win32")
    expect(result.userAgentMetadata.platform).toBe("Windows")
    expect(result.userAgentMetadata.platformVersion).toBe("10.0.0")
    expect(JSON.stringify(result)).not.toContain("HeadlessChrome")
  })

  test("keeps browser surfaces internally consistent", async () => {
    const requestHeaders = new Map<string, Record<string, string>>()
    const workerScript = `
      const surfacePromise = navigator.userAgentData.getHighEntropyValues([
        "architecture",
        "bitness",
        "formFactors",
        "fullVersionList",
        "uaFullVersion",
      ]).then((highEntropy) => ({
        userAgent: navigator.userAgent,
        brands: navigator.userAgentData.brands,
        highEntropy,
      }))
    `
    const server = createServer((req, res) => {
      const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers[k] = v
      }
      requestHeaders.set(pathname, headers)

      if (pathname === "/shared.js") {
        res.writeHead(200, { "Content-Type": "text/javascript" })
        res.end(`
          ${workerScript}
          onconnect = (event) => {
            const port = event.ports[0]
            port.onmessage = async () => port.postMessage(await surfacePromise)
          }
        `)
        return
      }
      if (pathname === "/sw.js") {
        res.writeHead(200, { "Content-Type": "text/javascript" })
        res.end(`
          ${workerScript}
          self.addEventListener("install", () => self.skipWaiting())
          self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()))
          self.addEventListener("message", async (event) => {
            event.source.postMessage(await surfacePromise)
          })
        `)
        return
      }

      res.writeHead(200, { "Content-Type": "text/html" })
      res.end("<!doctype html><title>Fingerprint test</title>")
    })

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as any).port
    const baseUrl = `http://127.0.0.1:${port}`
    const browser = await launchBeheadBrowser()

    try {
      const session = await browser.newSession()
      const page = await session.newPage()

      await page.goto(`${baseUrl}/fingerprint-test`)

      const main = await page.evaluate(async () => {
        const data = (navigator as any).userAgentData
        return {
          userAgent: navigator.userAgent,
          brands: data?.brands ?? [],
          highEntropy: await data?.getHighEntropyValues([
            "architecture",
            "bitness",
            "formFactors",
            "fullVersionList",
            "uaFullVersion",
          ]),
          webdriver: navigator.webdriver,
          ownsWebdriver: Object.prototype.hasOwnProperty.call(navigator, "webdriver"),
          ownsLanguages: Object.prototype.hasOwnProperty.call(navigator, "languages"),
          scrollbarWidth: (() => {
            const outer = document.createElement("div")
            outer.style.visibility = "hidden"
            outer.style.overflow = "scroll"
            document.body.appendChild(outer)
            const inner = document.createElement("div")
            outer.appendChild(inner)
            const width = outer.offsetWidth - inner.offsetWidth
            outer.remove()
            return width
          })(),
        }
      })
      const dedicatedWorker = await page.evaluate(() => new Promise<any>((resolve, reject) => {
        const source = `navigator.userAgentData.getHighEntropyValues(["architecture", "bitness", "formFactors", "fullVersionList", "uaFullVersion"]).then(highEntropy => postMessage({ userAgent: navigator.userAgent, brands: navigator.userAgentData.brands, highEntropy }))`
        const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })))
        worker.onmessage = (event) => {
          resolve(event.data)
          worker.terminate()
        }
        worker.onerror = reject
      }))
      const sharedWorker = await page.evaluate(() => new Promise<any>((resolve, reject) => {
        const worker = new SharedWorker("/shared.js")
        worker.port.onmessage = (event) => resolve(event.data)
        worker.onerror = reject
        worker.port.postMessage("ping")
      }))
      const serviceWorker = await page.evaluate(() => new Promise<any>(async (resolve, reject) => {
        try {
          navigator.serviceWorker.addEventListener("message", (event) => resolve(event.data), { once: true })
          const reg = await navigator.serviceWorker.register("/sw.js")
          const send = () => {
            const active = reg.active || reg.waiting || reg.installing
            if (active && active.state === "activated") {
              active.postMessage("ping")
            } else if (active) {
              active.addEventListener("statechange", () => {
                if (active.state === "activated") active.postMessage("ping")
              })
            }
          }
          send()
        } catch (error) {
          reject(error)
        }
      }))
      const popupPromise = session.context.waitForEvent("page")
      await page.evaluate((url) => window.open(url, "_blank"), `${baseUrl}/popup`)
      const popup = await popupPromise
      await popup.waitForLoadState("domcontentloaded")
      const popupFingerprint = await popup.evaluate(async () => {
        const data = (navigator as any).userAgentData
        return {
          userAgent: navigator.userAgent,
          brands: data?.brands ?? [],
          highEntropy: await data?.getHighEntropyValues([
            "architecture",
            "bitness",
            "formFactors",
            "fullVersionList",
            "uaFullVersion",
          ]),
        }
      })
      const directContextPage = await session.context.newPage()
      await directContextPage.goto(`${baseUrl}/direct-context`)
      const directContextFingerprint = await directContextPage.evaluate(async () => {
        const data = (navigator as any).userAgentData
        return {
          userAgent: navigator.userAgent,
          brands: data?.brands ?? [],
          highEntropy: await data?.getHighEntropyValues([
            "architecture",
            "bitness",
            "formFactors",
            "fullVersionList",
            "uaFullVersion",
          ]),
        }
      })

      const surfaces = {
        requestHeaders: Object.fromEntries(requestHeaders),
        main,
        dedicatedWorker,
        sharedWorker,
        serviceWorker,
        popupFingerprint,
        directContextFingerprint,
      }
      expect(JSON.stringify(surfaces)).not.toContain("HeadlessChrome")
      expect(requestHeaders.get("/fingerprint-test")?.["user-agent"]).toBe(main.userAgent)
      expect(dedicatedWorker.userAgent).toBe(main.userAgent)
      expect(sharedWorker.userAgent).toBe(main.userAgent)
      expect(serviceWorker.userAgent).toBe(main.userAgent)
      expect(popupFingerprint.userAgent).toBe(main.userAgent)
      expect(directContextFingerprint.userAgent).toBe(main.userAgent)
      expect(main.highEntropy.fullVersionList).toEqual(browser.fingerprint.userAgentMetadata.fullVersionList)
      expect(dedicatedWorker.highEntropy).toEqual(main.highEntropy)
      expect(sharedWorker.highEntropy).toEqual(main.highEntropy)
      expect(serviceWorker.highEntropy).toEqual(main.highEntropy)
      expect(popupFingerprint.highEntropy).toEqual(main.highEntropy)
      expect(directContextFingerprint.highEntropy).toEqual(main.highEntropy)
      expect(main.webdriver).toBe(false)
      expect(main.ownsWebdriver).toBe(false)
      expect(main.ownsLanguages).toBe(false)
      expect(main.scrollbarWidth).toBeGreaterThan(0)

      await session.close()
    } finally {
      await browser.close()
      server.close()
    }
  }, 30_000)

  test("supports headful mode without headless flags or worker restrictions", async () => {
    const browser = await launchBeheadBrowser({ headless: false })

    try {
      const session = await browser.newSession()
      const page = await session.newPage()

      await session.context.route("http://localhost/**", (route) => {
        const serviceWorker = route.request().url().endsWith("/sw.js")
        return route.fulfill({
          status: 200,
          contentType: serviceWorker ? "text/javascript" : "text/html",
          body: serviceWorker ? "" : "<!doctype html><title>Headful test</title>",
        })
      })
      await page.goto("http://localhost/headful-test")

      const state = await page.evaluate(async () => ({
        userAgent: navigator.userAgent,
        brands: (navigator as any).userAgentData?.brands ?? [],
        sharedWorkerAvailable: typeof SharedWorker !== "undefined",
        serviceWorkerRegistered: Boolean(await navigator.serviceWorker.register("/sw.js")),
      }))

      expect(JSON.stringify(state)).not.toContain("HeadlessChrome")
      expect(state.sharedWorkerAvailable).toBe(true)
      expect(state.serviceWorkerRegistered).toBe(true)

      await session.close()
    } finally {
      await browser.close()
    }
  }, 30_000)

  test("supports persistent sessions with pre-existing and newly opened pages", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "behead-persistent-"))
    const server = createServer((req, res) => {
      const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname
      if (pathname === "/sw.js") {
        res.writeHead(200, { "Content-Type": "text/javascript" })
        res.end(`
          self.addEventListener("install", () => self.skipWaiting())
          self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()))
          self.addEventListener("fetch", (event) => {
            event.respondWith(
              navigator.userAgentData.getHighEntropyValues(["architecture", "fullVersionList"]).then((fetchHe) =>
                new Response(
                  "<!doctype html><script src='/sub.js'></script><title>" +
                    JSON.stringify({ fetchHe }) +
                    "</title>",
                  { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } },
                ),
              ),
            )
          })
          self.addEventListener("message", async (event) => {
            const msgHe = await navigator.userAgentData.getHighEntropyValues([
              "architecture",
              "bitness",
              "formFactors",
              "fullVersionList",
              "uaFullVersion",
            ])
            event.source.postMessage(msgHe)
          })
        `)
        return
      }
      if (pathname === "/sub.js") {
        res.writeHead(200, { "Content-Type": "text/javascript" })
        res.end("window.__subLoaded = true")
        return
      }
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end("<!doctype html><title>Persistent test</title>")
    })

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as any).port
    const baseUrl = `http://localhost:${port}`

    try {
      const session1 = await launchPersistentBeheadSession(userDataDir)
      try {
        const initialPage = session1.context.pages()[0] ?? (await session1.context.newPage())
        await initialPage.goto(`${baseUrl}/persistent-test`)
        await initialPage.evaluate(async () => {
          const controllerReady = new Promise<void>((resolve) => {
            if (navigator.serviceWorker.controller) return resolve()
            navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true })
          })
          await navigator.serviceWorker.register("/sw.js")
          await controllerReady
        })
      } finally {
        await session1.close()
      }

      const session2 = await launchPersistentBeheadSession(userDataDir)
      try {
        const reopenedPage = session2.context.pages()[0] ?? (await session2.context.newPage())
        await reopenedPage.goto(`${baseUrl}/persistent-test`, { waitUntil: "load", timeout: 5_000 })
        const serviceWorkerHighEntropy = await reopenedPage.evaluate(
          () =>
            new Promise<any>((resolve) => {
              navigator.serviceWorker.addEventListener("message", (event) => resolve(event.data), { once: true })
              navigator.serviceWorker.controller!.postMessage("ping")
            }),
        )
        await reopenedPage.reload({ waitUntil: "load", timeout: 5_000 })
        const reloadSw = JSON.parse(await reopenedPage.title())

        const state = await reopenedPage.evaluate(async () => {
          const data = (navigator as any).userAgentData
          return {
            userAgent: navigator.userAgent,
            highEntropy: await data?.getHighEntropyValues([
              "architecture",
              "bitness",
              "formFactors",
              "fullVersionList",
              "uaFullVersion",
            ]),
          }
        })

        expect(JSON.stringify({ state, serviceWorkerHighEntropy, reloadSw })).not.toContain("HeadlessChrome")
        expect(state.highEntropy.fullVersionList).toEqual(session2.fingerprint.userAgentMetadata.fullVersionList)
        expect(serviceWorkerHighEntropy).toEqual(state.highEntropy)
        expect(reloadSw.fetchHe.fullVersionList).toEqual(session2.fingerprint.userAgentMetadata.fullVersionList)
      } finally {
        await session2.close()
      }
    } finally {
      server.close()
      rmSync(userDataDir, { recursive: true, force: true })
    }
  }, 30_000)

  test("rotates hardware GPU fingerprint by seed without SwiftShader", async () => {
    const b1 = await launchBeheadBrowser({ fingerprintSeed: 10001 })
    const b2 = await launchBeheadBrowser({ fingerprintSeed: 20002 })

    try {
      const s1 = await b1.newSession()
      const s2 = await b2.newSession()
      const p1 = await s1.newPage()
      const p2 = await s2.newPage()

      const readGpu = (page: any) =>
        page.evaluate(() => {
          const canvas = document.createElement("canvas")
          const gl = canvas.getContext("webgl")
          const dbg = gl?.getExtension("WEBGL_debug_renderer_info")
          return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null
        })

      const gpu1 = await readGpu(p1)
      const gpu2 = await readGpu(p2)

      expect(gpu1).toBeTruthy()
      expect(gpu2).toBeTruthy()
      expect(gpu1).not.toContain("SwiftShader")
      expect(gpu2).not.toContain("SwiftShader")
      expect(gpu1).not.toBe(gpu2)

      await s1.close()
      await s2.close()
    } finally {
      await b1.close()
      await b2.close()
    }
  }, 30_000)
})
