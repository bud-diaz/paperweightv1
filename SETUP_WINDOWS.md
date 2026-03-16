# Paperweight — Windows Setup Guide

This guide sets up a Paperweight station on a Windows device — Surface Pro, mini PC, thin client, or any old Windows laptop.

No prior experience required.

---

## What you need

- Windows 10 or 11 (64-bit)
- 2GB RAM minimum, 4GB+ recommended
- A wired or Wi-Fi connection
- A browser on any device to access the station

---

## Step 1 — Install Git for Windows

Paperweight's setup script runs in Bash. Git for Windows includes a Bash terminal.

1. Go to **git-scm.com/download/win**
2. Download and run the installer
3. Accept all defaults — no changes needed
4. After install, you'll have **Git Bash** in your Start menu

> All terminal commands in this guide are run in **Git Bash**, not the Windows Command Prompt or PowerShell.

---

## Step 2 — Install Node.js

1. Go to **nodejs.org**
2. Download the **LTS** version (the left button)
3. Run the installer, accept all defaults
4. When asked about "Tools for Native Modules", check the box — it installs build tools automatically

Verify in Git Bash:
```bash
node --version   # should show v18.x.x or higher
npm --version
```

---

## Step 3 — Install FFmpeg

FFmpeg handles all audio processing. The easiest way is through **winget**, which is built into Windows 10/11.

Open **PowerShell as Administrator** (right-click the Start button → Terminal (Admin)) and run:

```powershell
winget install Gyan.FFmpeg
```

After install, **close all terminal windows and reopen Git Bash** so the PATH updates.

Verify in Git Bash:
```bash
ffmpeg -version    # should show version info
ffprobe -version
```

**If winget doesn't work:**
1. Go to **ffmpeg.org/download.html** → Windows → click the gyan.dev link
2. Download `ffmpeg-release-essentials.zip`
3. Extract it to `C:\ffmpeg`
4. Add `C:\ffmpeg\bin` to your system PATH:
   - Search "environment variables" in the Start menu
   - Click "Environment Variables"
   - Under System Variables, find `Path`, click Edit
   - Click New and add `C:\ffmpeg\bin`
   - Click OK everywhere, then reopen Git Bash

---

## Step 4 — Install PM2

PM2 keeps Paperweight running and restarts it if it crashes.

In Git Bash:
```bash
npm install -g pm2
npm install -g pm2-windows-startup
```

Verify:
```bash
pm2 --version
```

---

## Step 5 — Copy Paperweight to your device

Put the `paperweight` folder somewhere permanent — not your Downloads folder, which gets cleaned up.

Good locations:
- `C:\paperweight`
- `C:\Users\YourName\paperweight`

**Option A — USB drive**
Copy the `paperweight` folder from the USB drive to your chosen location.

**Option B — From another computer on your network**
1. On the source computer, right-click the `paperweight` folder → Share → specific people → Everyone
2. On the Windows device, open File Explorer, type `\\SOURCE_PC_NAME` in the address bar
3. Copy the folder over

---

## Step 6 — Install dependencies

Open Git Bash, navigate to your Paperweight folder, and install:

```bash
cd /c/paperweight       # adjust path if you put it elsewhere
npm install
```

> **Path format in Git Bash:** `C:\paperweight` becomes `/c/paperweight`

---

## Step 7 — Run setup

```bash
bash scripts/setup.sh
```

The setup wizard will ask:

| Question | What to enter |
|---|---|
| Station name | Your station name (e.g. `Low End Theory Radio`) |
| Identity mode | `1` for Creator Brand, `2` for Anonymous |
| Your name | Optional — shown on the station page |
| Vault path | Press Enter for the default `./vault` |
| Vault mode | Press Enter for Hybrid (recommended) |

At the end, setup prints a **Dashboard Token**. Save it somewhere — you'll need it to access the dashboard from another device (phone, tablet, other computer).

---

## Step 8 — Add media

Copy your audio and video files into the vault folders:

```
C:\paperweight\vault\
├── music\
├── beats\
├── podcasts\
├── videos\
├── drafts\
└── live_sessions\
```

You can drag and drop files into these folders using File Explorer. You can also add files at any time — the vault scanner picks them up automatically.

---

## Step 9 — Run the preflight check

```bash
node scripts/preflight.js
```

Everything should show ✓. If anything shows ✗, the message will tell you what to fix.

---

## Step 10 — Start Paperweight

```bash
pm2 start ecosystem.config.js
```

Check that it's running:
```bash
pm2 status
pm2 logs paperweight
```

You should see:
```
[INFO] [server] Paperweight running on port 3000
[INFO] [server] Station: Your Station Name
[INFO] [broadcast] Broadcast starting in shuffle mode
```

