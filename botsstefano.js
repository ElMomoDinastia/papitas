const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// --- CONFIGURACIÓN ---
const HAXBALL_ROOMS = (process.env.HAXBALL_ROOMS || "").split(',');
const JOB_INDEX = parseInt(process.env.JOB_INDEX || 0);
const BOT_NICKNAME = process.env.JOB_ID || "bot";
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1393006720237961267/lxg_qUjPdnitvXt-aGzAwthMMwNbXyZIbPcgRVfGCSuLldynhFHJdsyC4sSH-Ymli5Xm";

function getRoomForJob() {
    if (!HAXBALL_ROOMS.length || HAXBALL_ROOMS[0] === "") return '';
    return HAXBALL_ROOMS[JOB_INDEX % HAXBALL_ROOMS.length].trim();
}

function handleCriticalError(error, context = '') {
    console.error(`❌ ERROR CRÍTICO ${context}:`, error);
    notifyDiscord(`🔴 **ERROR CRÍTICO** - Bot ${BOT_NICKNAME} cancelado. ${context}: ${error.message}`);
    process.exit(1);
}

process.on('uncaughtException', (error) => handleCriticalError(error, 'Excepción no capturada'));
process.on('unhandledRejection', (reason) => handleCriticalError(new Error(reason), 'Promesa rechazada'));

async function main() {
    const HAXBALL_ROOM_URL = getRoomForJob();
    console.log(`🤖 Bot ${BOT_NICKNAME} entrando a: ${HAXBALL_ROOM_URL}`);

    let browser, page;

    try {
        browser = await puppeteer.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        page = await browser.newPage();

        // Fake geo
        const haxballCountryCodes = ["uy","ar","br","cn","ly","me","vi","cl","cy"];
        const randomCode = haxballCountryCodes[Math.floor(Math.random() * haxballCountryCodes.length)];
        await page.evaluateOnNewDocument((code) => {
            localStorage.setItem("geo", JSON.stringify({ lat: -34.6504, lon: -58.3878, code: code || 'ar' }));
        }, randomCode);

        await page.goto(HAXBALL_ROOM_URL, { waitUntil: 'networkidle2' });
        await page.waitForSelector('iframe');

        const iframeElement = await page.$('iframe');
        const frame = await iframeElement.contentFrame();
        if (!frame) throw new Error('No se pudo acceder al iframe de Haxball');

        // --- NICKNAME ---
        console.log("Escribiendo el nombre de usuario...");
        const nickSelector = 'input[data-hook="input"][maxlength="25"]';
        await frame.waitForSelector(nickSelector, { timeout: 15000 });
        const nickInput = await frame.$(nickSelector);
        await nickInput.click();
        await nickInput.type(BOT_NICKNAME);
        await nickInput.press('Enter');
        console.log("✅ Nombre escrito");

        // --- CONTRASEÑA ---
        if (process.env.HAXBALL_PASSWORD && process.env.HAXBALL_PASSWORD.trim() !== "") {
            console.log("⏳ Esperando input de contraseña...");
            let passInput = null;

            try {
                const passSelector = 'input[data-hook="input"][maxlength="30"]';
                await frame.waitForSelector(passSelector, { timeout: 6000 });
                passInput = await frame.$(passSelector);
                console.log("🔐 Input de contraseña detectado (maxlength=30).");
            } catch {
                // fallback: segundo input
                await frame.waitForFunction(() => document.querySelectorAll('input[data-hook="input"]').length >= 2, { timeout: 6000 });
                const inputs = await frame.$$('input[data-hook="input"]');
                passInput = inputs[1];
                console.log("🔐 Segundo input detectado como contraseña.");
            }

            if (!passInput) throw new Error("No se pudo encontrar el input de contraseña");

            try { await passInput.focus(); } catch (_) {}
            await new Promise(res => setTimeout(res, 100));
            try {
                const box = await passInput.boundingBox();
                const frameBox = await iframeElement.boundingBox();
                if (box && frameBox) {
                    await page.mouse.click(frameBox.x + box.x + box.width / 2, frameBox.y + box.y + box.height / 2);
                } else {
                    await passInput.click();
                }
            } catch { await passInput.click(); }

            await new Promise(res => setTimeout(res, 120));
            await passInput.type(process.env.HAXBALL_PASSWORD, { delay: 40 });
            await passInput.press('Enter');
            console.log("🔓 Contraseña enviada");
        }

        console.log("✅ Inputs completados, bot dentro de la sala (si la password era correcta).");

        // --- CHAT ---
        const chatSelector = 'input[data-hook="input"][maxlength="140"]';
        await frame.waitForSelector(chatSelector, { timeout: 15000 });
        await notifyDiscord(`🟢 El bot **${BOT_NICKNAME}** ha entrado a la sala.`);

        await sendMessageToChat(frame, process.env.LLAMAR_ADMIN);

        const chatInterval = setInterval(async () => {
            try { await sendMessageToChat(frame, process.env.MENSAJE); }
            catch (error) { clearInterval(chatInterval); throw new Error('Perdida de conexión con el chat'); }
        }, 1000);

        // --- ANTI-AFK ---
        const moves = ['w','a','s','d'];
        let moveIndex = 0;
        const moveInterval = setInterval(async () => {
            try { await page.keyboard.press(moves[moveIndex++ % moves.length]); }
            catch (error) { clearInterval(moveInterval); throw new Error('Perdida de conexión con el juego'); }
        }, 5000);

        // --- HEALTH-CHECK ---
        const healthCheck = setInterval(async () => {
            try { await frame.waitForSelector(chatSelector, { timeout: 5000 }); }
            catch (error) { clearInterval(healthCheck); clearInterval(chatInterval); clearInterval(moveInterval); throw new Error('Perdida de conexión con el servidor'); }
        }, 30000);

        // --- CHAT → DISCORD ---
        await page.exposeFunction('sendToDiscord', async ({ nick, msg }) => {
            await notifyDiscord(`💬 **${nick}**: ${msg}`);
        });

        await frame.evaluate((botNick) => {
            const chatContainer = document.querySelector('.chat-messages');
            if (!chatContainer) return;
            const observer = new MutationObserver(mutations => {
                for (let m of mutations) {
                    for (let node of m.addedNodes) {
                        if (node.nodeType === 1) {
                            const nick = node.querySelector('.nick')?.innerText || 'Desconocido';
                            const msg = node.querySelector('.message')?.innerText;
                            if (msg && nick !== botNick) window.sendToDiscord({ nick, msg });
                        }
                    }
                }
            });
            observer.observe(chatContainer, { childList: true });
        }, BOT_NICKNAME);

        // Mantener bot activo 1h
        await new Promise(resolve => setTimeout(resolve, 3600000));

    } catch (error) {
        console.error("❌ Error durante la ejecución del bot:", error);
        await notifyDiscord(`🔴 Error del bot **${BOT_NICKNAME}**: ${error.message}`);
        if (browser) await browser.close();
        process.exit(1);
    } finally {
        if (browser) await browser.close();
        await notifyDiscord(`🟡 El bot **${BOT_NICKNAME}** terminó.`);
    }
}

