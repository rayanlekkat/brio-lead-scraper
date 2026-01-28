#!/usr/bin/env node

/**
 * Test DataForSEO Connection and Get 1 Lead
 */

import fetch from 'node-fetch';

const LOGIN = 'rayan@accelerateurlocal.ca';
const PASSWORD = 'fee263980a3055a0';

async function testConnection() {
  console.log('🔌 Testing DataForSEO Connection...\n');
  
  const auth = Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');
  
  // Test 1: Check account info
  console.log('1️⃣ Checking account info...');
  try {
    const response = await fetch('https://api.dataforseo.com/v3/appendix/user_data', {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (data.status_code === 20000) {
      console.log('   ✅ Connection successful!');
      const userInfo = data.tasks?.[0]?.result?.[0];
      if (userInfo) {
        console.log(`   💰 Balance: $${userInfo.money?.balance || 0}`);
        console.log(`   📧 Email: ${userInfo.login}`);
      }
    } else {
      console.log('   ❌ Connection failed:', data.status_message);
      return;
    }
  } catch (error) {
    console.log('   ❌ Connection error:', error.message);
    return;
  }

  // Test 2: Get 1 lead from Montreal
  console.log('\n2️⃣ Fetching 1 lead from Montreal...');
  try {
    const searchPayload = [{
      "keyword": "restaurant",
      "location_code": 1001149, // Montreal location code
      "language_code": "en",
      "depth": 1
    }];

    const response = await fetch('https://api.dataforseo.com/v3/business_data/google/my_business_info/live', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(searchPayload)
    });

    const data = await response.json();
    
    if (data.status_code === 20000 && data.tasks?.[0]?.result) {
      const results = data.tasks[0].result;
      console.log(`   ✅ Found ${results.length} result(s)`);
      
      if (results.length > 0) {
        const lead = results[0];
        console.log('\n📍 LEAD FOUND:');
        console.log('   ─────────────────────────────────');
        console.log(`   🏢 Name: ${lead.title || 'N/A'}`);
        console.log(`   📞 Phone: ${lead.phone || 'N/A'}`);
        console.log(`   🌐 Website: ${lead.url || 'N/A'}`);
        console.log(`   📍 Address: ${lead.address || 'N/A'}`);
        console.log(`   ⭐ Rating: ${lead.rating?.value || 'N/A'} (${lead.rating?.votes_count || 0} reviews)`);
        console.log(`   📂 Category: ${lead.category || 'N/A'}`);
        console.log('   ─────────────────────────────────');
        
        return lead;
      }
    } else {
      console.log('   ⚠️ No results or error:', data.tasks?.[0]?.status_message || data.status_message);
      
      // Try alternative endpoint - Business Listings Search
      console.log('\n3️⃣ Trying Business Listings Search...');
      
      const searchPayload2 = [{
        "categories": ["restaurant"],
        "description": "restaurant",
        "title": "restaurant",
        "is_claimed": true,
        "location_coordinate": "45.5017,-73.5673,50000", // Montreal coordinates, 50km radius
        "limit": 1
      }];

      const response2 = await fetch('https://api.dataforseo.com/v3/business_data/business_listings/search/live', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(searchPayload2)
      });

      const data2 = await response2.json();
      
      if (data2.status_code === 20000 && data2.tasks?.[0]?.result?.items) {
        const items = data2.tasks[0].result.items;
        console.log(`   ✅ Found ${items.length} result(s)`);
        
        if (items.length > 0) {
          const lead = items[0];
          console.log('\n📍 LEAD FOUND:');
          console.log('   ─────────────────────────────────');
          console.log(`   🏢 Name: ${lead.title || 'N/A'}`);
          console.log(`   📞 Phone: ${lead.phone || 'N/A'}`);
          console.log(`   🌐 Website: ${lead.domain || 'N/A'}`);
          console.log(`   📍 Address: ${lead.address || 'N/A'}`);
          console.log(`   ⭐ Rating: ${lead.rating?.value || 'N/A'} (${lead.rating?.votes_count || 0} reviews)`);
          console.log(`   📂 Category: ${lead.category || 'N/A'}`);
          console.log('   ─────────────────────────────────');
          
          return lead;
        }
      } else {
        console.log('   ⚠️ Business Listings error:', data2.tasks?.[0]?.status_message || data2.status_message);
      }
    }
  } catch (error) {
    console.log('   ❌ Search error:', error.message);
  }

  // Test 3: Try Google Maps search (most reliable)
  console.log('\n4️⃣ Trying Google Maps Search (SERP)...');
  try {
    const mapsPayload = [{
      "keyword": "restaurant montreal",
      "location_code": 2124, // Canada
      "language_code": "en",
      "device": "desktop",
      "os": "windows",
      "depth": 1
    }];

    const response = await fetch('https://api.dataforseo.com/v3/serp/google/maps/live/advanced', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(mapsPayload)
    });

    const data = await response.json();
    
    if (data.status_code === 20000 && data.tasks?.[0]?.result?.[0]?.items) {
      const items = data.tasks[0].result[0].items;
      const localResults = items.filter(i => i.type === 'maps_search');
      
      console.log(`   ✅ Found ${localResults.length} local result(s)`);
      
      if (localResults.length > 0) {
        const lead = localResults[0];
        console.log('\n📍 LEAD FOUND (Google Maps):');
        console.log('   ─────────────────────────────────');
        console.log(`   🏢 Name: ${lead.title || 'N/A'}`);
        console.log(`   📞 Phone: ${lead.phone || 'N/A'}`);
        console.log(`   🌐 Website: ${lead.url || 'N/A'}`);
        console.log(`   📍 Address: ${lead.address || 'N/A'}`);
        console.log(`   ⭐ Rating: ${lead.rating?.value || 'N/A'} (${lead.rating?.votes_count || 0} reviews)`);
        console.log(`   📂 Category: ${lead.category || 'N/A'}`);
        console.log('   ─────────────────────────────────');
        
        return lead;
      }
    } else {
      console.log('   ⚠️ Maps error:', data.tasks?.[0]?.status_message || data.status_message);
    }
  } catch (error) {
    console.log('   ❌ Maps error:', error.message);
  }

  console.log('\n✅ Test complete!');
}

testConnection().catch(console.error);
