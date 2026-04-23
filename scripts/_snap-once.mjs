import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
});
const page = await context.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hvReady === true, { timeout: 10000 });
await page.evaluate(() => window.__hv.navigate('home'));
await new Promise((r) => setTimeout(r, 2000));
await page.addStyleTag({
  content: `html,body{background:transparent!important;overflow:hidden}::-webkit-scrollbar{display:none}`,
});
await page.locator('#root').first().screenshot({
  path: '/Users/suhocho/Desktop/heart-vessel-v2/captures/home-now.png',
  omitBackground: true,
});
await browser.close();
console.log('saved → captures/home-now.png');
