import requests
from bs4 import BeautifulSoup
import pandas as pd

country_codes = [
    'af', 'al', 'dz', 'ad', 'ao', 'ag', 'ar', 'am', 'au', 'at',
    'az', 'bs', 'bh', 'bd', 'bb', 'by', 'be', 'bz', 'bj', 'bt',
    'bo', 'ba', 'bw', 'br', 'bn', 'bg', 'bf', 'bi', 'cv', 'kh',
    'cm', 'ca', 'cf', 'td', 'cl', 'cn', 'co', 'km', 'cg', 'cd',
    'cr', 'ci', 'hr', 'cu', 'cy', 'cz', 'dk', 'dj', 'dm', 'do',
    'ec', 'eg', 'sv', 'gq', 'er', 'ee', 'sz', 'et', 'fj', 'fi',
    'fr', 'ga', 'gm', 'ge', 'de', 'gh', 'gr', 'gd', 'gt', 'gn',
    'gw', 'gy', 'ht', 'hn', 'hu', 'is', 'in', 'id', 'ir', 'iq',
    'ie', 'il', 'it', 'jm', 'jp', 'jo', 'kz', 'ke', 'ki', 'kw',
    'kg', 'la', 'lv', 'lb', 'ls', 'lr', 'ly', 'li', 'lt', 'lu',
    'mg', 'mw', 'my', 'mv', 'ml', 'mt', 'mh', 'mr', 'mu', 'mx',
    'fm', 'md', 'mc', 'mn', 'me', 'ma', 'mz', 'mm', 'na', 'nr',
    'np', 'nl', 'nz', 'ni', 'ne', 'ng', 'kp', 'mk', 'no', 'om',
    'pk', 'pw', 'pa', 'pg', 'py', 'pe', 'ph', 'pl', 'pt', 'qa',
    'ro', 'ru', 'rw', 'kn', 'lc', 'vc', 'ws', 'sm', 'st', 'sa',
    'sn', 'rs', 'sc', 'sl', 'sg', 'sk', 'si', 'sb', 'so', 'za',
    'kr', 'ss', 'es', 'lk', 'sd', 'sr', 'se', 'ch', 'sy', 'tj',
    'tz', 'th', 'tl', 'tg', 'to', 'tt', 'tn', 'tr', 'tm', 'tv',
    'ug', 'ua', 'ae', 'gb', 'us', 'uy', 'uz', 'vu', 've', 'vn',
    'ye', 'zm', 'zw'
]

base_url = "https://www.twilio.com/en-us/guidelines/{}/sms"

all_data = []

for code in country_codes:
    url = base_url.format(code)
    response = requests.get(url)
    soup = BeautifulSoup(response.content, 'html.parser')

    country_data = {'country_code': code}  # Initialize country data

    # Locate all sections possibly containing guideline tables
    sections = soup.find_all('section', id='guideline-tables')
    for section in sections:
        tables = section.find_all('table')
        for table in tables:
            # Extract headers
            raw_headers = table.find_all('th')
            headers = [th.find('b').get_text(strip=True) if th.find('b') else th.get_text(strip=True) for th in raw_headers]

            if len(headers) > 1:  # For multi-category tables
                categories = headers[1:]
                for row in table.find_all('tr'):
                    cols = row.find_all('td')
                    if len(cols) == len(headers):
                        main_key = cols[0].find('b').get_text(strip=True) if cols[0].find('b') else cols[0].get_text(strip=True)

                        for index, category in enumerate(categories):
                            sub_key = f"{category} - {main_key}"
                            value = cols[index + 1].get_text(strip=True)
                            country_data[sub_key] = value
            else:
                # Handle two-column tables
                for row in table.find_all('tr'):
                    cols = row.find_all('td')
                    if len(cols) == 2:
                        key = cols[0].find('b').get_text(strip=True) if cols[0].find('b') else cols[0].get_text(strip=True)
                        value = cols[1].get_text(strip=True)
                        country_data[key] = value

    if country_data:
        all_data.append(country_data)

# Convert to DataFrame
df = pd.DataFrame(all_data)

# Organize the columns to ensure grouping by field names
# Custom sorting to group similar category attributes together
ordered_columns = sorted(df.columns, key=lambda x: (x.split(' - ')[0], x))
df = df[ordered_columns]

# Save organized DataFrame to CSV
df.to_csv('twilio_sms_guidelines.csv', index=False, quoting=1)  # quoting=1 is csv.QUOTE_ALL
