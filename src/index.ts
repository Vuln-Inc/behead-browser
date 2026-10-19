import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type LaunchOptions,
  type Page,
} from "patchright"
import {
  buildLaunchOptions as buildCloakLaunchOptions,
  type LaunchOptions as CloakLaunchOptions,
} from "cloakbrowser"

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

export interface CloakSpecificOptions {
  fingerprintSeed?: number
  fingerprintNoise?: boolean
  stealthArgs?: boolean
  timezone?: string
  locale?: string
  geoip?: boolean
  licenseKey?: string
  browserVersion?: string
  releaseChannel?: "stable" | "preview"
  extensionPaths?: string[]
}

export type BeheadLaunchOptions = LaunchOptions & CloakSpecificOptions

export type BeheadSessionOptions = Omit<BrowserContextOptions, "userAgent">

export type BeheadPersistentOptions = Omit<
  NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>,
  "userAgent"
> &
  CloakSpecificOptions

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

async function readNativeFingerprint(
  target: Browser | BrowserContext,
): Promise<NativeHeadlessFingerprint> {
  const probe = await target.newPage()

  try {
    await probe.route("http://localhost/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Fingerprint probe</title>",
      }),
    )
    await probe.goto("http://localhost/behead-fingerprint")

    const fingerprint = (await probe.evaluate(async () => {
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
    })) as NativeHeadlessFingerprint | null

    if (!fingerprint) {
      throw new Error("Chromium did not expose User-Agent Client Hints")
    }

    return fingerprint
  } finally {
    await probe.close().catch(() => undefined)
  }
}

const cachedFingerprints = new Map<string, Promise<BeheadFingerprint>>()

async function detectFingerprint(
  channel: string | undefined,
  executablePath?: string,
  args: string[] = [],
): Promise<BeheadFingerprint> {
  const browser = await chromium.launch({
    args,
    channel: executablePath ? undefined : channel,
    executablePath,
    headless: true,
    ignoreDefaultArgs: ["--hide-scrollbars", "--enable-automation", "--enable-unsafe-swiftshader"],
  })

  try {
    return buildBeheadFingerprint(await readNativeFingerprint(browser), browser.version())
  } finally {
    await browser.close().catch(() => undefined)
  }
}

async function getFingerprint(
  channel: string | undefined,
  executablePath?: string,
  args: string[] = [],
): Promise<BeheadFingerprint> {
  const stableArgs = args.filter((arg) => !arg.startsWith("--fingerprint="))
  const cacheKey = `${executablePath ? `path:${executablePath}` : `channel:${channel ?? "default"}`}|args:${stableArgs.join("\0")}`
  let pending = cachedFingerprints.get(cacheKey)
  if (!pending) {
    pending = detectFingerprint(channel, executablePath, args)
    cachedFingerprints.set(cacheKey, pending)
  }

  try {
    return await pending
  } catch (error) {
    cachedFingerprints.delete(cacheKey)
    throw error
  }
}

function mergeIgnoreDefaultArgs(
  ignoreDefaultArgs: boolean | string[] | undefined,
  extraDefaults: string[] = [],
): boolean | string[] {
  if (ignoreDefaultArgs === true) {
    return true
  }
  const base = Array.isArray(ignoreDefaultArgs) ? ignoreDefaultArgs : []
  return Array.from(
    new Set([
      ...base,
      ...extraDefaults,
      "--hide-scrollbars",
      "--enable-automation",
      "--enable-unsafe-swiftshader",
    ]),
  )
}

