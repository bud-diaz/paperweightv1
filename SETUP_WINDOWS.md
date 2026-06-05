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

> Terminal commands in this guide are run in **Git Bash** unless noted otherwise.

---

## Step 2 — Copy Paperweight to your device

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

## Step 3 — Run the installer

The installer sets up everything in one shot: Node.js, FFmpeg, cloudflared, PM2, npm packages, and the Windows firewall rule.

Open **PowerShell as Administrator** (right-click the Start button → Terminal (Admin)), navigate to your Paperweight folder, and run:

```powershell
cd C:\paperweight    # adjust if you put it elsewhere
.\scripts\install.ps1
```

This takes a few minutes. You'll see each step as it completes.

After it finishes, **close all terminals and reopen Git Bash** so the PATH updates.

> **If you get an "execution policy" error:** run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` in PowerShell Admin, then try again.

---

## Step 4 — Run setup

Open Git Bash:

```bash
cd /c/paperweight    # adjust path if needed
bash scripts/setup.sh
```

The setup wizard will ask:

| Question | What to enter |
|---|---|
| Station name | Your station name (e.g. `Low End Theory Radio`) |
| Station slug | Press Enter to accept the auto-generated slug |
| Identity mode | Press Enter for Anonymous, or `1` for Creator Brand |
| Your name | Optional — shown on the station page (Creator Brand only) |
| Vault path | Press Enter for the default `./vault` |
| Vault mode | Press Enter for Hybrid (recommended) |
| Tunnel token | Paste your Cloudflare tunnel token, or press Enter to set up later |

At the end, setup prints your **station URL** and **Dashboard Token**. Save them both.

---

## Step 5 — Add media

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

## Step 6 — Run the preflight check

```bash
node scripts/preflight.js
```

Everything should show ✓. If anything shows ✗, the message will tell you what to fix.

---

## Step 7 — Start Paperweight

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

## Step 8 — Auto-start on boot

So Paperweight starts automatically when Windows starts:

```bash
pm2-windows-startup install
pm2 save
```

**To verify it works:** restart your device, wait a minute, then open `http://localhost:3000` in a browser.

---

## Accessing the station

| What | Address |
|---|---|
| Live player | `http://localhost:3000` (on this device) |
| Live player | `http://192.168.1.55:3000` (from other devices on your network) |
| Library | `http://192.168.1.55:3000/#library` |
| Dashboard | `http://192.168.1.55:3000/#dashboard` |

Find your device's local IP address in PowerShell:
```powershell
ipconfig
```
Look for **IPv4 Address** under your active connection.

**Dashboard from another device:** when you open the dashboard page for the first time from a non-local device, it will prompt for your Dashboard Token. Paste the one saved from Step 4.

If you lost it:
```bash
grep DASHBOARD_TOKEN /c/paperweight/.env
```

---

## Listener accounts

Listeners can create a free account on your station using an email address and password. Once they have an account, their access (tokens, subscriptions, vault unlocks) follows them across devices — they just log in instead of pasting token strings.

Accounts are created from the **Share** drawer on the player page. No email verification is required.

As a creator you can see all registered accounts in the dashboard **Tokens** section when assigning a token.

---

## Managing access with tokens

Tokens grant listeners a tier above free (subscriber, pro, or all-access). You can create them from the dashboard or command line.

