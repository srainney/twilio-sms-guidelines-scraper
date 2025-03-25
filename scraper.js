"use strict";

const axios = require("axios");
const cheerio = require("cheerio");

console.log("running the scraper now");

// --------------------------------------------------------------------------
// 1. Scraping functions – return exactly what the HTML provides.
// --------------------------------------------------------------------------

// Retrieve the list of country codes from the Twilio guidelines landing page.
async function getCountryCodes() {
  const landingUrl = "https://www.twilio.com/en-us/guidelines/sms";
  try {
    const res = await axios.get(landingUrl);
    const $ = cheerio.load(res.data);
    const codes = [];
    $("a.card-icon__overlay").each((i, el) => {
      const href = $(el).attr("href");
      if (href) {
        const parts = href.split("/");
        if (parts.length >= 5) {
          const code = parts[3];
          if (code && !codes.includes(code)) {
            codes.push(code);
          }
        }
      }
    });
    console.log("Dynamically retrieved country codes:", codes);
    return codes;
  } catch (error) {
    console.error("Error retrieving country codes:", error.message);
    return [];
  }
}

// Scrape guideline tables for a given country code.
async function scrapeCountry(code) {
  const url = `https://www.twilio.com/en-us/guidelines/${code}/sms`;
  try {
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);
    let scrapedData = {};
    
    // Process all tables in the "guideline-tables" section.
    $("section#guideline-tables").each((i, section) => {
      $(section)
        .find("table")
        .each((j, table) => {
          const headers = [];
          $(table)
            .find("th")
            .each((k, th) => {
              let headerText = $(th).find("b").text().trim() || $(th).text().trim();
              headers.push(headerText);
            });
            
          if (headers.length > 1) {
            const categories = headers.slice(1);
            $(table)
              .find("tr")
              .each((k, row) => {
                const cols = $(row).find("td");
                if (cols.length === headers.length) {
                  const mainKey = $(cols[0]).find("b").text().trim() ||
                    $(cols[0]).text().trim();
                  categories.forEach((category, index) => {
                    const subKey = `${category} - ${mainKey}`;
                    const value = $(cols[index + 1]).text().trim();
                    scrapedData[subKey] = value;
                  });
                }
              });
          } else {
            $(table)
              .find("tr")
              .each((k, row) => {
                const cols = $(row).find("td");
                if (cols.length === 2) {
                  const key = $(cols[0]).find("b").text().trim() || $(cols[0]).text().trim();
                  const value = $(cols[1]).text().trim();
                  scrapedData[key] = value;
                }
              });
          }
        });
    });
    
    return scrapedData;
  } catch (error) {
    console.error(`Error scraping country ${code}:`, error.message);
    return null;
  }
}

// --------------------------------------------------------------------------
// 2. Post-processing: clean keys and group them.
// --------------------------------------------------------------------------
function postProcessData(data) {
  if (!data) return data;
  
  const cleaned = {};
  Object.keys(data).forEach(origKey => {
    let newKey = origKey.replace(/^\s*-\s*/, "").trim();
    cleaned[newKey] = data[origKey];
  });
  
  const mainKeys = {};
  const groupKeys = {};
  
  Object.keys(cleaned).forEach(key => {
    if (key.includes(" - ")) {
      const groupName = key.split(" - ")[0].trim();
      if (!groupKeys[groupName]) {
        groupKeys[groupName] = {};
      }
      groupKeys[groupName][key] = cleaned[key];
    } else {
      mainKeys[key] = cleaned[key];
    }
  });
  
  const mainOrder = [
    "Locale name",
    "ISO code",
    "Region",
    "Mobile country code",
    "Dialing code",
    "Two-way SMS supported",
    "Number portability available",
    "Twilio concatenated message support",
    "Message length",
    "Twilio MMS support",
    "Sending SMS to landline numbers",
    "Compliance considerations"
  ];
  
  const ordered = {};
  mainOrder.forEach(key => {
    if (key in mainKeys) {
      ordered[key] = mainKeys[key];
      delete mainKeys[key];
    }
  });
  Object.keys(mainKeys).sort().forEach(key => {
    ordered[key] = mainKeys[key];
  });
  
  const groupOrderKnown = [
    "International Pre-registration",
    "Domestic Pre-registration",
    "Dynamic",
    "Long code domestic",
    "Long code international",
    "Short code"
  ];
  
  const orderedGroups = {};
  groupOrderKnown.forEach(groupName => {
    if (groupName in groupKeys) {
      orderedGroups[groupName] = groupKeys[groupName];
      delete groupKeys[groupName];
    }
  });
  Object.keys(groupKeys).sort().forEach(groupName => {
    orderedGroups[groupName] = groupKeys[groupName];
  });
  
  Object.keys(orderedGroups).forEach(groupName => {
    const sortedGroup = {};
    Object.keys(orderedGroups[groupName]).sort().forEach(key => {
      sortedGroup[key] = orderedGroups[groupName][key];
    });
    orderedGroups[groupName] = sortedGroup;
  });
  
  Object.keys(orderedGroups).forEach(groupName => {
    const groupObj = orderedGroups[groupName];
    Object.keys(groupObj).forEach(key => {
      ordered[key] = groupObj[key];
    });
  });
  
  return ordered;
}

