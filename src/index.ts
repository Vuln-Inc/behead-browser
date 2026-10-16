import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type LaunchOptions,
  type Page,
} from "patchright"

interface BrandVersion {
  brand: string
  version: string
}

export interface NativeHeadlessFingerprint {
  userAgent: string
  navigatorPlatform: string
  brands: BrandVersion[]
  fullVersionList: BrandVersion[]
  mobile: boolean
  platform: string
  platformVersion: string
  architecture: string
  bitness: string
  model: string
  wow64: boolean
  formFactors?: string[]
}

export interface BeheadFingerprint {
  browserVersion: string
  userAgent: string
  platform: string
  userAgentMetadata: {
    brands: BrandVersion[]
    fullVersionList: BrandVersion[]
    fullVersion: string
    platform: string
    platformVersion: string
    architecture: string
    model: string
    mobile: boolean
    bitness: string
    wow64: boolean
    formFactors?: string[]
  }
}

export interface BeheadLaunchOptions {
  headless?: boolean
  proxy?: LaunchOptions["proxy"]
  timeout?: number
}

export interface BeheadSessionOptions {
  acceptDownloads?: boolean
  baseURL?: string
  storageState?: BrowserContextOptions["storageState"]
}

export function buildBeheadFingerprint(
  native: NativeHeadlessFingerprint,
  browserVersion: string,
): BeheadFingerprint {
  const majorVersion = browserVersion.split(".")[0]
  if (!/^\d+$/.test(majorVersion)) {
    throw new Error(`Unable to determine Chromium major version from: ${browserVersion}`)
  }

  const withoutHeadless = (brands: BrandVersion[]) =>
    brands.filter(({ brand }) => brand !== "HeadlessChrome")
  const fingerprint: BeheadFingerprint = {
    browserVersion,
    userAgent: native.userAgent.replace(
      /HeadlessChrome\/[\d.]+/,
      `Chrome/${majorVersion}.0.0.0`,
    ),
    platform: native.navigatorPlatform,
    userAgentMetadata: {
      brands: withoutHeadless(native.brands),
      fullVersionList: withoutHeadless(native.fullVersionList),
      fullVersion: browserVersion,
      platform: native.platform,
      platformVersion: native.platformVersion,
      architecture: native.architecture,
      model: native.model,
      mobile: native.mobile,
      bitness: native.bitness,
      wow64: native.wow64,
      formFactors: native.formFactors,
    },
  }

  if (JSON.stringify(fingerprint).includes("HeadlessChrome")) {
    throw new Error("Unable to remove the native HeadlessChrome fingerprint")
  }

  return fingerprint
}

async function readNativeFingerprint(browser: Browser): Promise<NativeHeadlessFingerprint> {
  const probe = await browser.newPage()

  try {
    // localhost is a trustworthy origin, so Chromium exposes UA Client Hints.
    // Fulfilling it locally avoids leaking the probe fingerprint to a website.
    await probe.route("http://localhost/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Fingerprint probe</title>",
      }),
    )
    await probe.goto("http://localhost/behead-fingerprint")

    const fingerprint = await probe.evaluate(async () => {
      const userAgentData = (navigator as any).userAgentData
      if (!userAgentData) return null

      const highEntropy = await userAgentData.getHighEntropyValues([
        "architecture",
        "bitness",
        "formFactors",
        "fullVersionList",
        "model",
        "platformVersion",
        "wow64",
      ])

      return {
        userAgent: navigator.userAgent,
        navigatorPlatform: navigator.platform,
        brands: userAgentData.brands,
        fullVersionList: highEntropy.fullVersionList,
        mobile: userAgentData.mobile,
        platform: userAgentData.platform,
        platformVersion: highEntropy.platformVersion,
        architecture: highEntropy.architecture,
        bitness: highEntropy.bitness,
        model: highEntropy.model,
        wow64: highEntropy.wow64,
        formFactors: highEntropy.formFactors,
      }
    }) as NativeHeadlessFingerprint | null

    if (!fingerprint) {
      throw new Error("Chromium did not expose User-Agent Client Hints")
    }

    return fingerprint
  } finally {
    await probe.close().catch(() => undefined)
  }
}

let cachedFingerprint: Promise<BeheadFingerprint> | null = null

async function detectFingerprint(): Promise<BeheadFingerprint> {
  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
  })

  try {
    return buildBeheadFingerprint(await readNativeFingerprint(browser), browser.version())
  } finally {
    await browser.close().catch(() => undefined)
  }
}

async function getFingerprint(): Promise<BeheadFingerprint> {
  cachedFingerprint ??= detectFingerprint()

  try {
    return await cachedFingerprint
  } catch (error) {
    cachedFingerprint = null
    throw error
  }
}

async function applyFingerprint(page: Page, fingerprint: BeheadFingerprint): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Emulation.setUserAgentOverride", {
    userAgent: fingerprint.userAgent,
    platform: fingerprint.platform,
    userAgentMetadata: fingerprint.userAgentMetadata,
  })
}

