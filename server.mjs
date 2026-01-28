#!/usr/bin/env node

/**
 * Brio Nettoyage - B2B Lead Scraper Web Application
 * 
 * A web application for neighborhood-level B2B lead scraping
 * with DataForSEO integration and Airtable storage
 */

import express from 'express';
import session from 'express-session';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ============== PERSISTENCE SETUP ==============
// Move all data files to a /data folder for Railway Volumes support
const DATA_DIR = join(__dirname, 'data');
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// Configuration
const CONFIG_PATH = join(DATA_DIR, 'config.json');
const NEIGHBORHOODS_PATH = join(DATA_DIR, 'neighborhoods.json');
const LOGS_PATH = join(DATA_DIR, 'logs.json');
const MONTREAL_AREAS_PATH = join(__dirname, 'montreal-areas.json');
const SCRAPE_PROGRESS_PATH = join(DATA_DIR, 'scrape-progress.json');
const LOCAL_LEADS_PATH = join(DATA_DIR, 'local-leads.json');
const DNC_PATH = join(DATA_DIR, 'dnc-list.json');
const LEADS_POOL_PATH = join(DATA_DIR, 'leads-pool.json');

// ============== LOCAL LEADS STORAGE ==============
// Store leads locally so they're NEVER lost, even if Airtable fails

function loadLocalLeads() {
  if (existsSync(LOCAL_LEADS_PATH)) {
    return JSON.parse(readFileSync(LOCAL_LEADS_PATH, 'utf-8'));
  }
  return { leads: [], campaigns: [], lastUpdated: null };
}

function saveLocalLeads(data) {
  data.lastUpdated = new Date().toISOString();
  writeFileSync(LOCAL_LEADS_PATH, JSON.stringify(data, null, 2));
}

function addLeadsToLocal(leads, campaignName, cityName, postalCodes) {
  const data = loadLocalLeads();
  
  // Add campaign if new
  let campaign = data.campaigns.find(c => c.name === campaignName);
  if (!campaign) {
    campaign = {
      id: Date.now().toString(),
      name: campaignName,
      city: cityName,
      postalCodes: postalCodes,
      createdAt: new Date().toISOString(),
      leadsCount: 0
    };
    data.campaigns.push(campaign);
  }
  
  // Add leads with campaign reference
  const newLeads = leads.map(lead => ({
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    ...lead,
    campaignId: campaign.id,
    campaignName: campaignName,
    importedAt: new Date().toISOString(),
    status: 'New'
  }));
  
  data.leads.push(...newLeads);
  campaign.leadsCount += newLeads.length;
  
  saveLocalLeads(data);
  logEvent('success', 'storage', `Saved ${newLeads.length} leads locally for campaign: ${campaignName}`);
  
  return newLeads.length;
}

// ============== AUTOMATION LOGGING SYSTEM ==============

const automationLogs = {
  events: [],
  errors: [],
  jobs: [],
  systemStatus: {
    dataforseo: { status: 'unknown', lastCheck: null },
    airtable: { status: 'unknown', lastCheck: null },
    server: { status: 'running', startTime: new Date().toISOString() }
  }
};

// Load existing logs
function loadLogs() {
  if (existsSync(LOGS_PATH)) {
    try {
      const saved = JSON.parse(readFileSync(LOGS_PATH, 'utf-8'));
      automationLogs.events = saved.events || [];
      automationLogs.errors = saved.errors || [];
      automationLogs.jobs = saved.jobs || [];
    } catch (e) {
      console.error('Error loading logs:', e.message);
    }
  }
}

function saveLogs() {
  try {
    writeFileSync(LOGS_PATH, JSON.stringify({
      events: automationLogs.events.slice(-500), // Keep last 500 events
      errors: automationLogs.errors.slice(-200), // Keep last 200 errors
      jobs: automationLogs.jobs.slice(-100) // Keep last 100 jobs
    }, null, 2));
  } catch (e) {
    console.error('Error saving logs:', e.message);
  }
}

function logEvent(type, node, message, data = {}) {
  const event = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
    type, // 'info', 'success', 'warning', 'error', 'start', 'complete'
    node, // Which workflow node: 'scraper', 'airtable', 'dedup', 'enrichment', etc.
    message,
    data
  };
  automationLogs.events.unshift(event);
  if (automationLogs.events.length > 500) {
    automationLogs.events = automationLogs.events.slice(0, 500);
  }
  
  if (type === 'error') {
    automationLogs.errors.unshift(event);
    if (automationLogs.errors.length > 200) {
      automationLogs.errors = automationLogs.errors.slice(0, 200);
    }
  }
  
  saveLogs();
  return event;
}

function logJob(job) {
  automationLogs.jobs.unshift({
    id: job.id,
    status: job.status,
    category: job.category,
    campaignName: job.campaignName,
    neighborhoodCount: job.neighborhoods?.length || 0,
    leadsFound: job.leads?.length || 0,
    errorsCount: job.errors?.length || 0,
    startTime: job.startTime,
    endTime: job.endTime,
    duration: job.endTime ? 
      Math.round((new Date(job.endTime) - new Date(job.startTime)) / 1000) + 's' : 
      'running'
  });
  if (automationLogs.jobs.length > 100) {
    automationLogs.jobs = automationLogs.jobs.slice(0, 100);
  }
  saveLogs();
}

// Load logs on startup
loadLogs();
logEvent('info', 'system', 'Server started', { port: PORT });

// Default config
const DEFAULT_CONFIG = {
  users: [
    { username: 'admin', password: 'brio2026' },
    { username: 'rayan', password: 'rayan1928!' }
  ],
  dataforseo: {
    login: '',
    password: ''
  },
  airtable: {
    apiKey: process.env.AIRTABLE_API_KEY || '',
    baseId: process.env.AIRTABLE_BASE_ID || ''
  },
  defaults: {
    locationCode: '2124', // Canada
    languageCode: 'en',
    minRating: 3.5,
    limitPerNeighborhood: 50
  }
};

// Load or create config
function loadConfig() {
  let currentConfig = DEFAULT_CONFIG;
  if (existsSync(CONFIG_PATH)) {
    try {
      const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      // Merge saved with default to ensure new users are always added
      currentConfig = {
        ...DEFAULT_CONFIG,
        ...saved,
        users: [...DEFAULT_CONFIG.users] // Always enforce the users from DEFAULT_CONFIG
      };
      
      // If saved had extra users, keep them too
      if (saved.users) {
        saved.users.forEach(u => {
          if (!currentConfig.users.find(du => du.username === u.username)) {
            currentConfig.users.push(u);
          }
        });
      }
    } catch (e) {
      console.error('Error parsing config.json, using defaults');
    }
  } else {
    saveConfig(DEFAULT_CONFIG);
  }
  
  // SECURE: Priority to Environment Variables (for Railway/Production)
  if (process.env.DATAFORSEO_LOGIN) currentConfig.dataforseo.login = process.env.DATAFORSEO_LOGIN;
  if (process.env.DATAFORSEO_PASSWORD) currentConfig.dataforseo.password = process.env.DATAFORSEO_PASSWORD;
  if (process.env.AIRTABLE_API_KEY) currentConfig.airtable.apiKey = process.env.AIRTABLE_API_KEY;
  if (process.env.AIRTABLE_BASE_ID) currentConfig.airtable.baseId = process.env.AIRTABLE_BASE_ID;
  
  return currentConfig;
}

function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Load or create neighborhoods
function loadNeighborhoods() {
  if (existsSync(NEIGHBORHOODS_PATH)) {
    return JSON.parse(readFileSync(NEIGHBORHOODS_PATH, 'utf-8'));
  }
  const defaultNeighborhoods = {
    city: 'Montreal',
    state: 'QC',
    country: 'Canada',
    neighborhoods: []
  };
  saveNeighborhoods(defaultNeighborhoods);
  return defaultNeighborhoods;
}

function saveNeighborhoods(data) {
  writeFileSync(NEIGHBORHOODS_PATH, JSON.stringify(data, null, 2));
}

let config = loadConfig();