// --------------------------------------------------------------------------
// 3. Airtable Update Helpers
// --------------------------------------------------------------------------
async function updateOrCreateAirtableRecord(finalData) {
  const isoCode = finalData["ISO code"];
  if (!isoCode) {
    console.error("No ISO code found in scraped data. Skipping record.");
    return;
  }
  
  // Now using process.env since we’re running locally.
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME;
  const airtableToken = process.env.AIRTABLE_API_TOKEN;

  if (!baseId || !tableName || !airtableToken) {
    console.error("Missing Airtable configuration. Please set AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME, and AIRTABLE_API_TOKEN.");
    return;
  }
  
  const airtableUrlBase = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;
  const headers = {
    "Authorization": `Bearer ${airtableToken}`,
    "Content-Type": "application/json"
  };
  
  try {
    const filter = `?filterByFormula={ISO code}='${isoCode}'`;
    const searchUrl = airtableUrlBase + filter;
    console.log("Searching Airtable with URL:", searchUrl);
    
    const searchResponse = await axios.get(searchUrl, { headers });
    
    if (searchResponse.data.records && searchResponse.data.records.length > 0) {
      const recordId = searchResponse.data.records[0].id;
      const updateUrl = `${airtableUrlBase}/${recordId}`;
      const updateData = { fields: finalData };
      console.log(`Updating Airtable record for ISO code ${isoCode} (Record ID: ${recordId})`);
      await axios.patch(updateUrl, updateData, { headers });
    } else {
      const createData = { fields: finalData };
      console.log(`Creating new Airtable record for ISO code ${isoCode}`);
      await axios.post(airtableUrlBase, createData, { headers });
    }
  } catch (err) {
    console.error(`Error updating Airtable for ISO code ${isoCode}:`, err.response ? err.response.data : err.message);
  }
}

// --------------------------------------------------------------------------
// 4. Main flow: scrape, post-process, update Airtable, and log.
// --------------------------------------------------------------------------
async function main() {
  const codes = await getCountryCodes();
  if (codes.length === 0) {
    console.error("No country codes retrieved. Aborting.");
    return;
  }
  for (const code of codes) {
    console.log(`\nProcessing country code: ${code}`);
    try {
      const rawData = await scrapeCountry(code);
      if (!rawData) {
        console.warn(`No data returned for country code: ${code}`);
        continue;
      }
      const finalData = postProcessData(rawData);
      console.log(`Scraped data for country (${code}):`, finalData);
      await updateOrCreateAirtableRecord(finalData);
    } catch (err) {
      console.error(`Error processing country ${code}:`, err.message);
    }
  }
}

// Immediately execute the main flow using an IIFE.
(async () => {
  try {
    await main();
    console.log("Scraping completed and Airtable records updated.");
  } catch (err) {
    console.error("An error occurred in main:", err);
    process.exit(1);
  }
})();
