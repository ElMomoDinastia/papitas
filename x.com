const { chromium } = require('playwright');

async function simulateView() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();

  try {
    console.log('Navegando al post...');
    await page.goto('https://x.com/jon1esi/status/2032516798776569901', {
      waitUntil: 'networkidle', 
      timeout: 60000
    });

    await page.mouse.wheel(0, 500);
    console.log('View simulada correctamente.');
    
    await page.waitForTimeout(5000);

  } catch (error) {
    console.error('Error al intentar cargar el post:', error.message);
  } finally {
    await browser.close();
  }
}

simulateView();