// Middleware
app.set('trust proxy', 1); // Trust first proxy (Railway)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, 'public')));
app.use(session({
  secret: 'brio-nettoyage-secret-2026',
  resave: true,
  saveUninitialized: true,
  cookie: { 
    maxAge: 24 * 60 * 60 * 1000,
    secure: false, // Force false to work on all Railway domains
    sameSite: 'lax'
  }
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// ============== AUTH ROUTES ==============

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = config.users.find(u => u.username === username && u.password === password);
  
  if (user) {
    req.session.user = { username: user.username };
    res.json({ success: true, username: user.username });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.status(401).json({ error: 'Not logged in' });
  }
});

// ============== CONFIG ROUTES ==============

app.get('/api/config', requireAuth, (req, res) => {
  // Don't expose passwords
  const safeConfig = {
    ...config,
    users: config.users.map(u => ({ username: u.username })),
    dataforseo: {
      login: config.dataforseo.login,
      hasPassword: !!config.dataforseo.password
    }
  };
  res.json(safeConfig);
});

app.post('/api/config/dataforseo', requireAuth, (req, res) => {
  const { login, password } = req.body;
  config.dataforseo.login = login;
  if (password) {
    config.dataforseo.password = password;
  }
  saveConfig(config);
  res.json({ success: true });
});

app.post('/api/config/defaults', requireAuth, (req, res) => {
  const { locationCode, languageCode, minRating, limitPerNeighborhood } = req.body;
  config.defaults = { ...config.defaults, locationCode, languageCode, minRating, limitPerNeighborhood };
  saveConfig(config);
  res.json({ success: true });
});

// ============== LOCATION MANAGEMENT (Greater Montreal Area) ==============

// Load Montreal areas database
function loadMontrealAreas() {
  if (existsSync(MONTREAL_AREAS_PATH)) {
    return JSON.parse(readFileSync(MONTREAL_AREAS_PATH, 'utf-8'));
  }
  return { region: 'Greater Montreal Area', cities: [] };
}

// Load/save scrape progress
function loadScrapeProgress() {
  if (existsSync(SCRAPE_PROGRESS_PATH)) {
    return JSON.parse(readFileSync(SCRAPE_PROGRESS_PATH, 'utf-8'));
  }
  return { 
    postalCodes: {}, // { "H1A": { status: "complete", leadsCount: 50, lastScraped: "...", campaigns: [] } }
    savedSelections: [] // [{ id, name, cityId, postalCodes: [...] }]
  };
}

function saveScrapeProgress(data) {
  writeFileSync(SCRAPE_PROGRESS_PATH, JSON.stringify(data, null, 2));
}

// Get all cities
app.get('/api/locations/cities', requireAuth, (req, res) => {
  const areas = loadMontrealAreas();
  const progress = loadScrapeProgress();
  
  // Calculate progress for each city
  const citiesWithProgress = areas.cities.map(city => {
    const totalPostalCodes = city.postalCodes.length;
    let scrapedCount = 0;
    let totalLeads = 0;
    
    city.postalCodes.forEach(pc => {
      const pcProgress = progress.postalCodes[pc.code];
      if (pcProgress && pcProgress.status === 'complete') {
        scrapedCount++;
        totalLeads += pcProgress.leadsCount || 0;
      }
    });
    
    return {
      id: city.id,
      name: city.name,
      postalCodeCount: totalPostalCodes,
      scrapedCount,
      totalLeads,
      progressPercent: totalPostalCodes > 0 ? Math.round((scrapedCount / totalPostalCodes) * 100) : 0
    };
  });
  
  res.json({
    region: areas.region,
    cities: citiesWithProgress
  });
});

// Get postal codes for a city
app.get('/api/locations/cities/:cityId/postal-codes', requireAuth, (req, res) => {
  const { cityId } = req.params;
  const areas = loadMontrealAreas();
  const progress = loadScrapeProgress();
  
  const city = areas.cities.find(c => c.id === cityId);
  if (!city) {
    return res.status(404).json({ error: 'City not found' });
  }
  
  // Add progress info to each postal code
  const postalCodesWithProgress = city.postalCodes.map(pc => {
    const pcProgress = progress.postalCodes[pc.code] || { status: 'not_started', leadsCount: 0 };
    return {
      code: pc.code,
      area: pc.area,
      status: pcProgress.status || 'not_started',
      leadsCount: pcProgress.leadsCount || 0,
      lastScraped: pcProgress.lastScraped || null,
      campaigns: pcProgress.campaigns || []
    };
  });
  
  res.json({
    city: { id: city.id, name: city.name },
    postalCodes: postalCodesWithProgress
  });
});

// Update postal code progress
app.post('/api/locations/postal-codes/:code/progress', requireAuth, (req, res) => {
  const { code } = req.params;
  const { status, leadsCount, campaign } = req.body;
  
  const progress = loadScrapeProgress();
  
  if (!progress.postalCodes[code]) {
    progress.postalCodes[code] = { status: 'not_started', leadsCount: 0, campaigns: [] };
  }
  
  if (status) progress.postalCodes[code].status = status;
  if (leadsCount !== undefined) progress.postalCodes[code].leadsCount = (progress.postalCodes[code].leadsCount || 0) + leadsCount;
  if (campaign && !progress.postalCodes[code].campaigns.includes(campaign)) {
    progress.postalCodes[code].campaigns.push(campaign);
  }
  progress.postalCodes[code].lastScraped = new Date().toISOString();
  
  saveScrapeProgress(progress);
  res.json({ success: true, progress: progress.postalCodes[code] });
});

// Save a selection (group of postal codes)
app.post('/api/locations/selections', requireAuth, (req, res) => {
  const { name, cityId, postalCodes } = req.body;
  
  const progress = loadScrapeProgress();
  const selection = {
    id: Date.now().toString(),
    name,
    cityId,
    postalCodes,
    createdAt: new Date().toISOString()
  };
  
  progress.savedSelections.push(selection);
  saveScrapeProgress(progress);
  
  res.json({ success: true, selection });
});

// Get saved selections
app.get('/api/locations/selections', requireAuth, (req, res) => {
  const progress = loadScrapeProgress();
  res.json(progress.savedSelections || []);
});

// Delete a selection
app.delete('/api/locations/selections/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const progress = loadScrapeProgress();
  progress.savedSelections = progress.savedSelections.filter(s => s.id !== id);
  saveScrapeProgress(progress);
  res.json({ success: true });
});

// Get overall progress stats
app.get('/api/locations/progress', requireAuth, (req, res) => {
  const areas = loadMontrealAreas();
  const progress = loadScrapeProgress();
  
  let totalPostalCodes = 0;
  let scrapedPostalCodes = 0;
  let partialPostalCodes = 0;
  let totalLeads = 0;
  
  areas.cities.forEach(city => {
    city.postalCodes.forEach(pc => {
      totalPostalCodes++;
      const pcProgress = progress.postalCodes[pc.code];
      if (pcProgress) {
        if (pcProgress.status === 'complete') scrapedPostalCodes++;
        else if (pcProgress.status === 'partial') partialPostalCodes++;
        totalLeads += pcProgress.leadsCount || 0;
      }
    });
  });
  
  res.json({
    totalPostalCodes,
    scrapedPostalCodes,
    partialPostalCodes,
    notStarted: totalPostalCodes - scrapedPostalCodes - partialPostalCodes,
    totalLeads,
    progressPercent: Math.round((scrapedPostalCodes / totalPostalCodes) * 100)
  });
});

// ============== NEIGHBORHOODS ROUTES ==============

app.get('/api/neighborhoods', requireAuth, (req, res) => {
  const data = loadNeighborhoods();
  res.json(data);
});

app.post('/api/neighborhoods', requireAuth, (req, res) => {
  const data = req.body;
  saveNeighborhoods(data);
  res.json({ success: true });
});

app.post('/api/neighborhoods/add', requireAuth, (req, res) => {
  const { name, location, zipCodes, description } = req.body;
  const data = loadNeighborhoods();
  data.neighborhoods.push({
    id: Date.now().toString(),
    name,
    location,
    zipCodes: zipCodes || [],
    description: description || ''
  });
  saveNeighborhoods(data);
  res.json({ success: true, neighborhoods: data.neighborhoods });
});

app.delete('/api/neighborhoods/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const data = loadNeighborhoods();
  data.neighborhoods = data.neighborhoods.filter(n => n.id !== id);
  saveNeighborhoods(data);
  res.json({ success: true });
});

// ============== DATAFORSEO API ==============
// Based on: https://docs.dataforseo.com/v3/

class DataForSEOAPI {
  constructor(login, password) {
    this.login = login;
    this.password = password;
    this.baseUrl = 'https://api.dataforseo.com/v3';
    this.auth = Buffer.from(`${login}:${password}`).toString('base64');
  }

  async request(endpoint, method = 'POST', body = null) {
    const options = {
      method,
      headers: {
        'Authorization': `Basic ${this.auth}`,
        'Content-Type': 'application/json',
      },
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, options);
    const data = await response.json();

    if (data.status_code !== 20000) {
      throw new Error(`DataForSEO Error: ${data.status_message || 'Unknown error'}`);
    }

    return data;
  }

  // Get account balance
  async getBalance() {
    const data = await this.request('/appendix/user_data', 'GET');
    return data.tasks?.[0]?.result?.[0]?.money?.balance || 0;
  }

  // Search Google Maps for local businesses (BEST for leads with phone numbers)
  // Docs: https://docs.dataforseo.com/v3/serp/google/maps/live/advanced/
  async searchGoogleMaps(params) {
    const { keyword, locationCode = 2124, languageCode = 'en', depth = 20 } = params;

    const payload = [{
      keyword,
      location_code: locationCode,
      language_code: languageCode,
      device: 'desktop',
      os: 'windows',
      depth
    }];

    const data = await this.request('/serp/google/maps/live/advanced', 'POST', payload);
    const items = data.tasks?.[0]?.result?.[0]?.items || [];

    return items
      .filter(item => item.type === 'maps_search')
      .map(item => ({
        id: item.place_id || item.cid,
        name: item.title,
        phone: item.phone,
        website: item.url,
        address: item.address,
        rating: item.rating?.value,
        reviewsCount: item.rating?.votes_count,
        category: item.category,
        hours: item.work_hours,
        coordinates: item.latitude && item.longitude ? { lat: item.latitude, lng: item.longitude } : null,
        isClaimed: item.is_claimed,
        placeId: item.place_id
      }));
  }

  // Main search function - uses Google Maps API
  async searchBusinessListings(params) {
    const { location, category, minRating, limit } = params;
    
    // Build keyword from category and location
    const keyword = `${category} ${location}`;
    
    logEvent('info', 'dataforseo', `Searching: "${keyword}" (depth: 100)`);
    
    const results = await this.searchGoogleMaps({
      keyword,
      locationCode: 2124, // Canada
      depth: 100 // Maximum depth for comprehensive results
    });

    // Filter by rating if specified, but keep all phones (even without)
    let filtered = results;
    if (minRating > 0) {
      filtered = results.filter(r => (r.rating || 0) >= minRating);
    }
    
    // Keep businesses WITH phone numbers for cold calling
    const withPhone = filtered.filter(r => r.phone);

    logEvent('success', 'dataforseo', `Found ${results.length} total, ${withPhone.length} with phone numbers`);
    
    return withPhone.slice(0, limit || 100);
  }

  // Calculate lead score
  calculateLeadScore(business) {
    let score = 0;
    if (business.phone) score += 25;
    if (business.website) score += 15;
    if (business.rating) score += Math.min(30, business.rating * 6);
    if (business.reviewsCount) {
      if (business.reviewsCount > 100) score += 20;
      else if (business.reviewsCount > 50) score += 15;
      else if (business.reviewsCount > 20) score += 10;
      else if (business.reviewsCount > 5) score += 5;
    }
    if (business.isClaimed) score += 10;
    return Math.min(100, Math.round(score));
  }
}

// ============== EMAIL EXTRACTOR ==============
// Crawls lead websites to extract contact emails

