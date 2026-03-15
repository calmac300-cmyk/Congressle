// supabase.js — Supabase client and all database operations
// Loaded before game.js and ui.js in index.html

const SUPABASE_URL = 'https://uhfdksixglaflxbehstl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_eoOBJvIhVU-fvY_-oXVfVQ_dLJPEv7T';

// Minimal Supabase REST client — no npm needed
const _headers = {
  'apikey':        SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type':  'application/json',
  'Prefer':        'return=representation',
};

async function _get(table, params = '') {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + params, {
    headers: _headers,
  });
  if (!res.ok) throw new Error('GET ' + table + ' failed: ' + res.status);
  return res.json();
}

async function _post(table, body) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method:  'POST',
    headers: _headers,
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error('POST ' + table + ' failed: ' + res.status);
  return res.json();
}

// ----------------------------------------------------------
// Player identity
// ----------------------------------------------------------

const PLAYER_KEY = 'crg_player';

function getLocalPlayer() {
  try {
    const raw = localStorage.getItem(PLAYER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

function saveLocalPlayer(player) {
  try { localStorage.setItem(PLAYER_KEY, JSON.stringify(player)); } catch(e) {}
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

async function getOrCreatePlayer(displayName) {
  let player = getLocalPlayer();

  if (player && player.uuid && player.display_name === displayName) {
    return player;
  }

  // New player or name change
  const uuid = (player && player.uuid) ? player.uuid : generateUUID();
  try {
    await _post('players', { uuid, display_name: displayName });
  } catch(e) {
    // May already exist if uuid collision — that's fine
  }

  player = { uuid, display_name: displayName };
  saveLocalPlayer(player);
  return player;
}

// ----------------------------------------------------------
// Submit a result
// ----------------------------------------------------------

async function submitResult({ chamber, mode, targetIcpsr, targetName, won, guessCount, revealedVotesCount, puzzleDate }) {
  const player = getLocalPlayer();
  if (!player) return null;

  try {
    const result = await _post('results', {
      player_uuid:          player.uuid,
      display_name:         player.display_name,
      chamber,
      mode,
      target_icpsr:         targetIcpsr,
      target_name:          targetName,
      won,
      guess_count:          guessCount,
      revealed_votes_count: revealedVotesCount || null,
      puzzle_date:          puzzleDate,
    });
    return result;
  } catch(e) {
    console.warn('Could not submit result:', e.message);
    return null;
  }
}

// ----------------------------------------------------------
// Leaderboard queries
// ----------------------------------------------------------

async function getDailyLeaderboard(chamber, puzzleDate) {
  try {
    const params = new URLSearchParams({
      chamber:     'eq.' + chamber,
      puzzle_date: 'eq.' + puzzleDate,
      mode:        'eq.daily',
      won:         'eq.true',
      order:       'guess_count.asc,created_at.asc',
      limit:       '20',
      select:      'display_name,guess_count,created_at',
    });
    return await _get('results', params.toString());
  } catch(e) {
    console.warn('Leaderboard fetch failed:', e.message);
    return [];
  }
}

async function getAllTimeLeaderboard() {
  try {
    // Get win counts and average guess count per player (daily only)
    const params = new URLSearchParams({
      mode:   'eq.daily',
      select: 'display_name,won,guess_count',
      limit:  '500',
    });
    const rows = await _get('results', params.toString());

    // Aggregate client-side
    const players = {};
    for (const r of rows) {
      if (!players[r.display_name]) {
        players[r.display_name] = { display_name: r.display_name, played: 0, won: 0, total_guesses: 0 };
      }
      players[r.display_name].played++;
      if (r.won) {
        players[r.display_name].won++;
        players[r.display_name].total_guesses += r.guess_count;
      }
    }

    return Object.values(players)
      .filter(p => p.played >= 3)  // min 3 games for ranking
      .map(p => ({
        ...p,
        win_rate:   Math.round(p.won / p.played * 100),
        avg_guesses: p.won > 0 ? (p.total_guesses / p.won).toFixed(1) : '-',
      }))
      .sort((a, b) => b.win_rate - a.win_rate || a.avg_guesses - b.avg_guesses)
      .slice(0, 20);
  } catch(e) {
    console.warn('All-time leaderboard fetch failed:', e.message);
    return [];
  }
}

// Expose globally
window.CRSupabase = {
  getLocalPlayer,
  getOrCreatePlayer,
  saveLocalPlayer,
  submitResult,
  getDailyLeaderboard,
  getAllTimeLeaderboard,
};

// ----------------------------------------------------------
// Custom challenges
// ----------------------------------------------------------

function generateShareCode() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'; // no confusables
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function createChallenge(targetIcpsr, chamber) {
  const player = getLocalPlayer();
  const creatorUuid = player ? player.uuid : 'anon-' + Math.random().toString(36).slice(2);
  const shareCode = generateShareCode();

  try {
    await _post('challenges', {
      share_code:    shareCode,
      creator_uuid:  creatorUuid,
      target_icpsr:  targetIcpsr,
      chamber,
    });
    return shareCode;
  } catch(e) {
    console.warn('Could not create challenge:', e.message);
    return null;
  }
}

async function getChallenge(shareCode) {
  try {
    const params = new URLSearchParams({
      share_code: 'eq.' + shareCode,
      select:     'share_code,target_icpsr,chamber',
      limit:      '1',
    });
    const rows = await _get('challenges', params.toString());
    return rows.length > 0 ? rows[0] : null;
  } catch(e) {
    console.warn('Could not fetch challenge:', e.message);
    return null;
  }
}

async function getPlayCount(puzzleDate, chamber) {
  try {
    const params = new URLSearchParams({
      puzzle_date: 'eq.' + puzzleDate,
      chamber:     'eq.' + chamber,
      mode:        'eq.daily',
      select:      'id',
    });
    const rows = await _get('results', params.toString());
    return rows.length;
  } catch(e) { return null; }
}

// Add to window export
window.CRSupabase = Object.assign(window.CRSupabase || {}, {
  createChallenge,
  getChallenge,
  getPlayCount,
});
