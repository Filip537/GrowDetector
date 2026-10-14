"use strict";
require("dotenv").config();
const { REST, Routes } = require("discord.js");
"use strict";
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const c = (name, description) => new SlashCommandBuilder().setName(name).setDescription(description);
const setup = (name, description) => c(name, description).addChannelOption(o => o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText).setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
const commands = [
    c("help", "Open the GrowDetector help menu"),
    setup("setupblacklist", "Choose channel for approved blacklists"),
    setup("setupunblist", "Choose channel for approved removals"),
    setup("setproof", "Choose channel for proof and reports"),
    setup("setscanchannel", "Choose channel for administrator /who screenshot scans"),
    c("addblist", "Submit a blacklist request for approval").setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o => o.setName("growid").setDescription("Growtopia player ID").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Why this player should be blacklisted").setRequired(true))
        .addStringOption(o => o.setName("proof").setDescription("Optional proof URL or evidence reference").setRequired(false))
        .addAttachmentOption(o => o.setName("image").setDescription("Upload proof screenshot (optional)").setRequired(false)),
    c("unblist", "Submit a blacklist removal for approval").setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o => o.setName("growid").setDescription("Growtopia player ID").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason for removal").setRequired(true))
        .addAttachmentOption(o => o.setName("image").setDescription("Upload removal evidence (optional)").setRequired(false)),
    c("report", "Public: report a Growtopia player to server administrators")
        .addStringOption(o => o.setName("growid").setDescription("Growtopia player ID").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("What happened").setRequired(true))
        .addStringOption(o => o.setName("proof").setDescription("Optional proof URL or evidence reference").setRequired(false))
        .addAttachmentOption(o => o.setName("image").setDescription("Upload proof screenshot (optional)").setRequired(false)),
    c("checkblist", "Check whether a GrowID is on this server's blacklist").setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o => o.setName("growid").setDescription("Growtopia player ID").setRequired(true)),
    c("blist", "Show this server's blacklisted GrowIDs").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    c("scanstatus", "Show OCR scanner queue status").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    c("blacklistsettings", "Show this server's blacklist channel settings").setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(v => v.toJSON());



const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.DEPLOY_GUILD_ID;
if (!token || !clientId) {
    console.error("Missing DISCORD_TOKEN or CLIENT_ID in .env");
    process.exit(1);
}
async function deploy() {
    const rest = new REST({ version: "10" }).setToken(token);
    const route = guildId
        ? Routes.applicationGuildCommands(clientId, guildId)
        : Routes.applicationCommands(clientId);
    console.log(`Deploying ${commands.length} ${guildId ? "guild" : "global"} commands...`);
    await rest.put(route, { body: commands });
    console.log("Slash commands deployed successfully.");
}
deploy().catch((error) => {
    console.error("Slash command deployment failed:", error);
    process.exitCode = 1;
});