class EmailExtractor {
  constructor() {
    this.timeout = 10000; // 10 second timeout per site
    this.delay = 1000; // 1 second between requests
    
    // Email patterns to skip (invalid/tracking emails)
    this.skipPatterns = [
      /^noreply@/i,
      /^no-reply@/i,
      /^donotreply@/i,
      /^mailer-daemon@/i,
      /^postmaster@/i,
      /^webmaster@/i,
      // Placeholder/test domains
      /@example\./i,
      /@exemple\./i,          // French "example"
      /@test\./i,
      /@localhost/i,
      // Image file extensions (not emails)
      /\.png$/i,
      /\.jpg$/i,
      /\.gif$/i,
      /\.jpeg$/i,
      /\.webp$/i,
      /\.svg$/i,
      // Sentry error tracking domains - NOT real emails
      /@sentry\.io$/i,
      /@sentry\.wixpress\.com$/i,
      /@sentry-next\.wixpress\.com$/i,
      /@.*sentry.*\./i,       // Catch any sentry-related domain
      // Other tracking/analytics domains (not real contact emails)
      /@wixpress\.com$/i,
      // Placeholder patterns
      /^nom@/i,               // French "name@"
      /^name@/i,
      /^email@/i,
      /^your[._-]?email@/i,
      /^votre[._-]?courriel@/i,  // French "your email"
      // Hex/hash-like local parts (tracking IDs, not real emails)
      /^[a-f0-9]{20,}@/i,     // Long hex strings are tracking IDs
      // Website builder/template demo emails
      /@convertus\.com$/i,    // Convertus (dealer website builder)
      /@dealer\.com$/i,
      /@dealereprocess\.com$/i,
      /@dealerinspire\.com$/i,
      /@dealersocket\.com$/i,
      /^jane@/i,              // Common demo names
      /^john@/i,
      /^janedoe@/i,
      /^johndoe@/i,
      /^test@/i,
      /^demo@/i,
      /^sample@/i,
      /^user@/i,
      /^client@/i,
      /^customer@/i,
    ];
    
    // Priority patterns (better quality emails for business leads)
    this.priorityPatterns = [
      /^[a-z]+\.[a-z]+@/i,  // firstname.lastname@
      /^[a-z]+_[a-z]+@/i,   // firstname_lastname@
      /^info@/i,            // Main business contact
      /^contact@/i,         // Main business contact
      /^sales@/i,
      /^ventes@/i,          // French "sales"
      /^hello@/i,
      /^bonjour@/i,
      /^direction@/i,
      /^owner@/i,
      /^proprietaire@/i,    // French "owner"
      /^manager@/i,
      /^gerant@/i,          // French "manager"
      /^commercial@/i,
      /^reception@/i,
      /^admin@/i,
      /^service@/i,
      /^reservation@/i,
    ];
  }

