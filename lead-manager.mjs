#!/usr/bin/env node

/**
 * Brio Nettoyage - Complete Lead Management System
 * 
 * Handles:
 * - Lead lifecycle management
 * - DNC (Do Not Call) list
 * - Call outcome tracking
 * - Auto lead assignment
 * - Callback scheduling
 * - Deduplication across campaigns
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const CONFIG_PATH = join(__dirname, 'config.json');
const DNC_PATH = join(__dirname, 'dnc-list.json');
const LEADS_POOL_PATH = join(__dirname, 'leads-pool.json');

// Load config
function loadConfig() {
  if (existsSync(CONFIG_PATH)) {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  }
  throw new Error('Config not found. Run the app first to create config.');
}

const config = loadConfig();

// Airtable helper
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

// ============== DNC (DO NOT CALL) LIST MANAGEMENT ==============

const DNC = {
  load() {
    if (existsSync(DNC_PATH)) {
      return JSON.parse(readFileSync(DNC_PATH, 'utf-8'));
    }
    return { phones: {}, lastUpdated: null };
  },

  save(data) {
    data.lastUpdated = new Date().toISOString();
    writeFileSync(DNC_PATH, JSON.stringify(data, null, 2));
  },

  // Normalize phone number for matching
  normalizePhone(phone) {
    if (!phone) return null;
    return phone.replace(/\D/g, '').slice(-10); // Last 10 digits
  },

  // Check if phone is on DNC list
  isBlocked(phone) {
    const data = this.load();
    const normalized = this.normalizePhone(phone);
    return normalized ? !!data.phones[normalized] : false;
  },

  // Add phone to DNC list
  add(phone, reason = 'Not interested', source = 'manual') {
    const data = this.load();
    const normalized = this.normalizePhone(phone);
    if (normalized) {
      data.phones[normalized] = {
        originalPhone: phone,
        reason,
        source,
        addedAt: new Date().toISOString()
      };
      this.save(data);
      return true;
    }
    return false;
  },

  // Remove phone from DNC list
  remove(phone) {
    const data = this.load();
    const normalized = this.normalizePhone(phone);
    if (normalized && data.phones[normalized]) {
      delete data.phones[normalized];
      this.save(data);
      return true;
    }
    return false;
  },

  // Get all DNC entries
  getAll() {
    return this.load().phones;
  },

  // Get count
  count() {
    return Object.keys(this.load().phones).length;
  },

  // Sync DNC list to Airtable (optional)
  async syncToAirtable() {
    const data = this.load();
    const phones = Object.entries(data.phones);
    
    console.log(`Syncing ${phones.length} DNC entries to Airtable...`);
    
    // Create DNC table records
    const records = phones.map(([normalized, info]) => ({
      fields: {
        'Phone': info.originalPhone,
        'Reason': info.reason,
        'Source': info.source,
        'Added Date': info.addedAt
      }
    }));

    // Batch create
    for (let i = 0; i < records.length; i += 10) {
      const batch = records.slice(i, i + 10);
      try {
        await airtableRequest('/DNC List', {
          method: 'POST',
          body: JSON.stringify({ records: batch })
        });
      } catch (e) {
        // Table might not exist, that's ok
        console.log('DNC table might not exist:', e.message);
      }
    }
  }
};

// ============== LEAD POOL MANAGEMENT ==============

const LeadPool = {
  load() {
    if (existsSync(LEADS_POOL_PATH)) {
      return JSON.parse(readFileSync(LEADS_POOL_PATH, 'utf-8'));
    }
    return { 
      phones: {}, // Track all scraped phone numbers
      lastScrape: null,
      totalScraped: 0,
      totalImported: 0,
      totalDuplicates: 0
    };
  },

  save(data) {
    writeFileSync(LEADS_POOL_PATH, JSON.stringify(data, null, 2));
  },

  // Check if phone already exists (prevents duplicates)
  exists(phone) {
    const data = this.load();
    const normalized = DNC.normalizePhone(phone);
    return normalized ? !!data.phones[normalized] : false;
  },

  // Add phone to tracking
  track(phone, leadId, campaign) {
    const data = this.load();
    const normalized = DNC.normalizePhone(phone);
    if (normalized) {
      data.phones[normalized] = {
        leadId,
        campaign,
        firstSeenAt: new Date().toISOString()
      };
      this.save(data);
    }
  },

  // Get stats
  getStats() {
    const data = this.load();
    return {
      uniquePhones: Object.keys(data.phones).length,
      lastScrape: data.lastScrape,
      totalScraped: data.totalScraped,
      totalImported: data.totalImported,
      totalDuplicates: data.totalDuplicates
    };
  },

  // Update scrape stats
  updateScrapeStats(scraped, imported, duplicates) {
    const data = this.load();
    data.lastScrape = new Date().toISOString();
    data.totalScraped += scraped;
    data.totalImported += imported;
    data.totalDuplicates += duplicates;
    this.save(data);
  }
};

// ============== LEAD VALIDATION ==============

const LeadValidator = {
  // Validate a lead before import
  validate(lead) {
    const errors = [];
    const warnings = [];

    // Required fields
    if (!lead.name) errors.push('Missing company name');
    if (!lead.phone) errors.push('Missing phone number');

    // Check DNC
    if (lead.phone && DNC.isBlocked(lead.phone)) {
      errors.push('Phone is on DNC list');
    }

    // Check duplicates
    if (lead.phone && LeadPool.exists(lead.phone)) {
      warnings.push('Phone already exists in system');
    }

    // Phone format validation
    if (lead.phone) {
      const normalized = DNC.normalizePhone(lead.phone);
      if (!normalized || normalized.length < 10) {
        errors.push('Invalid phone number format');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  },

  // Filter and validate a batch of leads
  filterBatch(leads) {
    const valid = [];
    const invalid = [];
    const duplicates = [];

    for (const lead of leads) {
      const result = this.validate(lead);
      
      if (!result.valid) {
        invalid.push({ lead, errors: result.errors });
      } else if (result.warnings.includes('Phone already exists in system')) {
        duplicates.push(lead);
      } else {
        valid.push(lead);
      }
    }

    return { valid, invalid, duplicates };
  }
};

// ============== CALL OUTCOME PROCESSING ==============

const CallOutcomes = {
  // Process call outcome and update lead status
  async processOutcome(callId, outcome, notes = '') {
    const outcomeActions = {
      'interested': {
        leadStatus: 'Qualified',
        action: 'schedule_followup',
        dnc: false
      },
      'not_interested': {
        leadStatus: 'Not Interested',
        action: 'add_to_dnc',
        dnc: true,
        dncReason: 'Customer requested no calls'
      },
      'no_answer': {
        leadStatus: 'No Answer',
        action: 'schedule_callback',
        dnc: false,
        callbackDays: 1
      },
      'voicemail': {
        leadStatus: 'Voicemail Left',
        action: 'schedule_callback',
        dnc: false,
        callbackDays: 2
      },
      'wrong_number': {
        leadStatus: 'Invalid',
        action: 'mark_invalid',
        dnc: true,
        dncReason: 'Wrong/invalid number'
      },
      'callback_requested': {
        leadStatus: 'Callback Scheduled',
        action: 'schedule_callback',
        dnc: false,
        callbackDays: 0 // Same day or specified date
      },
      'busy': {
        leadStatus: 'Call Later',
        action: 'schedule_callback',
        dnc: false,
        callbackDays: 0.25 // 6 hours
      }
    };

    const config = outcomeActions[outcome];
    if (!config) {
      throw new Error(`Unknown outcome: ${outcome}`);
    }

    // Get call details from Airtable
    // This would need the call-to-lead mapping

    return {
      outcome,
      leadStatus: config.leadStatus,
      action: config.action,
      dnc: config.dnc,
      dncReason: config.dncReason,
      callbackDays: config.callbackDays,
      notes
    };
  },

  // Get outcome statistics
  async getStats(days = 7) {
    // This would query Airtable for call outcomes
    return {
      total: 0,
      interested: 0,
      notInterested: 0,
      noAnswer: 0,
      voicemail: 0,
      wrongNumber: 0,
      callback: 0,
      conversionRate: 0
    };
  }
};

// ============== AGENT ASSIGNMENT ==============

const AgentAssignment = {
  // Round-robin assignment
  async assignLeadsToAgents(leads, agentIds) {
    const assignments = [];
    
    for (let i = 0; i < leads.length; i++) {
      const agentIndex = i % agentIds.length;
      assignments.push({
        leadId: leads[i].id,
        agentId: agentIds[agentIndex]
      });
    }

    return assignments;
  },

  // Load-balanced assignment (based on current workload)
  async assignBalanced(leads, agents) {
    // Sort agents by current lead count (ascending)
    const sortedAgents = [...agents].sort((a, b) => 
      (a.currentLeads || 0) - (b.currentLeads || 0)
    );

    const assignments = [];
    
    for (let i = 0; i < leads.length; i++) {
      // Always assign to agent with fewest leads
      const agent = sortedAgents[0];
      assignments.push({
        leadId: leads[i].id,
        agentId: agent.id
      });
      
      // Increment and re-sort
      agent.currentLeads = (agent.currentLeads || 0) + 1;
      sortedAgents.sort((a, b) => (a.currentLeads || 0) - (b.currentLeads || 0));
    }

    return assignments;
  }
};

// ============== LEAD PIPELINE HEALTH ==============

const PipelineHealth = {
  async check() {
    const stats = LeadPool.getStats();
    const dncCount = DNC.count();

    // Get leads from Airtable
    let availableLeads = 0;
    let pendingCallbacks = 0;

    try {
      // Count available leads (New status)
      const newLeads = await airtableRequest(
        `/Leads?filterByFormula=OR({Status}="New",{Status}="Queued")&maxRecords=1000`
      );
      availableLeads = newLeads.records?.length || 0;

      // Count pending callbacks
      const callbacks = await airtableRequest(
        `/Leads?filterByFormula=OR({Status}="Callback Scheduled",{Status}="No Answer")&maxRecords=1000`
      );
      pendingCallbacks = callbacks.records?.length || 0;

    } catch (e) {
      console.log('Could not fetch lead counts:', e.message);
    }

    const health = {
      availableLeads,
      pendingCallbacks,
      uniquePhonesTracked: stats.uniquePhones,
      dncListSize: dncCount,
      lastScrape: stats.lastScrape,
      
      // Alerts
      alerts: []
    };

    // Generate alerts
    if (availableLeads < 100) {
      health.alerts.push({
        level: 'critical',
        message: `Only ${availableLeads} leads available! Need to scrape more.`
      });
    } else if (availableLeads < 500) {
      health.alerts.push({
        level: 'warning',
        message: `Lead pool running low: ${availableLeads} available.`
      });
    }

    if (pendingCallbacks > 100) {
      health.alerts.push({
        level: 'warning',
        message: `${pendingCallbacks} callbacks pending. Consider following up.`
      });
    }

    // Calculate daily capacity
    const dailyCallTarget = 1000;
    const daysOfLeads = Math.floor(availableLeads / dailyCallTarget);
    health.daysOfLeadsRemaining = daysOfLeads;

    if (daysOfLeads < 2) {
      health.alerts.push({
        level: 'critical',
        message: `Only ${daysOfLeads} day(s) of leads remaining at current pace!`
      });
    }

    return health;
  },

  // Auto-scrape trigger
  async shouldAutoScrape(threshold = 500) {
    const health = await this.check();
    return health.availableLeads < threshold;
  }
};

// ============== EXPORT API ==============

export {
  DNC,
  LeadPool,
  LeadValidator,
  CallOutcomes,
  AgentAssignment,
  PipelineHealth,
  airtableRequest
};

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'health':
      console.log('\n📊 Pipeline Health Check\n');
      const health = await PipelineHealth.check();
      console.log(`Available Leads: ${health.availableLeads}`);
      console.log(`Pending Callbacks: ${health.pendingCallbacks}`);
      console.log(`DNC List Size: ${health.dncListSize}`);
      console.log(`Days of Leads: ${health.daysOfLeadsRemaining}`);
      console.log('\nAlerts:');
      health.alerts.forEach(a => console.log(`  [${a.level.toUpperCase()}] ${a.message}`));
      break;

    case 'dnc':
      const dncAction = args[1];
      const phone = args[2];
      
      if (dncAction === 'add' && phone) {
        DNC.add(phone, args[3] || 'Manual add');
        console.log(`Added ${phone} to DNC list`);
      } else if (dncAction === 'check' && phone) {
        console.log(`${phone} is ${DNC.isBlocked(phone) ? 'BLOCKED' : 'not blocked'}`);
      } else if (dncAction === 'count') {
        console.log(`DNC list has ${DNC.count()} entries`);
      } else {
        console.log('Usage: node lead-manager.mjs dnc [add|check|count] [phone] [reason]');
      }
      break;

    case 'stats':
      console.log('\n📈 Lead Pool Statistics\n');
      const stats = LeadPool.getStats();
      console.log(`Unique Phones Tracked: ${stats.uniquePhones}`);
      console.log(`Total Scraped: ${stats.totalScraped}`);
      console.log(`Total Imported: ${stats.totalImported}`);
      console.log(`Total Duplicates: ${stats.totalDuplicates}`);
      console.log(`Last Scrape: ${stats.lastScrape || 'Never'}`);
      break;

    default:
      console.log(`
Brio Nettoyage - Lead Management System

Commands:
  health          Check pipeline health and alerts
  dnc add <phone> Add phone to DNC list
  dnc check <phone> Check if phone is blocked
  dnc count       Show DNC list size
  stats           Show lead pool statistics
      `);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
