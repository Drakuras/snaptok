# SnapTok — TikTok Video Downloader

A fast, free TikTok video downloader built for Cloudflare Pages.

## Stack

- **Frontend:** Static HTML/CSS/JS (served by Cloudflare Pages)
- **Backend:** Cloudflare Pages Functions (serverless Workers)
- **No external dependencies** — scrapes TikTok directly

## Local Development

```bash
# Install wrangler
npm install

# Run locally (starts Wrangler dev server on port 3000)
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Deploy to Cloudflare Pages

### Option 1: Git Integration (recommended)

1. Push this repo to GitHub/GitLab
2. Go to [Cloudflare Dashboard → Pages](https://dash.cloudflare.com/?to=/:account/pages)
3. Click **Create a project** → **Connect to Git**
4. Select your repo
5. Build settings:
   - **Build command:** _(leave empty)_
   - **Build output directory:** `public`
6. Deploy!

### Option 2: Direct Upload via CLI

```bash
# Login to Cloudflare
npx wrangler login

# Deploy
npm run deploy
```

## Project Structure

```
├── public/              # Static frontend (served by Pages)
│   ├── index.html
│   ├── style.css
│   └── script.js
├── functions/           # Cloudflare Pages Functions
│   └── api/
│       ├── info.js      # POST /api/info  — video metadata
│       └── download.js  # GET  /api/download — proxy video stream
├── package.json
└── README.md
```

## How It Works

1. User pastes a TikTok URL
2. `/api/info` fetches the TikTok page, extracts embedded video metadata
3. User clicks "Save Video"
4. `/api/download` fetches the TikTok page again, extracts the video stream URL, and proxies it back as an MP4 download

## Notes

- **Rate limits:** Cloudflare Workers have a free tier of 100k requests/day
- **Video size:** Workers free tier has a 100MB response limit; most TikTok videos are well under this
- **No watermark:** Uses the `downloadAddr` when available, which is typically watermark-free