  // Clean and decode email addresses
  cleanEmail(email) {
    if (!email) return null;
    
    let cleaned = email.toLowerCase().trim();
    
    // URL decode if needed
    try {
      if (cleaned.includes('%')) {
        cleaned = decodeURIComponent(cleaned);
      }
    } catch (e) {
      // If decoding fails, try to clean manually
      cleaned = cleaned.replace(/%22/g, '"').replace(/%20/g, ' ').replace(/%3a/gi, ':');
    }
    
    // Remove common prefixes/artifacts from scraped data
    cleaned = cleaned
      .replace(/^["\s\\5c]+/gi, '') // Remove leading quotes, spaces, backslashes, "5c"
      .replace(/["\s\\]+$/, '')     // Remove trailing quotes, spaces, backslashes
      .replace(/^mailto:/i, '');    // Remove mailto: prefix if present
    
    // Re-extract email if there's garbage around it
    const emailMatch = cleaned.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      return emailMatch[1].toLowerCase();
    }
    
    return null;
  }

  // Extract emails from HTML content
  extractEmailsFromHTML(html) {
    const emails = new Set();
    
    // Pattern 1: mailto: links
    const mailtoRegex = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
    let match;
    while ((match = mailtoRegex.exec(html)) !== null) {
      const cleaned = this.cleanEmail(match[1]);
      if (cleaned) emails.add(cleaned);
    }
    
    // Pattern 2: General email pattern in text
    const emailRegex = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/gi;
    while ((match = emailRegex.exec(html)) !== null) {
      const cleaned = this.cleanEmail(match[1]);
      if (cleaned) emails.add(cleaned);
    }
    
    return Array.from(emails);
  }

  // Filter and score emails
  filterAndScoreEmails(emails, domain) {
    const scored = [];
    
    for (const email of emails) {
      // Skip invalid emails
      if (!email || email.length > 100) continue;
      
      // Skip generic/useless patterns
      let skip = false;
      for (const pattern of this.skipPatterns) {
        if (pattern.test(email)) {
          skip = true;
          break;
        }
      }
      if (skip) continue;
      
      // Calculate score
      let score = 50; // Base score
      
      // Bonus: email domain matches website domain
      if (domain) {
        const emailDomain = email.split('@')[1];
        const siteDomain = domain.replace(/^www\./, '').toLowerCase();
        if (emailDomain && emailDomain.includes(siteDomain.split('.')[0])) {
          score += 30;
        }
      }
      
      // Bonus: priority patterns
      for (const pattern of this.priorityPatterns) {
        if (pattern.test(email)) {
          score += 20;
          break;
        }
      }
      
      // Penalty: very long local part
      const localPart = email.split('@')[0];
      if (localPart.length > 30) score -= 20;
      
      // Penalty: lots of numbers
      const numberCount = (localPart.match(/\d/g) || []).length;
      if (numberCount > 4) score -= 15;
      
      scored.push({ email, score });
    }
    
    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    
    return scored;
  }

  // Extract domain from URL
  getDomain(url) {
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      return parsed.hostname;
    } catch {
      return null;
    }
  }

  // Crawl a single website
  async crawlWebsite(url) {
    if (!url) return { emails: [], error: 'No URL provided' };
    
    // Normalize URL
    let normalizedUrl = url;
    if (!normalizedUrl.startsWith('http')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    
    const domain = this.getDomain(normalizedUrl);
    const allEmails = new Set();
    const pagesToCheck = [normalizedUrl];
    
    // Try to find contact page
    const contactPaths = ['/contact', '/contact-us', '/contactez-nous', '/nous-joindre', '/about', '/about-us', '/a-propos'];
    for (const path of contactPaths) {
      try {
        const contactUrl = new URL(path, normalizedUrl).toString();
        pagesToCheck.push(contactUrl);
      } catch {}
    }
    
    const errors = [];
    
    for (const pageUrl of pagesToCheck.slice(0, 3)) { // Max 3 pages per site
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        
        const response = await fetch(pageUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
          },
          redirect: 'follow',
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const html = await response.text();
          const emails = this.extractEmailsFromHTML(html);
          emails.forEach(e => allEmails.add(e));
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          errors.push(`Timeout on ${pageUrl}`);
        } else {
          errors.push(`${error.message} on ${pageUrl}`);
        }
      }
      
      // Small delay between pages
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Filter and score
    const scored = this.filterAndScoreEmails(Array.from(allEmails), domain);
    
    return {
      emails: scored,
      bestEmail: scored.length > 0 ? scored[0].email : null,
      totalFound: allEmails.size,
      errors: errors.length > 0 ? errors : null
    };
  }
}

// Email extraction jobs storage
const emailExtractionJobs = new Map();
const emailExtractor = new EmailExtractor();

// ============== SCRAPING ROUTES ==============

// Store for active scraping jobs
const scrapingJobs = new Map();

// Categories for "All Businesses" broad search
const ALL_BUSINESS_CATEGORIES = [
  // General Business
  'business',
  'office',
  'professional services',
  'company',
  'corporate',
  'commercial',
  'store',
  'shop',
  'agency',
  'firm',
  'clinic',
  'center',
  'studio',
  'salon',
  'restaurant',
  'medical',
  'dental',
  'legal',
  'accounting',
  'real estate',
  'insurance',
  'consulting',
  'marketing',
  'technology',
  'construction',
  'retail',
  'fitness',
  'spa',
  'automotive',
  
  // Automotive & Concessionnaires
  'car dealership',
  'concessionnaire',
  'concessionnaire auto',
  'concessionnaire automobile',
  'auto dealer',
  'used car dealer',
  'motorcycle dealer',
  'RV dealer',
  'truck dealer',
  'vehicle dealer',
  'auto repair',
  'mechanic',
  'car wash',
  'tire shop',
  'auto parts',
  
  // Buildings & Property Management (Residential)
  'apartment building',
  'residential building',
  'condo building',
  'property management',
  'building management',
  'syndic',
  'syndic de copropriété',
  'immeuble',
  'immeuble résidentiel',
  'immeuble à logements',
  'gestion immobilière',
  'housing complex',
  'apartment complex',
  'condo association',
  'strata management',
  'landlord',
  'property owner',
  'rental property',
  'logement',
  'habitation',
  
  // More Business Types
  'cafe',
  'bakery',
  'gym',
  'pharmacy',
  'hotel',
  'motel',
  'daycare',
  'school',
  'warehouse',
  'factory',
  'manufacturing'
];

app.post('/api/scrape/start', requireAuth, async (req, res) => {
  const { category, campaignName, neighborhoods: selectedIds, scrapeMode = 'category', postalCodes, cityId } = req.body;
  
  if (!config.dataforseo.login || !config.dataforseo.password) {
    return res.status(400).json({ error: 'DataForSEO credentials not configured' });
  }

  // Support both old neighborhoods system and new postal code system
  let targets = [];
  
  if (postalCodes && postalCodes.length > 0) {
    // New postal code based scraping
    const areas = loadMontrealAreas();
    const city = areas.cities.find(c => c.id === cityId);
    
    targets = postalCodes.map(code => {
      const pcInfo = city?.postalCodes.find(p => p.code === code);
      return {
        id: code,
        name: pcInfo?.area || code,
        location: `${pcInfo?.area || ''}, ${city?.name || ''}, QC, Canada`,
        postalCode: code,
        cityId: cityId,
        cityName: city?.name || ''
      };
    });
  } else if (selectedIds && selectedIds.length > 0) {
    // Legacy neighborhood system
    const neighborhoodData = loadNeighborhoods();
    targets = neighborhoodData.neighborhoods
      .filter(n => selectedIds.includes(n.id))
      .map(n => ({ ...n, postalCode: null }));
  }

  if (targets.length === 0) {
    return res.status(400).json({ error: 'No locations selected' });
  }

  const jobId = Date.now().toString();
  const job = {
    id: jobId,
    status: 'running',
    category,
    scrapeMode, // 'category', 'all_businesses'
    campaignName,
    cityId,
    postalCodes: postalCodes || [],
    neighborhoods: targets, // Now called targets internally
    progress: 0,
    totalNeighborhoods: targets.length,
    currentNeighborhood: '',
    currentCategory: '',
    leads: [],
    errors: [],
    startTime: new Date().toISOString()
  };

  scrapingJobs.set(jobId, job);

  // Start scraping in background based on mode
  if (scrapeMode === 'all_businesses') {
    runBroadScrapingJob(jobId, job);
  } else {
    runScrapingJob(jobId, job);
  }

  res.json({ jobId, status: 'started' });
});

async function runScrapingJob(jobId, job) {
  const api = new DataForSEOAPI(config.dataforseo.login, config.dataforseo.password);
  
  logEvent('start', 'workflow', `Starting scraping job: ${job.campaignName}`, {
    jobId,
    category: job.category,
    neighborhoods: job.neighborhoods.length
  });
  
  for (let i = 0; i < job.neighborhoods.length; i++) {
    const neighborhood = job.neighborhoods[i];
    job.currentNeighborhood = neighborhood.name;
    job.progress = Math.round((i / job.neighborhoods.length) * 100);

    logEvent('info', 'scraper', `Scraping neighborhood: ${neighborhood.name}`, {
      jobId,
      index: i + 1,
      total: job.neighborhoods.length
    });

    try {
      logEvent('info', 'dataforseo', `API call for: ${neighborhood.location}`, { jobId });
      
      const results = await api.searchBusinessListings({
        location: neighborhood.location,
        category: job.category,
        minRating: config.defaults.minRating,
        limit: config.defaults.limitPerNeighborhood,
        locationCode: config.defaults.locationCode,
        languageCode: config.defaults.languageCode,
      });

      automationLogs.systemStatus.dataforseo = { status: 'connected', lastCheck: new Date().toISOString() };
      
      logEvent('success', 'dataforseo', `Found ${results.length} businesses in ${neighborhood.name}`, {
        jobId,
        count: results.length
      });

      // Add neighborhood info to each lead
      const leadsWithNeighborhood = results.map(lead => ({
        ...lead,
        neighborhood: neighborhood.name,
        scrapedAt: new Date().toISOString()
      }));

      job.leads.push(...leadsWithNeighborhood);
      
      // Rate limiting between neighborhoods
      if (i < job.neighborhoods.length - 1) {
        logEvent('info', 'rate-limiter', 'Waiting 2s before next request...', { jobId });
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      logEvent('error', 'dataforseo', `Error scraping ${neighborhood.name}: ${error.message}`, {
        jobId,
        neighborhood: neighborhood.name,
        error: error.message,
        stack: error.stack
      });
      
      automationLogs.systemStatus.dataforseo = { status: 'error', lastCheck: new Date().toISOString(), error: error.message };
      
      job.errors.push({
        neighborhood: neighborhood.name,
        error: error.message
      });
    }
  }

  // Deduplicate by phone
  logEvent('info', 'deduplication', `Deduplicating ${job.leads.length} leads...`, { jobId });
  
  const originalCount = job.leads.length;
  const seenPhones = new Set();
  job.leads = job.leads.filter(lead => {
    if (!lead.phone) return true;
    const phone = lead.phone.replace(/\D/g, '');
    if (seenPhones.has(phone)) return false;
    seenPhones.add(phone);
    return true;
  });
  
  const duplicatesRemoved = originalCount - job.leads.length;
  logEvent('success', 'deduplication', `Removed ${duplicatesRemoved} duplicates, ${job.leads.length} unique leads`, {
    jobId,
    original: originalCount,
    unique: job.leads.length,
    duplicates: duplicatesRemoved
  });

  job.status = 'completed';
  job.progress = 100;
  job.endTime = new Date().toISOString();
  
  // Update postal code progress tracking
  if (job.postalCodes && job.postalCodes.length > 0) {
    const progress = loadScrapeProgress();
    const leadsPerPostalCode = Math.ceil(job.leads.length / job.postalCodes.length);
    
    job.postalCodes.forEach(code => {
      if (!progress.postalCodes[code]) {
        progress.postalCodes[code] = { status: 'not_started', leadsCount: 0, campaigns: [] };
      }
      progress.postalCodes[code].status = 'complete';
      progress.postalCodes[code].leadsCount += leadsPerPostalCode;
      progress.postalCodes[code].lastScraped = new Date().toISOString();
      if (!progress.postalCodes[code].campaigns.includes(job.campaignName)) {
        progress.postalCodes[code].campaigns.push(job.campaignName);
      }
    });
    
    saveScrapeProgress(progress);
    logEvent('info', 'progress', `Updated progress for ${job.postalCodes.length} postal codes`, { jobId });
  }
  
  // AUTO-SAVE leads locally (never lose data!)
  if (job.leads.length > 0) {
    const cityName = job.neighborhoods[0]?.cityName || 'Unknown';
    addLeadsToLocal(job.leads, job.campaignName, cityName, job.postalCodes || []);
  }
  
  logEvent('complete', 'workflow', `Job completed: ${job.leads.length} leads found`, {
    jobId,
    leadsCount: job.leads.length,
    errorsCount: job.errors.length,
    duration: Math.round((new Date(job.endTime) - new Date(job.startTime)) / 1000) + 's'
  });
  
  logJob(job);
}

// Broad scraping job - searches multiple categories for comprehensive coverage
async function runBroadScrapingJob(jobId, job) {
  const api = new DataForSEOAPI(config.dataforseo.login, config.dataforseo.password);
  
  // COMPREHENSIVE category list for maximum B2B coverage
  const categoriesToSearch = [
    // Food & Beverage
    'restaurant',
    'cafe',
    'coffee shop',
    'fast food',
    'bakery',
    'bar',
    'pizzeria',
    'sushi',
    'deli',
    'catering',
    // Retail
    'store',
    'shop',
    'boutique',
    'grocery store',
    'convenience store',
    'pharmacy',
    'liquor store',
    'cannabis dispensary',
    'florist',
    'pet store',
    'clothing store',
    'electronics store',
    'furniture store',
    'hardware store',
    // Health & Wellness
    'gym',
    'fitness center',
    'yoga studio',
    'spa',
    'massage',
    'physiotherapy',
    'chiropractor',
    'dental clinic',
    'dentist',
    'medical clinic',
    'doctor',
    'veterinarian',
    'optometrist',
    // Professional Services
    'office',
    'lawyer',
    'accountant',
    'notary',
    'insurance',
    'real estate',
    'financial advisor',
    'consultant',
    'marketing agency',
    'advertising',
    'architect',
    'engineering',
    // Personal Care
    'salon',
    'hair salon',
    'barber',
    'nail salon',
    'beauty salon',
    'tattoo',
    'esthetician',
    // Automotive & Concessionnaires
    'car dealership',
    'concessionnaire',
    'concessionnaire auto',
    'concessionnaire automobile',
    'auto dealer',
    'used car dealer',
    'motorcycle dealer',
    'RV dealer',
    'truck dealer',
    'vehicle dealer',
    'auto repair',
    'mechanic',
    'car wash',
    'tire shop',
    'auto parts',
    // Buildings & Property Management (Residential)
    'apartment building',
    'residential building',
    'condo building',
    'property management',
    'building management',
    'syndic',
    'syndic de copropriété',
    'immeuble',
    'immeuble résidentiel',
    'immeuble à logements',
    'gestion immobilière',
    'housing complex',
    'apartment complex',
    'condo association',
    'strata management',
    'landlord',
    'property owner',
    'rental property',
    'logement',
    'habitation',
    // Home Services
    'plumber',
    'electrician',
    'HVAC',
    'contractor',
    'renovation',
    'landscaping',
    'cleaning service',
    'locksmith',
    'moving company',
    // Education & Childcare
    'daycare',
    'school',
    'tutoring',
    'driving school',
    'dance studio',
    'music school',
    // Entertainment & Recreation
    'hotel',
    'motel',
    'theater',
    'bowling',
    'escape room',
    'arcade',
    // Other Business Types
    'warehouse',
    'printing',
    'shipping',
    'storage',
    'laundromat',
    'dry cleaner',
    'tailor',
    'jeweler',
    'photographer',
    'event venue'
  ];
  
  const totalOperations = job.neighborhoods.length * categoriesToSearch.length;
  let completedOperations = 0;
  
  // Higher limit per category for comprehensive results
  const limitPerCategory = 50; // Get up to 50 results per category per location
  
  logEvent('start', 'workflow', `Starting COMPREHENSIVE scraping job: ${job.campaignName}`, {
    jobId,
    mode: 'all_businesses',
    neighborhoods: job.neighborhoods.length,
    categories: categoriesToSearch.length,
    totalOperations,
    limitPerCategory
  });
  
  for (let i = 0; i < job.neighborhoods.length; i++) {
    const neighborhood = job.neighborhoods[i];
    job.currentNeighborhood = neighborhood.name;
    
    logEvent('info', 'scraper', `Scraping ALL businesses in: ${neighborhood.name} (${categoriesToSearch.length} categories)`, {
      jobId,
      neighborhoodIndex: i + 1,
      totalNeighborhoods: job.neighborhoods.length
    });
    
    for (let c = 0; c < categoriesToSearch.length; c++) {
      const category = categoriesToSearch[c];
      job.currentCategory = category;
      job.progress = Math.round((completedOperations / totalOperations) * 100);
      
      try {
        logEvent('info', 'dataforseo', `Searching: "${category}" in ${neighborhood.location}`, { jobId });
        
        const results = await api.searchBusinessListings({
          location: neighborhood.location,
          category: category,
          minRating: 0, // Get all businesses regardless of rating
          limit: limitPerCategory,
          locationCode: config.defaults.locationCode,
          languageCode: config.defaults.languageCode,
        });

        automationLogs.systemStatus.dataforseo = { status: 'connected', lastCheck: new Date().toISOString() };
        
        // Add neighborhood and category info to each lead
        const leadsWithInfo = results.map(lead => ({
          ...lead,
          neighborhood: neighborhood.name,
          searchCategory: category,
          scrapedAt: new Date().toISOString()
        }));

        job.leads.push(...leadsWithInfo);
        
        logEvent('success', 'dataforseo', `Found ${results.length} in "${category}" - ${neighborhood.name}`, {
          jobId,
          count: results.length,
          category
        });
        
        completedOperations++;
        
        // Rate limiting between API calls (1 second to speed up while staying safe)
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        logEvent('error', 'dataforseo', `Error: ${category} in ${neighborhood.name}: ${error.message}`, {
          jobId,
          category,
          neighborhood: neighborhood.name,
          error: error.message
        });
        
        job.errors.push({
          neighborhood: neighborhood.name,
          category,
          error: error.message
        });
        
        completedOperations++;
      }
    }
    
    // Longer pause between neighborhoods
    if (i < job.neighborhoods.length - 1) {
      logEvent('info', 'rate-limiter', 'Waiting 3s before next neighborhood...', { jobId });
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // Aggressive deduplication by phone
  logEvent('info', 'deduplication', `Deduplicating ${job.leads.length} leads from broad search...`, { jobId });
  
  const originalCount = job.leads.length;
  const seenPhones = new Set();
  const seenNames = new Set();
  
  job.leads = job.leads.filter(lead => {
    // Dedupe by phone first
    if (lead.phone) {
      const phone = lead.phone.replace(/\D/g, '');
      if (seenPhones.has(phone)) return false;
      seenPhones.add(phone);
    }
    // Also dedupe by name+address combo for businesses without phones
    const nameKey = `${(lead.name || '').toLowerCase()}-${(lead.address || '').toLowerCase()}`;
    if (seenNames.has(nameKey)) return false;
    seenNames.add(nameKey);
    return true;
  });
  
  const duplicatesRemoved = originalCount - job.leads.length;
  logEvent('success', 'deduplication', `Removed ${duplicatesRemoved} duplicates, ${job.leads.length} unique leads`, {
    jobId,
    original: originalCount,
    unique: job.leads.length,
    duplicates: duplicatesRemoved
  });

  job.status = 'completed';
  job.progress = 100;
  job.endTime = new Date().toISOString();
  
  // Update postal code progress tracking
  if (job.postalCodes && job.postalCodes.length > 0) {
    const progress = loadScrapeProgress();
    const leadsPerPostalCode = Math.ceil(job.leads.length / job.postalCodes.length);
    
    job.postalCodes.forEach(code => {
      if (!progress.postalCodes[code]) {
        progress.postalCodes[code] = { status: 'not_started', leadsCount: 0, campaigns: [] };
      }
      progress.postalCodes[code].status = 'complete';
      progress.postalCodes[code].leadsCount += leadsPerPostalCode;
      progress.postalCodes[code].lastScraped = new Date().toISOString();
      if (!progress.postalCodes[code].campaigns.includes(job.campaignName)) {
        progress.postalCodes[code].campaigns.push(job.campaignName);
      }
    });
    
    saveScrapeProgress(progress);
    logEvent('info', 'progress', `Updated progress for ${job.postalCodes.length} postal codes`, { jobId });
  }
  
  // AUTO-SAVE leads locally (never lose data!)
  if (job.leads.length > 0) {
    const cityName = job.neighborhoods[0]?.cityName || 'Unknown';
    addLeadsToLocal(job.leads, job.campaignName, cityName, job.postalCodes || []);
  }
  
  logEvent('complete', 'workflow', `BROAD scraping completed: ${job.leads.length} unique leads found`, {
    jobId,
    leadsCount: job.leads.length,
    errorsCount: job.errors.length,
    duration: Math.round((new Date(job.endTime) - new Date(job.startTime)) / 1000) + 's',
    mode: 'all_businesses'
  });
  
  logJob(job);
}

app.get('/api/scrape/status/:jobId', requireAuth, (req, res) => {
  const { jobId } = req.params;
  const job = scrapingJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    currentNeighborhood: job.currentNeighborhood,
    totalNeighborhoods: job.totalNeighborhoods,
    leadsCount: job.leads.length,
    errorsCount: job.errors.length,
    startTime: job.startTime,
    endTime: job.endTime
  });
});

app.get('/api/scrape/results/:jobId', requireAuth, (req, res) => {
  const { jobId } = req.params;
  const job = scrapingJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    leads: job.leads,
    errors: job.errors,
    status: job.status
  });
});

// ============== EXPORT ROUTES ==============

// Export scraping results to CSV
app.get('/api/export/scrape/:jobId/csv', requireAuth, (req, res) => {
  const { jobId } = req.params;
  const job = scrapingJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const leads = job.leads || [];
  
  // Build CSV with proper phone formatting
  const headers = ['Company Name', 'Phone', 'Website', 'Address', 'Rating', 'Reviews', 'Category', 'Neighborhood', 'Scraped Date'];
  const rows = [headers.join(',')];
  
  leads.forEach(lead => {
    const row = [
      escapeCSVField(lead.name),
      escapeCSVField(formatPhoneForExcel(lead.phone)),
      escapeCSVField(lead.website),
      escapeCSVField(lead.address),
      lead.rating || '',
      lead.reviewsCount || '',
      escapeCSVField(lead.category || lead.searchCategory),
      escapeCSVField(lead.neighborhood),
      lead.scrapedAt || ''
    ];
    rows.push(row.join(','));
  });

  const filename = `brio-leads-${job.campaignName?.replace(/[^a-z0-9]/gi, '-') || jobId}-${new Date().toISOString().split('T')[0]}.csv`;
  
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\ufeff' + rows.join('\n'));
});

// Export leads from Airtable to CSV (redirects to local export now)
app.get('/api/export/leads/csv', requireAuth, (req, res) => {
  // Redirect to local export since Airtable has permission issues
  res.redirect('/api/local/export/csv');
});

// Export DNC list to CSV
app.get('/api/export/dnc/csv', requireAuth, (req, res) => {
  const dnc = loadDNC();
  const rows = [['Phone', 'Reason', 'Source', 'Added Date'].join(',')];
  
  Object.entries(dnc.phones).forEach(([normalized, info]) => {
    rows.push([
      escapeCSVField(formatPhoneForExcel(info.originalPhone)),
      escapeCSVField(info.reason),
      escapeCSVField(info.source),
      info.addedAt || ''
    ].join(','));
  });

  const filename = `brio-dnc-list-${new Date().toISOString().split('T')[0]}.csv`;
  
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\ufeff' + rows.join('\n'));
});

// ============== LOCAL LEADS API ==============

// Get all local leads
app.get('/api/local/leads', requireAuth, (req, res) => {
  const { campaign, status, search, limit = 500 } = req.query;
  const data = loadLocalLeads();
  
  let leads = data.leads || [];
  
  // Filter by campaign
  if (campaign) {
    leads = leads.filter(l => l.campaignId === campaign || l.campaignName === campaign);
  }
  
  // Filter by status
  if (status) {
    leads = leads.filter(l => l.status === status);
  }
  
  // Search
  if (search) {
    const term = search.toLowerCase();
    leads = leads.filter(l => 
      (l.name || '').toLowerCase().includes(term) ||
      (l.phone || '').toLowerCase().includes(term) ||
      (l.address || '').toLowerCase().includes(term) ||
      (l.category || '').toLowerCase().includes(term)
    );
  }
  
  // Sort by most recent first
  leads = leads.sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));
  
