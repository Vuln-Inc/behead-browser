import { launchBeheadBrowser } from "./index.js"

const browser = await launchBeheadBrowser()

try {
  const session = await browser.newSession()
  const page = await session.newPage()

  await page.goto("https://example.com", { waitUntil: "domcontentloaded" })
  console.log({
    title: await page.title(),
    url: page.url(),
    userAgent: await page.evaluate(() => navigator.userAgent),
  })

  await session.close()
} finally {
  await browser.close()
}