async function resolveCloakConfig(
  options: BeheadLaunchOptions | BeheadPersistentOptions,
): Promise<{
  executablePath?: string
  args: string[]
  ignoreDefaultArgs: boolean | string[]
  proxy?: LaunchOptions["proxy"]
  env?: LaunchOptions["env"]
}> {
  const userArgs = [...(options.args ?? [])]
  if (options.fingerprintSeed !== undefined && !userArgs.some((a) => a.startsWith("--fingerprint="))) {
    userArgs.push(`--fingerprint=${options.fingerprintSeed}`)
  }
  if (
    (options.fingerprintNoise ?? false) === false &&
    !userArgs.some((a) => a.startsWith("--fingerprint-noise="))
  ) {
    userArgs.push("--fingerprint-noise=false")
  }

  if (options.executablePath || options.channel) {
    return {
      executablePath: options.executablePath,
      args: userArgs,
      ignoreDefaultArgs: mergeIgnoreDefaultArgs(options.ignoreDefaultArgs),
      proxy: options.proxy,
      env: options.env as LaunchOptions["env"],
    }
  }

  const cloakOpts: CloakLaunchOptions = {
    headless: options.headless ?? true,
    proxy: options.proxy,
    args: userArgs,
    stealthArgs: options.stealthArgs,
    timezone: options.timezone,
    locale: options.locale,
    geoip: options.geoip,
    licenseKey: options.licenseKey,
    browserVersion: options.browserVersion,
    releaseChannel: options.releaseChannel,
    extensionPaths: options.extensionPaths,
    launchOptions: options.env ? { env: options.env } : undefined,
  }
  const resolved = (await buildCloakLaunchOptions(cloakOpts)) as any

  return {
    executablePath: resolved.executablePath,
    args: resolved.args ?? userArgs,
    ignoreDefaultArgs: mergeIgnoreDefaultArgs(
      options.ignoreDefaultArgs,
      Array.isArray(resolved.ignoreDefaultArgs) ? resolved.ignoreDefaultArgs : [],
    ),
    proxy: resolved.proxy ?? options.proxy,
    env: resolved.env ?? (options.env as LaunchOptions["env"]),
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

async function attachTargetFingerprint(browser: Browser, fingerprint: BeheadFingerprint): Promise<void> {
  const workerCdp = await browser.newBrowserCDPSession()
  const pageCdp = await browser.newBrowserCDPSession()
  const configuredTargets = new Set<string>()
  const pendingWorkerSessions = new Map<string, string>()
  const overrideParams = {
    userAgent: fingerprint.userAgent,
    platform: fingerprint.platform,
    userAgentMetadata: fingerprint.userAgentMetadata,
  }

  const cleanupTarget = ({ targetId }: any) => {
    configuredTargets.delete(targetId)
  }
  workerCdp.on("Target.targetDestroyed", cleanupTarget)
  pageCdp.on("Target.targetDestroyed", cleanupTarget)

  workerCdp.on("Target.receivedMessageFromTarget", ({ sessionId, message }: any) => {
    if (!pendingWorkerSessions.has(sessionId)) return

    try {
      const parsed = JSON.parse(message)
      if (parsed.id === 1) {
        const flatSessionId = pendingWorkerSessions.get(sessionId)
        pendingWorkerSessions.delete(sessionId)
        if (flatSessionId) {
          void workerCdp.send("Target.detachFromTarget", { sessionId: flatSessionId }).catch(() => undefined)
        }
      }
    } catch {}
  })

  workerCdp.on("Target.attachedToTarget", async ({ sessionId: flatSessionId, targetInfo, waitingForDebugger }: any) => {
    const targetId = targetInfo?.targetId
    if (!targetId) return
    if (configuredTargets.has(targetId)) {
      if (waitingForDebugger && flatSessionId) {
        void workerCdp.send("Target.detachFromTarget", { sessionId: flatSessionId }).catch(() => undefined)
      }
      return
    }
    configuredTargets.add(targetId)

    try {
      const { sessionId } = await workerCdp.send("Target.attachToTarget", {
        targetId,
        flatten: false,
      })
      pendingWorkerSessions.set(sessionId, flatSessionId)
      await workerCdp.send("Target.sendMessageToTarget", {
        sessionId,
        message: JSON.stringify({
          id: 1,
          method: "Emulation.setUserAgentOverride",
          params: overrideParams,
        }),
      })
    } catch {
      configuredTargets.delete(targetId)
      if (waitingForDebugger && flatSessionId) {
        void workerCdp.send("Target.detachFromTarget", { sessionId: flatSessionId }).catch(() => undefined)
      }
    }
  })

  pageCdp.on("Target.attachedToTarget", async ({ targetInfo }: any) => {
    const targetId = targetInfo?.targetId
    if (!targetId || configuredTargets.has(targetId)) return
    configuredTargets.add(targetId)

    try {
      const { sessionId } = await pageCdp.send("Target.attachToTarget", {
        targetId,
        flatten: false,
      })
      await pageCdp.send("Target.sendMessageToTarget", {
        sessionId,
        message: JSON.stringify({
          id: 1,
          method: "Emulation.setUserAgentOverride",
          params: overrideParams,
        }),
      })
    } catch {
      configuredTargets.delete(targetId)
    }
  })

  await Promise.all([
    workerCdp.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [
        { type: "shared_worker", exclude: false },
        { type: "service_worker", exclude: false },
        { exclude: true },
      ],
    } as any),
    pageCdp.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
      filter: [
        { type: "page", exclude: false },
        { type: "iframe", exclude: false },
        { exclude: true },
      ],
    } as any),
  ])
}

export class BeheadSession {
  private readonly pageConfigurations = new WeakMap<Page, Promise<void>>()

