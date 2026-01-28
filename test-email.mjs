// Quick test for email extraction
import fetch from 'node-fetch';

class TestEmailExtractor {
  constructor() {
    this.timeout = 10000;
    
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
      /@exemple\./i,
      /@test\./i,
      /@localhost/i,
      // Image file extensions
      /\.png$/i,
      /\.jpg$/i,
      /\.gif$/i,
      /\.jpeg$/i,
      /\.webp$/i,
      /\.svg$/i,
      // Sentry error tracking domains
      /@sentry\.io$/i,
      /@sentry\.wixpress\.com$/i,
      /@sentry-next\.wixpress\.com$/i,
      /@.*sentry.*\./i,
      /@wixpress\.com$/i,
      // Placeholder patterns
      /^nom@/i,
      /^name@/i,
      /^email@/i,
      /^your[._-]?email@/i,
      /^votre[._-]?courriel@/i,
      // Hex/hash-like tracking IDs
      /^[a-f0-9]{20,}@/i,
      // Website builder/template demo emails
      /@convertus\.com$/i,
      /@dealer\.com$/i,
      /@dealereprocess\.com$/i,
      /@dealerinspire\.com$/i,
      /@dealersocket\.com$/i,
      /^jane@/i,
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
    
    // Priority patterns for good business emails
    this.priorityPatterns = [
      /^[a-z]+\.[a-z]+@/i,
      /^[a-z]+_[a-z]+@/i,
      /^info@/i,
      /^contact@/i,
      /^sales@/i,
      /^ventes@/i,
      /^hello@/i,
      /^bonjour@/i,
      /^direction@/i,
      /^owner@/i,
      /^proprietaire@/i,
      /^manager@/i,
      /^gerant@/i,
      /^commercial@/i,
      /^reception@/i,
      /^admin@/i,
      /^service@/i,
      /^reservation@/i,
    ];
  }

  cleanEmail(email) {
    if (!email) return null;
    
    let cleaned = email.toLowerCase().trim();
    
    // URL decode if needed
    try {
      if (cleaned.includes('%')) {
        cleaned = decodeURIComponent(cleaned);
      }
    } catch (e) {
      cleaned = cleaned.replace(/%22/g, '"').replace(/%20/g, ' ').replace(/%3a/gi, ':');
    }
    
    // Remove artifacts
    cleaned = cleaned
      .replace(/^["\s\\5c]+/gi, '')
      .replace(/["\s\\]+$/, '')
      .replace(/^mailto:/i, '');
    
    // Re-extract email
    const emailMatch = cleaned.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      return emailMatch[1].toLowerCase();
    }
    
    return null;
  }

  extractEmailsFromHTML(html) {
    const emails = new Set();
    
    // mailto: links
    const mailtoRegex = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
    let match;
    while ((match = mailtoRegex.exec(html)) !== null) {
      const cleaned = this.cleanEmail(match[1]);
      if (cleaned) emails.add(cleaned);
    }
    
    // General pattern
    const emailRegex = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/gi;
    while ((match = emailRegex.exec(html)) !== null) {
      const cleaned = this.cleanEmail(match[1]);
      if (cleaned) emails.add(cleaned);
    }
    
    return Array.from(emails);
  }

  filterAndScoreEmails(emails, domain) {
    const scored = [];
    
    for (const email of emails) {
      if (!email || email.length > 100) continue;
      
      // Check skip patterns
      let skip = false;
      let matchedPattern = null;
      for (const pattern of this.skipPatterns) {
        if (pattern.test(email)) {
          skip = true;
          matchedPattern = pattern.toString();
          break;
        }
      }
      
      if (skip) {
        console.log(`  ❌ FILTERED: "${email}" (matched: ${matchedPattern})`);
        continue;
      }
      
      // Calculate score
      let score = 50;
      
      if (domain) {
        const emailDomain = email.split('@')[1];
        const siteDomain = domain.replace(/^www\./, '').toLowerCase();
        if (emailDomain && emailDomain.includes(siteDomain.split('.')[0])) {
          score += 30;
        }
      }
      
      for (const pattern of this.priorityPatterns) {
        if (pattern.test(email)) {
          score += 20;
          break;
        }
      }
      
      const localPart = email.split('@')[0];
      if (localPart.length > 30) score -= 20;
      
      const numberCount = (localPart.match(/\d/g) || []).length;
      if (numberCount > 4) score -= 15;
      
      console.log(`  ✅ ACCEPTED: "${email}" (score: ${score})`);
      scored.push({ email, score });
    }
    
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  getDomain(url) {
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      return parsed.hostname;
    } catch {
      return null;
    }
  }

  async crawlWebsite(url) {
    if (!url) return { emails: [], error: 'No URL provided' };
    
    let normalizedUrl = url;
    if (!normalizedUrl.startsWith('http')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    
    const domain = this.getDomain(normalizedUrl);
    const allEmails = new Set();
    const pagesToCheck = [normalizedUrl];
    
    const contactPaths = ['/contact', '/contact-us', '/contactez-nous', '/nous-joindre'];
    for (const path of contactPaths) {
      try {
        const contactUrl = new URL(path, normalizedUrl).toString();
        pagesToCheck.push(contactUrl);
      } catch {}
    }
    
    console.log(`\n🔍 Crawling: ${url}`);
    console.log(`   Domain: ${domain}`);
    console.log(`   Pages to check: ${pagesToCheck.slice(0, 3).join(', ')}`);
    
    for (const pageUrl of pagesToCheck.slice(0, 3)) {
      try {
        console.log(`\n   📄 Fetching: ${pageUrl}`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        
        const response = await fetch(pageUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
          },
          redirect: 'follow',
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const html = await response.text();
          console.log(`      Status: ${response.status}, HTML length: ${html.length}`);
          const emails = this.extractEmailsFromHTML(html);
          console.log(`      Raw emails found: ${emails.length}`);
          if (emails.length > 0) {
            console.log(`      Emails: ${emails.join(', ')}`);
          }
          emails.forEach(e => allEmails.add(e));
        } else {
          console.log(`      Status: ${response.status} (not OK)`);
        }
      } catch (error) {
        console.log(`      Error: ${error.message}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    console.log(`\n   📊 Total unique emails before filtering: ${allEmails.size}`);
    if (allEmails.size > 0) {
      console.log(`   All found: ${Array.from(allEmails).join(', ')}`);
    }
    
    console.log(`\n   🔎 Filtering emails:`);
    const scored = this.filterAndScoreEmails(Array.from(allEmails), domain);
    
    console.log(`\n   ✨ Final results: ${scored.length} valid emails`);
    if (scored.length > 0) {
      console.log(`   Best email: ${scored[0].email} (score: ${scored[0].score})`);
    }
    
    return {
      emails: scored,
      bestEmail: scored.length > 0 ? scored[0].email : null,
      totalFound: allEmails.size,
    };
  }
}

// Test URLs - real business websites
const testUrls = [
  'brossardhyundai.com',
  'megakiabrossard.com',
  'parkavenueaudi.com',
  'hondabrossard.com',
];

async function runTests() {
  const extractor = new TestEmailExtractor();
  
  console.log('='.repeat(60));
  console.log('EMAIL EXTRACTION TEST');
  console.log('='.repeat(60));
  
  for (const url of testUrls) {
    const result = await extractor.crawlWebsite(url);
    console.log('\n' + '-'.repeat(60));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('TEST COMPLETE');
  console.log('='.repeat(60));
}

runTests();
