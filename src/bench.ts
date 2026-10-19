import { chromium as patchrightChromium } from "patchright"
import { launchBeheadBrowser } from "./index.js"

async function evaluateDetectors(
  name: string,
  createSession: () => Promise<{ page: any; context: any; close: () => Promise<void> }>,
) {
  const { page, context, close } = await createSession()

  try {
    await page.goto("https://abrahamjuliot.github.io/creepjs/", {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    })
    await page.waitForTimeout(6_500)
    const cdp = await context.newCDPSession(page)
    const creepRaw = await cdp.send("Runtime.evaluate", {
      expression: `JSON.stringify({
        headlessRating: window.Fingerprint?.headless?.headlessRating ?? null,
        stealthRating: window.Fingerprint?.headless?.stealthRating ?? null,
        likeHeadlessRating: window.Fingerprint?.headless?.likeHeadlessRating ?? null,
        liesCount: window.Fingerprint?.lies?.totalLies ?? 0,
      })`,
      returnByValue: true,
    })
    const creep = JSON.parse(creepRaw.result.value)

    await page
      .goto("https://bot.sannysoft.com/", { waitUntil: "networkidle", timeout: 20_000 })
      .catch(() => undefined)
    await page.waitForTimeout(1_500)
    const sannyFailedCount = await page.evaluate(
      () => document.querySelectorAll(".failed").length,
    )

    await page
      .goto("https://nopecha.com/demo/cloudflare", {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      })
      .catch(() => undefined)
    await page.waitForTimeout(4_000)
    for (const frame of page.frames()) {
      if (frame.url().includes("challenges.cloudflare.com")) {
        const box = await frame.locator("body").boundingBox().catch(() => null)
        if (box) {
          await page.mouse.click(box.x + 28, box.y + box.height / 2)
        }
      }
    }
    await page.waitForTimeout(5_000)
    const cookies = (await context.cookies()).map((c: any) => c.name)

    return {
      runner: name,
      creepjs: creep,
      sannysoftFailedChecks: sannyFailedCount,
      cloudflareTurnstileCleared: cookies.includes("cf_clearance"),
    }
  } finally {
    await close()
  }
}

const results = []

results.push(
  await evaluateDetectors("Patchright (Standalone Headless)", async () => {
    const browser = await patchrightChromium.launch({ channel: "chromium", headless: true })
    const context = await browser.newContext({ viewport: null })
    const page = await context.newPage()
    return { page, context, close: () => browser.close() }
  }),
)

results.push(
  await evaluateDetectors("Behead Browser (Headless)", async () => {
    const browser = await launchBeheadBrowser({ headless: true })
    const session = await browser.newSession()
    const page = await session.newPage()
    return { page, context: session.context, close: () => browser.close() }
  }),
)

console.log(JSON.stringify(results, null, 2))
