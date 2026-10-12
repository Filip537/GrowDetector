"use strict";
require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Client, GatewayIntentBits, Events, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { createWorker } = require("tesseract.js");
const sharp = require("sharp");
const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
    console.error("Set DISCORD_TOKEN in .env");
    process.exit(1);
}
const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const MAX_PENDING = 12, MAX_USER_PENDING = 2, MAX_BYTES = 8 * 1024 * 1024;
const queue = [], userPending = new Map();
let active = false, workerPromise = null;
function getWorker() { if (!workerPromise)
    workerPromise = createWorker("eng").catch(e => { workerPromise = null; throw e; }); return workerPromise; }
function guildFile(id) { if (!/^\d{15,25}$/.test(id))
    throw Error("Invalid guild id"); return path.join(DATA_DIR, `guild-${id}.json`); }
function getGuildData(id) { const file = guildFile(id); if (!fs.existsSync(file))
    return { settings: {}, blacklist: [], requests: {} }; const d = JSON.parse(fs.readFileSync(file, "utf8")); return { settings: d.settings || {}, blacklist: d.blacklist || [], requests: d.requests || {} }; }
function saveGuildData(id, d) { const file = guildFile(id), tmp = file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(d, null, 2)); fs.renameSync(tmp, file); }
function admin(i) { return Boolean(i.memberPermissions?.has(PermissionFlagsBits.Administrator)); }
function safe(s) { return String(s ?? "Unknown").replace(/@/g, "＠").slice(0, 800); }
function imageAttachment(att) { return (att.contentType || "").startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(att.name || ""); }
async function downloadImage(url) { const response = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!response.ok)
    throw Error("Image download HTTP " + response.status); const len = Number(response.headers.get("content-length") || 0); if (len > MAX_BYTES)
    throw Error("Image exceeds 8 MB"); const chunks = []; let size = 0; for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES)
        throw Error("Image exceeds 8 MB");
    chunks.push(chunk);
} return Buffer.concat(chunks); }
function getBlacklistGrowID(entry) {
    if (typeof entry === "string")
        return entry.trim();
    return String(entry?.growid ?? entry?.growID ?? entry?.GrowID ?? entry?.name ?? "").trim();
}
function normalizeGrowID(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "");
}
function levenshtein(a, b) {
    a = normalizeGrowID(a);
    b = normalizeGrowID(b);
    if (a === b)
        return 0;
    if (!a.length)
        return b.length;
    if (!b.length)
        return a.length;
    const matrix = Array.from({ length: b.length + 1 }, () => new Array(a.length + 1).fill(0));
    for (let i = 0; i <= b.length; i++) {
        matrix[i][0] = i;
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            const cost = b[i - 1] === a[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
        }
    }
    return matrix[b.length][a.length];
}
function getBlacklistMatch(detectedName, blacklist) {
    const detected = normalizeGrowID(detectedName);
    if (!detected)
        return null;
    // ==========================================
    // 1. EXACT MATCH - ALWAYS ACCEPT
    // ==========================================
    for (const entry of blacklist) {
        if (!entry?.growid)
            continue;
        const blacklisted = normalizeGrowID(entry.growid);
        if (detected === blacklisted) {
            return {
                entry,
                type: "exact",
                distance: 0
            };
        }
    }
    // ==========================================
    // 2. VERY STRICT OCR FUZZY MATCH
    // ==========================================
    let bestMatch = null;
    for (const entry of blacklist) {
        if (!entry?.growid)
            continue;
        const blacklisted = normalizeGrowID(entry.growid);
        if (!blacklisted)
            continue;
        const lengthDifference = Math.abs(detected.length -
            blacklisted.length);
        // Different lengths by more than 1?
        // Don't consider it.
        if (lengthDifference > 1) {
            continue;
        }
        const longest = Math.max(detected.length, blacklisted.length);
        // Short GrowIDs = exact only
        if (longest < 7) {
            continue;
        }
        const distance = levenshtein(detected, blacklisted);
        /*
          STRICT RULE:
    
          7-11 chars:
          max 1 OCR mistake
    
          12+ chars:
          max 1 OCR mistake too.
    
          We deliberately DO NOT allow distance 2 anymore.
        */
        const maxDistance = 1;
        if (distance <= maxDistance &&
            (!bestMatch ||
                distance < bestMatch.distance)) {
            bestMatch = {
                entry,
                type: "fuzzy",
                distance
            };
        }
    }
    return bestMatch;
}
function findBlacklistInRawWhoText(text, blacklist) {
    if (!text)
        return [];
    const compactOCR = String(text)
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "");
    const found = [];
    for (const entry of blacklist) {
        if (!entry?.growid)
            continue;
        const target = normalizeGrowID(entry.growid);
        if (target.length < 4)
            continue;
        if (compactOCR.includes(target)) {
            found.push({
                entry,
                detectedName: entry.growid,
                matchType: "raw-text-exact",
                distance: 0
            });
            console.log(`[RAW OCR BLACKLIST MATCH] "${entry.growid}" found in OCR`);
        }
    }
    return found;
}
function findGrowIDInsideMergedOCR(candidateText, targetGrowID) {
    const candidate = normalizeGrowID(candidateText);
    const target = normalizeGrowID(targetGrowID);
    if (!candidate || !target)
        return null;
    // Exact name inside merged OCR
    if (candidate.includes(target)) {
        return {
            type: "merged-exact",
            distance: 0
        };
    }
    // Avoid fuzzy matching very short IDs
    if (target.length < 5) {
        return null;
    }
    let maxDistance = 1;
    if (target.length >= 8) {
        maxDistance = 2;
    }
    const minLength = Math.max(4, target.length - maxDistance);
    const maxLength = Math.min(candidate.length, target.length + maxDistance);
    let best = null;
    for (let length = minLength; length <= maxLength; length++) {
        for (let start = 0; start + length <= candidate.length; start++) {
            const window = candidate.slice(start, start + length);
            const distance = levenshtein(window, target);
            if (distance <= maxDistance &&
                (!best || distance < best.distance)) {
                best = {
                    type: "merged-fuzzy",
                    distance,
                    window
                };
                if (distance === 0) {
                    return best;
                }
            }
        }
    }
    return best;
}
function extractWhoNames(text) {
    if (!text)
        return [];
    const lines = String(text).replace(/\r/g, "\n").split("\n");
    let collecting = false;
    const collected = [];
    for (const raw of lines) {
        const line = raw.trim();
        if (!line)
            continue;
        const start = line.match(/who['’]?s?\s+in\s+[^:]+:\s*(.*)$/i);
        if (start) {
            collecting = true;
            if (start[1])
                collected.push(start[1]);
            continue;
        }
        if (!collecting)
            continue;
        if (/^\s*\[[^\]]+\]\s*\[\d{1,2}:\d{2}:\d{2}\]/.test(line) || /^(world\s+|xenonite|click profile)/i.test(line))
            break;
        collected.push(line);
    }
    if (!collected.length)
        return [];
    return [...new Map(collected.join(" ").split(",").map(v => v.trim().replace(/\s+/g, "")).filter(v => /^[a-z0-9_]{2,24}$/i.test(v)).map(v => [normalizeGrowID(v), v])).values()];
}
async function scan(message, image, reply) {
    const buffer = await downloadImage(image.url);
    const meta = await sharp(buffer, { limitInputPixels: 25000000 }).metadata();
    if (!meta.width || !meta.height)
        throw new Error("Invalid image");
    const a = await sharp(buffer).resize({ width: 2200, withoutEnlargement: false }).grayscale().normalize().sharpen({ sigma: 1.2 }).png().toBuffer();
    const b = await sharp(buffer).resize({ width: 2600, withoutEnlargement: false }).grayscale().normalize().linear(1.4, -20).sharpen({ sigma: 1.5 }).threshold(145).png().toBuffer();
    const worker = await getWorker();
    const text1 = (await worker.recognize(a)).data.text || "";
    const text2 = (await worker.recognize(b)).data.text || "";
    const namesPass1 = extractWhoNames(text1);
    const namesPass2 = extractWhoNames(text2);
    if (!namesPass1.length && !namesPass2.length) {
        return reply.edit({ content: "Could not detect a Growtopia `/who` list. Make sure `Who's in WORLD:` is visible." });
    }
    const uniqueNames = [...new Map([...namesPass1, ...namesPass2].map(n => [normalizeGrowID(n), n])).values()];
    let raw;
    try {
        raw = getGuildData(message.guildId).blacklist;
    }
    catch (err) {
        throw new Error("Invalid guild blacklist data: " + err.message);
    }
    if (!Array.isArray(raw))
        throw new Error("Guild blacklist must contain an array");
    const blacklist = raw.map(e => {
        const growid = getBlacklistGrowID(e);
        if (!growid)
            return null;
        return typeof e === "string" ? { growid, reason: "Unknown", proof: "Unknown" } : { ...e, growid };
    }).filter(Boolean);
    if (!blacklist.length)
        return reply.edit({ content: "Blacklist database is empty. Approve a blacklist request first." });
    const candidateTexts = new Set(uniqueNames.map(normalizeGrowID).filter(Boolean));
    for (const p of [namesPass1, namesPass2]) {
        const merged = normalizeGrowID(p.join(""));
        if (merged)
            candidateTexts.add(merged);
    }
    // Limit merged/raw fuzzy matches to the parsed /who section.
    const matches = [];
    for (const entry of blacklist) {
        let found = null;
        for (const candidate of candidateTexts) {
            const result = findGrowIDInsideMergedOCR(candidate, entry.growid);
            if (result) {
                found = result;
                break;
            }
        }
        if (!found) {
            for (const name of uniqueNames) {
                const result = getBlacklistMatch(name, [entry]);
                if (result) {
                    found = result;
                    break;
                }
            }
        }
        if (found)
            matches.push({ entry, found });
    }
    const safe = s => String(s || "Unknown").replace(/@/g, "＠").slice(0, 450);
    if (!matches.length) {
        const embed = new EmbedBuilder().setColor("Green").setTitle("/who Blacklist Scan Clear")
            .setDescription(`No blacklisted GrowIDs were found.\n\n**Players detected: ${uniqueNames.length}**\n${uniqueNames.map(n => "\`" + safe(n) + "\`").join(", ").slice(0, 2500)}`)
            .setFooter({ text: `Blacklist database: ${blacklist.length} entries` }).setTimestamp();
        return reply.edit({ content: "", embeds: [embed] });
    }
    const lines = matches.map(({ entry }) => `**${safe(entry.growid)}**\nReason: ${safe(entry.reason)}\nProof: ${safe(entry.proof)}`).join("\n\n").slice(0, 3500);
    const embed = new EmbedBuilder().setColor("Red").setTitle("BLACKLISTED PLAYER DETECTED")
        .setDescription(`Found **${matches.length} blacklisted player(s)** in the /who screenshot.\n\n${lines}`)
        .setFooter({ text: `${uniqueNames.length} players detected • ${blacklist.length} blacklist entries checked` }).setTimestamp();
    return reply.edit({ content: "", embeds: [embed] });
}
async function pump() {
    if (active || !queue.length)
        return;
    active = true;
    const job = queue.shift();
    try {
        await job.reply.edit({ content: "Scanning your screenshot now..." });
        await scan(job.message, job.image, job.reply);
    }
    catch (err) {
        console.error("[SCAN]", err);
        await job.reply.edit({ content: "Scan failed: " + String(err.message).slice(0, 160) }).catch(() => { });
    }
    finally {
        const n = (userPending.get(job.message.guildId + ":" + job.message.author.id) || 1) - 1;
        if (n > 0)
            userPending.set(job.message.guildId + ":" + job.message.author.id, n);
        else
            userPending.delete(job.message.guildId + ":" + job.message.author.id);
        active = false;
        setImmediate(pump);
    }
}
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const setupNames = { setupblacklist: "blacklist", setupunblist: "unblist", setproof: "proof", setscanchannel: "scan" };
async function sendChannel(guild, id, payload) { if (!id)
    return null; const channel = await guild.channels.fetch(id).catch(() => null); if (!channel?.isTextBased())
    return null; return channel.send(payload).catch(e => { console.error("Channel send failed", id, e.message); return null; }); }
function buttons(id) { return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`blapprove:${id}`).setLabel("Approve").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`bldeny:${id}`).setLabel("Deny").setStyle(ButtonStyle.Danger))]; }
function requestEmbed(r) { return new EmbedBuilder().setColor(r.type === "unblist" ? "Orange" : r.type === "report" ? "Blue" : "Yellow").setTitle(`${r.type.toUpperCase()} — Pending approval`).addFields({ name: "GrowID", value: safe(r.growid), inline: true }, { name: "Submitted by", value: `<@${r.by}>`, inline: true }, { name: "Reason", value: safe(r.reason) }, { name: "Proof", value: safe(r.proof || "Not provided") }).setFooter({ text: `Request ID: ${r.id}` }).setTimestamp(); }
async function handleRequest(i, d, type) {
    const growid = i.options.getString("growid", true).trim(), reason = i.options.getString("reason", true).trim(), proof = type === "unblist" ? "" : i.options.getString("proof", true).trim();
    if (!/^[A-Za-z0-9_]{2,24}$/.test(growid))
        return i.reply({ content: "GrowID must contain 2–24 letters, digits, or underscores.", flags: MessageFlags.Ephemeral });
    if (reason.length > 600 || proof.length > 700)
        return i.reply({ content: "Reason or proof is too long.", flags: MessageFlags.Ephemeral });
    if (type === "unblist" && !d.settings.unblist)
        return i.reply({ content: "Configure `/setupunblist` first.", flags: MessageFlags.Ephemeral });
    if (type !== "unblist" && !d.settings.blacklist)
        return i.reply({ content: "Configure `/setupblacklist` first.", flags: MessageFlags.Ephemeral });
    if (!d.settings.proof)
        return i.reply({ content: "An administrator must configure `/setproof` first.", flags: MessageFlags.Ephemeral });
    if (type === "unblist" && !d.blacklist.some(x => normalizeGrowID(x.growid) === normalizeGrowID(growid)))
        return i.reply({ content: "That GrowID is not blacklisted on this server.", flags: MessageFlags.Ephemeral });
    if (type !== "unblist" && d.blacklist.some(x => normalizeGrowID(x.growid) === normalizeGrowID(growid)))
        return i.reply({ content: "That GrowID is already blacklisted on this server.", flags: MessageFlags.Ephemeral });
    const id = crypto.randomUUID().slice(0, 12), r = { id, type, growid, reason, proof, by: i.user.id, createdAt: new Date().toISOString(), status: "pending" };
    d.requests[id] = r;
    saveGuildData(i.guildId, d);
    const posted = await sendChannel(i.guild, d.settings.proof, { embeds: [requestEmbed(r)], components: buttons(id), allowedMentions: { parse: [] } });
    if (!posted) {
        delete d.requests[id];
        saveGuildData(i.guildId, d);
        return i.reply({ content: "Cannot post to the configured proof channel. Check bot permissions.", flags: MessageFlags.Ephemeral });
    }
    r.messageId = posted.id;
    saveGuildData(i.guildId, d);
    return i.reply({ content: `${type === "report" ? "Report" : "Request"} submitted for administrator approval in <#${d.settings.proof}>. ID: \`${id}\``, flags: MessageFlags.Ephemeral });
}
async function review(i) {
    if (!admin(i))
        return i.reply({ content: "Only server administrators can review blacklist requests.", flags: MessageFlags.Ephemeral });
    const [action, id] = i.customId.split(":"), d = getGuildData(i.guildId), r = d.requests[id];
    if (!r || r.status !== "pending")
        return i.reply({ content: "This request has already been processed or no longer exists.", flags: MessageFlags.Ephemeral });
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const approve = action === "blapprove", key = normalizeGrowID(r.growid), idx = d.blacklist.findIndex(x => normalizeGrowID(x.growid) === key);
    if (approve && r.type === "unblist" && idx < 0)
        return i.editReply("Player is no longer blacklisted.");
    if (approve && r.type !== "unblist" && idx >= 0)
        return i.editReply("Player is already blacklisted.");
    // Save approval first, then publish an audit event. A failed publish can be retried manually.
    if (approve) {
        if (r.type === "unblist")
            d.blacklist.splice(idx, 1);
        else
            d.blacklist.push({ growid: r.growid, reason: r.reason, proof: r.proof, reportedBy: r.by, approvedBy: i.user.id, addedAt: new Date().toISOString() });
    }
    r.status = approve ? "approved" : "denied";
    r.reviewedBy = i.user.id;
    r.reviewedAt = new Date().toISOString();
    saveGuildData(i.guildId, d);
    const title = approve ? (r.type === "unblist" ? "Blacklist removed" : "Player blacklisted") : "Blacklist request denied";
    const log = new EmbedBuilder().setColor(approve ? (r.type === "unblist" ? "Orange" : "Red") : "Grey").setTitle(title)
        .addFields({ name: "GrowID", value: safe(r.growid), inline: true }, { name: "Reviewed by", value: `<@${i.user.id}>`, inline: true }, { name: "Reason", value: safe(r.reason) }, { name: "Proof", value: safe(r.proof || "Not provided") }).setTimestamp();
    const dest = approve ? (r.type === "unblist" ? d.settings.unblist : d.settings.blacklist) : null;
    const posted = dest ? await sendChannel(i.guild, dest, { embeds: [log], allowedMentions: { parse: [] } }) : null;
    await i.message.edit({ embeds: [requestEmbed(r).setTitle(`${r.type.toUpperCase()} — ${r.status.toUpperCase()}`).setColor(approve ? "Green" : "Grey")], components: [] }).catch(() => { });
    await i.editReply(`${title}: **${safe(r.growid)}**.${approve && !dest ? " Warning: destination channel not configured." : approve && !posted ? " Warning: couldn't publish to the destination channel." : ""}`);
}
client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);
});
client.on(Events.InteractionCreate, async (i) => {
    if (!i.guildId)
        return;
    try {
        if (i.isButton() && (i.customId.startsWith("blapprove:") || i.customId.startsWith("bldeny:")))
            return await review(i);
        if (!i.isChatInputCommand())
            return;
        const name = i.commandName;
        if (!["report", "help"].includes(name) && !admin(i))
            return i.reply({ content: "Administrator permission required.", flags: MessageFlags.Ephemeral });
        if (name === "help") {
            console.log(`[HELP] Received from ${i.user.id} in guild ${i.guildId}`);
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const choice = i.options.getString("choice", true);
            const info = [
                "# GrowDetector — Information",
                "## How the Bot Works",
                "GrowDetector helps server administrators manage Growtopia player blacklists and review reports.",
                "",
                "### Screenshot Scanner",
                "**1.** An administrator sets a screenshot channel using `/setscanchannel`.",
                "**2.** An administrator uploads a screenshot of the Growtopia `/who` player list in that channel.",
                "**3.** The bot queues the image, reads player names using AI-powered text recognition (OCR), and checks them against this server's blacklist.",
                "**4.** The bot replies with detected names and any potential blacklist matches.",
                "",
                "### Important Notice",
                "**The bot uses AI-powered text recognition to read names from screenshots. It can make mistakes, miss names, or incorrectly match players.**",
                "**Always manually verify the screenshot and evidence before taking action.**",
                "",
                "### Reports and Blacklists",
                "Members can use `/report` to submit a player report. Administrators review requests using **Approve** or **Deny** buttons.",
                "Each server maintains its **own blacklist**."
            ].join("\n");
            const commandHelp = [
                "# GrowDetector — Commands",
                "## Public Commands",
                "**/help choice:info** — Learn how the bot works.",
                "**/help choice:commands** — View the command list.",
                "**/report** — Report a Growtopia player for administrator review.",
                "",
                "## Administrator Commands",
                "**/setupblacklist** — Set the channel for approved blacklist entries.",
                "**/setupunblist** — Set the channel for approved removals.",
                "**/setproof** — Set the proof and pending requests channel.",
                "**/setscanchannel** — Set the `/who` screenshot scanning channel.",
                "**/addblist** — Submit a player blacklist request.",
                "**/unblist** — Request removal of a blacklisted player.",
                "**/checkblist** — Check a specific GrowID.",
                "**/blist** — View the server blacklist.",
                "**/scanstatus** — Check scanner queue status.",
                "**/blacklistsettings** — View configured channels.",
                "",
                "### Screenshot Scanning",
                "Upload a Growtopia **/who screenshot** in the configured scan channel. **Only administrators can trigger scans** with the current settings."
            ].join("\n");
            const content = choice === "info" ? info : commandHelp;
            console.log(`[HELP] Sending ${choice}, ${content.length} characters`);
            return await i.editReply({
                content,
                allowedMentions: { parse: [] }
            });
        }
        const d = getGuildData(i.guildId);
        if (setupNames[name]) {
            const channel = i.options.getChannel("channel", true);
            if (!channel.isTextBased()) {
                return i.reply({ content: "Select a text channel.", flags: MessageFlags.Ephemeral });
            }
            d.settings[setupNames[name]] = channel.id;
            saveGuildData(i.guildId, d);
            return i.reply({ content: `${name} configured: <#${channel.id}>`, flags: MessageFlags.Ephemeral });
        }
        if (["addblist", "unblist", "report"].includes(name))
            return await handleRequest(i, d, name);
        if (name === "checkblist") {
            const q = i.options.getString("growid", true), entry = d.blacklist.find(x => normalizeGrowID(x.growid) === normalizeGrowID(q));
            return i.reply({ content: entry ? `**BLACKLISTED:** ${safe(entry.growid)}
Reason: ${safe(entry.reason)}
Proof: ${safe(entry.proof)}` : `**${safe(q)}** is not on this server's blacklist.`, flags: MessageFlags.Ephemeral });
        }
        if (name === "blist")
            return i.reply({ content: d.blacklist.length ? `**Server blacklist (${d.blacklist.length}):**
${d.blacklist.slice(0, 75).map(x => "• " + safe(x.growid)).join("\n").slice(0, 1900)}` : "This server's blacklist is empty.", flags: MessageFlags.Ephemeral });
        if (name === "scanstatus")
            return i.reply({ content: `Scanner: ${active ? "busy" : "idle"} • Queue: ${queue.length}/${MAX_PENDING} • OCR workers: 1`, flags: MessageFlags.Ephemeral });
        if (name === "blacklistsettings")
            return i.reply({ content: Object.entries({ Blacklist: d.settings.blacklist, Unblacklist: d.settings.unblist, Proof: d.settings.proof, Scan: d.settings.scan }).map(([k, v]) => `${k}: ${v ? `<#${v}>` : "Not configured"}`).join("\n"), flags: MessageFlags.Ephemeral });
    }
    catch (e) {
        console.error("Interaction error", e);
        if (i.deferred || i.replied)
            await i.followUp({ content: "An error occurred. Check the bot logs.", flags: MessageFlags.Ephemeral }).catch(() => { });
        else
            await i.reply({ content: "An error occurred. Check the bot logs.", flags: MessageFlags.Ephemeral }).catch(() => { });
    }
});
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guildId)
        return;
    const d = getGuildData(message.guildId);
    if (!d.settings.scan || message.channelId !== d.settings.scan)
        return;
    if (!message.member?.permissions.has(PermissionFlagsBits.Administrator))
        return;
    const image = message.attachments.find(imageAttachment);
    if (!image)
        return;
    const key = message.guildId + ":" + message.author.id, pending = userPending.get(key) || 0;
    if (pending >= MAX_USER_PENDING)
        return message.reply({ content: "You already have two pending scans.", allowedMentions: { repliedUser: false } }).catch(() => { });
    if (queue.length >= MAX_PENDING)
        return message.reply({ content: "Scanner queue full; try again later.", allowedMentions: { repliedUser: false } }).catch(() => { });
    const reply = await message.reply({ content: `Screenshot queued (position ${queue.length + 1}).`, allowedMentions: { repliedUser: false } }).catch(() => null);
    if (!reply)
        return;
    userPending.set(key, pending + 1);
    queue.push({ message, image, reply });
    void pump();
});
async function shutdown() {
    if (workerPromise) {
        try {
            await (await workerPromise).terminate();
        }
        catch (error) {
            console.error("Worker shutdown:", error);
        }
    }
    client.destroy();
    process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
client.login(TOKEN).catch(e => { console.error("Bot login failed", e); process.exit(1); });

