import { decodeEntities } from './util.ts';

/** Road to Nationals team id to the name RTN publishes. Virtius uses the same ids. */
export const TEAM_BY_ID: Record<string, string> = {
  "47": "Oklahoma",
  "34": "LSU",
  "22": "Florida",
  "66": "UCLA",
  "2": "Alabama",
  "24": "Georgia",
  "61": "Stanford",
  "40": "Missouri",
  "6": "Arkansas",
  "37": "Michigan",
  "38": "Michigan State",
  "69": "Utah",
  "39": "Minnesota",
  "15": "California",
  "163": "Clemson",
  "33": "Kentucky",
  "7": "Auburn",
  "46": "Ohio State",
  "29": "Iowa",
  "49": "Penn State",
  "44": "North Carolina State",
  "43": "North Carolina",
  "20": "Denver",
  "8": "BYU",
  "48": "Oregon State",
  "70": "Utah State",
  "36": "Maryland",
  "59": "Southern Utah",
  "56": "San Jose State",
  "1": "Air Force",
  "17": "Central Michigan",
  "5": "Arizona State",
  "4": "Arizona",
  "41": "Nebraska",
  "71": "Washington",
  "53": "Rutgers",
  "10": "Boise State",
  "51": "Pittsburgh",
  "9": "Ball State",
  "50": "Pennsylvania",
  "64": "Towson",
  "28": "Illinois",
  "32": "Kent State",
  "74": "Western Michigan",
  "42": "New Hampshire",
  "73": "West Virginia",
  "82": "Yale",
  "54": "S.E. Missouri",
  "55": "Sacramento State",
  "21": "Eastern Michigan",
  "14": "Brown",
  "62": "Temple",
  "128": "LIU",
  "23": "George Washington",
  "27": "Illinois State",
  "11": "Bowling Green",
  "65": "UC Davis",
  "18": "Cornell",
  "45": "Northern Illinois",
  "75": "William & Mary",
  "3": "Alaska",
  "30": "Iowa State",
  "63": "Texas Woman's",
};

/** Virtius tricodes that are not already the RTN name. */
export const TRICODE_TO_ID: Record<string, string> = {
  "AFA": "1",
  "ALA": "2",
  "ARK": "6",
  "ASU": "5",
  "AUB": "7",
  "BRWN": "14",
  "BSU": "10",
  "BYU": "8",
  "CLEM": "163",
  "CMU": "17",
  "FLA": "22",
  "GW": "23",
  "ILL": "28",
  "IOWA": "29",
  "LSU": "34",
  "MICH": "37",
  "MINN": "39",
  "MIZ": "40",
  "MSU": "38",
  "NEB": "41",
  "NIU": "45",
  "OKLA": "47",
  "ORST": "48",
  "OSU": "46",
  "PENN": "50",
  "SJSU": "56",
  "STAN": "61",
  "SUU": "59",
  "TEM": "62",
  "UCLA": "66",
  "UGA": "24",
  "UK": "33",
  "UTAH": "69",
  "WASH": "71",
  "WMU": "74",
  "WVU": "73",
};

function norm(value: string): string {
  return decodeEntities(value).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const BY_NORM = new Map<string, string>();
for (const name of Object.values(TEAM_BY_ID)) BY_NORM.set(norm(name), name);

function known(label: string): string | null {
  const key = norm(label).replace(/^university of /, '').replace(/^the /, '').replace(/ university$/, '');
  return BY_NORM.get(key) || null;
}

/**
 * One display name per school. A known team id wins, then a tricode, then a
 * name we already publish. Otherwise keep the longer real name.
 */
export function canonicalTeam(input: { id?: string | null; name?: string | null; short?: string | null }): string {
  const id = String(input.id || '').trim();
  if (id && TEAM_BY_ID[id]) return TEAM_BY_ID[id];
  const short = (input.short || '').trim();
  const shortId = TRICODE_TO_ID[short.toUpperCase()];
  if (shortId && TEAM_BY_ID[shortId]) return TEAM_BY_ID[shortId];
  const name = decodeEntities((input.name || '').trim());
  const fromName = name ? known(name) : null;
  if (fromName) return fromName;
  const fromShort = short ? known(short) : null;
  if (fromShort) return fromShort;
  if (name && short && name.length > short.length) return name;
  return name || short || 'Unknown';
}