  res.json({
    total: leads.length,
    leads: leads.slice(0, parseInt(limit)),
    hasMore: leads.length > parseInt(limit)
  });
});

// Get local campaigns
app.get('/api/local/campaigns', requireAuth, (req, res) => {
  const data = loadLocalLeads();
  res.json(data.campaigns || []);
});

// Get local leads stats
app.get('/api/local/stats', requireAuth, (req, res) => {
  const data = loadLocalLeads();
  const leads = data.leads || [];
  
  const withPhone = leads.filter(l => l.phone).length;
  const byStatus = {};
  leads.forEach(l => {
    byStatus[l.status || 'New'] = (byStatus[l.status || 'New'] || 0) + 1;
  });
  
  res.json({
    totalLeads: leads.length,
    withPhone,
    withoutPhone: leads.length - withPhone,
    totalCampaigns: (data.campaigns || []).length,
    byStatus,
    lastUpdated: data.lastUpdated
  });
});

// Update lead status
app.patch('/api/local/leads/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;
  
  const data = loadLocalLeads();
  const lead = data.leads.find(l => l.id === id);
  
  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }
  
  if (status) lead.status = status;
  if (notes) lead.notes = notes;
  lead.updatedAt = new Date().toISOString();
  
  saveLocalLeads(data);
  res.json({ success: true, lead });
});

