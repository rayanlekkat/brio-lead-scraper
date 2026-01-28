#!/usr/bin/env node

/**
 * DataForSEO API Client
 * 
 * Based on official documentation: https://docs.dataforseo.com/v3/
 * 
 * Supports:
 * - SERP API > Google Maps (best for local leads)
 * - SERP API > Google Local Finder
 * - Business Data API > Business Listings
 * - Business Data API > Google My Business
 * - Business Data API > Google Reviews
 */

import fetch from 'node-fetch';

export class DataForSEOClient {
  constructor(login, password) {
    this.login = login;
    this.password = password;
    this.baseUrl = 'https://api.dataforseo.com/v3';
    this.auth = Buffer.from(`${login}:${password}`).toString('base64');
  }

  /**
   * Make authenticated request to DataForSEO API
   */
  async request(endpoint, method = 'POST', body = null) {
    const url = `${this.baseUrl}${endpoint}`;
    
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

    const response = await fetch(url, options);
    const data = await response.json();

    if (data.status_code !== 20000) {
      throw new Error(`DataForSEO Error: ${data.status_message || 'Unknown error'}`);
    }

    return data;
  }

  // ============== ACCOUNT INFO ==============

  /**
   * Get account information and balance
   * Docs: https://docs.dataforseo.com/v3/appendix/user_data/
   */
  async getUserData() {
    const data = await this.request('/appendix/user_data', 'GET');
    return data.tasks?.[0]?.result?.[0];
  }

  // ============== SERP API - GOOGLE MAPS ==============
  // Best for local business scraping with phone numbers
  // Docs: https://docs.dataforseo.com/v3/serp/google/maps/live/advanced/

  /**
   * Search Google Maps for local businesses
   * @param {Object} params
   * @param {string} params.keyword - Search query (e.g., "restaurants montreal")
   * @param {number} params.locationCode - Location code (2124 = Canada)
   * @param {string} params.languageCode - Language (default: "en")
   * @param {number} params.depth - Number of results (1-700)
   */
  async searchGoogleMaps(params) {
    const {
      keyword,
      locationCode = 2124, // Canada
      languageCode = 'en',
      depth = 20
    } = params;

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
    
    // Extract business data from maps_search results
    return items
      .filter(item => item.type === 'maps_search')
      .map(item => ({
        id: item.place_id || item.cid,
        name: item.title,
        phone: item.phone,
        website: item.url,
        address: item.address,
        addressInfo: item.address_info,
        rating: item.rating?.value,
        reviewsCount: item.rating?.votes_count,
        category: item.category,
        categoryIds: item.category_ids,
        hours: item.work_hours,
        workTime: item.work_time,
        coordinates: {
          lat: item.latitude,
          lng: item.longitude
        },
        isClaimed: item.is_claimed,
        placeId: item.place_id,
        cid: item.cid,
        dataAttid: item.data_attid
      }));
  }

  // ============== SERP API - GOOGLE LOCAL FINDER ==============
  // Alternative for local businesses
  // Docs: https://docs.dataforseo.com/v3/serp/google/local_finder/live/advanced/