async function attachWorkerFingerprint(browser: Browser, fingerprint: BeheadFingerprint): Promise<void> {
  const browserCdp = await browser.newBrowserCDPSession()
  const configuredTargets = new Set<string>()
  const pendingSessions = new Set<string>()

  browserCdp.on("Target.targetDestroyed", ({ targetId }: any) => {
    configuredTargets.delete(targetId)
  })

  browserCdp.on("Target.receivedMessageFromTarget", ({ sessionId, message }: any) => {
    if (!pendingSessions.has(sessionId)) return

    try {
      const parsed = JSON.parse(message)
      if (parsed.id === 1) {
        pendingSessions.delete(sessionId)
        void browserCdp.send("Target.detachFromTarget", { sessionId }).catch(() => undefined)
      }
    } catch {}
  })

  browserCdp.on("Target.attachedToTarget", async ({ targetInfo }: any) => {
    const targetId = targetInfo?.targetId
    if (!targetId || configuredTargets.has(targetId)) return
    configuredTargets.add(targetId)

    try {
      const { sessionId } = await browserCdp.send("Target.attachToTarget", {
        targetId,
        flatten: false,
      })
      pendingSessions.add(sessionId)
      await browserCdp.send("Target.sendMessageToTarget", {
        sessionId,
        message: JSON.stringify({
          id: 1,
          method: "Emulation.setUserAgentOverride",
          params: {
            userAgent: fingerprint.userAgent,
            platform: fingerprint.platform,
            userAgentMetadata: fingerprint.userAgentMetadata,
          },
        }),
      })
    } catch {
      configuredTargets.delete(targetId)
    }
  })

  await browserCdp.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
    filter: [
      { type: "shared_worker", exclude: false },
      { type: "service_worker", exclude: false },
      { type: "page", exclude: true },
      { type: "background_page", exclude: true },
      { type: "iframe", exclude: true },
    ],
  } as any)
}

export class BeheadSession {
  private readonly pageConfigurations = new WeakMap<Page, Promise<void>>()

  constructor(
    public readonly context: BrowserContext,
    private readonly fingerprint: BeheadFingerprint,
    private readonly headless: boolean = true,
  ) {
    if (this.headless) {
      this.context.on("page", (page) => {
        void this.configurePage(page).catch(() => undefined)
      })
    }
  }

  private configurePage(page: Page): Promise<void> {
    if (!this.headless) return Promise.resolve()

    const existing = this.pageConfigurations.get(page)
    if (existing) return existing

    const configuration = applyFingerprint(page, this.fingerprint)
    this.pageConfigurations.set(page, configuration)
    return configuration
  }

  async newPage(): Promise<Page> {
    const page = await this.context.newPage()

    try {
      await this.configurePage(page)
      return page
    } catch (error) {
      await page.close().catch(() => undefined)
      throw error
    }
  }

  async preparePage(page: Page): Promise<Page> {
    await this.configurePage(page)
    return page
  }

  async close(): Promise<void> {
    await this.context.close()
  }
}

export class BeheadBrowser {
  private constructor(
    public readonly browser: Browser,
    public readonly fingerprint: BeheadFingerprint,
    private readonly headless: boolean = true,
  ) {}

  static async launch(options: BeheadLaunchOptions = {}): Promise<BeheadBrowser> {
    const headless = options.headless ?? true

    if (!headless) {
      const browser = await chromium.launch({
        channel: "chromium",
        headless: false,
        proxy: options.proxy,
        timeout: options.timeout,
      })

      try {
        const fingerprint = buildBeheadFingerprint(
          await readNativeFingerprint(browser),
          browser.version(),
        )
        return new BeheadBrowser(browser, fingerprint, false)
      } catch (error) {
        await browser.close().catch(() => undefined)
        throw error
      }
    }

    const fingerprint = await getFingerprint()
    const browser = await chromium.launch({
      args: [
        `--user-agent=${fingerprint.userAgent}`,
      ],
      channel: "chromium",
      headless: true,
      proxy: options.proxy,
      timeout: options.timeout,
    })

    try {
      await attachWorkerFingerprint(browser, fingerprint)
      return new BeheadBrowser(browser, fingerprint, true)
    } catch (error) {
      await browser.close().catch(() => undefined)
      throw error
    }
  }

  async newSession(options: BeheadSessionOptions = {}): Promise<BeheadSession> {
    const context = await this.browser.newContext({
      acceptDownloads: options.acceptDownloads,
      baseURL: options.baseURL,
      storageState: options.storageState,
      viewport: null,
    })

    return new BeheadSession(context, this.fingerprint, this.headless)
  }

  async close(): Promise<void> {
    await this.browser.close()
  }
}

export async function launchBeheadBrowser(options: BeheadLaunchOptions = {}): Promise<BeheadBrowser> {
  return BeheadBrowser.launch(options)
}
