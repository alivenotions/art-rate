#!/usr/bin/env node

// fetch-artist.js — Fetch artist discography from MusicBrainz + cover art from Cover Art Archive
// Usage: node fetch-artist.js "Artist Name"
// Writes to data.js + covers/ so the Phonograph app can use real data.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const COVERS_DIR = path.join(ROOT, 'covers');
const DATA_JSON = path.join(ROOT, 'data.json');
const DATA_JS = path.join(ROOT, 'data.js');

const UA = 'Phonograph/1.0 (personal-music-rating-app)';
const DELAY = 1200;

const MOTIFS = ['wave','grid','mountain','weep','splash','leaves','soul','collage','band','blank','crossing','windows'];
const PALETTES = [
  ['#1a3a5c','#7ba7c9','#e8d5b7'], ['#2a2a2a','#c8c8c8','#d4a574'],
  ['#8a2c1f','#f0e8d8','#c4b89d'], ['#b8332a','#1a1a1a','#e8b89d'],
  ['#1a0f3a','#e8a020','#c0386b'], ['#2d4a3e','#e8e0c8','#a8956b'],
  ['#5c3a1f','#d4a574','#8c5a2e'], ['#1f1f1f','#e8e8e8','#b85c2e'],
  ['#c0392b','#f4d03f','#2874a6'], ['#f5f5f0','#bdb8a8','#2a2a2a'],
  ['#2d5016','#a8c45e','#1a1a1a'], ['#1a1a1a','#d4af37','#8c7a3a'],
];
const ACCENTS = ['#d97842','#c97a1f','#6db26d','#7a5ae0','#c0386b','#2874a6','#e8a040','#d4a574'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function slugify(s) {
  return s.toLowerCase().replace(/^the\s+/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function mbFetch(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, redirect: 'follow' });
      if (res.status === 503 && i < retries - 1) {
        await sleep(3000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(2000);
    }
  }
}

async function downloadBinary(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function searchArtist(name) {
  const url = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(name)}&fmt=json&limit=5`;
  const data = await mbFetch(url);
  if (!data.artists || !data.artists.length) throw new Error(`No artist found for "${name}"`);
  return data.artists[0];
}

function buildBio(artist) {
  const type = artist.type || 'Artist';
  const area = artist['begin-area']?.name || artist.area?.name || null;
  const begin = artist['life-span']?.begin?.substring(0, 4) || null;
  const end = artist['life-span']?.ended ? (artist['life-span']?.end?.substring(0, 4) || 'unknown') : null;

  let bio = type;
  if (area) bio += ` from ${area}`;
  if (begin) {
    bio += `. ${end ? `${begin}–${end}` : `Formed ${begin}`}`;
  }
  return bio + '.';
}

async function getReleaseGroups(artistId) {
  const url = `https://musicbrainz.org/ws/2/release-group?artist=${artistId}&type=album&fmt=json&limit=100`;
  const data = await mbFetch(url);
  return (data['release-groups'] || [])
    .filter(rg => rg['primary-type'] === 'Album' && (!rg['secondary-types'] || rg['secondary-types'].length === 0))
    .sort((a, b) => (a['first-release-date'] || '9999').localeCompare(b['first-release-date'] || '9999'));
}

async function getReleaseTracks(releaseGroupId) {
  const url = `https://musicbrainz.org/ws/2/release?release-group=${releaseGroupId}&inc=recordings+media&status=official&fmt=json&limit=20`;
  const data = await mbFetch(url);
  let releases = (data.releases || []).filter(r => r.media?.length && r.media[0].tracks?.length);

  if (!releases.length) {
    const allReleases = (data.releases || []).filter(r => r.id);
    if (allReleases.length) {
      await sleep(DELAY);
      const lookupUrl = `https://musicbrainz.org/ws/2/release/${allReleases[0].id}?inc=recordings&fmt=json`;
      const lookup = await mbFetch(lookupUrl);
      if (lookup.media?.length && lookup.media[0].tracks?.length) {
        releases = [lookup];
      }
    }
  }

  if (!releases.length) return [];

  releases.sort((a, b) => {
    const at = a.media.reduce((s, m) => s + (m['track-count'] || m.tracks?.length || 0), 0);
    const bt = b.media.reduce((s, m) => s + (m['track-count'] || m.tracks?.length || 0), 0);
    if (at !== bt) return at - bt;
    return (a.date || '9999').localeCompare(b.date || '9999');
  });

  const release = releases[0];
  const tracks = [];
  for (const medium of release.media) {
    for (const track of (medium.tracks || [])) {
      const dur = track.length || track.recording?.length || 0;
      tracks.push([
        track.title || track.recording?.title || 'Unknown',
        Math.round(dur / 1000)
      ]);
    }
  }
  return tracks;
}

async function downloadCover(releaseGroupId, outputPath) {
  try {
    const buf = await downloadBinary(`https://coverartarchive.org/release-group/${releaseGroupId}/front-500`);
    fs.writeFileSync(outputPath, buf);
    return true;
  } catch {
    return false;
  }
}

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_JSON, 'utf8')); }
  catch { return {}; }
}