  constructor(
    public readonly context: BrowserContext,
    public readonly fingerprint: BeheadFingerprint,
    private readonly headless: boolean = true,
  ) {
    if (this.headless) {
      for (const page of this.context.pages()) {
        void this.configurePage(page).catch(() => undefined)
      }
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

function stripCloakOptions<T extends Record<string, any>>(options: T): Omit<T, keyof CloakSpecificOptions> {
  const {
    fingerprintSeed: _fingerprintSeed,
    fingerprintNoise: _fingerprintNoise,
    stealthArgs: _stealthArgs,
    timezone: _timezone,
    locale: _locale,
    geoip: _geoip,
    licenseKey: _licenseKey,
    browserVersion: _browserVersion,
    releaseChannel: _releaseChannel,
    extensionPaths: _extensionPaths,
    ...rest
  } = options
  return rest
}

export class BeheadBrowser {
  private constructor(
    public readonly browser: Browser,
    public readonly fingerprint: BeheadFingerprint,
    private readonly headless: boolean = true,
  ) {}

  static async launch(options: BeheadLaunchOptions = {}): Promise<BeheadBrowser> {
    const headless = options.headless ?? true
    const cloakConfig = await resolveCloakConfig(options)
    const cleanOptions = stripCloakOptions(options)

    if (!headless) {
      const browser = await chromium.launch({
        ...cleanOptions,
        args: cloakConfig.args,
        channel: cloakConfig.executablePath ? undefined : options.channel,
        executablePath: cloakConfig.executablePath,
        headless: false,
        ignoreDefaultArgs: cloakConfig.ignoreDefaultArgs,
        proxy: cloakConfig.proxy,
        env: cloakConfig.env,
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

    const filteredArgs = cloakConfig.args.filter((arg) => !arg.startsWith("--user-agent="))
    const fingerprint = await getFingerprint(
      options.channel,
      cloakConfig.executablePath,
      filteredArgs,
    )
    const browser = await chromium.launch({
      ...cleanOptions,
      args: [
        ...filteredArgs,
        `--user-agent=${fingerprint.userAgent}`,
      ],
      channel: cloakConfig.executablePath ? undefined : options.channel,
      executablePath: cloakConfig.executablePath,
      headless: true,
      ignoreDefaultArgs: cloakConfig.ignoreDefaultArgs,
      proxy: cloakConfig.proxy,
      env: cloakConfig.env,
    })

    try {
      await attachTargetFingerprint(browser, fingerprint)
      return new BeheadBrowser(browser, fingerprint, true)
    } catch (error) {
      await browser.close().catch(() => undefined)
      throw error
    }
  }

  static async launchPersistent(
    userDataDir: string,
    options: BeheadPersistentOptions = {},
  ): Promise<BeheadSession> {
    const headless = options.headless ?? true
    const viewport = options.viewport === undefined ? null : options.viewport
    const cloakConfig = await resolveCloakConfig(options)
    const cleanOptions = stripCloakOptions(options)

    if (!headless) {
      const context = await chromium.launchPersistentContext(userDataDir, {
        ...cleanOptions,
        args: cloakConfig.args,
        channel: cloakConfig.executablePath ? undefined : options.channel,
        executablePath: cloakConfig.executablePath,
        headless: false,
        ignoreDefaultArgs: cloakConfig.ignoreDefaultArgs,
        proxy: cloakConfig.proxy,
        env: cloakConfig.env,
        viewport,
      })

      try {
        const browser = context.browser()
        const version = browser?.version()
        if (!version) {
          throw new Error("Unable to determine Chromium version from persistent context")
        }
        const fingerprint = buildBeheadFingerprint(
          await readNativeFingerprint(context),
          version,
        )
        return new BeheadSession(context, fingerprint, false)
      } catch (error) {
        await context.close().catch(() => undefined)
        throw error
      }
    }

    const filteredArgs = cloakConfig.args.filter((arg) => !arg.startsWith("--user-agent="))
    const fingerprint = await getFingerprint(
      options.channel,
      cloakConfig.executablePath,
      filteredArgs,
    )
    const context = await chromium.launchPersistentContext(userDataDir, {
      ...cleanOptions,
      args: [
        ...filteredArgs,
        `--user-agent=${fingerprint.userAgent}`,
      ],
      channel: cloakConfig.executablePath ? undefined : options.channel,
      executablePath: cloakConfig.executablePath,
      headless: true,
      ignoreDefaultArgs: cloakConfig.ignoreDefaultArgs,
      proxy: cloakConfig.proxy,
      env: cloakConfig.env,
      viewport,
    })

    try {
      const browser = context.browser()
      if (browser) {
        await attachTargetFingerprint(browser, fingerprint)
      }
      const session = new BeheadSession(context, fingerprint, true)
      await Promise.all(context.pages().map((page) => session.preparePage(page)))
      return session
    } catch (error) {
      await context.close().catch(() => undefined)
      throw error
    }
  }

  async newSession(options: BeheadSessionOptions = {}): Promise<BeheadSession> {
    const context = await this.browser.newContext({
      ...options,
      viewport: options.viewport === undefined ? null : options.viewport,
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

export async function launchPersistentBeheadSession(
  userDataDir: string,
  options: BeheadPersistentOptions = {},
): Promise<BeheadSession> {
  return BeheadBrowser.launchPersistent(userDataDir, options)
}