// Export local leads to CSV
app.get('/api/local/export/csv', requireAuth, (req, res) => {
  const { campaign } = req.query;
  const data = loadLocalLeads();
  let leads = data.leads || [];
  
  if (campaign) {
    leads = leads.filter(l => l.campaignId === campaign || l.campaignName === campaign);
  }
  
  const csvRows = [
    ['Company Name', 'Phone', 'Website', 'Address', 'Rating', 'Reviews', 'Category', 'Neighborhood', 'Campaign', 'Status', 'Scraped Date'].join(',')
  ];
  
  leads.forEach(lead => {
    const row = [
      escapeCSVField(lead.name),
      escapeCSVField(formatPhoneForExcel(lead.phone)),
      escapeCSVField(lead.website),
      escapeCSVField(lead.address),
      lead.rating || '',
      lead.reviewsCount || '',
      escapeCSVField(lead.category || lead.searchCategory),
      escapeCSVField(lead.neighborhood),
      escapeCSVField(lead.campaignName),
      lead.status || 'New',
      lead.importedAt || ''
    ];
    csvRows.push(row.join(','));
  });
  
  const campaignName = campaign ? data.campaigns.find(c => c.id === campaign || c.name === campaign)?.name : 'all';
  const filename = `brio-leads-${(campaignName || 'all').replace(/[^a-z0-9]/gi, '-')}-${new Date().toISOString().split('T')[0]}.csv`;
  
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\ufeff' + csvRows.join('\n'));
});

// Helper: Format phone number for Excel (prevent formula interpretation)
function formatPhoneForExcel(phone) {
  if (!phone) return '';
  // Remove leading = + - @ characters that Excel interprets as formulas
  let cleaned = phone.replace(/^[=+\-@]+/, '');
  // Keep only digits, spaces, parentheses, and dashes
  cleaned = cleaned.replace(/[^\d\s()\-\.]/g, '');
  // Format as plain number if possible
  const digitsOnly = cleaned.replace(/\D/g, '');
  if (digitsOnly.length === 10) {
    // Format: (514) 740-2098
    return `(${digitsOnly.slice(0,3)}) ${digitsOnly.slice(3,6)}-${digitsOnly.slice(6)}`;
  } else if (digitsOnly.length === 11 && digitsOnly[0] === '1') {
    // Format: 1 (514) 740-2098
    return `1 (${digitsOnly.slice(1,4)}) ${digitsOnly.slice(4,7)}-${digitsOnly.slice(7)}`;
  }
  return cleaned || phone;
}

// Helper: Escape CSV field properly
function escapeCSVField(value) {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  // Remove/escape characters that could be interpreted as formulas
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str; // Prefix with single quote to force text
  }
  // Escape quotes and wrap in quotes
  return `"${str.replace(/"/g, '""')}"`;
}

// Delete a campaign and its leads
app.delete('/api/local/campaigns/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const data = loadLocalLeads();
  
  data.campaigns = data.campaigns.filter(c => c.id !== id);
  data.leads = data.leads.filter(l => l.campaignId !== id);
  
  saveLocalLeads(data);
  res.json({ success: true });
});

// ============== AIRTABLE ROUTES ==============

