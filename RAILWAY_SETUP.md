# Railway Setup Guide

## ⚠️ CRITICAL: Data Persistence Setup

Your Brio Lead Scraper stores ALL data in the `/data` folder. **Without proper setup, all data will be lost on every deployment!**

## Required Railway Configuration

### 1. Add a Volume (REQUIRED)

In Railway dashboard:
1. Go to your Brio project
2. Click on your service
3. Go to **Settings** tab
4. Scroll to **Volumes** section
5. Click **+ New Volume**
6. Configure:
   - **Mount Path:** `/app/data`
   - **Size:** 1 GB (or more if you have lots of leads)
7. Click **Add**

### 2. Environment Variables (Optional but Recommended)

Set these in Railway **Variables** tab:
```
NODE_ENV=production
DATAFORSEO_LOGIN=your_login_here
DATAFORSEO_PASSWORD=your_password_here
AIRTABLE_API_KEY=your_key_here (if using Airtable)
AIRTABLE_BASE_ID=your_base_id_here (if using Airtable)
```

### 3. Verify Data Persistence

After setting up the volume:
1. Deploy your app
2. Add some test data (scrape leads or add neighborhoods)
3. Redeploy the app
4. Check if data is still there ✅

## What Data is Stored

The `/data` folder contains:
- `local-leads.json` - All your scraped leads (can be 10+ MB!)
- `scrape-progress.json` - Campaign progress and postal code tracking
- `config.json` - App configuration
- `logs.json` - System logs
- `dnc-list.json` - Do Not Call list
- `neighborhoods.json` - Neighborhoods data

## Troubleshooting

**Data keeps disappearing?**
- ✅ Volume is configured correctly
- ✅ Mount path is `/app/data` (not `/data`)
- ✅ Volume is attached to the service

**App won't start?**
- Check Railway logs
- Verify `NODE_ENV` is set to `production`
- Check healthcheck passes

**Need help?**
Contact Railway support or check: https://docs.railway.app/reference/volumes
