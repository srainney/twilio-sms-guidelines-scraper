"use strict";

exports.handler = async function (context, event, callback) {
  const axios = require("axios");
  const cheerio = require("cheerio");

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
  // This returns a flat object containing the key/value pairs as scraped from HTML.
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
                // Use text from a <b>, if present, otherwise plain text.
                let headerText = $(th).find("b").text().trim() || $(th).text().trim();
                headers.push(headerText);
              });
              
            if (headers.length > 1) {
              // Multi-category table: first header cell defines the base key for each row.
              const categories = headers.slice(1);
              $(table)
                .find("tr")
                .each((k, row) => {
                  const cols = $(row).find("td");
                  if (cols.length === headers.length) {
                    const mainKey = $(cols[0]).find("b").text().trim() ||
                      $(cols[0]).text().trim();
                    categories.forEach((category, index) => {
                      // Build a composite key: "Category - MainKey"
                      const subKey = `${category} - ${mainKey}`;
                      const value = $(cols[index + 1]).text().trim();
                      scrapedData[subKey] = value;
                    });
                  }
                });
            } else {
              // Two-column table format.
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
  
  // This function:
  //   A. Removes any leading dash with surrounding whitespace from each key.
  //   B. Splits keys into "main" (without " - ") and "grouped" keys (with " - ").
  //   C. Orders keys using a fixed order for main fields and for known groups.
  function postProcessData(data) {
    if (!data) return data;
    
    // Remove any leading dash and surrounding whitespace.
    const cleaned = {};
    Object.keys(data).forEach(origKey => {
      // Use a regex to remove any whitespace, dash, and subsequent whitespace at the start.
      let newKey = origKey.replace(/^\s*-\s*/, "").trim();
      cleaned[newKey] = data[origKey];
    });
    
    // Separate keys into main (no " - " in key) and grouped (keys that include " - ").
    const mainKeys = {};
    const groupKeys = {}; // groupName -> { key: value, ... }
    
    Object.keys(cleaned).forEach(key => {
      if (key.includes(" - ")) {
        // Grouping by the text before the first dash.
        const groupName = key.split(" - ")[0].trim();
        if (!groupKeys[groupName]) {
          groupKeys[groupName] = {};
        }
        groupKeys[groupName][key] = cleaned[key];
      } else {
        mainKeys[key] = cleaned[key];
      }
    });
    
    // Fixed order for main keys.
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
    
    // Build the final ordered object.
    const ordered = {};
    // Insert main keys in fixed order, then remaining main keys alphabetically.
    mainOrder.forEach(key => {
      if (key in mainKeys) {
        ordered[key] = mainKeys[key];
        delete mainKeys[key];
      }
    });
    Object.keys(mainKeys).sort().forEach(key => {
      ordered[key] = mainKeys[key];
    });
    
    // Define a fixed group order for known group names.
    const groupOrderKnown = [
      "International Pre-registration",
      "Domestic Pre-registration",
      "Dynamic",
      "Long code domestic",
      "Long code international",
      "Short code"
    ];
    
    // Order groups: first known, then any others alphabetically.
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
    
    // For each group, sort the keys alphabetically.
    Object.keys(orderedGroups).forEach(groupName => {
      const sortedGroup = {};
      Object.keys(orderedGroups[groupName]).sort().forEach(key => {
        sortedGroup[key] = orderedGroups[groupName][key];
      });
      orderedGroups[groupName] = sortedGroup;
    });
    
    // Append grouped keys to the ordered object.
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
  
  // This function looks up an Airtable record by ISO code, and then either updates the record
  // or creates a new record if a match does not exist. All fields in finalData are passed, meaning
  // that if new fields are introduced, they are included.
  async function updateOrCreateAirtableRecord(finalData) {
    // Make sure we have a record to work with.
    const isoCode = finalData["ISO code"];
    if (!isoCode) {
      console.error("No ISO code found in scraped data. Skipping record.");
      return;
    }
    
    // Set your Airtable config from context/environment variables.
    const baseId = context.AIRTABLE_BASE_ID;             // e.g., "appXXXXXXXXXXXXXX"
    const tableName = context.AIRTABLE_TABLE_NAME;         // e.g., "Countries"
    const airtableToken = context.AIRTABLE_API_TOKEN;        // Your personal access token

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
      // Search for an existing record matching the ISO code.
      // The formula searches records where the "ISO code" field exactly matches.
      // Make sure that field’s name in Airtable is exactly "ISO code".
      const filter = `?filterByFormula={ISO code}='${isoCode}'`;
      const searchUrl = airtableUrlBase + filter;
      const searchResponse = await axios.get(searchUrl, { headers });
      
      if (searchResponse.data.records && searchResponse.data.records.length > 0) {
        // Record exists – update it.
        const recordId = searchResponse.data.records[0].id;
        const updateUrl = `${airtableUrlBase}/${recordId}`;
        const updateData = {
          fields: finalData
        };
        console.log(`Updating Airtable record for ISO code ${isoCode} (Record ID: ${recordId})`);
        await axios.patch(updateUrl, updateData, { headers });
      } else {
        // No record found – create a new one.
        const createData = {
          fields: finalData
        };
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
        // Update (or create) the record in Airtable.
        await updateOrCreateAirtableRecord(finalData);
      } catch (err) {
        console.error(`Error processing country ${code}:`, err.message);
      }
    }
  }

  try {
    await main();
    return callback(null, { message: "Scraping completed and Airtable records updated. Check logs for details." });
  } catch (err) {
    console.error("An error occurred in main:", err);
    return callback(err);
  }
};