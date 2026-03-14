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

  // Set today's date in masthead
  document.getElementById('today-date').textContent =
    new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // Check if there's a saved session from today and restore it
  const d = new Date();
  const dateKey = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  for (const chamber of ['Senate', 'House']) {
    try {
      const saved = localStorage.getItem(`crg_${chamber}_${dateKey}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.guesses && parsed.guesses.length > 0) {
          // Restore this session silently
          await initGame(chamber);
          return;
        }
      }
    } catch(e) {}
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
      const chamber = btn.dataset.chamber;
      initGame(chamber);
    });
  });

  document.getElementById('btn-back').addEventListener('click', () => {
    showScreen('screen-chamber');
  });

  // ----------------------------------------------------------
  // Game initialisation
  // ----------------------------------------------------------
  let map = null;
  let geojsonLayer = null;
  let stateData = {};   // state abbrev -> { layer, candidates[] }

  async function initGame(chamber) {
    const state = CRGame.startGame(chamber);

    // Pre-load vote display names and summaries for this target
    // without exposing the target identity
    const dailyTarget = CRGame.getDailyTarget(chamber);
    _targetDescriptions  = dailyTarget ? (dailyTarget.vote_summaries      || {}) : {};
    _targetDisplayNames  = dailyTarget ? (dailyTarget.vote_display_names  || {}) : {};

    // Header
    document.getElementById('chamber-badge').textContent = chamber;
    document.getElementById('guess-counter').textContent =
      `${state.guessCount} / ${state.maxGuesses}`;

    // Reset UI panels
    document.getElementById('guesses-list').innerHTML =
      '<p class="no-guesses-yet">Your guesses will appear here.</p>';
    document.getElementById('search-input').value = '';
    document.getElementById('search-dropdown').classList.add('hidden');
    document.getElementById('btn-submit').disabled = true;
    selectedLegislator = null;

    renderVotes(state);

    // If game was already in progress or over, restore the full UI
    if (state.guessCount > 0) {
      renderGuesses(state);
    }

    showScreen('screen-game');

    // Init map (only once)
    if (!map) await initMap();
    updateMap();

    // If already game over, jump straight to reveal
    if (state.gameOver) {
      setTimeout(() => showGameOver(state), 300);
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
        <span class="vote-label ${desc ? 'has-tooltip' : ''}" data-desc="${desc}">${displayName}</span>
        <span class="vote-result ${cls}">${result}</span>
      `;
      list.appendChild(row);
    });

    // Bind tooltip events on vote labels
    list.querySelectorAll('.vote-label.has-tooltip').forEach(el => {
      el.addEventListener('mouseenter', e => {
        const tooltip = document.getElementById('map-tooltip');
        tooltip.innerHTML = `<div class="map-tooltip-title">Vote Description</div>${el.dataset.desc}`;
        tooltip.classList.remove('hidden');
        moveTooltip(e);
      });
      el.addEventListener('mousemove', moveTooltip);
      el.addEventListener('mouseleave', () => {
        document.getElementById('map-tooltip').classList.add('hidden');
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
      item.innerHTML = `
        <span class="dropdown-item-name">${formatName(leg.name)}</span>
        <span class="dropdown-item-meta">${leg.state} · ${shortParty(leg.party)} · ${CRGame.tenureString(leg)}</span>
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
      const sel = dropdown.querySelector('.dropdown-item.selected');
      if (sel) sel.click();
      else if (!btnSubmit.disabled) handleSubmit();
    } else if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
    }
  });

  // ----------------------------------------------------------
  // Submit guess
  // ----------------------------------------------------------
  btnSubmit.addEventListener('click', handleSubmit);

  function handleSubmit() {
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
    updateMap();

    if (state.gameOver) {
      setTimeout(() => showGameOver(state), 800);
    }
  }

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
  async function initMap() {
    map = L.map('map', {
      center: [39, -98],
      zoom: 4,
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: false,
    });

    // Minimal tile layer — muted to let our colours stand out
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    // Load US states GeoJSON
    try {
      const res  = await fetch('data/us-states.json');
      const data = await res.json();
      geojsonLayer = L.geoJSON(data, {
        style: stateStyle,
        onEachFeature: bindStateEvents,
      }).addTo(map);
    } catch (e) {
      console.warn('Could not load us-states.geojson — map will show tiles only');
    }
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

  function getStateAbbr(props) {
    return props.STUSPS || props.postal || props.STUSAB ||
           props.STATE_ABBR || props.abbr ||
           FIPS_TO_ABBR[props.STATE] || '';
  }

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

      const candidates = CRGame.getViableCandidates()
        .filter(l => l.state === abbr)
        .slice(0, 8);

      if (candidates.length === 0) return;

      const tooltip = document.getElementById('map-tooltip');
      tooltip.innerHTML = `
        <div class="map-tooltip-title">${name}</div>
        <ul class="tooltip-candidates">
          ${candidates.map(c => `<li>${formatName(c.name)}</li>`).join('')}
          ${CRGame.getViableCandidates().filter(l => l.state === abbr).length > 8
            ? `<li class="tooltip-more">+${CRGame.getViableCandidates().filter(l => l.state === abbr).length - 8} more…</li>`
            : ''}
        </ul>
      `;
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

  function updateMap() {
    if (!geojsonLayer) return;

    // Force redraw each layer individually — more reliable than setStyle()
    geojsonLayer.eachLayer(layer => {
      layer.setStyle(stateStyle(layer.feature));
    });

    const viable = CRGame.getViableCandidates();
    document.getElementById('candidate-count').textContent =
      `${viable.length} candidate${viable.length !== 1 ? 's' : ''} remaining`;
  }

  // ----------------------------------------------------------
  // Game Over Screen
  // ----------------------------------------------------------
  function showGameOver(state) {
    const target  = state.target;
    const banner  = document.getElementById('gameover-banner');
    const tDiv    = document.getElementById('gameover-target');
    const vDiv    = document.getElementById('gameover-votes');

    banner.className = `gameover-banner ${state.won ? 'won' : 'lost'}`;
    banner.innerHTML = state.won
      ? `<div class="gameover-headline">Identified!</div>
         <div class="gameover-sub">You got it in ${state.guessCount} guess${state.guessCount !== 1 ? 'es' : ''}.</div>`
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

    tDiv.innerHTML = `
      <div class="gameover-target-name">${formatName(target.name)}</div>
      <div class="gameover-target-meta">
        ${target.chamber} · ${target.state} · ${shortParty(target.party)} ·
        ${CRGame.tenureString(target)}
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
      el.addEventListener('mouseenter', e => {
        const tooltip = document.getElementById('map-tooltip');
        tooltip.innerHTML = '<div class="map-tooltip-title">About this vote</div>' + el.dataset.desc;
        tooltip.classList.remove('hidden');
        moveTooltip(e);
      });
      el.addEventListener('mousemove', moveTooltip);
      el.addEventListener('mouseleave', () => {
        document.getElementById('map-tooltip').classList.add('hidden');
      });
    });

    const other = target.chamber === 'Senate' ? 'House' : 'Senate';
    document.getElementById('other-chamber').textContent = other;
    document.getElementById('btn-play-other').onclick = () => initGame(other);

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
