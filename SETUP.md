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

## Step 3 — Install Node.js

Paperweight requires Node.js v18 or later.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify:
```bash
node --version   # should show v22.x.x or higher
```

---

## Step 4 — Install FFmpeg

FFmpeg handles all audio processing and HLS stream generation.

```bash
sudo apt install -y ffmpeg
```

Verify:
```bash
ffmpeg -version   # should show version info
ffprobe -version
```

---

## Step 5 — Install PM2

PM2 keeps Paperweight running and restarts it automatically if it crashes.

```bash
sudo npm install -g pm2
```

---

## Step 6 — Copy Paperweight to the Pi

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

## Step 7 — Install dependencies

```bash
cd /home/pi/paperweight
npm install
```

---

## Step 8 — Run setup

```bash
bash scripts/setup.sh
```

The setup wizard will ask:

| Question | What to enter |
|---|---|
| Station name | Your station name (e.g. `Low End Theory Radio`) |
| Identity mode | `1` for Creator Brand, `2` for Anonymous |
| Your name | Optional — shown on the station page |
| Vault path | Press Enter to use the default `./vault` |
| Vault mode | Press Enter for Hybrid (recommended) |

At the end, setup prints a **Dashboard Token**. Save it somewhere — you'll need it to access the dashboard from another device.

---

## Step 9 — Add media

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

## Step 10 — Run the preflight check

```bash
node scripts/preflight.js
```

Everything should show ✓ except the tmpfs recommendation (handled in the next step). If anything shows ✗, fix it before continuing.

---

## Step 11 — Protect the SD card (recommended)

HLS streaming writes many small files per minute. Running this from SD card will wear it out. Mount the HLS output directory in RAM instead:

Open the fstab file:
```bash
sudo nano /etc/fstab
```

Add this line at the bottom:
```
tmpfs /home/pi/paperweight/hls_output tmpfs defaults,noatime,size=100m 0 0
```

Save with `Ctrl+O`, exit with `Ctrl+X`, then apply:
```bash
sudo mount -a
```

Verify:
```bash
mount | grep hls_output   # should show tmpfs
```

---

## Step 12 — Start Paperweight

```bash
cd /home/pi/paperweight
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

## Step 13 — Auto-start on boot

```bash
pm2 save
pm2 startup
```

PM2 will print a command starting with `sudo env PATH=...`. Copy and run that exact command. After that, Paperweight starts automatically whenever the Pi powers on.

---

## Step 14 — Find your Pi's IP address

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

By default, Paperweight is only accessible on your local network. To open it to the internet:

1. Log into your router and forward **port 3000** to your Pi's local IP (e.g. `192.168.1.42`)
2. Find your public IP at whatismyip.com
3. Your station is now at `http://YOUR_PUBLIC_IP:3000`

For a permanent address, point a domain name at your public IP using an A record with your DNS provider.

> **Note:** If your ISP assigns a dynamic IP (most home connections do), it will change occasionally. A free DDNS service like DuckDNS keeps a stable hostname pointed at your changing IP automatically.

---

## Useful commands

```bash
# Check status
pm2 status

# View live logs
pm2 logs paperweight

# Restart the station
pm2 restart paperweight

# Stop the station
pm2 stop paperweight

# Update station after adding many files (scanner runs automatically, but you can restart to force it)
pm2 restart paperweight
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
- If you lost it, find it in your `.env` file: `grep DASHBOARD_TOKEN /home/pi/paperweight/.env`

**Pi is running hot or slow**
- Make sure hls_output is on tmpfs (Step 11)
- The broadcast engine uses `-vn` (audio only) to minimize CPU load
- Raspberry Pi OS applies CPU throttling above ~80°C — a heatsink or case fan helps

**Out of disk space**
- The `delete_segments` FFmpeg flag keeps the HLS output small (< 5MB at any time)
- The main disk usage is your vault files — check with: `du -sh /home/pi/paperweight/vault/`