// --- FUNCIONES AUXILIARES ---
async function notifyDiscord(message) {
    if (!DISCORD_WEBHOOK_URL) return;
    try {
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: message }),
        });
    } catch (e) { console.error("Error enviando a Discord:", e); }
}

async function sendMessageToChat(frame, message) {
    if (!message) return;
    try {
        const chatSelector = 'input[data-hook="input"][maxlength="140"]';
        await frame.waitForSelector(chatSelector);
        const chatInput = await frame.$(chatSelector);
        await chatInput.click();
        await chatInput.type(message);
        await chatInput.press('Enter');
    } catch (e) { console.error("Error al enviar mensaje:", e); throw e; }
}

// --- REINTENTOS ---
let intentos = 0;
const MAX_INTENTOS = 1000;

async function iniciarBotConReintentos() {
    while (intentos < MAX_INTENTOS) {
        try {
            intentos++;
            console.log(`🔁 Intento ${intentos} de ${MAX_INTENTOS}`);
            await main();
            break;
        } catch (error) {
            await notifyDiscord(`🔴 Fallo intento ${intentos}: ${error.message}`);
            if (intentos >= MAX_INTENTOS) {
                await notifyDiscord(`❌ El bot **${BOT_NICKNAME}** falló tras ${MAX_INTENTOS} intentos.`);
                process.exit(1);
            }
            await new Promise(res => setTimeout(res, 5000));
        }
    }
}

iniciarBotConReintentos();