function saveData(data) {
  fs.writeFileSync(DATA_JSON, JSON.stringify(data, null, 2));
  const js = `// Auto-generated by fetch-artist.js — do not edit manually\n// Usage: node fetch-artist.js "Artist Name"\nwindow.DISCOGRAPHY = ${JSON.stringify(data, null, 2)};\n`;
  fs.writeFileSync(DATA_JS, js);
}

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.log('Usage: node fetch-artist.js "Artist Name"');
    console.log('       node fetch-artist.js --list');
    console.log('       node fetch-artist.js --remove "Artist Name"');
    process.exit(1);
  }

  if (name === '--list') {
    const data = loadData();
    const keys = Object.keys(data);
    if (!keys.length) { console.log('No artists yet. Run: node fetch-artist.js "Artist Name"'); return; }
    console.log(`${keys.length} artist(s):`);
    keys.forEach(k => console.log(`  ${data[k].name} — ${data[k].albums.length} albums`));
    return;
  }

  if (name === '--remove') {
    const removeName = process.argv[3];
    if (!removeName) { console.log('Usage: node fetch-artist.js --remove "Artist Name"'); process.exit(1); }
    const data = loadData();
    const key = slugify(removeName);
    if (!data[key]) { console.log(`Artist "${removeName}" (key: ${key}) not found.`); process.exit(1); }
    console.log(`Removing ${data[key].name}...`);
    const albumIds = data[key].albums.map(a => a.id);
    delete data[key];
    saveData(data);
    albumIds.forEach(id => {
      const coverPath = path.join(COVERS_DIR, `${id}.jpg`);
      if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
    });
    console.log('Done.');
    return;
  }

  fs.mkdirSync(COVERS_DIR, { recursive: true });

  console.log(`Searching for "${name}"...`);
  const artist = await searchArtist(name);
  const artistSlug = slugify(artist.name);
  const bio = buildBio(artist);
  console.log(`Found: ${artist.name} — ${bio}`);

  await sleep(DELAY);
  console.log(`\nFetching discography...`);
  const releaseGroups = await getReleaseGroups(artist.id);
  console.log(`${releaseGroups.length} studio album(s) found.\n`);

  const data = loadData();
  const existingKeys = Object.keys(data);
  const accentIdx = existingKeys.includes(artistSlug)
    ? existingKeys.indexOf(artistSlug)
    : existingKeys.length;

  const albums = [];
  for (let i = 0; i < releaseGroups.length; i++) {
    const rg = releaseGroups[i];
    const year = rg['first-release-date'] ? parseInt(rg['first-release-date'].substring(0, 4)) : null;
    const albumSlug = `${artistSlug}-${slugify(rg.title)}`;
    const label = `[${i + 1}/${releaseGroups.length}] ${rg.title}${year ? ` (${year})` : ''}`;

    await sleep(DELAY);
    let tracks;
    try {
      tracks = await getReleaseTracks(rg.id);
    } catch (e) {
      process.stdout.write(`  ${label} — ERROR: ${e.message}\n`);
      continue;
    }

    if (!tracks.length) {
      process.stdout.write(`  ${label} — no tracks found, skipping\n`);
      continue;
    }

    await sleep(DELAY);
    const coverPath = path.join(COVERS_DIR, `${albumSlug}.jpg`);
    const hasCover = await downloadCover(rg.id, coverPath);

    const album = {
      id: albumSlug,
      mbid: rg.id,
      title: rg.title,
      year,
      cover: hasCover ? `covers/${albumSlug}.jpg` : null,
      palette: PALETTES[i % PALETTES.length],
      motif: MOTIFS[i % MOTIFS.length],
      tracks
    };
    albums.push(album);

    const trackInfo = `${tracks.length} tracks`;
    const coverInfo = hasCover ? 'cover downloaded' : 'no cover art';
    console.log(`  ${label} — ${trackInfo}, ${coverInfo}`);
  }

  data[artistSlug] = {
    name: artist.name,
    mbid: artist.id,
    bio,
    accent: ACCENTS[accentIdx % ACCENTS.length],
    albums
  };

  saveData(data);

  const totalArtists = Object.keys(data).length;
  const totalAlbums = Object.values(data).reduce((s, a) => s + a.albums.length, 0);
  console.log(`\nDone. ${totalArtists} artist(s), ${totalAlbums} album(s) saved to data.js`);
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