async function airtableRequest(endpoint, options = {}) {
  const url = `https://api.airtable.com/v0/${config.airtable.baseId}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${config.airtable.apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Airtable Error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

app.post('/api/airtable/import', requireAuth, async (req, res) => {
  const { leads, campaignName } = req.body;

  try {
    // Create or find campaign
    let campaignId = null;
    try {
      const searchResponse = await airtableRequest(
        `/Campaigns?filterByFormula={Campaign Name}="${campaignName}"`
      );
      
      if (searchResponse.records?.length > 0) {
        campaignId = searchResponse.records[0].id;
      } else {
        const createResponse = await airtableRequest('/Campaigns', {
          method: 'POST',
          body: JSON.stringify({
            records: [{
              fields: {
                'Campaign Name': campaignName,
                'Status': 'Active',
                'Start Date': new Date().toISOString().split('T')[0],
              },
            }],
          }),
        });
        campaignId = createResponse.records[0].id;
      }
    } catch (e) {
      console.error('Campaign error:', e.message);
    }

    // Import leads in batches of 10
    let imported = 0;
    let duplicates = 0;

    for (let i = 0; i < leads.length; i += 10) {
      const batch = leads.slice(i, i + 10);
      
      const records = batch.map(lead => ({
        fields: {
          'Company Name': lead.name || '',
          'Phone': lead.phone || '',
          'Website': lead.website || '',
          'Address': lead.address || '',
          'Rating': lead.rating || null,
          'Reviews Count': lead.reviewsCount || 0,
          'Category': lead.category || '',
          'Neighborhood': lead.neighborhood || '',
          'Import Date': new Date().toISOString(),
          'Campaign': campaignId ? [campaignId] : [],
          'Status': 'New',
        },
      }));

      try {
        await airtableRequest('/Leads', {
          method: 'POST',
          body: JSON.stringify({ records }),
        });
        imported += batch.length;
      } catch (e) {
        console.error('Batch import error:', e.message);
      }
    }

    res.json({ success: true, imported, duplicates });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/airtable/leads', requireAuth, async (req, res) => {
  try {
    const response = await airtableRequest('/Leads?maxRecords=100&sort[0][field]=Import Date&sort[0][direction]=desc');
    res.json(response.records || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/airtable/campaigns', requireAuth, async (req, res) => {
  try {
    const response = await airtableRequest('/Campaigns?sort[0][field]=Start Date&sort[0][direction]=desc');
    res.json(response.records || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== AUTOMATION MONITORING ROUTES ==============

app.get('/api/automation/logs', requireAuth, (req, res) => {
  const { limit = 50, type } = req.query;
  let events = automationLogs.events;
  
  if (type) {
    events = events.filter(e => e.type === type);
  }
  
  res.json(events.slice(0, parseInt(limit)));
});

app.get('/api/automation/errors', requireAuth, (req, res) => {
  const { limit = 50 } = req.query;
  res.json(automationLogs.errors.slice(0, parseInt(limit)));
});

app.get('/api/automation/jobs', requireAuth, (req, res) => {
  const { limit = 20 } = req.query;
  res.json(automationLogs.jobs.slice(0, parseInt(limit)));
});

app.get('/api/automation/status', requireAuth, (req, res) => {
  res.json({
    systemStatus: automationLogs.systemStatus,
    stats: {
      totalEvents: automationLogs.events.length,
      totalErrors: automationLogs.errors.length,
      totalJobs: automationLogs.jobs.length,
      recentErrors: automationLogs.errors.filter(e => 
        new Date(e.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
      ).length,
      jobsToday: automationLogs.jobs.filter(j =>
        new Date(j.startTime) > new Date(Date.now() - 24 * 60 * 60 * 1000)
      ).length
    },
    activeJobs: Array.from(scrapingJobs.values()).filter(j => j.status === 'running').map(j => ({
      id: j.id,
      campaign: j.campaignName,
      progress: j.progress,
      currentNeighborhood: j.currentNeighborhood
    }))
  });
});

app.post('/api/automation/test/dataforseo', requireAuth, async (req, res) => {
  logEvent('info', 'qa-test', 'Testing DataForSEO connection...');
  
  if (!config.dataforseo.login || !config.dataforseo.password) {
    logEvent('error', 'qa-test', 'DataForSEO credentials not configured');
    return res.json({ success: false, error: 'Credentials not configured' });
  }

  try {
    const api = new DataForSEOAPI(config.dataforseo.login, config.dataforseo.password);
    const auth = Buffer.from(`${config.dataforseo.login}:${config.dataforseo.password}`).toString('base64');
    
    const response = await fetch('https://api.dataforseo.com/v3/appendix/user_data', {
      method: 'GET',
      headers: { 'Authorization': `Basic ${auth}` }
    });
    
    const data = await response.json();
    
    if (response.ok && data.status_code === 20000) {
      automationLogs.systemStatus.dataforseo = { status: 'connected', lastCheck: new Date().toISOString() };
      logEvent('success', 'qa-test', 'DataForSEO connection successful', { balance: data.tasks?.[0]?.result?.[0]?.money?.balance });
      res.json({ 
        success: true, 
        message: 'Connection successful',
        balance: data.tasks?.[0]?.result?.[0]?.money?.balance
      });
    } else {
      throw new Error(data.status_message || 'Unknown error');
    }
  } catch (error) {
    automationLogs.systemStatus.dataforseo = { status: 'error', lastCheck: new Date().toISOString(), error: error.message };
    logEvent('error', 'qa-test', `DataForSEO connection failed: ${error.message}`);
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/automation/test/airtable', requireAuth, async (req, res) => {
  logEvent('info', 'qa-test', 'Testing Airtable connection...');
  
  try {
    const response = await airtableRequest('/Leads?maxRecords=1');
    automationLogs.systemStatus.airtable = { status: 'connected', lastCheck: new Date().toISOString() };
    logEvent('success', 'qa-test', 'Airtable connection successful');
    res.json({ success: true, message: 'Connection successful' });
  } catch (error) {
    automationLogs.systemStatus.airtable = { status: 'error', lastCheck: new Date().toISOString(), error: error.message };
    logEvent('error', 'qa-test', `Airtable connection failed: ${error.message}`);
    res.json({ success: false, error: error.message });
  }
});

app.delete('/api/automation/errors/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  automationLogs.errors = automationLogs.errors.filter(e => e.id !== id);
  saveLogs();
  res.json({ success: true });
});

app.post('/api/automation/errors/clear', requireAuth, (req, res) => {
  automationLogs.errors = [];
  saveLogs();
  logEvent('info', 'system', 'Error log cleared');
  res.json({ success: true });
});

// Workflow definition for visual display
app.get('/api/automation/workflow', requireAuth, (req, res) => {
  res.json({
    nodes: [
      { id: 'trigger', type: 'trigger', label: 'Manual Trigger', x: 50, y: 150, status: 'idle' },
      { id: 'config', type: 'config', label: 'Load Config', x: 200, y: 150, status: 'idle' },
      { id: 'neighborhoods', type: 'data', label: 'Get Neighborhoods', x: 350, y: 150, status: 'idle' },
      { id: 'loop', type: 'loop', label: 'For Each Neighborhood', x: 500, y: 150, status: 'idle' },
      { id: 'scraper', type: 'api', label: 'DataForSEO Scrape', x: 650, y: 100, status: automationLogs.systemStatus.dataforseo.status },
      { id: 'rate-limiter', type: 'utility', label: 'Rate Limiter (2s)', x: 650, y: 200, status: 'idle' },
      { id: 'deduplication', type: 'transform', label: 'Deduplicate', x: 800, y: 150, status: 'idle' },
      { id: 'airtable', type: 'api', label: 'Import to Airtable', x: 950, y: 150, status: automationLogs.systemStatus.airtable.status },
      { id: 'complete', type: 'end', label: 'Complete', x: 1100, y: 150, status: 'idle' }
    ],
    edges: [
      { from: 'trigger', to: 'config' },
      { from: 'config', to: 'neighborhoods' },
      { from: 'neighborhoods', to: 'loop' },
      { from: 'loop', to: 'scraper' },
      { from: 'scraper', to: 'rate-limiter' },
      { from: 'rate-limiter', to: 'loop', type: 'loop-back' },
      { from: 'loop', to: 'deduplication', type: 'loop-exit' },
      { from: 'deduplication', to: 'airtable' },
      { from: 'airtable', to: 'complete' }
    ]
  });
});

// DNC List Management
// Paths are now handled in PERSISTENCE SETUP section at top of file

function loadDNC() {
  if (existsSync(DNC_PATH)) {
    return JSON.parse(readFileSync(DNC_PATH, 'utf-8'));
  }
  return { phones: {}, lastUpdated: null };
}

function saveDNC(data) {
  data.lastUpdated = new Date().toISOString();
  writeFileSync(DNC_PATH, JSON.stringify(data, null, 2));
}

function normalizePhone(phone) {
  if (!phone) return null;
  return phone.replace(/\D/g, '').slice(-10);
}

function loadLeadPool() {
  if (existsSync(LEADS_POOL_PATH)) {
    return JSON.parse(readFileSync(LEADS_POOL_PATH, 'utf-8'));
  }
  return { phones: {}, lastScrape: null, totalScraped: 0, totalImported: 0, totalDuplicates: 0 };
}

function saveLeadPool(data) {
  writeFileSync(LEADS_POOL_PATH, JSON.stringify(data, null, 2));
}

// DNC API endpoints
app.get('/api/dnc', requireAuth, (req, res) => {
  const dnc = loadDNC();
  res.json({
    count: Object.keys(dnc.phones).length,
    lastUpdated: dnc.lastUpdated,
    phones: Object.entries(dnc.phones).slice(0, 100).map(([normalized, info]) => ({
      phone: info.originalPhone,
      reason: info.reason,
      addedAt: info.addedAt
    }))
  });
});

app.post('/api/dnc/add', requireAuth, (req, res) => {
  const { phone, reason = 'Manual add' } = req.body;
  const dnc = loadDNC();
  const normalized = normalizePhone(phone);
  
  if (!normalized) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }

  dnc.phones[normalized] = {
    originalPhone: phone,
    reason,
    source: 'manual',
    addedAt: new Date().toISOString()
  };
  saveDNC(dnc);
  
  logEvent('info', 'dnc', `Added ${phone} to DNC list: ${reason}`);
  res.json({ success: true, count: Object.keys(dnc.phones).length });
});

app.post('/api/dnc/check', requireAuth, (req, res) => {
  const { phone } = req.body;
  const dnc = loadDNC();
  const normalized = normalizePhone(phone);
  const blocked = normalized ? !!dnc.phones[normalized] : false;
  
  res.json({ 
    phone, 
    blocked,
    info: blocked ? dnc.phones[normalized] : null
  });
});

app.delete('/api/dnc/:phone', requireAuth, (req, res) => {
  const { phone } = req.params;
  const dnc = loadDNC();
  const normalized = normalizePhone(phone);
  
  if (normalized && dnc.phones[normalized]) {
    delete dnc.phones[normalized];
    saveDNC(dnc);
    logEvent('info', 'dnc', `Removed ${phone} from DNC list`);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Phone not found in DNC list' });
  }
});

// Lead Pool Stats
app.get('/api/leads/pool-stats', requireAuth, (req, res) => {
  const pool = loadLeadPool();
  const dnc = loadDNC();
  
  res.json({
    uniquePhones: Object.keys(pool.phones).length,
    lastScrape: pool.lastScrape,
    totalScraped: pool.totalScraped,
    totalImported: pool.totalImported,
    totalDuplicates: pool.totalDuplicates,
    dncCount: Object.keys(dnc.phones).length
  });
});

// Pipeline Health Check
app.get('/api/leads/health', requireAuth, async (req, res) => {
  const pool = loadLeadPool();
  const dnc = loadDNC();
  
  let availableLeads = 0;
  let pendingCallbacks = 0;
  
  try {
    const newLeads = await airtableRequest(
      `/Leads?filterByFormula=OR({Status}="New",{Status}="Queued")&maxRecords=1000`
    );
    availableLeads = newLeads.records?.length || 0;
    
    const callbacks = await airtableRequest(
      `/Leads?filterByFormula=OR({Status}="Callback Scheduled",{Status}="No Answer")&maxRecords=1000`
    );
    pendingCallbacks = callbacks.records?.length || 0;
  } catch (e) {
    // Leads table might not exist yet
  }
  
  const dailyTarget = 1000;
  const daysRemaining = Math.floor(availableLeads / dailyTarget);
  
  const alerts = [];
  
  if (availableLeads < 100) {
    alerts.push({ level: 'critical', message: `Only ${availableLeads} leads available! Need to scrape more.` });
  } else if (availableLeads < 500) {
    alerts.push({ level: 'warning', message: `Lead pool running low: ${availableLeads} available.` });
  }
  
  if (pendingCallbacks > 100) {
    alerts.push({ level: 'warning', message: `${pendingCallbacks} callbacks pending.` });
  }
  
  if (daysRemaining < 2) {
    alerts.push({ level: 'critical', message: `Only ${daysRemaining} day(s) of leads remaining!` });
  }
  
  res.json({
    availableLeads,
    pendingCallbacks,
    uniquePhonesTracked: Object.keys(pool.phones).length,
    dncListSize: Object.keys(dnc.phones).length,
    lastScrape: pool.lastScrape,
    daysRemaining,
    dailyTarget,
    alerts
  });
});

// Validate leads before import (check DNC + duplicates)
app.post('/api/leads/validate', requireAuth, (req, res) => {
  const { leads } = req.body;
  const dnc = loadDNC();
  const pool = loadLeadPool();
  
  const results = {
    valid: [],
    dnc: [],
    duplicates: [],
    invalid: []
  };
  
  for (const lead of leads) {
    if (!lead.phone) {
      results.invalid.push({ lead, reason: 'No phone number' });
      continue;
    }
    
    const normalized = normalizePhone(lead.phone);
    
    if (!normalized || normalized.length < 10) {
      results.invalid.push({ lead, reason: 'Invalid phone format' });
      continue;
    }
    
    if (dnc.phones[normalized]) {
      results.dnc.push({ lead, reason: dnc.phones[normalized].reason });
      continue;
    }
    
    if (pool.phones[normalized]) {
      results.duplicates.push({ lead, existingCampaign: pool.phones[normalized].campaign });
      continue;
    }
    
    results.valid.push(lead);
  }
  
  res.json({
    total: leads.length,
    validCount: results.valid.length,
    dncCount: results.dnc.length,
    duplicateCount: results.duplicates.length,
    invalidCount: results.invalid.length,
    results
  });
});

// Track imported leads (prevent future duplicates)
app.post('/api/leads/track', requireAuth, (req, res) => {
  const { leads, campaign } = req.body;
  const pool = loadLeadPool();
  
  let tracked = 0;
  for (const lead of leads) {
    if (lead.phone) {
      const normalized = normalizePhone(lead.phone);
      if (normalized && !pool.phones[normalized]) {
        pool.phones[normalized] = {
          leadId: lead.id,
          campaign,
          firstSeenAt: new Date().toISOString()
        };
        tracked++;
      }
    }
  }
  
  pool.totalImported += tracked;
  pool.lastScrape = new Date().toISOString();
  saveLeadPool(pool);
  
  logEvent('success', 'leads', `Tracked ${tracked} new leads for campaign: ${campaign}`);
  res.json({ success: true, tracked });
});

// Process call outcome
app.post('/api/leads/outcome', requireAuth, (req, res) => {
  const { phone, outcome, notes } = req.body;
  
  const outcomeActions = {
    'interested': { status: 'Qualified', addToDnc: false },
    'not_interested': { status: 'Not Interested', addToDnc: true, dncReason: 'Customer declined' },
    'no_answer': { status: 'No Answer', addToDnc: false },
    'voicemail': { status: 'Voicemail Left', addToDnc: false },
    'wrong_number': { status: 'Invalid', addToDnc: true, dncReason: 'Wrong/invalid number' },
    'callback': { status: 'Callback Scheduled', addToDnc: false }
  };
  
  const action = outcomeActions[outcome];
  if (!action) {
    return res.status(400).json({ error: 'Invalid outcome' });
  }
  
  // Add to DNC if needed
  if (action.addToDnc && phone) {
    const dnc = loadDNC();
    const normalized = normalizePhone(phone);
    if (normalized) {
      dnc.phones[normalized] = {
        originalPhone: phone,
        reason: action.dncReason,
        source: 'call_outcome',
        addedAt: new Date().toISOString()
      };
      saveDNC(dnc);
    }
  }
  
  logEvent('info', 'outcome', `Call outcome for ${phone}: ${outcome}`);
  res.json({ success: true, status: action.status, addedToDnc: action.addToDnc });
});

// ============== EMAIL EXTRACTION ROUTES ==============

// Extract email from a single website
app.post('/api/emails/extract/single', requireAuth, async (req, res) => {
  const { url, leadId } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  logEvent('info', 'email-extract', `Extracting email from: ${url}`);
  
  try {
    const result = await emailExtractor.crawlWebsite(url);
    
    // If leadId provided, update the lead with the email
    if (leadId && result.bestEmail) {
      const data = loadLocalLeads();
      const lead = data.leads.find(l => l.id === leadId);
      if (lead) {
        lead.email = result.bestEmail;
        lead.emailExtractedAt = new Date().toISOString();
        lead.allEmails = result.emails.map(e => e.email);
        saveLocalLeads(data);
      }
    }
    
    logEvent('success', 'email-extract', `Found ${result.totalFound} emails, best: ${result.bestEmail || 'none'}`);
    res.json(result);
  } catch (error) {
    logEvent('error', 'email-extract', `Failed to extract from ${url}: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Bulk extract emails for multiple leads
app.post('/api/emails/extract', requireAuth, async (req, res) => {
  const { leadIds, campaign } = req.body;
  
  if (!leadIds || leadIds.length === 0) {
    return res.status(400).json({ error: 'No leads selected' });
  }
  
  const jobId = Date.now().toString();
  const job = {
    id: jobId,
    status: 'running',
    campaign,
    totalLeads: leadIds.length,
    processed: 0,
    extracted: 0,
    failed: 0,
    results: [],
    startTime: new Date().toISOString()
  };
  
  emailExtractionJobs.set(jobId, job);
  
  logEvent('start', 'email-extract', `Starting bulk email extraction: ${leadIds.length} leads`, { jobId });
  
  // Run extraction in background
  runEmailExtractionJob(jobId, leadIds);
  
  res.json({ jobId, status: 'started', totalLeads: leadIds.length });
});

// Background job for bulk email extraction
async function runEmailExtractionJob(jobId, leadIds) {
  const job = emailExtractionJobs.get(jobId);
  const data = loadLocalLeads();
  
  for (const leadId of leadIds) {
    const lead = data.leads.find(l => l.id === leadId);
    
    if (!lead) {
      job.failed++;
      job.processed++;
      job.results.push({ leadId, error: 'Lead not found' });
      continue;
    }
    
    if (!lead.website) {
      job.failed++;
      job.processed++;
      job.results.push({ leadId, name: lead.name, error: 'No website' });
      continue;
    }
    
    // Skip if already has email
    if (lead.email) {
      job.processed++;
      job.results.push({ leadId, name: lead.name, email: lead.email, skipped: true });
      continue;
    }
    
    try {
      logEvent('info', 'email-extract', `Extracting from ${lead.website} (${job.processed + 1}/${job.totalLeads})`);
      
      const result = await emailExtractor.crawlWebsite(lead.website);
      
      if (result.bestEmail) {
        lead.email = result.bestEmail;
        lead.emailExtractedAt = new Date().toISOString();
        lead.allEmails = result.emails.map(e => e.email);
        job.extracted++;
        job.results.push({ 
          leadId, 
          name: lead.name, 
          email: result.bestEmail,
          totalFound: result.totalFound
        });
        logEvent('success', 'email-extract', `Found email for ${lead.name}: ${result.bestEmail}`);
      } else {
        job.results.push({ 
          leadId, 
          name: lead.name, 
          error: 'No email found',
          totalFound: result.totalFound
        });
      }
    } catch (error) {
      job.failed++;
      job.results.push({ leadId, name: lead.name, error: error.message });
      logEvent('error', 'email-extract', `Failed for ${lead.name}: ${error.message}`);
    }
    
    job.processed++;
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, emailExtractor.delay));
  }
  
  // Save all updated leads
  saveLocalLeads(data);
  
  job.status = 'completed';
  job.endTime = new Date().toISOString();
  
  logEvent('complete', 'email-extract', `Bulk extraction completed: ${job.extracted} emails found from ${job.totalLeads} leads`, {
    jobId,
    extracted: job.extracted,
    failed: job.failed,
    duration: Math.round((new Date(job.endTime) - new Date(job.startTime)) / 1000) + 's'
  });
}