  /**
   * Search Google Local Finder
   */
  async searchLocalFinder(params) {
    const {
      keyword,
      locationCode = 2124,
      languageCode = 'en',
      depth = 20
    } = params;

    const payload = [{
      keyword,
      location_code: locationCode,
      language_code: languageCode,
      depth
    }];

    const data = await this.request('/serp/google/local_finder/live/advanced', 'POST', payload);
    
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
        placeId: item.place_id,
        cid: item.cid
      }));
  }

  // ============== BUSINESS DATA API - BUSINESS LISTINGS ==============
  // Large database of pre-scraped businesses
  // Docs: https://docs.dataforseo.com/v3/business_data/business_listings/search/

  /**
   * Get available business listing categories
   * Docs: https://docs.dataforseo.com/v3/business_data/business_listings/categories/
   */
  async getBusinessListingsCategories() {
    const data = await this.request('/business_data/business_listings/categories', 'GET');
    return data.tasks?.[0]?.result || [];
  }

  /**
   * Search Business Listings Database
   * @param {Object} params
   * @param {string} params.categories - Category filter (e.g., ["restaurant"])
   * @param {string} params.locationCoordinate - "lat,lng,radius" (e.g., "45.5017,-73.5673,10000")
   * @param {number} params.limit - Max results (default: 100)
   * @param {Object} params.filters - Additional filters
   */
  async searchBusinessListings(params) {
    const {
      categories,
      locationCoordinate,
      country,
      limit = 100,
      offset = 0,
      filters
    } = params;

    const payload = [{
      categories: Array.isArray(categories) ? categories : [categories],
      limit,
      offset
    }];

    if (locationCoordinate) {
      payload[0].location_coordinate = locationCoordinate;
    }

    if (country) {
      payload[0].country = country;
    }

    if (filters) {
      payload[0].filters = filters;
    }

    const data = await this.request('/business_data/business_listings/search/live', 'POST', payload);
    
    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    
    return items.map(item => ({
      id: item.place_id,
      name: item.title,
      phone: item.phone,
      website: item.domain,
      address: item.address,
      addressInfo: item.address_info,
      rating: item.rating?.value,
      reviewsCount: item.rating?.votes_count,
      category: item.category,
      categoryIds: item.category_ids,
      coordinates: {
        lat: item.latitude,
        lng: item.longitude
      },
      isClaimed: item.is_claimed,
      placeId: item.place_id
    }));
  }

  // ============== BUSINESS DATA API - GOOGLE MY BUSINESS ==============
  // Detailed business profile info
  // Docs: https://docs.dataforseo.com/v3/business_data/google/my_business_info/live/

  /**
   * Get detailed Google My Business info
   * @param {Object} params
   * @param {string} params.keyword - Business name or search query
   * @param {number} params.locationCode - Location code
   */
  async getGoogleMyBusinessInfo(params) {
    const {
      keyword,
      locationCode = 2124,
      languageCode = 'en'
    } = params;

    const payload = [{
      keyword,
      location_code: locationCode,
      language_code: languageCode
    }];

    const data = await this.request('/business_data/google/my_business_info/live', 'POST', payload);
    
    return data.tasks?.[0]?.result || [];
  }

  // ============== BUSINESS DATA API - GOOGLE REVIEWS ==============
  // Get business reviews
  // Docs: https://docs.dataforseo.com/v3/business_data/google/reviews/task_post/

  /**
   * Get Google Reviews for a business
   * @param {string} keyword - Business name
   * @param {number} locationCode - Location code
   * @param {number} depth - Number of reviews to fetch
   */
  async getGoogleReviews(keyword, locationCode = 2124, depth = 10) {
    const payload = [{
      keyword,
      location_code: locationCode,
      language_code: 'en',
      depth
    }];

    const data = await this.request('/business_data/google/reviews/task_post', 'POST', payload);
    return data;
  }

  // ============== LOCATION CODES ==============
  // Docs: https://docs.dataforseo.com/v3/serp/google/locations/

  /**
   * Get available locations for SERP API
   * @param {string} country - Country filter (e.g., "Canada")
   */
  async getLocations(country = null) {
    let endpoint = '/serp/google/locations';
    if (country) {
      endpoint += `?country=${encodeURIComponent(country)}`;
    }
    
    const data = await this.request(endpoint, 'GET');
    return data.tasks?.[0]?.result || [];
  }

  // ============== HELPER METHODS ==============

  /**
   * Search leads in a specific neighborhood/area
   * @param {Object} params
   * @param {string} params.category - Business category
   * @param {string} params.location - Location string (e.g., "Plateau Mont-Royal, Montreal")
   * @param {number} params.limit - Max results
   */
  async searchLeadsByLocation(params) {
    const {
      category,
      location,
      limit = 50,
      minRating = 0
    } = params;

    // Use Google Maps search with location in keyword
    const keyword = `${category} ${location}`;
    
    const results = await this.searchGoogleMaps({
      keyword,
      locationCode: 2124, // Canada
      languageCode: 'en',
      depth: Math.min(limit * 2, 100) // Get extra to filter
    });

    // Filter by rating if specified
    let filtered = results;
    if (minRating > 0) {
      filtered = results.filter(r => (r.rating || 0) >= minRating);
    }

    // Filter to only those with phone numbers
    filtered = filtered.filter(r => r.phone);

    return filtered.slice(0, limit);
  }

  /**
   * Search leads by coordinates (radius search)
   * @param {Object} params
   * @param {string} params.category - Business category
   * @param {number} params.lat - Latitude
   * @param {number} params.lng - Longitude
   * @param {number} params.radiusMeters - Search radius in meters
   * @param {number} params.limit - Max results
   */
  async searchLeadsByCoordinates(params) {
    const {
      category,
      lat,
      lng,
      radiusMeters = 5000,
      limit = 100
    } = params;

    const locationCoordinate = `${lat},${lng},${radiusMeters}`;

    return await this.searchBusinessListings({
      categories: [category],
      locationCoordinate,
      limit
    });
  }

  /**
   * Calculate lead score based on business data
   */
  calculateLeadScore(business) {
    let score = 0;

    // Has phone (essential for cold calling)
    if (business.phone) score += 25;

    // Has website (indicates established business)
    if (business.website) score += 15;

    // Rating score (0-30 points)
    if (business.rating) {
      score += Math.min(30, business.rating * 6);
    }

    // Review count (0-20 points)
    if (business.reviewsCount) {
      if (business.reviewsCount > 100) score += 20;
      else if (business.reviewsCount > 50) score += 15;
      else if (business.reviewsCount > 20) score += 10;
      else if (business.reviewsCount > 5) score += 5;
    }

    // Is claimed (indicates active management)
    if (business.isClaimed) score += 10;

    return Math.min(100, Math.round(score));
  }
}

