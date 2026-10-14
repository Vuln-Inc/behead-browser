import { launchBeheadBrowser } from "./index.js"

const query = process.argv.slice(2).join(" ") || "Patchright browser automation"
const browser = await launchBeheadBrowser()

try {
  const session = await browser.newSession()
  const page = await session.newPage()
  const url = new URL("https://www.google.com/search")
  url.searchParams.set("q", query)
  url.searchParams.set("hl", "en")

  const started = Date.now()
  const response = await page.goto(url.toString(), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  })

  if (page.url().includes("/sorry/")) {
    throw new Error("Google redirected this browser to /sorry/")
  }

  console.log({
    query,
    status: response?.status(),
    title: await page.title(),
    url: page.url(),
    elapsedMs: Date.now() - started,
  })

  await session.close()
} finally {
  await browser.close()
}
