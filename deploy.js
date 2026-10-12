"use strict";
require("dotenv").config();
const { REST, Routes } = require("discord.js");
const { commands } = require("./commands");
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

