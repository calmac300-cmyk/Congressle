// ============================================================
// ui.js — DOM controller for The Congressional Record
// Depends on: game.js (CRGame), Leaflet
// ============================================================

(async () => {

  // ----------------------------------------------------------
  // Boot — load data then reveal UI
  // ----------------------------------------------------------
  try {
    await CRGame.loadData();
  } catch (e) {
    document.getElementById('loading').innerHTML =
      '<div class="loading-inner"><p class="loading-title">Failed to load data</p>' +
      '<p class="loading-sub">Please check that data/targets.json and data/legislators.json exist.</p></div>';
    return;
  }
  document.getElementById('loading').classList.add('hidden');

  // Set today's date and volume number in masthead
  document.getElementById('today-date').textContent =
    new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  function toRoman(n) {
    const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
    const syms = ['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
    let result = '';
    for (let i = 0; i < vals.length; i++) {
      while (n >= vals[i]) { result += syms[i]; n -= vals[i]; }
    }
    return result;
  }

  const volEpoch = new Date(2026, 2, 15); // March 15, 2026 = Vol. I
  const volDays  = Math.floor((new Date() - volEpoch) / 86400000) + 1;
  const volEl    = document.getElementById('masthead-vol');
  if (volEl) volEl.innerHTML =
    'Vol. ' + toRoman(volDays) + ' &nbsp;·&nbsp; <span id="today-date">' +
    new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) +
    '</span>';

  // Render streak stats on chamber select
  renderStreak();

  // Check for challenge URL parameter (?c=xxxxxx)
  const urlParams  = new URLSearchParams(window.location.search);
  const challengeCode = urlParams.get('c');
  if (challengeCode && window.CRSupabase) {
    initChallengeFromCode(challengeCode);
  } else {

  // Check if there's a saved session from today and restore it
  const d = new Date();
  const dateKey = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  // Only restore daily sessions (never freeplay)
  for (const chamber of ['Senate', 'House']) {
    try {
      const saved = localStorage.getItem(`crg_${chamber}_${dateKey}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.gameOver) {
          await initGame(chamber, false);
          showAlreadyPlayed(chamber, parsed);
          return;
        } else if (parsed.guesses && parsed.guesses.length > 0) {
          await initGame(chamber, false);
          return;
        }
      }
    } catch(e) {}
  }

  } // end else (not a challenge URL)

  // ----------------------------------------------------------
  // Streak display
  // ----------------------------------------------------------
  function renderStreak() {
    const streak  = CRGame.getStreak();
    const el      = document.getElementById('streak-display');
    if (!el) return;
    if (streak.totalPlayed === 0) {
      el.classList.add('hidden');
      return;
    }
    const pct = streak.totalPlayed > 0
      ? Math.round((streak.totalWon / streak.totalPlayed) * 100)
      : 0;
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="streak-stats">
        <div class="streak-stat">
          <span class="streak-num">${streak.totalPlayed}</span>
          <span class="streak-label">Played</span>
        </div>
        <div class="streak-stat">
          <span class="streak-num">${pct}%</span>
          <span class="streak-label">Win rate</span>
        </div>
        <div class="streak-stat">
          <span class="streak-num">${streak.current}</span>
          <span class="streak-label">Streak</span>
        </div>
        <div class="streak-stat">
          <span class="streak-num">${streak.best}</span>
          <span class="streak-label">Best</span>
        </div>
      </div>
    `;
  }

  // ----------------------------------------------------------
  // Screen management
  // ----------------------------------------------------------
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    window.scrollTo(0, 0);
  }

  // ----------------------------------------------------------
  // Chamber Select Screen
  // ----------------------------------------------------------
  document.querySelectorAll('.chamber-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const chamber  = btn.dataset.chamber;
      const freeplay = btn.dataset.mode === 'freeplay';
      initGame(chamber, freeplay);
    });
  });

  document.getElementById('btn-back').addEventListener('click', () => {
    showScreen('screen-chamber');
  });

  // Reset streak buttons
  document.getElementById('btn-reset-streak-home').addEventListener('click', () => {
    if (confirm('Reset all streak data?')) {
      CRGame.resetStreak();
      renderStreak();
    }
  });
  document.getElementById('btn-reset-streak').addEventListener('click', () => {
    if (confirm('Reset all streak data?')) {
      CRGame.resetStreak();
      renderStreak();
      showScreen('screen-chamber');
    }
  });

  // ----------------------------------------------------------
  // Help / About Modal
  // ----------------------------------------------------------
  const modalHelp  = document.getElementById('modal-help');

  document.getElementById('btn-help').addEventListener('click', () => {
    modalHelp.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  });

  document.getElementById('btn-modal-close').addEventListener('click', closeModal);

  modalHelp.addEventListener('click', e => {
    if (e.target === modalHelp) closeModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  function closeModal() {
    modalHelp.classList.add('hidden');
    document.body.style.overflow = '';
  }

  // ----------------------------------------------------------
  // Player name modal
  // ----------------------------------------------------------
  function showPlayerModal(onComplete) {
    const modal = document.getElementById('modal-player');
    const input = document.getElementById('player-name-input');
    const existing = window.CRSupabase.getLocalPlayer();
    if (existing) input.value = existing.display_name;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    input.focus();

    document.getElementById('btn-save-name').onclick = async () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      await window.CRSupabase.getOrCreatePlayer(name);
      modal.classList.add('hidden');
      document.body.style.overflow = '';
      updateLbNameDisplay();
      if (onComplete) onComplete();
    };

    document.getElementById('btn-skip-name').onclick = () => {
      modal.classList.add('hidden');
      document.body.style.overflow = '';
      if (onComplete) onComplete();
    };

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-save-name').click();
    });
  }

  function updateLbNameDisplay() {
    const player = window.CRSupabase ? window.CRSupabase.getLocalPlayer() : null;
    const el = document.getElementById('lb-player-name-display');
    if (el) el.textContent = player ? ('Playing as: ' + player.display_name) : 'Playing anonymously';
  }

  // Show name prompt on first visit
  if (window.CRSupabase && !window.CRSupabase.getLocalPlayer()) {
    showPlayerModal(null);
  }

  // Leaderboard button
  document.getElementById('btn-leaderboard').addEventListener('click', () => {
    showLeaderboard();
  });

  document.getElementById('btn-lb-back').addEventListener('click', () => {
    showScreen('screen-chamber');
  });

  document.getElementById('btn-change-name').addEventListener('click', () => {
    showPlayerModal(updateLbNameDisplay);
  });

  // Leaderboard tab switching
  document.querySelectorAll('.lb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadLeaderboardTab(tab.dataset.tab);
    });
  });

  async function showLeaderboard() {
    updateLbNameDisplay();
    showScreen('screen-leaderboard');
    loadLeaderboardTab('daily-senate');
  }

  async function loadLeaderboardTab(tab) {
    const content = document.getElementById('leaderboard-content');
    content.innerHTML = '<div class="lb-loading">Loading…</div>';

    const d = new Date();
    const puzzleDate = d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();

    try {
      let rows = [];
      if (tab === 'daily-senate') {
        rows = await window.CRSupabase.getDailyLeaderboard('Senate', puzzleDate);
        renderDailyLeaderboard(content, rows, 'Senate', puzzleDate);
      } else if (tab === 'daily-house') {
        rows = await window.CRSupabase.getDailyLeaderboard('House', puzzleDate);
        renderDailyLeaderboard(content, rows, 'House', puzzleDate);
      } else {
        rows = await window.CRSupabase.getAllTimeLeaderboard();
        renderAllTimeLeaderboard(content, rows);
      }
    } catch(e) {
      content.innerHTML = '<div class="lb-empty">Could not load leaderboard.</div>';
    }
  }

  function renderDailyLeaderboard(el, rows, chamber, date) {
    if (rows.length === 0) {
      el.innerHTML = '<div class="lb-empty">No results yet for today\'s ' + chamber + ' puzzle.<br>Be the first!</div>';
      return;
    }
    el.innerHTML = '<table class="lb-table">' +
      '<thead><tr><th>#</th><th>Name</th><th>Guesses</th></tr></thead>' +
      '<tbody>' +
      rows.map((r, i) => {
        const player = window.CRSupabase.getLocalPlayer();
        const isMe   = player && player.display_name === r.display_name;
        return '<tr class="' + (isMe ? 'lb-me' : '') + '">' +
          '<td class="lb-rank">' + (i+1) + '</td>' +
          '<td class="lb-name">' + escapeHtml(r.display_name) + (isMe ? ' ★' : '') + '</td>' +
          '<td class="lb-guesses">' + r.guess_count + ' / 6</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  function renderAllTimeLeaderboard(el, rows) {
    if (rows.length === 0) {
      el.innerHTML = '<div class="lb-empty">No all-time data yet.<br>Play a few daily puzzles to appear here.</div>';
      return;
    }
    el.innerHTML = '<table class="lb-table">' +
      '<thead><tr><th>#</th><th>Name</th><th>Win %</th><th>Avg</th><th>Played</th></tr></thead>' +
      '<tbody>' +
      rows.map((r, i) => {
        const player = window.CRSupabase.getLocalPlayer();
        const isMe   = player && player.display_name === r.display_name;
        return '<tr class="' + (isMe ? 'lb-me' : '') + '">' +
          '<td class="lb-rank">' + (i+1) + '</td>' +
          '<td class="lb-name">' + escapeHtml(r.display_name) + (isMe ? ' ★' : '') + '</td>' +
          '<td>' + r.win_rate + '%</td>' +
          '<td>' + r.avg_guesses + '</td>' +
          '<td>' + r.played + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ----------------------------------------------------------
  // Challenge mode
  // ----------------------------------------------------------
  async function initChallengeFromCode(code) {
    // Show loading state
    document.getElementById('loading').classList.remove('hidden');

    const challenge = await window.CRSupabase.getChallenge(code);
    document.getElementById('loading').classList.add('hidden');

    if (!challenge) {
      alert('Challenge link not found or expired.');
      showScreen('screen-chamber');
      return;
    }

    // Find the target in legislators pool — loadData already called at boot
    const legs = CRGame.getAllLegislators();

    // Look up legislator by icpsr
    const leg = legs.find(l => l.icpsr === challenge.target_icpsr);
    if (!leg || Object.keys(leg.votes || {}).length < 3) {
      alert('Could not load challenge target.');
      showScreen('screen-chamber');
      return;
    }

    const state = CRGame.startChallenge(leg, challenge.chamber);
    _targetDescriptions = leg.vote_summaries     || {};
    _targetDisplayNames = leg.vote_display_names || {};

    // Update header
    document.getElementById('chamber-badge').textContent =
      challenge.chamber + ' · Challenge';
    document.getElementById('guess-counter').textContent =
      '0 / ' + state.maxGuesses;

    // Show challenge banner
    document.getElementById('challenge-banner').classList.remove('hidden');

    // Reset UI
    document.getElementById('guesses-list').innerHTML =
      '<p class="no-guesses-yet">Your guesses will appear here.</p>';
    document.getElementById('search-input').value = '';
    document.getElementById('search-dropdown').classList.add('hidden');
    document.getElementById('btn-submit').disabled = true;
    document.getElementById('gameover-target').innerHTML = '';
    document.getElementById('gameover-votes').innerHTML = '';
    selectedLegislator = null;

    renderVotes(state);
    showScreen('screen-game');

    _gameGeneration++;
    if (!map) await initMap();
    _currentMapChamber = null;
    await updateMap();
  }

  function openChallengeModal(target) {
    const modal = document.getElementById('modal-challenge');
    const display = document.getElementById('challenge-url-display');
    const copyBtn = document.getElementById('btn-copy-challenge');

    display.textContent = 'Generating link…';
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    window.CRSupabase.createChallenge(target.icpsr, target.chamber).then(code => {
      if (!code) {
        display.textContent = 'Could not generate link. Try again.';
        return;
      }
      const url = window.location.origin + window.location.pathname + '?c=' + code;
      display.textContent = url;

      copyBtn.onclick = () => {
        navigator.clipboard.writeText(url).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = url;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        });
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy Challenge Link'; }, 2500);
      };
    });
  }

  document.getElementById('btn-challenge-modal-close').addEventListener('click', () => {
    document.getElementById('modal-challenge').classList.add('hidden');
    document.body.style.overflow = '';
  });
  document.getElementById('modal-challenge').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-challenge')) {
      document.getElementById('modal-challenge').classList.add('hidden');
      document.body.style.overflow = '';
    }
  });

  // ----------------------------------------------------------
  // Game initialisation
  // ----------------------------------------------------------
  let map = null;
  let geojsonLayer = null;
  let stateData = {};   // state abbrev -> { layer, candidates[] }

  let _currentMapChamber = null;  // track which chamber the map is showing
  let _gameGeneration    = 0;     // incremented on each new game to cancel stale timeouts

  async function initGame(chamber, freeplay = false) {
    _gameGeneration++;             // invalidate any pending setTimeout from previous game
    const myGeneration = _gameGeneration;
    const state = CRGame.startGame(chamber, freeplay);

    const activeTarget = CRGame.getCurrentTarget();
    _targetDescriptions = activeTarget ? (activeTarget.vote_summaries     || {}) : {};
    _targetDisplayNames = activeTarget ? (activeTarget.vote_display_names || {}) : {};

    // Header
    document.getElementById('chamber-badge').textContent =
      chamber + (freeplay ? ' · Free Play' : '');
    document.getElementById('guess-counter').textContent =
      `${state.guessCount} / ${state.maxGuesses}`;

    // Reset UI panels fully — including clearing any previous game over state
    document.getElementById('guesses-list').innerHTML =
      '<p class="no-guesses-yet">Your guesses will appear here.</p>';
    document.getElementById('votes-list').innerHTML = '';
    document.getElementById('search-input').value = '';
    document.getElementById('search-dropdown').classList.add('hidden');
    document.getElementById('btn-submit').disabled = true;
    document.getElementById('gameover-target').innerHTML = '';
    document.getElementById('gameover-votes').innerHTML = '';
    selectedLegislator = null;

    renderVotes(state);

    if (state.guessCount > 0) {
      renderGuesses(state);
    }

    showScreen('screen-game');

    // Init map once; force layer rebuild when chamber changes
    if (!map) await initMap();
    if (_currentMapChamber !== chamber) {
      // Remove existing layer to force fresh load for new chamber
      if (geojsonLayer) { map.removeLayer(geojsonLayer); geojsonLayer = null; }
      _currentMapChamber = chamber;
    }
    await updateMap();

    if (state.gameOver) {
      const gen = myGeneration;
      setTimeout(() => {
        if (_gameGeneration === gen) showGameOver(state);
        else console.log('[initGame timeout] stale, skipping');
      }, 300);
    }
  }

  // ----------------------------------------------------------
  // Vote Clues rendering
  // ----------------------------------------------------------
  function renderVotes(state) {
    const list = document.getElementById('votes-list');
    list.innerHTML = '';

    // Get descriptions from the current target (only available post-gameover
    // via state.target, so we store them on a module-level var during startGame)
    state.visibleVotes.forEach(({ label, result }) => {
      const row = document.createElement('div');
      row.className = 'vote-row';
      const cls = result === 'Yea' ? 'yea' : result === 'Nay' ? 'nay' : 'absent';
      const desc        = _targetDescriptions[label]  || '';
      const displayName = _targetDisplayNames[label] || label;
      row.innerHTML = `
        <span class="vote-label ${desc ? 'has-tooltip' : ''}" data-desc="${desc}" data-label="${label}">${displayName}</span>
        <span class="vote-result ${cls}">${result}</span>
      `;
      list.appendChild(row);
    });

    // Bind tooltip events on vote labels
    list.querySelectorAll('.vote-label.has-tooltip').forEach(el => {
      bindTooltip(el, () => {
        const label     = el.dataset.label || '';
        const votePhoto = CRGame.getVotePhoto(label);
        const photoHtml = votePhoto.photo_url
          ? '<img src="' + votePhoto.photo_url + '" alt="' + label + '" class="tooltip-bill-photo" onerror="this.style.display=\'none\'">'
          + (votePhoto.caption ? '<div class="tooltip-bill-caption">' + votePhoto.caption + '</div>' : '')
          : '';
        return '<div class="map-tooltip-title">Vote Description</div>' + photoHtml + el.dataset.desc;
      });
    });

    document.getElementById('votes-revealed-count').textContent =
      `${state.revealedVotes} of ${state.totalVotes} shown`;

    const hint = document.getElementById('votes-hint');
    if (state.revealedVotes < state.totalVotes) {
      hint.textContent = `A new vote is revealed with each wrong guess.`;
    } else {
      hint.textContent = `All available votes shown.`;
    }
  }

  // Stores vote descriptions and display names for the current target
  // without exposing the target itself before game over
  let _targetDescriptions = {};
  let _targetDisplayNames = {};

  // ----------------------------------------------------------
  // Fuzzy search & dropdown
  // ----------------------------------------------------------
  let selectedLegislator = null;

  const searchInput = document.getElementById('search-input');
  const dropdown    = document.getElementById('search-dropdown');
  const btnSubmit   = document.getElementById('btn-submit');

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    selectedLegislator = null;
    btnSubmit.disabled = true;

    if (q.length < 2) {
      dropdown.classList.add('hidden');
      return;
    }

    const results = CRGame.search(q, 8);
    if (results.length === 0) {
      dropdown.classList.add('hidden');
      return;
    }

    dropdown.innerHTML = '';
    results.forEach(leg => {
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      const photoHtml = leg.photo_url
        ? `<img src="${leg.photo_url}" alt="${formatName(leg.name)}"
                class="dropdown-photo"
                onerror="this.style.display='none'">`
        : `<div class="dropdown-photo-placeholder"></div>`;
      item.innerHTML = `
        ${photoHtml}
        <div class="dropdown-item-text">
          <span class="dropdown-item-name">${formatName(leg.name)}</span>
          <span class="dropdown-item-meta">${leg.state} · ${shortParty(leg.party)} · ${CRGame.tenureString(leg)}</span>
        </div>
      `;
      item.addEventListener('click', () => {
        selectedLegislator = leg;
        searchInput.value  = formatName(leg.name);
        dropdown.classList.add('hidden');
        btnSubmit.disabled = false;
      });
      dropdown.appendChild(item);
    });
    dropdown.classList.remove('hidden');
  });

  // Close dropdown on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) {
      dropdown.classList.add('hidden');
    }
  });

  // Keyboard navigation in dropdown
  searchInput.addEventListener('keydown', e => {
    const items = dropdown.querySelectorAll('.dropdown-item');
    const current = dropdown.querySelector('.dropdown-item.selected');
    let idx = Array.from(items).indexOf(current);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (current) current.classList.remove('selected');
      items[Math.min(idx + 1, items.length - 1)]?.classList.add('selected');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (current) current.classList.remove('selected');
      items[Math.max(idx - 1, 0)]?.classList.add('selected');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const sel = dropdown.querySelector('.dropdown-item.selected');
      if (sel) {
        // Confirm highlighted dropdown item
        sel.click();
      } else if (items.length > 0 && !selectedLegislator) {
        // Auto-select first result if dropdown is open
        items[0].click();
      } else if (!btnSubmit.disabled) {
        // Submit if a legislator is already selected
        handleSubmit();
      }
    } else if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
    }
  });

  // ----------------------------------------------------------
  // Submit guess
  // ----------------------------------------------------------
  btnSubmit.addEventListener('click', handleSubmit);

  async function handleSubmit() {
    if (!selectedLegislator || btnSubmit.disabled) return;
    const state = CRGame.submitGuess(selectedLegislator);

    searchInput.value      = '';
    selectedLegislator     = null;
    btnSubmit.disabled     = true;
    dropdown.classList.add('hidden');

    document.getElementById('guess-counter').textContent =
      `${state.guessCount} / ${state.maxGuesses}`;

    renderVotes(state);
    renderGuesses(state);
    await updateMap();

    if (state.gameOver) {
      // Submit to Supabase (daily + challenge, not freeplay)
      if (!state.freeplay && window.CRSupabase && window.CRSupabase.getLocalPlayer()) {
        const target = CRGame.getCurrentTarget();
        const d = new Date();
        const puzzleDate = d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
        window.CRSupabase.submitResult({
          chamber:            state.chamber,
          mode:               state.challenge ? 'challenge' : 'daily',
          targetIcpsr:        target ? target.icpsr : '',
          targetName:         target ? target.name  : '',
          won:                state.won,
          guessCount:         state.guessCount,
          revealedVotesCount: state.revealedVotes,
          puzzleDate,
        });
      }

      const gen = _gameGeneration;
      setTimeout(() => {
        if (_gameGeneration === gen) showGameOver(state);
        else console.log('[handleSubmit timeout] stale, skipping');
      }, 800);
    }
  }

  // expose initGame for freeplay "play again" button
  window._initGame = initGame;

  // ----------------------------------------------------------
  // Guess history rendering
  // ----------------------------------------------------------
  function renderGuesses(state) {
    const list = document.getElementById('guesses-list');
    list.innerHTML = '';

    if (state.guesses.length === 0) {
      list.innerHTML = '<p class="no-guesses-yet">Your guesses will appear here.</p>';
      return;
    }

    state.guesses.forEach((result, i) => {
      const { guess, feedback, correct } = result;
      const row = document.createElement('div');
      row.className = `guess-row${correct ? ' correct' : ''}`;

      // Tenure direction arrow
      const arrow = feedback.tenureDirection === 'later'   ? ' ↑ later'
                  : feedback.tenureDirection === 'earlier' ? ' ↓ earlier'
                  : '';

      row.innerHTML = `
        <div class="guess-row-header">
          <span class="guess-name">${formatName(guess.name)}</span>
          <span class="guess-number">Guess ${i + 1}</span>
        </div>
        <div class="guess-tiles">
          ${guessTile('State',   guess.state,                    feedback.state)}
          ${guessTile('Region',  guess.region || regionOf(guess.state), feedback.region)}
          ${guessTile('Party',   shortParty(guess.party),        feedback.party)}
          ${guessTile('Chamber', guess.chamber,                  feedback.chamber)}
          ${guessTile('Era',     CRGame.tenureString(guess) + arrow, feedback.tenure)}
        </div>
        <div class="guess-votes">
          ${feedback.votes.map(v => voteTile(v)).join('')}
        </div>
      `;
      list.appendChild(row);
    });
  }

  function guessTile(label, value, feedbackClass) {
    return `
      <div class="guess-tile">
        <span class="guess-tile-label">${label}</span>
        <span class="guess-tile-value ${feedbackClass}">${value}</span>
      </div>
    `;
  }

  function voteTile({ label, guessVote, feedback }) {
    const display     = guessVote || 'N/A';
    const displayName = _targetDisplayNames[label] || label;
    const short       = displayName.length > 30 ? displayName.slice(0, 28) + '…' : displayName;
    return `<span class="vote-tile ${feedback}" title="${displayName}: ${display}">${short}</span>`;
  }

  // ----------------------------------------------------------
  // Map
  // ----------------------------------------------------------
  let districtLayerCache = {};   // congress -> GeoJSON data, cached after first load

  async function initMap() {
    map = L.map('map', {
      center: [38, -96],
      zoom: 3.5,
      zoomSnap: 0.5,
      zoomControl: true,
      scrollWheelZoom: false,
      tap: true,
      dragging: true,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    // Load state GeoJSON upfront — always needed for Senate
    try {
      const res  = await fetch('data/us-states.json');
      stateGeoJSON = await res.json();
    } catch (e) {
      console.warn('Could not load us-states.json — map will show tiles only');
    }
  }

  // Stored state GeoJSON for reuse
  let stateGeoJSON = null;

  async function loadDistrictGeoJSON(congress) {
    if (districtLayerCache[congress]) return districtLayerCache[congress];
    const padded = String(congress).padStart(3, '0');
    try {
      // Build absolute URL — window.location.origin ensures we get https://host
      const pathBase = window.location.pathname.replace(/\/[^/]*$/, '/');
      const absBase  = window.location.origin + pathBase;
      const res  = await fetch(absBase + 'data/districts/districts' + padded + '.json');
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      districtLayerCache[congress] = data;
      return data;
    } catch (e) {
      console.warn('Could not load district GeoJSON for Congress ' + congress);
      return null;
    }
  }

  async function updateMap() {
    if (!map) return;

    const state   = CRGame.getState();
    const chamber = state.chamber;

    // Remove existing layer
    if (geojsonLayer) {
      map.removeLayer(geojsonLayer);
      geojsonLayer = null;
    }

    if (chamber === 'House') {
      // Use getCurrentTarget so freeplay targets work too
      const target   = CRGame.getCurrentTarget();
      const congress = target ? target.last_congress : null;


      if (congress) {
        const distData = await loadDistrictGeoJSON(congress);
        if (distData) {
          geojsonLayer = L.geoJSON(distData, {
            style:          districtStyle,
            onEachFeature:  bindDistrictEvents,
            smoothFactor:   2,
          }).addTo(map);
        } else {
        }
      }

      // Fall back to state layer if district file not available
      if (!geojsonLayer && stateGeoJSON) {
        geojsonLayer = L.geoJSON(stateGeoJSON, {
          style:         stateStyle,
          onEachFeature: bindStateEvents,
        }).addTo(map);
      }
    } else {
      // Senate — always use state layer
      if (stateGeoJSON) {
        geojsonLayer = L.geoJSON(stateGeoJSON, {
          style:         stateStyle,
          onEachFeature: bindStateEvents,
        }).addTo(map);
      }
    }

    // Redraw if layer already existed (guess was submitted)
    if (geojsonLayer) {
      geojsonLayer.eachLayer(layer => {
        const isDistrict = layer.feature.properties.DISTRICT !== undefined ||
                           layer.feature.properties.district !== undefined;
        layer.setStyle(isDistrict ? districtStyle(layer.feature)
                                  : stateStyle(layer.feature));
      });
    }

    const viable = CRGame.getViableCandidates();
    document.getElementById('candidate-count').textContent =
      viable.length + ' candidate' + (viable.length !== 1 ? 's' : '') + ' remaining';
  }

  const FIPS_TO_ABBR = {
    '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT',
    '10':'DE','11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL',
    '18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD',
    '25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE',
    '32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND',
    '39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD',
    '47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV',
    '55':'WI','56':'WY','72':'PR',
  };

  // Full state name -> abbreviation for district layer joins
  const NAME_TO_ABBR = {
    'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
    'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
    'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA',
    'Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD',
    'Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS',
    'Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV',
    'New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY',
    'North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
    'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
    'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
    'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI',
    'Wyoming':'WY',
  };

  function getStateAbbr(props) {
    return props.STUSPS || props.postal || props.STUSAB ||
           props.STATE_ABBR || props.abbr ||
           FIPS_TO_ABBR[props.STATE] || '';
  }

  function getDistrictKey(props) {
    // Returns {state, district} for matching against legislators
    const stateName = props.STATENAME || props.state_name || props.StateName || '';
    const stateAbbr = NAME_TO_ABBR[stateName] || '';
    const district  = String(parseInt(props.DISTRICT || props.district || 0));
    return { state: stateAbbr, district };
  }

  // ----------------------------------------------------------
  // Senate — state-level styling and events
  // ----------------------------------------------------------
  function stateStyle(feature) {
    const abbr       = getStateAbbr(feature.properties);
    const eliminated = CRGame.getEliminatedStates();
    const isElim     = eliminated.has(abbr);
    return {
      fillColor:   isElim ? '#c8b99a' : '#8b1a1a',
      fillOpacity: isElim ? 0.18     : 0.35,
      color:       '#7a6a54',
      weight:      1,
      opacity:     0.7,
    };
  }

  function bindStateEvents(feature, layer) {
    const props = feature.properties;
    const abbr  = getStateAbbr(props);
    const name  = props.NAME || props.state_name || props.StateName || abbr;

    layer.on('mouseover', e => {
      const eliminated = CRGame.getEliminatedStates();
      if (eliminated.has(abbr)) return;

      const all        = CRGame.getViableCandidates().filter(l => l.state === abbr);
      const candidates = all.slice(0, 8);
      if (candidates.length === 0) return;

      const tooltip = document.getElementById('map-tooltip');
      tooltip.innerHTML =
        '<div class="map-tooltip-title">' + name + '</div>' +
        '<ul class="tooltip-candidates">' +
        candidates.map(c => '<li>' + formatName(c.name) + '</li>').join('') +
        (all.length > 8
          ? '<li class="tooltip-more">+' + (all.length - 8) + ' more\u2026</li>'
          : '') +
        '</ul>';
      tooltip.classList.remove('hidden');
      moveTooltip(e.originalEvent);
    });

    layer.on('mousemove', e => moveTooltip(e.originalEvent));
    layer.on('mouseout', () => {
      document.getElementById('map-tooltip').classList.add('hidden');
    });
  }

  // ----------------------------------------------------------
  // House — district-level styling and events
  // ----------------------------------------------------------
  function districtStyle(feature) {
    const { state, district } = getDistrictKey(feature.properties);
    const eliminated = CRGame.getEliminatedStates();

    const isStateElim = eliminated.has(state);
    const hasCandidate = !isStateElim && CRGame.getViableCandidates()
      .some(l => l.state === state &&
                 CRGame.getDistrictCodeForMap(l) === district);

    const isElim = isStateElim || !hasCandidate;
    return {
      fillColor:   isElim ? '#c8b99a' : '#8b1a1a',
      fillOpacity: isElim ? 0.15     : 0.40,
      color:       '#7a6a54',
      weight:      0.5,
      opacity:     0.7,
    };
  }

  function bindDistrictEvents(feature, layer) {
    const { state, district } = getDistrictKey(feature.properties);
    const stateName = feature.properties.STATENAME || state;

    layer.on('mouseover', e => {
      const candidates = CRGame.getViableCandidates()
        .filter(l => l.state === state &&
                     CRGame.getDistrictCodeForMap(l) === district);

      if (candidates.length === 0) return;

      const label   = stateName + (district !== '0' ? ' District ' + district : ' (At-Large)');
      const tooltip = document.getElementById('map-tooltip');
      tooltip.innerHTML =
        '<div class="map-tooltip-title">' + label + '</div>' +
        '<ul class="tooltip-candidates">' +
        candidates.map(c => '<li>' + formatName(c.name) + '</li>').join('') +
        '</ul>';
      tooltip.classList.remove('hidden');
      moveTooltip(e.originalEvent);
    });

    layer.on('mousemove', e => moveTooltip(e.originalEvent));
    layer.on('mouseout', () => {
      document.getElementById('map-tooltip').classList.add('hidden');
    });
  }

  function moveTooltip(e) {
    const t = document.getElementById('map-tooltip');
    t.style.left = (e.clientX + 14) + 'px';
    t.style.top  = (e.clientY - 10) + 'px';
  }

  function hideTooltip() {
    document.getElementById('map-tooltip').classList.add('hidden');
  }

  // isTouchDevice — true if primary input is touch
  const isTouchDevice = () => window.matchMedia('(hover: none)').matches;

  // bindTooltip — attaches mouse + touch events to an element.
  // getHtml: function returning the tooltip innerHTML string.
  // For touch: first tap opens, second tap (or tap elsewhere) closes.
  function bindTooltip(el, getHtml) {
    // Mouse events (desktop)
    el.addEventListener('mouseenter', e => {
      if (isTouchDevice()) return;
      const tooltip = document.getElementById('map-tooltip');
      tooltip.innerHTML = getHtml();
      tooltip.classList.remove('hidden');
      moveTooltip(e);
    });
    el.addEventListener('mousemove', e => {
      if (isTouchDevice()) return;
      moveTooltip(e);
    });
    el.addEventListener('mouseleave', () => {
      if (isTouchDevice()) return;
      hideTooltip();
    });

    // Touch events (mobile) — tap to toggle
    el.addEventListener('touchend', e => {
      e.preventDefault(); // prevent ghost click
      const tooltip = document.getElementById('map-tooltip');
      const isOpen  = !tooltip.classList.contains('hidden') &&
                      tooltip.dataset.owner === el.dataset.label;

      // Close any open tooltip first
      hideTooltip();

      if (!isOpen) {
        tooltip.innerHTML  = getHtml();
        tooltip.dataset.owner = el.dataset.label || '';
        // Position near the element itself on mobile
        const rect = el.getBoundingClientRect();
        tooltip.style.left = Math.min(rect.left, window.innerWidth - 300) + 'px';
        tooltip.style.top  = (rect.bottom + window.scrollY + 8) + 'px';
        tooltip.classList.remove('hidden');
      }
    });
  }

  // Close tooltip when tapping outside any tooltip-bound element
  document.addEventListener('touchend', e => {
    if (!e.target.closest('.has-tooltip') && !e.target.closest('.map-tooltip')) {
      hideTooltip();
    }
  });

  // ----------------------------------------------------------
  // Already Played Today Screen
  // ----------------------------------------------------------
  function showAlreadyPlayed(chamber, savedState) {
    const state   = CRGame.getState();
    const target  = state.target;
    const streak  = CRGame.getStreak();
    const content = document.getElementById('already-played-content');
    const streakEl= document.getElementById('already-played-streak');

    const resultLine = savedState.won
      ? `You identified today's ${chamber} puzzle in ${savedState.guesses.length} guess${savedState.guesses.length !== 1 ? 'es' : ''}.`
      : `You did not identify today's ${chamber} puzzle.`;

    content.innerHTML = `
      <div class="already-played-banner ${savedState.won ? 'won' : 'lost'}">
        <div class="gameover-headline">${savedState.won ? 'Already solved!' : 'Already played!'}</div>
        <div class="gameover-sub">${resultLine}</div>
      </div>
      ${target ? `<div class="already-played-target">
        <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(wikiName(target.name))}"
           target="_blank" rel="noopener" class="wiki-link">${formatName(target.name)}</a>
        <div class="gameover-target-meta">${target.chamber} · ${target.state} · ${shortParty(target.party)} · ${CRGame.tenureString(target)}</div>
      </div>` : ''}
    `;

    const pct = streak.totalPlayed > 0
      ? Math.round((streak.totalWon / streak.totalPlayed) * 100) : 0;
    streakEl.innerHTML = `
      <div class="streak-stats">
        <div class="streak-stat"><span class="streak-num">${streak.totalPlayed}</span><span class="streak-label">Played</span></div>
        <div class="streak-stat"><span class="streak-num">${pct}%</span><span class="streak-label">Win rate</span></div>
        <div class="streak-stat"><span class="streak-num">${streak.current}</span><span class="streak-label">Streak</span></div>
        <div class="streak-stat"><span class="streak-num">${streak.best}</span><span class="streak-label">Best</span></div>
      </div>
    `;

    // Share button
    document.getElementById('btn-already-share').onclick = () => {
      const text = CRGame.buildShareString(state);
      navigator.clipboard.writeText(text).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta);
        ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
      }).finally ? null : null;
      document.getElementById('btn-already-share').textContent = 'Copied!';
      setTimeout(() => {
        document.getElementById('btn-already-share').textContent = 'Copy Result';
      }, 2500);
    };

    const other = chamber === 'Senate' ? 'House' : 'Senate';
    const btnAlreadyMenu = document.getElementById('btn-already-menu');
    if (btnAlreadyMenu) btnAlreadyMenu.onclick = () => showScreen('screen-chamber');
    document.getElementById('already-other-chamber').textContent = other;
    document.getElementById('btn-already-other').onclick = () => initGame(other, false);
    document.getElementById('btn-already-freeplay-chamber').textContent = chamber;
    document.getElementById('btn-already-freeplay').onclick = () => initGame(chamber, true);

    showScreen('screen-already-played');
  }

  // ----------------------------------------------------------
  // Game Over Screen
  // ----------------------------------------------------------
  function showGameOver(state) {
    const target = state.target || CRGame.getCurrentTarget();

    console.log('[showGameOver] called, target:', target ? target.name : 'NULL',
                'gameOver:', state.gameOver, 'won:', state.won,
                'generation check passed');

    if (!target) {
      return;
    }

    const banner  = document.getElementById('gameover-banner');
    const tDiv    = document.getElementById('gameover-target');
    const vDiv    = document.getElementById('gameover-votes');

    banner.className = `gameover-banner ${state.won ? 'won' : 'lost'}`;
    banner.innerHTML = state.won
      ? `<div class="gameover-headline">Identified!</div>
         <div class="gameover-sub">You got it in ${state.guessCount} guess${state.guessCount !== 1 ? 'es' : ''}.</div>`
      : state.freeplay
        ? `<div class="gameover-headline">Not quite.</div>
           <div class="gameover-sub">Try another?</div>`
        : `<div class="gameover-headline">Not quite.</div>
           <div class="gameover-sub">Better luck tomorrow.</div>`;

    // Most revealing vote — highest dissent score
    const revealingLabel = target.most_revealing_vote;
    let revealingHtml = '';
    if (revealingLabel && target.vote_party_context) {
      const ctx         = target.vote_party_context[revealingLabel] || {};
      const displayName = (target.vote_display_names || {})[revealingLabel] || revealingLabel;
      const cast        = target.votes[revealingLabel];
      const partyName   = shortParty(target.party);
      const p_yea       = ctx.party_yea || 0;
      const p_nay       = ctx.party_nay || 0;
      const t_yea       = ctx.yea_total || 0;
      const t_nay       = ctx.nay_total || 0;
      const partyTotal  = p_yea + p_nay;
      const chamberTotal= t_yea + t_nay;

      // Build the "one of only X" stat
      let statParts = [];
      if (partyTotal > 0) {
        const partyAgainst = cast === 'Yea' ? p_nay : p_yea;
        const partyWith    = cast === 'Yea' ? p_yea : p_nay;
        if (partyWith < partyAgainst) {
          statParts.push(`One of only ${partyWith} ${partyName}s to vote ${cast} (${partyAgainst} voted ${cast === 'Yea' ? 'Nay' : 'Yea'})`);
        }
      }
      if (chamberTotal > 0) {
        const totalAgainst = cast === 'Yea' ? t_nay : t_yea;
        const totalWith    = cast === 'Yea' ? t_yea : t_nay;
        if (totalWith < totalAgainst) {
          statParts.push(`${totalWith} of ${chamberTotal} total ${target.chamber} members voted ${cast}`);
        }
      }

      if (statParts.length > 0) {
        revealingHtml = `
          <div class="revealing-vote">
            <div class="revealing-vote-label">Most revealing vote</div>
            <div class="revealing-vote-name">${displayName}: <span class="vote-result ${cast.toLowerCase()}">${cast}</span></div>
            <div class="revealing-vote-stat">${statParts.join(' · ')}</div>
          </div>
        `;
      }
    }

    const photoHtml = target.photo_url
      ? `<img src="${target.photo_url}" alt="${formatName(target.name)}"
              class="legislator-photo"
              onerror="this.style.display='none'">`
      : '';

    tDiv.innerHTML = `
      <div class="gameover-target-header">
        ${photoHtml}
        <div class="gameover-target-info">
          <div class="gameover-target-name">
            <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(wikiName(target.name))}"
               target="_blank" rel="noopener" class="wiki-link">${formatName(target.name)}</a>
          </div>
          <div class="gameover-target-meta">
            ${target.chamber} · ${target.state} · ${shortParty(target.party)} ·
            ${CRGame.tenureString(target)}
          </div>
        </div>
      </div>
      ${revealingHtml}
    `;

    // Full voting record
    const allVotes = Object.entries(target.votes);
    vDiv.innerHTML = `
      <div class="gameover-votes-title">Complete Voting Record (${allVotes.length} votes)</div>
      <div class="votes-list">
        ${allVotes.map(([label, result]) => {
          const cls         = result === 'Yea' ? 'yea' : result === 'Nay' ? 'nay' : 'absent';
          const displayName = (target.vote_display_names || {})[label] || label;
          const summary     = (target.vote_summaries     || {})[label] || '';
          return `<div class="vote-row ${summary ? 'has-tooltip' : ''}"
                       data-desc="${summary}">
            <span class="vote-label">${displayName}</span>
            <span class="vote-result ${cls}">${result}</span>
          </div>`;
        }).join('')}
      </div>
    `;

    // Bind tooltips on game over vote rows
    vDiv.querySelectorAll('.vote-row.has-tooltip').forEach(el => {
      bindTooltip(el, () =>
        '<div class="map-tooltip-title">About this vote</div>' + el.dataset.desc
      );
    });

    // Share button
    const shareBtn = document.getElementById('btn-share');
    const shareConfirm = document.getElementById('share-confirm');
    shareBtn.onclick = () => {
      const text = CRGame.buildShareString(CRGame.getState());
      navigator.clipboard.writeText(text).then(() => {
        shareConfirm.classList.remove('hidden');
        shareBtn.textContent = 'Copied!';
        setTimeout(() => {
          shareConfirm.classList.add('hidden');
          shareBtn.textContent = 'Copy Result';
        }, 2500);
      }).catch(() => {
        // Fallback for browsers without clipboard API
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        shareBtn.textContent = 'Copied!';
        setTimeout(() => { shareBtn.textContent = 'Copy Result'; }, 2500);
      });
    };

    // Other chamber / play again / freeplay buttons
    const other    = target.chamber === 'Senate' ? 'House' : 'Senate';
    const freeplay = state.freeplay;

    // Grab all game over buttons upfront
    const btnChallenge        = document.getElementById('btn-challenge');
    const btnMainMenu         = document.getElementById('btn-main-menu');
    const btnGoLb             = document.getElementById('btn-gameover-leaderboard');
    const freeplayBtn         = document.getElementById('btn-play-freeplay');
    const freeplayChamberSpan = document.getElementById('freeplay-chamber');
    const otherChamberSpan    = document.getElementById('other-chamber');
    const btnPlayOther        = document.getElementById('btn-play-other');

    // Challenge button — only for daily games
    if (btnChallenge) {
      if (!state.freeplay && !state.challenge) {
        btnChallenge.style.display = '';
        btnChallenge.onclick = () => openChallengeModal(target);
      } else {
        btnChallenge.style.display = 'none';
      }
    }

    // Main menu button
    if (btnMainMenu) btnMainMenu.onclick = () => showScreen('screen-chamber');

    // Leaderboard button
    if (btnGoLb) btnGoLb.onclick = () => showLeaderboard();

    // Freeplay button
    if (freeplayChamberSpan) freeplayChamberSpan.textContent = target.chamber;
    if (freeplayBtn) {
      freeplayBtn.onclick       = () => initGame(target.chamber, true);
      freeplayBtn.style.display = '';
    }

    if (freeplay) {
      if (otherChamberSpan) otherChamberSpan.textContent = 'Again';
      if (btnPlayOther) {
        btnPlayOther.textContent = 'Play Again';
        btnPlayOther.onclick     = () => initGame(target.chamber, true);
      }
      if (freeplayBtn) freeplayBtn.style.display = 'none';
    } else {
      if (otherChamberSpan) otherChamberSpan.textContent = other;
      if (btnPlayOther) {
        btnPlayOther.textContent = 'Play ' + other;
        btnPlayOther.onclick     = () => initGame(other, false);
      }
    }

    // Refresh streak display
    renderStreak();

    showScreen('screen-gameover');
  }

  // ----------------------------------------------------------
  // Utility helpers
  // ----------------------------------------------------------

  function formatName(raw) {
    // "BYRD, Robert Carlyle" -> "Robert Carlyle Byrd"
    const parts = raw.split(',');
    if (parts.length < 2) return raw;
    const last  = parts[0].trim();
    const first = parts.slice(1).join(',').trim();
    return `${toTitleCase(first)} ${toTitleCase(last)}`;
  }

  function wikiName(raw) {
    // Like formatName but strips parenthetical nicknames for Wikipedia URLs
    // "KENNEDY, Edward Moore (Ted), Jr." -> "Edward Moore Kennedy"
    const parts = raw.split(',');
    if (parts.length < 2) return formatName(raw);
    const last  = parts[0].trim();
    // Remove suffixes like Jr., Sr., II, III and nicknames in parens
    const first = parts.slice(1).join(',')
      .replace(/\([^)]*\)/g, '')  // strip (Ted), (Scoop), (Joe) etc.
      .replace(/\b(Jr|Sr|II|III|IV)\b\.?/gi, '')
      .trim();
    return toTitleCase(first) + ' ' + toTitleCase(last);
  }

  function toTitleCase(str) {
    return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  function shortParty(party) {
    if (!party) return '?';
    const u = party.toUpperCase();
    if (u.includes('DEMOCRAT'))   return 'D';
    if (u.includes('REPUBLICAN')) return 'R';
    if (u.includes('INDEPENDENT'))return 'I';
    if (u.includes('WHIG'))       return 'W';
    if (u.includes('POPULIST'))   return 'Pop';
    return party.slice(0, 3);
  }

  function regionOf(state) {
    return CRGame.STATE_TO_REGION[state] || '?';
  }

})();
