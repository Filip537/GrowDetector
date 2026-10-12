"use strict";
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const c = (name, description) => new SlashCommandBuilder().setName(name).setDescription(description);
const setup = (name, description) => c(name, description).addChannelOption(o => o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText).setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
const commands = [
    setup("setupblacklist", "Choose channel for approved blacklists"),
    setup("setupunblist", "Choose channel for approved removals"),
    setup("setproof", "Choose channel for proof and reports"),
    setup("setscanchannel", "Choose channel for administrator /who screenshot scans"),
    c("addblist", "Submit a blacklist request for approval").setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o => o.setName("growid").setDescription("Growtopia player ID").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Why this player should be blacklisted").setRequired(true))
        .addStringOption(o => o.setName("proof").setDescription("Proof URL or evidence reference").setRequired(true)),
    c("unblist", "Submit a blacklist removal for approval").setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o => o.setName("growid").setDescription("Growtopia player ID").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason for removal").setRequired(true)),
    c("report", "Public: report a Growtopia player to server administrators")
        .addStringOption(o => o.setName("growid").setDescription("Growtopia player ID").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("What happened").setRequired(true))
        .addStringOption(o => o.setName("proof").setDescription("Proof URL or evidence reference").setRequired(true)),
    c("checkblist", "Check whether a GrowID is on this server's blacklist").setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o => o.setName("growid").setDescription("Growtopia player ID").setRequired(true)),
    c("blist", "Show this server's blacklisted GrowIDs").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    c("scanstatus", "Show OCR scanner queue status").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    c("blacklistsettings", "Show this server's blacklist channel settings").setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(v => v.toJSON());
module.exports = { commands };

