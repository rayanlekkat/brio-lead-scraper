# NO WEBSITE Lead Scraper 🔍

A powerful web application for finding B2B leads **without websites** from Google Maps using DataForSEO API. Perfect for agencies offering web development and digital marketing services.

## ✨ Key Features

- 🚫 **NO WEBSITE Filter** - Automatically finds businesses without websites (your perfect prospects!)
- 📍 **Postal Code Based** - Target specific neighborhoods and areas
- 📞 **Phone Number Focus** - Get businesses ready for cold calling
- 📧 **Email Extraction** - Automatically extract contact emails from websites
- 💾 **Never Lose Data** - All leads saved locally in JSON files
- 📊 **Campaign Tracking** - Manage multiple scraping campaigns
- 🚫 **DNC List** - Built-in Do Not Call list management
- 📤 **CSV Export** - Export for Instantly.ai, cold calling, etc.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure API Credentials
Copy the example config and add your credentials:
```bash
cp data/config.example.json data/config.json
```

Edit `data/config.json` with:
- Your DataForSEO API credentials ([Get them here](https://dataforseo.com))
- Your admin password
- (Optional) Airtable credentials

### 3. Run the Server
```bash
npm start
```
Then open: http://localhost:3001

### Production Deployment
See [RAILWAY_SETUP.md](./RAILWAY_SETUP.md) for Railway deployment instructions.

## 📊 Features

- ✅ **Lead Scraping** - Search businesses by category and postal code
- ✅ **Local Storage** - All data saved locally (never lost!)
- ✅ **Campaign Management** - Track multiple scraping campaigns
- ✅ **Email Extraction** - Automatically extract emails from websites
- ✅ **DNC List Management** - Do Not Call list integration
- ✅ **Export to CSV** - Export leads for Instantly.ai and other tools
- ✅ **Progress Tracking** - Track which postal codes have been scraped
- ✅ **No Authentication** - Direct access (authentication removed)

## 🗂️ Data Storage

All data is stored in the `/data` folder:
- `local-leads.json` - All scraped leads
- `scrape-progress.json` - Campaign progress
- `config.json` - Application configuration
- `logs.json` - System logs
- `dnc-list.json` - Do Not Call list

**⚠️ IMPORTANT FOR RAILWAY:** 
You MUST configure a Railway Volume at `/app/data` or all data will be lost on every deployment!
See [RAILWAY_SETUP.md](./RAILWAY_SETUP.md)

## 🔧 Configuration

### DataForSEO API (Required for scraping)
Get your credentials at: https://dataforseo.com
Then configure in app Settings page or via environment variables:
```
DATAFORSEO_LOGIN=your_login
DATAFORSEO_PASSWORD=your_password
```

### Airtable (Optional)
If you want to sync to Airtable:
```
AIRTABLE_API_KEY=your_key
AIRTABLE_BASE_ID=your_base_id
```

## 📈 Usage

1. **Scrape Leads**: Go to "Scrape Leads" page, select postal codes and category
2. **View Leads**: Check the "Leads" page to see all scraped data  
3. **Export**: Export to CSV for cold calling or email campaigns
4. **Email Extraction**: Extract contact emails from lead websites
5. **Track Progress**: Monitor which areas have been scraped in Dashboard

## 🛠️ Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: Vanilla JavaScript (no framework!)
- **APIs**: DataForSEO (Google Maps), Airtable (optional)
- **Storage**: JSON files in `/data` folder
- **Deployment**: Railway

## 📝 License

MIT - See LICENSE file

## 🆘 Support

For issues or questions, check the Railway logs or review configuration files.