// ============== LOCATION CODES REFERENCE ==============
export const LOCATION_CODES = {
  // Canada
  CANADA: 2124,
  MONTREAL: 1001149,
  TORONTO: 1002291,
  VANCOUVER: 1002414,
  QUEBEC_CITY: 1002150,
  OTTAWA: 1002068,
  CALGARY: 1000665,
  
  // USA
  USA: 2840,
  NEW_YORK: 1023191,
  LOS_ANGELES: 1013962,
  CHICAGO: 1016367,
  
  // France
  FRANCE: 2250,
  PARIS: 1006094
};

// ============== CATEGORY EXAMPLES ==============
export const COMMON_CATEGORIES = [
  'restaurant',
  'cleaning service',
  'commercial cleaning',
  'office cleaning',
  'medical clinic',
  'dental office',
  'gym',
  'fitness center',
  'hair salon',
  'beauty salon',
  'real estate agency',
  'hotel',
  'school',
  'daycare',
  'retail store',
  'auto repair',
  'plumber',
  'electrician',
  'landscaping',
  'construction company'
];

// ============== TEST / CLI ==============
async function main() {
  const args = process.argv.slice(2);
  
  // Load config
  const { readFileSync, existsSync } = await import('fs');
  const { join, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const configPath = join(__dirname, 'config.json');
  
  if (!existsSync(configPath)) {
    console.error('Config file not found. Please run the app first.');
    process.exit(1);
  }
  
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  
  if (!config.dataforseo?.login || !config.dataforseo?.password) {
    console.error('DataForSEO credentials not configured.');
    process.exit(1);
  }
  
  const client = new DataForSEOClient(config.dataforseo.login, config.dataforseo.password);
  
  const command = args[0];
  
  switch (command) {
    case 'balance':
      console.log('Checking account balance...\n');
      const userData = await client.getUserData();
      console.log(`Balance: $${userData.money?.balance || 0}`);
      console.log(`Login: ${userData.login}`);
      break;
      
    case 'search':
      const category = args[1] || 'restaurant';
      const location = args[2] || 'Montreal';
      const limit = parseInt(args[3]) || 10;
      
      console.log(`\nSearching for "${category}" in "${location}" (limit: ${limit})...\n`);
      
      const leads = await client.searchLeadsByLocation({
        category,
        location,
        limit
      });
      
      console.log(`Found ${leads.length} leads with phone numbers:\n`);
      
      leads.forEach((lead, i) => {
        const score = client.calculateLeadScore(lead);
        console.log(`${i + 1}. ${lead.name}`);
        console.log(`   Phone: ${lead.phone}`);
        console.log(`   Address: ${lead.address}`);
        console.log(`   Rating: ${lead.rating || 'N/A'} (${lead.reviewsCount || 0} reviews)`);
        console.log(`   Score: ${score}/100`);
        console.log('');
      });
      break;
      
    case 'categories':
      console.log('Fetching business categories...\n');
      const categories = await client.getBusinessListingsCategories();
      console.log(`Found ${categories.length} categories`);
      categories.slice(0, 50).forEach(cat => console.log(`- ${cat}`));
      break;
      
    case 'locations':
      const country = args[1] || 'Canada';
      console.log(`Fetching locations for ${country}...\n`);
      const locations = await client.getLocations(country);
      console.log(`Found ${locations.length} locations`);
      locations.slice(0, 20).forEach(loc => {
        console.log(`- ${loc.location_name} (code: ${loc.location_code})`);
      });
      break;
      
    default:
      console.log(`
DataForSEO Client - Based on https://docs.dataforseo.com/v3/

Commands:
  balance                        Check account balance
  search <category> <location> [limit]   Search for leads
  categories                     List business categories
  locations [country]            List location codes

Examples:
  node dataforseo-client.mjs balance
  node dataforseo-client.mjs search "restaurant" "Montreal" 20
  node dataforseo-client.mjs search "cleaning service" "Plateau Mont-Royal, Montreal" 10
  node dataforseo-client.mjs locations Canada
      `);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