// Get extraction job status
app.get('/api/emails/extract/status/:jobId', requireAuth, (req, res) => {
  const { jobId } = req.params;
  const job = emailExtractionJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json({
    id: job.id,
    status: job.status,
    totalLeads: job.totalLeads,
    processed: job.processed,
    extracted: job.extracted,
    failed: job.failed,
    progress: Math.round((job.processed / job.totalLeads) * 100),
    startTime: job.startTime,
    endTime: job.endTime
  });
});

// Get extraction job results
app.get('/api/emails/extract/results/:jobId', requireAuth, (req, res) => {
  const { jobId } = req.params;
  const job = emailExtractionJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json({
    status: job.status,
    results: job.results,
    summary: {
      total: job.totalLeads,
      extracted: job.extracted,
      failed: job.failed,
      skipped: job.results.filter(r => r.skipped).length
    }
  });
});

// Get leads with email filter
app.get('/api/local/leads/with-emails', requireAuth, (req, res) => {
  const { hasEmail, campaign, limit = 500 } = req.query;
  const data = loadLocalLeads();
  
  let leads = data.leads || [];
  
  // Filter by email presence
  if (hasEmail === 'true') {
    leads = leads.filter(l => l.email);
  } else if (hasEmail === 'false') {
    leads = leads.filter(l => !l.email && l.website);
  }
  
  // Filter by campaign
  if (campaign) {
    leads = leads.filter(l => l.campaignId === campaign || l.campaignName === campaign);
  }
  
  // Sort by most recent
  leads = leads.sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));
  
  const withEmail = (data.leads || []).filter(l => l.email).length;
  const withWebsite = (data.leads || []).filter(l => l.website && !l.email).length;
  
  res.json({
    total: leads.length,
    leads: leads.slice(0, parseInt(limit)),
    stats: {
      totalLeads: (data.leads || []).length,
      withEmail,
      withWebsite,
      noWebsite: (data.leads || []).length - withEmail - withWebsite
    }
  });
});

// ============== INSTANTLY EXPORT ==============

// Export leads with emails for Instantly
app.get('/api/export/instantly/csv', requireAuth, (req, res) => {
  const { campaign, onlyWithEmail = 'true', ids, industry, area } = req.query;
  const data = loadLocalLeads();
  
  let leads = data.leads || [];
  
  // Filter by specific IDs if provided
  if (ids) {
    const idList = ids.split(',');
    leads = leads.filter(l => idList.includes(l.id));
  } else {
    // Filter by campaign
    if (campaign) {
      leads = leads.filter(l => l.campaignId === campaign || l.campaignName === campaign);
    }
    // Filter by industry
    if (industry) {
      leads = leads.filter(l => (l.category || l.searchCategory || '').toLowerCase().includes(industry.toLowerCase()));
    }
    // Filter by area
    if (area) {
      leads = leads.filter(l => l.neighborhood === area);
    }
  }
  
  // Filter by email presence
  if (onlyWithEmail === 'true') {
    leads = leads.filter(l => l.email);
  }
  
  // Instantly CSV format
  // Required: email
  // Optional: first_name, last_name, company_name, personalization, phone, website, custom1-5
  const headers = [
    'email',
    'first_name',
    'company_name', 
    'website',
    'phone',
    'custom1',  // category
    'custom2',  // address
    'custom3',  // rating
    'custom4',  // neighborhood
    'custom5'   // campaign
  ];
  
  const rows = [headers.join(',')];
  
  leads.forEach(lead => {
    // Try to extract a first name from company name
    const firstName = extractFirstName(lead.name);
    
    const row = [
      escapeCSVField(lead.email || ''),
      escapeCSVField(firstName),
      escapeCSVField(lead.name || ''),
      escapeCSVField(lead.website || ''),
      escapeCSVField(formatPhoneForExcel(lead.phone)),
      escapeCSVField(lead.category || lead.searchCategory || ''),
      escapeCSVField(lead.address || ''),
      lead.rating || '',
      escapeCSVField(lead.neighborhood || ''),
      escapeCSVField(lead.campaignName || '')
    ];
    rows.push(row.join(','));
  });
  
  const campaignName = campaign ? 
    data.campaigns.find(c => c.id === campaign || c.name === campaign)?.name : 
    'all';
  const filename = `instantly-${(campaignName || 'all').replace(/[^a-z0-9]/gi, '-')}-${new Date().toISOString().split('T')[0]}.csv`;
  
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\ufeff' + rows.join('\n'));
});

// Helper: Extract a first name from business name
function extractFirstName(companyName) {
  if (!companyName) return '';
  
  // Common patterns to try
  // "John's Plumbing" -> "John"
  // "Marie-Claire Salon" -> "Marie-Claire"
  // "Dr. Smith Dental" -> "Dr. Smith"
  
  const possessiveMatch = companyName.match(/^([A-Z][a-zéèêëàâäùûüôöîïç-]+)'s\s/i);
  if (possessiveMatch) return possessiveMatch[1];
  
  // If starts with a capitalized word that looks like a name
  const firstWord = companyName.split(/[\s,]+/)[0];
  if (firstWord && /^[A-Z][a-zéèêëàâäùûüôöîïç-]+$/.test(firstWord) && firstWord.length >= 3 && firstWord.length <= 15) {
    // Check it's not a common business word
    const businessWords = ['the', 'les', 'la', 'le', 'service', 'services', 'enterprise', 'entreprise', 'group', 'groupe', 'solutions', 'pro', 'expert', 'centre', 'center', 'clinic', 'clinique', 'restaurant', 'cafe', 'hotel', 'salon', 'spa', 'gym', 'studio', 'shop', 'store', 'boutique', 'garage', 'auto', 'dental', 'medical'];
    if (!businessWords.includes(firstWord.toLowerCase())) {
      return firstWord;
    }
  }
  
  return '';
}

// ============== SERVE FRONTEND ==============

app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('\u250F\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2513');
  console.log('\u2503                                                              \u2503');
  console.log('\u2503   BRIO NETTOYAGE - B2B Lead Scraper                         \u2503');
  console.log('\u2503                                                              \u2503');
  console.log(`\u2503   Server running at: http://localhost:${PORT}                  \u2503`);
  console.log('\u2503                                                              \u2503');
  console.log('\u2503   Default login:                                             \u2503');
  console.log('\u2503     Username: admin                                          \u2503');
  console.log('\u2503     Password: brio2026                                       \u2503');
  console.log('\u2503                                                              \u2503');
  console.log('\u2517\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u251B');
  console.log('');
});

export default app;
