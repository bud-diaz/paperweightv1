# Paperweight — Pi Setup Guide

This guide sets up a Paperweight station on a Raspberry Pi 4 (or any Ubuntu-based machine).
No prior Linux experience required.

---

## What you need

- Raspberry Pi 4 (2GB RAM minimum, 4GB recommended) or any mini PC / old laptop running Ubuntu
- MicroSD card (32GB+) or USB drive
- Power supply, ethernet cable or Wi-Fi
- A computer on the same network to access the dashboard

---

## Step 1 — Install the OS

If your Pi is already running Ubuntu or Raspberry Pi OS, skip to Step 2.

1. Download **Raspberry Pi Imager** from raspberrypi.com/software
2. Insert your SD card
3. Choose **Raspberry Pi OS Lite (64-bit)** — no desktop needed
4. Click the gear icon and set:
   - Hostname: `paperweight`
   - Enable SSH
   - Set your username and password
   - Configure Wi-Fi if not using ethernet
5. Flash the card, insert it into the Pi, and power on

Connect via SSH from your computer:
```bash
ssh pi@paperweight.local
```
(Replace `pi` with the username you set.)

---

## Step 2 — Update the system

```bash
sudo apt update && sudo apt upgrade -y
```

---

## Step 3 — Copy Paperweight to the Pi

**Option A — USB drive or SD card**

Copy the `paperweight/` folder to a USB drive, plug it into the Pi, then:
```bash
sudo mkdir -p /home/pi/paperweight
sudo cp -r /media/pi/YOUR_DRIVE/paperweight /home/pi/
```

**Option B — SCP from your computer** (run this on your computer, not the Pi)

```bash
scp -r /path/to/paperweight pi@paperweight.local:/home/pi/
```

**Option C — Git** (if you have a private repo)

```bash
git clone YOUR_REPO_URL /home/pi/paperweight
```

---

## Step 4 — Run the installer

The installer sets up everything in one shot: Node.js, FFmpeg, PM2, cloudflared, npm packages, and SD card protection for the HLS output directory.

```bash
cd /home/pi/paperweight
bash scripts/install.sh
```

This takes a few minutes. You'll see each step as it completes.

---

## Step 5 — Run setup

```bash
bash scripts/setup.sh
```

The setup wizard will ask:

| Question | What to enter |
|---|---|
| Station name | Your station name (e.g. `Low End Theory Radio`) |
| Station slug | Press Enter to accept the auto-generated slug |
| Identity mode | Press Enter for Anonymous, or `1` for Creator Brand |
| Your name | Optional — shown on the station page (Creator Brand only) |
| Vault path | Press Enter to use the default `./vault` |
| Vault mode | Press Enter for Hybrid (recommended) |
| Tunnel token | Paste your Cloudflare tunnel token, or press Enter to set up later |

At the end, setup prints your **station URL** and **Dashboard Token**. Save them both.

---

## Step 6 — Add media

Copy your audio and video files into the vault folders:

```
/home/pi/paperweight/vault/
├── music/          ← songs, tracks
├── beats/          ← instrumentals, loops
├── podcasts/       ← episodes, recordings
├── videos/         ← video content
├── drafts/         ← work in progress
└── live_sessions/  ← live recordings
```

Example — copy from a USB drive:
```bash
cp /media/pi/MY_DRIVE/beats/*.mp3 /home/pi/paperweight/vault/beats/
```

You can add more files at any time. The vault scanner picks them up automatically.

---

## Step 7 — Run the preflight check

```bash
node scripts/preflight.js
```

Everything should show ✓. If anything shows ✗, fix it before continuing.

---

## Step 8 — Start Paperweight

```bash
pm2 start ecosystem.config.js
```

Check that it started:
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

---

## Step 9 — Auto-start on boot

```bash
pm2 save
pm2 startup
```

PM2 will print a command starting with `sudo env PATH=...`. Copy and run that exact command. After that, Paperweight starts automatically whenever the Pi powers on.

---

## Step 10 — Find your Pi's IP address

```bash
hostname -I
```

This prints something like `192.168.1.42`. That's your station address on your local network.

---

## Accessing the station

| What | Address |
|---|---|
| Live player | `http://192.168.1.42:3000` |
| Library | `http://192.168.1.42:3000/#library` |
| Dashboard | `http://192.168.1.42:3000/#dashboard` |

Open the player in any browser on your network. The HLS stream plays on desktop and mobile.

**Dashboard from another device:** when you open the dashboard page, it will ask for your Dashboard Token (the one printed during setup). Paste it in and you're in.

---

## Creating subscriber tokens

Give listeners access to the full library by creating a token for them.

From the dashboard:
1. Go to **Subscriber Tokens**
2. Enter a label (e.g. the listener's name)
3. Click **Create Token**
4. Copy the token and send it to them

They go to your station, click the lock icon in the Library, and paste the token.

You can also do this from the command line:
```bash
node scripts/gen-token.js "Maria"
```

---

## Making your station available outside your home network

Paperweight uses **Cloudflare Tunnel** to expose your station to the internet. This hides your Pi's IP address completely — listeners connect through Cloudflare's edge, never directly to your machine. cloudflared is already installed from Step 4.

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

```bash
nano /home/pi/paperweight/.env
```

Find the line:
```
CLOUDFLARE_TUNNEL_TOKEN=
```

Paste your token after the `=`. Save with `Ctrl+O`, exit with `Ctrl+X`.

### Step 3 — Restart PM2

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

## Useful commands

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
```

---

## Troubleshooting

**Station page won't load**
- Check PM2 is running: `pm2 status`
- Check the logs: `pm2 logs paperweight`
- Make sure port 3000 isn't blocked: `sudo ufw allow 3000` (if using UFW firewall)

**No audio / stream not playing**
- Verify FFmpeg is installed: `ffmpeg -version`
- Check that the vault has media files: `ls /home/pi/paperweight/vault/beats/`
- View broadcast logs: `pm2 logs paperweight | grep broadcast`

**Files not appearing in the library**
- The vault scanner runs automatically on startup and watches for new files
- Wait a few seconds after adding files, then refresh the library page
- If still missing, restart: `pm2 restart paperweight`

**Dashboard says "access denied" from another device**
- Use the Dashboard Token printed during setup
- If you lost it: `grep DASHBOARD_TOKEN /home/pi/paperweight/.env`

**Pi is running hot or slow**
- The installer mounts hls_output as tmpfs — verify: `mount | grep hls_output`
- The broadcast engine uses `-vn` (audio only) to minimize CPU load
- Raspberry Pi OS applies CPU throttling above ~80°C — a heatsink or case fan helps

**Out of disk space**
- The `delete_segments` FFmpeg flag keeps the HLS output small (< 5MB at any time)
- The main disk usage is your vault files — check with: `du -sh /home/pi/paperweight/vault/`

**Tunnel not starting / `cloudflared-tunnel` not in `pm2 status`**
- Make sure `CLOUDFLARE_TUNNEL_TOKEN` is set in `.env`: `grep CLOUDFLARE_TUNNEL_TOKEN /home/pi/paperweight/.env`
- After editing `.env`, restart PM2: `pm2 restart all`
- Check tunnel logs: `pm2 logs cloudflared-tunnel`

**Tunnel shows `online` but station URL doesn't load**
- Verify the public hostname in Cloudflare dashboard points to `HTTP localhost:3000`
- Make sure the station itself is running: `pm2 logs paperweight`
- Try accessing `http://localhost:3000` directly on the Pi to confirm the server is up