Open a browser and go to **http://localhost:3000** — your station is live.

---

## Step 11 — Auto-start on boot

So Paperweight starts automatically when Windows starts, without you needing to open Git Bash:

```bash
pm2-windows-startup install
pm2 save
```

That's it. Paperweight will now start when Windows boots.

**To verify it works:** restart your device, wait a minute, then open `http://localhost:3000` in a browser.

---

## Step 12 — Allow access from other devices on your network

By default, Windows Firewall blocks other devices from connecting. Add a rule to allow it:

Open **PowerShell as Administrator** and run:

```powershell
New-NetFirewallRule -DisplayName "Paperweight" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

Now find your device's local IP address:
```powershell
ipconfig
```

Look for **IPv4 Address** under your active connection — something like `192.168.1.55`.

Your station is now accessible at:
- **http://192.168.1.55:3000** from any phone, tablet, or computer on the same Wi-Fi

---

## Accessing the station

| What | Address |
|---|---|
| Live player | `http://192.168.1.55:3000` |
| Library | `http://192.168.1.55:3000/#library` |
| Dashboard | `http://192.168.1.55:3000/#dashboard` |

**Dashboard from another device:** when you open the dashboard page for the first time from a non-local device, it will prompt for your Dashboard Token. Paste the one saved from Step 7.

If you lost it, find it again:
```bash
grep DASHBOARD_TOKEN /c/paperweight/.env
```

---

## Creating subscriber tokens

Give listeners access to the full library by creating a token for them.

**From the dashboard:**
1. Go to **Subscriber Tokens**
2. Enter a label (e.g. the person's name)
3. Click **Create Token**
4. Copy the token and send it to them

**From Git Bash:**
```bash
node scripts/gen-token.js "Maria"
```

Listeners go to your station, click the lock icon in the Library, and paste their token.

---

## Making your station available outside your home network

By default the station is only reachable on your local Wi-Fi. To open it to the internet:

1. **Port forward** port 3000 to your device's local IP in your router settings
   - Log into your router (usually `192.168.1.1` or `192.168.0.1`)
   - Find "Port Forwarding" — add a rule: TCP, external port 3000, internal IP 192.168.1.55, internal port 3000
2. Find your public IP at **whatismyip.com**
3. Your station is live at `http://YOUR_PUBLIC_IP:3000`

> **Dynamic IP:** most home internet connections change their public IP occasionally. A free service like **DuckDNS** (duckdns.org) gives you a stable address like `yourstation.duckdns.org` that automatically follows your changing IP.

---

## Keeping the device awake

Windows puts devices to sleep when idle, which kills the broadcast. To prevent this:

1. Open **Settings → System → Power & sleep**
2. Set "When plugged in, PC goes to sleep after" → **Never**
3. Set "When plugged in, turn off after" → **Never**

On a Surface Pro, also check:
- **Settings → System → Battery** → disable Battery Saver if it's on

---

## Useful commands

Open Git Bash and run these from the `paperweight` folder:

```bash
# Check status
pm2 status

# View live logs
pm2 logs paperweight

# Restart the station
pm2 restart paperweight

# Stop the station
pm2 stop paperweight

# Start after a manual stop
pm2 start ecosystem.config.js
```

---

## Troubleshooting

**Station page won't load at localhost:3000**
- Check PM2: `pm2 status`
- Check logs: `pm2 logs paperweight`
- Make sure nothing else is using port 3000: search "Resource Monitor" in Start, check the Network tab

**Other devices can't connect**
- Confirm the firewall rule was added (Step 12)
- Make sure all devices are on the same Wi-Fi network
- Try turning off Windows Firewall temporarily to test: Settings → Windows Security → Firewall & network protection

**No audio / stream not playing**
- Verify FFmpeg works: `ffmpeg -version` in Git Bash
- Check that the vault has files: open `C:\paperweight\vault\beats\` in File Explorer
- Check logs: `pm2 logs paperweight | grep broadcast`

**Files added to vault aren't showing up**
- The scanner runs automatically — wait a few seconds, then refresh the Library page
- If still missing: `pm2 restart paperweight`

**`bash scripts/setup.sh` gives "command not found" errors**
- Make sure you're running it in **Git Bash**, not PowerShell or Command Prompt

**FFmpeg not found after installing**
- Close Git Bash completely and reopen it — the PATH needs to reload
- Verify: `which ffmpeg` should print a path

**PM2 not starting on boot**
- Re-run: `pm2 save` then `pm2-windows-startup install`
- Check Task Manager → Startup apps — "PM2" should be listed and enabled

**Dashboard token prompt keeps appearing**
- Make sure you're pasting the full token (it's 64 characters)
- The token is stored in session — clearing your browser session will require re-entering it
