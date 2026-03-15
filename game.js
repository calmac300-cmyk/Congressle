// ============================================================
// game.js — Core game logic for Congressional Record Game
// ============================================================
// This file handles:
//   - Data loading from targets.json
//   - Daily puzzle seeding (same target for everyone on a given day)
//   - Game state management
//   - Guess comparison and feedback engine
//   - Vote clue reveal logic
//
// It exposes a single global object: CRGame
// All UI code (index.html) calls into CRGame — no DOM logic lives here.
// ============================================================

const CRGame = (() => {

  // ----------------------------------------------------------
  // Constants
  // ----------------------------------------------------------

  const FEEDBACK = {
    GREEN:  'green',   // exact match
    YELLOW: 'yellow',  // close / partial match
    GREY:   'grey',    // no match
  };

  // Congress number -> approximate year (start of congress)
  // Used for era display and tenure comparison
  const CONGRESS_YEAR = {};
  for (let c = 1; c <= 120; c++) {
    CONGRESS_YEAR[c] = 1789 + (c - 1) * 2;
  }

  // Census regions
  const REGIONS = {
    Northeast: ['ME','VT','NH','MA','RI','CT','NY','NJ','PA'],
    South:     ['DE','MD','VA','WV','NC','SC','GA','FL','KY',
                'TN','AL','MS','AR','LA','OK','TX'],
    Midwest:   ['OH','IN','IL','MI','WI','MN','IA','MO',
                'ND','SD','NE','KS'],
    West:      ['MT','ID','WY','CO','NV','UT','AZ','NM',
                'CA','OR','WA','AK','HI'],
  };

  // Override Census assignments that feel wrong to players
  const REGION_OVERRIDES = {
    'DE': 'Northeast',  // Census says South, players will dispute
  };

  const STATE_TO_REGION = {};
  for (const [region, states] of Object.entries(REGIONS)) {
    for (const s of states) {
      STATE_TO_REGION[s] = REGION_OVERRIDES[s] || region;
    }
  }

  // How many votes to show upfront, and how many to reveal per wrong guess
  const VOTES_INITIAL = 3;
  const VOTES_PER_REVEAL = 1;
  const MAX_GUESSES = 6;

  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------

  let _allTargets     = { Senate: [], House: [] };  // loaded from targets.json
  let _allLegislators = [];                         // loaded from legislators.json (full pool for search)
  let _votePhotos     = {};                         // loaded from vote_photos.json
  let _chamber      = null;   // 'Senate' | 'House' — chosen by player
  let _target       = null;   // the day's target legislator object
  let _guesses      = [];     // array of guess result objects
  let _revealedVotes= 0;      // how many votes are currently visible
  let _gameOver     = false;
  let _won          = false;
  let _freeplay     = false;  // true when in freeplay mode
  let _challenge    = false;  // true when in challenge mode
  let _shareCode    = null;   // current challenge share code

  const FREEPLAY_MIN_VOTES = 8;  // minimum votes for a freeplay target

  // ----------------------------------------------------------
  // Data loading
  // ----------------------------------------------------------

  async function loadData() {
    const [targetsRes, legislatorsRes, photosRes] = await Promise.all([
      fetch('data/targets.json'),
      fetch('data/legislators.json'),
      fetch('data/vote_photos.json'),
    ]);
    _allTargets     = await targetsRes.json();
    _allLegislators = await legislatorsRes.json();
    _votePhotos     = await photosRes.json();
  }

  function getVotePhoto(label) {
    return _votePhotos[label] || { photo_url: '', caption: '' };
  }

  // ----------------------------------------------------------
  // Daily puzzle seed
  // Produces the same target for everyone on the same calendar day.
  // Advances to the next target each day, cycling through the list.
  // ----------------------------------------------------------

  function _getDailyIndex(list) {
    // Days since a fixed epoch (Jan 1 2025)
    const epoch = new Date('2025-01-01T00:00:00Z');
    const now   = new Date();
    const utcNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const daysSinceEpoch = Math.floor((utcNow - epoch) / 86400000);
    return daysSinceEpoch % list.length;
  }

  function getDailyTarget(chamber) {
    const list = _allTargets[chamber];
    if (!list || list.length === 0) return null;
    return list[_getDailyIndex(list)];
  }

  // ----------------------------------------------------------
  // localStorage persistence
  // Saves and restores game state so a page refresh picks up
  // where the player left off. Keyed by chamber + date so each
  // day starts fresh automatically.
  // ----------------------------------------------------------

  function _saveKey(chamber) {
    const d = new Date();
    return `crg_${chamber}_${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  }

  function _saveState() {
    try {
      const payload = {
        chamber:       _chamber,
        guesses:       _guesses,
        revealedVotes: _revealedVotes,
        gameOver:      _gameOver,
        won:           _won,
      };
      localStorage.setItem(_saveKey(_chamber), JSON.stringify(payload));
    } catch (e) {
      // localStorage unavailable — silently skip
    }
  }

  function _loadSavedState(chamber) {
    try {
      const raw = localStorage.getItem(_saveKey(chamber));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function getFreeplayTarget(chamber) {
    // Pick a random legislator from the full pool with enough votes
    const pool = _allLegislators.filter(l =>
      l.chamber === chamber &&
      Object.keys(l.votes || {}).length >= FREEPLAY_MIN_VOTES
    );
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function startChallenge(challengeTarget, chamber) {
    // Start a game with a specific legislator from the full pool
    _chamber   = chamber;
    _freeplay  = false;
    _challenge = true;
    _target    = challengeTarget;
    _guesses       = [];
    _gameOver      = false;
    _won           = false;
    _revealedVotes = Math.min(VOTES_INITIAL, Object.keys(_target.votes).length);
    return getState();
  }

  // ----------------------------------------------------------
  // Game initialisation
  // Call this when the player picks a chamber.
  // ----------------------------------------------------------

  function startGame(chamber, freeplay = false) {
    _chamber   = chamber;
    _freeplay  = freeplay;
    _challenge = false;

    if (freeplay) {
      // Freeplay — random target, no save/restore
      _target        = getFreeplayTarget(chamber);
      _guesses       = [];
      _gameOver      = false;
      _won           = false;
      _revealedVotes = _target
        ? Math.min(VOTES_INITIAL, Object.keys(_target.votes).length)
        : 0;
    } else {
      _target = getDailyTarget(chamber);

      // Try to restore today's saved session
      const saved = _loadSavedState(chamber);
      if (saved && saved.chamber === chamber) {
        _guesses       = saved.guesses       || [];
        _revealedVotes = saved.revealedVotes || Math.min(VOTES_INITIAL, Object.keys(_target.votes).length);
        _gameOver      = saved.gameOver      || false;
        _won           = saved.won           || false;
      } else {
        _guesses       = [];
        _gameOver      = false;
        _won           = false;
        _revealedVotes = Math.min(VOTES_INITIAL, Object.keys(_target.votes).length);
      }
    }

    return getState();
  }

  // ----------------------------------------------------------
  // Vote clue management
  // Returns the votes currently visible to the player,
  // in chronological order by congress (earliest first).
  // ----------------------------------------------------------

  function _sortedVoteKeys(target) {
    // Use pre-computed interest order (most dissenting first) if available.
    // Falls back to alphabetical if enrichment hasn't been run.
    if (target.votes_sorted_by_interest && target.votes_sorted_by_interest.length > 0) {
      return target.votes_sorted_by_interest;
    }
    return Object.keys(target.votes).sort();
  }

  function getVisibleVotes() {
    const keys = _sortedVoteKeys(_target);
    return keys.slice(0, _revealedVotes).map(label => ({
      label,
      result: _target.votes[label],
    }));
  }

  function getTotalVotes() {
    return Object.keys(_target.votes).length;
  }

  // ----------------------------------------------------------
  // Fuzzy search across the full legislator pool
  // Returns up to `limit` matches sorted by relevance.
  // ----------------------------------------------------------

  function search(query, limit = 10) {
    if (!query || query.trim().length < 2) return [];
    const q = query.trim().toUpperCase();
    const pool = _allLegislators.filter(l => l.chamber === _chamber);

    return pool
      .map(l => {
        const name = l.name.toUpperCase();
        // Exact start match scores highest
        if (name.startsWith(q))          return { l, score: 3 };
        // Last name match (before comma) scores next
        const lastName = name.split(',')[0];
        if (lastName.startsWith(q))      return { l, score: 2 };
        // Substring anywhere scores lowest
        if (name.includes(q))            return { l, score: 1 };
        return { l, score: 0 };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(x => x.l);
  }

  // ----------------------------------------------------------
  // Feedback engine
  // Compares a guessed legislator against the target and returns
  // a structured result object with green/yellow/grey for each category.
  // ----------------------------------------------------------

  function _compareState(guess, target) {
    if (guess.state === target.state) return FEEDBACK.GREEN;
    if (STATE_TO_REGION[guess.state] === STATE_TO_REGION[target.state])
      return FEEDBACK.YELLOW;
    return FEEDBACK.GREY;
  }

  function _compareRegion(guess, target) {
    const gr = STATE_TO_REGION[guess.state];
    const tr = STATE_TO_REGION[target.state];
    return gr === tr ? FEEDBACK.GREEN : FEEDBACK.GREY;
  }

  function _compareParty(guess, target) {
    // Normalise party names to handle minor variations
    const normalise = p => {
      if (!p) return '';
      const u = p.toUpperCase();
      if (u.includes('DEMOCRAT')) return 'Democrat';
      if (u.includes('REPUBLICAN')) return 'Republican';
      return p;
    };
    return normalise(guess.party) === normalise(target.party)
      ? FEEDBACK.GREEN
      : FEEDBACK.GREY;
  }

  function _compareChamber(guess, target) {
    return guess.chamber === target.chamber ? FEEDBACK.GREEN : FEEDBACK.GREY;
  }

  function _compareTenure(guess, target) {
    // Green  — tenures overlap
    // Yellow — within 4 congresses (8 years) of overlapping
    // Grey   — further apart
    const gStart = guess.first_congress, gEnd = guess.last_congress;
    const tStart = target.first_congress, tEnd = target.last_congress;

    const overlaps = gStart <= tEnd && gEnd >= tStart;
    if (overlaps) return FEEDBACK.GREEN;

    const gap = gStart > tEnd
      ? gStart - tEnd
      : tStart - gEnd;

    return gap <= 4 ? FEEDBACK.YELLOW : FEEDBACK.GREY;
  }

  function _tenureDirection(guess, target) {
    // Returns 'earlier', 'later', or null (if overlap / green)
    const gMid = (guess.first_congress + guess.last_congress) / 2;
    const tMid = (target.first_congress + target.last_congress) / 2;
    if (_compareTenure(guess, target) === FEEDBACK.GREEN) return null;
    return gMid < tMid ? 'later' : 'earlier';
  }

  function _compareVotes(guess, target) {
    // For each vote visible to the player, compare guess vs target.
    // Green  — same vote (both Yea, both Nay, both Absent)
    // Yellow — both present (Yea/Nay) but voted differently
    // Grey   — guess was absent/not in office for this vote
    const visibleVotes = getVisibleVotes();
    return visibleVotes.map(({ label, result: targetVote }) => {
      const guessVote = guess.votes?.[label];

      if (!guessVote || guessVote === 'Absent') {
        return { label, targetVote, guessVote: guessVote || null,
                 feedback: FEEDBACK.GREY };
      }
      if (guessVote === targetVote) {
        return { label, targetVote, guessVote,
                 feedback: FEEDBACK.GREEN };
      }
      // Both present but different sides
      return { label, targetVote, guessVote,
               feedback: FEEDBACK.YELLOW };
    });
  }

  function _buildGuessResult(guess) {
    return {
      guess,
      correct: guess.icpsr === _target.icpsr,
      feedback: {
        state:   _compareState(guess, _target),
        region:  _compareRegion(guess, _target),
        party:   _compareParty(guess, _target),
        chamber: _compareChamber(guess, _target),
        tenure:  _compareTenure(guess, _target),
        tenureDirection: _tenureDirection(guess, _target),
        votes:   _compareVotes(guess, _target),
      },
    };
  }

  // ----------------------------------------------------------
  // Submit a guess
  // Pass a legislator object from the search results.
  // Returns the updated game state.
  // ----------------------------------------------------------

  function submitGuess(legislator) {
    if (_gameOver) return getState();

    const result = _buildGuessResult(legislator);
    _guesses.push(result);

    if (result.correct) {
      _gameOver = true;
      _won      = true;
    } else {
      // Reveal one more vote on each wrong guess if available
      const totalVotes = getTotalVotes();
      if (_revealedVotes < totalVotes) {
        _revealedVotes = Math.min(_revealedVotes + VOTES_PER_REVEAL, totalVotes);
      }
      if (_guesses.length >= MAX_GUESSES) {
        _gameOver = true;
        _won      = false;
      }
    }

    if (!_freeplay && !_challenge) {
      _saveState();
      if (_gameOver) recordResult(_won);
    }
    return getState();
  }

  // ----------------------------------------------------------
  // Game state snapshot
  // Everything the UI needs to render the current state.
  // ----------------------------------------------------------

  function getState() {
    return {
      chamber:        _chamber,
      guesses:        _guesses,
      guessCount:     _guesses.length,
      maxGuesses:     MAX_GUESSES,
      visibleVotes:   _target ? getVisibleVotes() : [],
      totalVotes:     _target ? getTotalVotes() : 0,
      revealedVotes:  _revealedVotes,
      gameOver:       _gameOver,
      won:            _won,
      freeplay:       _freeplay,
      challenge:      _challenge,
      // Only expose target on game over
      target:         _gameOver ? _target : null,
    };
  }

  // ----------------------------------------------------------
  // Map elimination helper
  // Returns the set of states still viable given all guesses so far.
  // Used by the map to grey out eliminated states.
  // ----------------------------------------------------------

  function getEliminatedStates() {
    if (_guesses.length === 0) return new Set();

    const eliminated = new Set();

    // Collect constraints from all guesses
    let confirmedState  = null;
    let confirmedRegion = null;
    const eliminatedStates  = new Set();
    const eliminatedRegions = new Set();

    for (const { feedback, guess } of _guesses) {
      if (feedback.state === FEEDBACK.GREEN) {
        confirmedState = guess.state;
      } else if (feedback.state === FEEDBACK.GREY) {
        eliminatedStates.add(guess.state);
        // If region is also grey, eliminate the whole region
        if (feedback.region === FEEDBACK.GREY) {
          eliminatedRegions.add(STATE_TO_REGION[guess.state]);
        }
      } else if (feedback.state === FEEDBACK.YELLOW) {
        // Same region confirmed, wrong state
        confirmedRegion = STATE_TO_REGION[guess.state];
        eliminatedStates.add(guess.state);
      }
    }

    // Build eliminated set from all US states
    const allStates = Object.keys(STATE_TO_REGION);
    for (const state of allStates) {
      if (confirmedState) {
        // Only the confirmed state survives
        if (state !== confirmedState) eliminated.add(state);
      } else {
        if (eliminatedStates.has(state)) {
          eliminated.add(state);
          continue;
        }
        if (eliminatedRegions.has(STATE_TO_REGION[state])) {
          eliminated.add(state);
          continue;
        }
        if (confirmedRegion && STATE_TO_REGION[state] !== confirmedRegion) {
          eliminated.add(state);
        }
      }
    }

    return eliminated;
  }

  // ----------------------------------------------------------
  // Viable candidates helper
  // Returns legislators still consistent with all guess feedback.
  // Used for map hover tooltips.
  // ----------------------------------------------------------

  function getViableCandidates() {
    if (!_chamber || _allLegislators.length === 0) return [];
    const pool = _allLegislators.filter(l => l.chamber === _chamber);
    const eliminated = getEliminatedStates();

    return pool.filter(l => {
      // Must be in a non-eliminated state
      if (eliminated.has(l.state)) return false;

      // Apply party constraints
      for (const { feedback, guess } of _guesses) {
        if (feedback.party === FEEDBACK.GREEN) {
          const norm = p => {
            if (!p) return '';
            const u = p.toUpperCase();
            if (u.includes('DEMOCRAT'))   return 'Democrat';
            if (u.includes('REPUBLICAN')) return 'Republican';
            return p;
          };
          if (norm(l.party) !== norm(guess.party)) return false;
        }
        // Apply tenure constraints
        if (feedback.tenure === FEEDBACK.GREEN) {
          const overlaps = l.first_congress <= guess.last_congress &&
                           l.last_congress  >= guess.first_congress;
          if (!overlaps) return false;
        }
      }
      return true;
    });
  }

  // Normalise district code for map matching.
  // Rather than a hardcoded list, detect at-large dynamically:
  // if a state has only ONE House member in the viable pool for this congress,
  // and that member has district_code 1, treat them as district 0 (GeoJSON at-large code).
  // Truly at-large states use DISTRICT=0 in GeoJSON but district_code=1 in Voteview.
  // States with multiple genuine districts use matching numbers in both.

  // Known at-large states that consistently use 0 in GeoJSON and 1 in Voteview
  // across all congresses in our range — only truly single-member states
  const AT_LARGE_STATES = new Set(['AK', 'DE', 'VT', 'WY', 'NV']);

  function normaliseDistrictForMap(state, districtCode) {
    const dc = String(districtCode || '0');
    // For confirmed at-large states, map Voteview's 1 -> GeoJSON's 0
    if (AT_LARGE_STATES.has(state) && (dc === '1' || dc === '0')) return '0';
    return dc;
  }

  function getDistrictCodeForMap(legislator) {
    return normaliseDistrictForMap(legislator.state, legislator.district_code);
  }

  // ----------------------------------------------------------
  // Streak tracking
  // Stored separately from daily session — persists across days
  // ----------------------------------------------------------

  const STREAK_KEY = 'crg_streak';

  function _loadStreak() {
    try {
      const raw = localStorage.getItem(STREAK_KEY);
      return raw ? JSON.parse(raw) : {
        current: 0, best: 0,
        lastWonDate: null, totalPlayed: 0, totalWon: 0
      };
    } catch(e) {
      return { current: 0, best: 0, lastWonDate: null, totalPlayed: 0, totalWon: 0 };
    }
  }

  function _saveStreak(streak) {
    try { localStorage.setItem(STREAK_KEY, JSON.stringify(streak)); } catch(e) {}
  }

  function recordResult(won) {
    const streak = _loadStreak();
    const d = new Date();
    const today = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    const yesterday = (() => {
      const y = new Date(d); y.setDate(y.getDate() - 1);
      return `${y.getFullYear()}-${y.getMonth()+1}-${y.getDate()}`;
    })();

    streak.totalPlayed++;
    if (won) {
      streak.totalWon++;
      // Extend streak if won yesterday or starting fresh
      if (streak.lastWonDate === yesterday || streak.lastWonDate === null) {
        streak.current++;
      } else if (streak.lastWonDate !== today) {
        streak.current = 1;
      }
      streak.best = Math.max(streak.best, streak.current);
      streak.lastWonDate = today;
    } else {
      // Only break streak if we haven't already recorded a loss today
      if (streak.lastWonDate !== today) {
        streak.current = 0;
      }
    }
    _saveStreak(streak);
    return streak;
  }

  function resetStreak() {
    try {
      localStorage.removeItem(STREAK_KEY);
      // Also clear today's daily sessions so puzzles can be replayed
      const d = new Date();
      const dateKey = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
      localStorage.removeItem(`crg_Senate_${dateKey}`);
      localStorage.removeItem(`crg_House_${dateKey}`);
    } catch(e) {}
  }

  function getStreak() {
    return _loadStreak();
  }

  // ----------------------------------------------------------
  // Share string generation
  // Produces a Wordle-style emoji grid for the clipboard
  // ----------------------------------------------------------

  function buildShareString(state) {
    if (!state.gameOver) return '';
    const d = new Date();
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const EMOJI = { green: '🟩', yellow: '🟨', grey: '⬜' };

    const lines = [
      `The Congressional Record`,
      `${state.chamber} · ${dateStr}`,
      state.won
        ? `Identified in ${state.guessCount}/${state.maxGuesses}`
        : `Not identified (${state.guessCount}/${state.maxGuesses})`,
      '',
    ];

    for (const { feedback } of state.guesses) {
      const row = [
        EMOJI[feedback.state],
        EMOJI[feedback.region],
        EMOJI[feedback.party],
        EMOJI[feedback.chamber],
        EMOJI[feedback.tenure],
        // Vote emojis — one per visible vote
        ...feedback.votes.map(v => EMOJI[v.feedback]),
      ].join('');
      lines.push(row);
    }

    lines.push('');
    lines.push('https://calmac300-cmyk.github.io/Congressle/');
    return lines.join('\n');
  }

  // ----------------------------------------------------------
  // Utility: congress number to year string for display
  // ----------------------------------------------------------

  function congressToYear(n) {
    return CONGRESS_YEAR[n] ? `${CONGRESS_YEAR[n]}` : `Congress ${n}`;
  }

  function tenureString(legislator) {
    return `${congressToYear(legislator.first_congress)}–` +
           `${congressToYear(legislator.last_congress) }`;
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  return {
    // Setup
    loadData,
    startGame,
    getDailyTarget,
    getFreeplayTarget,
    getCurrentTarget: () => _target,
    getAllLegislators: () => _allLegislators,
    isFreeplay:    () => _freeplay,
    isChallenge:   () => _challenge,
    startChallenge,

    // Gameplay
    search,
    submitGuess,
    getState,

    // Map helpers
    getEliminatedStates,
    getViableCandidates,

    // Display helpers
    congressToYear,
    tenureString,

    // Stats & sharing
    recordResult,
    getStreak,
    resetStreak,
    buildShareString,

    // Photos
    getVotePhoto,

    // Map helpers (district)
    getDistrictCodeForMap,

    // Constants (exposed for UI)
    FEEDBACK,
    MAX_GUESSES,
    VOTES_INITIAL,
    STATE_TO_REGION,
  };

})();
