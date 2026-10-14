import { describe, expect, test } from "bun:test"
import {
  buildBeheadFingerprint,
  launchBeheadBrowser,
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
    const browser = await launchBeheadBrowser()

    try {
      const session = await browser.newSession()
      const page = await session.newPage()
      const requestHeaders = new Map<string, Record<string, string>>()

      await session.context.route("http://localhost/**", (route) => {
        requestHeaders.set(new URL(route.request().url()).pathname, route.request().headers())
        const serviceWorker = route.request().url().endsWith("/sw.js")
        return route.fulfill({
          status: 200,
          contentType: serviceWorker ? "text/javascript" : "text/html",
          body: serviceWorker ? "" : "<!doctype html><title>Fingerprint test</title>",
        })
      })
      await page.goto("http://localhost/fingerprint-test")

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
      const sharedWorkerAvailable = await page.evaluate(() => typeof SharedWorker !== "undefined")
      const popupPromise = session.context.waitForEvent("page")
      await page.evaluate(() => window.open("http://localhost/popup", "_blank"))
      const popup = await session.preparePage(await popupPromise)
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
      const serviceWorkerRegistered = await page.evaluate(async () => {
        try {
          return Boolean(await navigator.serviceWorker.register("/sw.js"))
        } catch {
          return false
        }
      }, undefined, false)

      const surfaces = {
        requestHeaders: Object.fromEntries(requestHeaders),
        main,
        dedicatedWorker,
        popupFingerprint,
      }
      expect(JSON.stringify(surfaces)).not.toContain("HeadlessChrome")
      expect(requestHeaders.get("/fingerprint-test")?.["user-agent"]).toBe(main.userAgent)
      expect(dedicatedWorker.userAgent).toBe(main.userAgent)
      expect(popupFingerprint.userAgent).toBe(main.userAgent)
      expect(main.highEntropy.fullVersionList).toEqual(browser.fingerprint.userAgentMetadata.fullVersionList)
      expect(dedicatedWorker.highEntropy.fullVersionList).toEqual(main.highEntropy.fullVersionList)
      expect(popupFingerprint.highEntropy.fullVersionList).toEqual(main.highEntropy.fullVersionList)
      expect(main.webdriver).toBe(false)
      expect(main.ownsWebdriver).toBe(false)
      expect(main.ownsLanguages).toBe(false)
      expect(sharedWorkerAvailable).toBe(false)
      expect(serviceWorkerRegistered).toBe(false)
      expect(session.context.serviceWorkers()).toHaveLength(0)

      await session.close()
    } finally {
      await browser.close()
    }
  }, 30_000)
})