**From the dashboard:**
1. Go to **Tokens**
2. Enter a label (e.g. the listener's name)
3. Choose a tier
4. Optionally enter their email to assign it directly to their account
5. Click **Create** — copy the token string and send it to them if not assigning by account

**From Git Bash:**
```bash
node scripts/gen-token.js "Maria"
```

**Assigning tokens to accounts:**

Tokens can be assigned directly to listener accounts without the listener having to redeem a string. When assigned, the tier applies automatically the next time they log in.

One token can be assigned to multiple accounts — useful for granting a group the same level of access.

To assign after creation:
1. In the **Tokens** section, find the token
2. Click **⊕ ASSIGN**
3. Start typing a listener's email — select from the dropdown
4. Click **Assign**

To remove access, click **Remove** next to their email in the same panel, or **Revoke** the token entirely.

---

## Vault content and gated projects

Set any track's visibility to **Vault** to gate it behind a payment or assigned token.

**Visibility levels:**

| Setting | Who can play |
|---|---|
| Public | Everyone |
| Supporters Only | Subscriber tier and above |
| Vault | Paid unlock or assigned token required |

Change a track's visibility from the **Library** section in the dashboard using the dropdown next to each track.

**Projects (gated bundles):**

Group tracks into a named project (album, EP, series) and set pricing for the whole bundle. Listeners can unlock the entire project at once instead of track by track.

To create a project:
1. Go to **Projects** in the dashboard
2. Click **+ New Project**, enter a name and optional pricing
3. Expand the project card and use **Add Track** to assign tracks
4. Set tracks to **Vault** visibility so the gate applies

Listeners see projects listed first in the library drawer with a **Support to Unlock** button.

---

## Track info and credits

Edit a track's metadata directly from the dashboard without touching files.

1. Find the track in the **Library** section
2. Click **✎ Edit**
3. Update Title, Artist, Album, Producer, or Credits
4. Click **Save Changes**

Changes take effect immediately in the player and library.

---

## Making your station available outside your home network

Paperweight uses **Cloudflare Tunnel** to expose your station to the internet. This hides your device's IP address completely — listeners connect through Cloudflare's edge, never directly to your machine. cloudflared is already installed from Step 3.

### Step 1 — Create a tunnel in Cloudflare

1. Go to **one.dash.cloudflare.com** and create a free account (or log in)
2. In the left sidebar: **Networks → Tunnels**
3. Click **Create a tunnel** → choose **Cloudflared** → give it a name (e.g. `paperweight`)
4. Copy the tunnel token — it's a long string starting with `eyJ...`
5. Under **Public Hostname**, add a route:
   - Subdomain: your station slug (shown during setup, e.g. `low-end-theory`)
   - Domain: `paperweighthq.com`
   - Service: `HTTP`, URL: `localhost:3000`
6. Save the tunnel

### Step 2 — Add the token to .env

Open your `.env` file in a text editor (Notepad, VS Code, etc.) or in Git Bash:

```bash
nano /c/paperweight/.env   # adjust path if needed
```

Find the line:
```
CLOUDFLARE_TUNNEL_TOKEN=
```

Paste your token after the `=` and save.

### Step 3 — Restart PM2

In Git Bash:
```bash
pm2 restart all
pm2 save
```

Verify both processes are running:
```bash
pm2 status
```

You should see both `paperweight` and `cloudflared-tunnel` with status `online`.

### Step 4 — Share your station URL

Your station is now live at `https://<your-slug>.paperweighthq.com`. Share this URL — listeners connect through Cloudflare and your IP stays hidden.

The URL is also displayed in your dashboard under **Station URL** with a one-click copy button.

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
# Check status of all processes (station + tunnel)
pm2 status

# View live logs
pm2 logs paperweight
pm2 logs cloudflared-tunnel

# Restart the station
pm2 restart paperweight

# Restart everything (station + tunnel)
pm2 restart all

# Stop the station
pm2 stop paperweight

# Stop the tunnel only
pm2 stop cloudflared-tunnel

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
- The installer adds the firewall rule automatically — verify: `Get-NetFirewallRule -DisplayName "Paperweight"` in PowerShell
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

**FFmpeg or cloudflared not found after installing**
- Close all terminals and reopen Git Bash — the PATH needs to reload
- Verify: `which ffmpeg` and `which cloudflared` should each print a path

**PM2 not starting on boot**
- Re-run: `pm2-windows-startup install && pm2 save`
- Check Task Manager → Startup apps — "PM2" should be listed and enabled

**Dashboard token prompt keeps appearing**
- Make sure you're pasting the full token (it's 64 characters)
- The token is stored in session — clearing your browser session will require re-entering it

**Tunnel not starting / `cloudflared-tunnel` not in `pm2 status`**
- Make sure `CLOUDFLARE_TUNNEL_TOKEN` is set in `.env`
- After editing `.env`, restart PM2: `pm2 restart all`
- Check tunnel logs: `pm2 logs cloudflared-tunnel`

**Tunnel shows `online` but station URL doesn't load**
- Verify the public hostname in Cloudflare dashboard points to `HTTP localhost:3000`
- Make sure the station itself is running: `pm2 logs paperweight`
- Try opening `http://localhost:3000` in a browser on the same device to confirm the server is up

**install.ps1 fails with "execution policy" error**
- In PowerShell Admin: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`
- Then re-run: `.\scripts\install.ps1`
