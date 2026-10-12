# Multi-server Growtopia Blacklist Bot

Independent bot with **one separate JSON database per Discord server**. No NoobV2 token, files, or database access.

## Install
1. Create a **new** bot in the Discord Developer Portal; enable Message Content Intent.
2. Invite it to servers with the `bot` and `applications.commands` scopes. Give it View Channel, Send Messages, Embed Links, Read Message History permissions in configured channels.
3. Use Node.js 20+; run `npm install`.
4. Copy `.env.example` to `.env`, fill in the **new** bot token and application ID.
5. Run `npm start`, or `pm2 start index.js --name blacklist-multiserver && pm2 save`.
6. Each server's admin configures channels using `/setupblacklist`, `/setupunblist`, `/setproof`, `/setscanchannel`.

## Commands
- `/setupblacklist channel:` — approved blacklist announcements.
- `/setupunblist channel:` — approved removal announcements.
- `/setproof channel:` — proof, reports and approval buttons.
- `/setscanchannel channel:` — administrator-only /who screenshot scanner.
- `/addblist growid: reason: proof:` — admin submits for approval.
- `/unblist growid: reason:` — admin submits removal for approval.
- `/report growid: reason: proof:` — public submits report for approval.
- `/checkblist growid:` — admin checks local server blacklist.
- `/blist` — admin sees local server blacklist.
- `/scanstatus` and `/blacklistsettings` — admin status.

All submissions post to the configured proof channel for administrator approval. The approving admin clicks **Approve** or **Deny**. Approved additions are stored only in `data/guild-SERVER_ID.json`, and announced in that server's blacklist channel; removals go to the configured unblacklist channel. Proof is stored with each approved entry and included in approval logs. The proof channel also acts as the review channel.

**Important:** Admins can approve their own submissions. Add a second-reviewer rule if you want independent moderation. Approved entries are saved before channel announcements; if the bot lacks channel permissions, the record is saved but the announcement may fail. OCR matches can be inaccurate and should be manually verified. Scan queue uses 1 OCR worker and 12 waiting jobs; data persists across restarts, but queued scans do not. There is no database synchronization between servers or with NoobV2. Global slash commands can take time to appear.
