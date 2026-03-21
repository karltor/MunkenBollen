import { db } from './config.js';
import { doc, getDoc, setDoc, deleteField, collection, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f } from './wizard.js';

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
let allMatches = [];
let currentAdminGroup = 'A';
let existingResults = {};
let initDone = false;

export async function initAdmin(matchesData) {
    allMatches = matchesData;
    await refreshLockStatus();

    const resultsSnap = await getDoc(doc(db, "matches", "_results"));
    existingResults = resultsSnap.exists() ? resultsSnap.data() : {};

    currentAdminGroup = GROUP_LETTERS.find(letter => {
        const gm = allMatches.filter(m => m.stage === `Grupp ${letter}`);
        return gm.some(m => !existingResults[m.id]);
    }) || 'A';

    renderGroupButtons();
    renderAdminMatches(currentAdminGroup);
    renderTeamRenames();
    renderAdminBracket();

    if (!initDone) {
        document.getElementById('admin-lock-tips').addEventListener('click', () => toggleLock(true));
        document.getElementById('admin-unlock-tips').addEventListener('click', () => toggleLock(false));
        document.getElementById('admin-save-results').addEventListener('click', saveAdminResults);
        initDone = true;
    }
}

function renderGroupButtons() {
    const groupSelect = document.getElementById('admin-group-select');
    groupSelect.innerHTML = '';
    const now = Date.now();

    GROUP_LETTERS.forEach(letter => {
        const gm = allMatches.filter(m => m.stage === `Grupp ${letter}`);
        const allDone = gm.every(m => existingResults[m.id]);
        const hasOverdue = gm.some(m => !existingResults[m.id] && isOverdue(m.date, now));

        const btn = document.createElement('button');
        btn.className = 'admin-group-btn' + (letter === currentAdminGroup ? ' active' : '');
        if (hasOverdue) btn.classList.add('overdue');
        btn.textContent = letter;
        if (allDone) btn.style.opacity = '0.5';
        btn.addEventListener('click', () => {
            currentAdminGroup = letter;
            groupSelect.querySelectorAll('.admin-group-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderAdminMatches(letter);
        });
        groupSelect.appendChild(btn);
    });
}

// Parse date like "18 juni 21:00" or "12 juni 04:00" relative to 2026
function parseMatchDate(dateStr) {
    if (!dateStr) return null;
    const months = { 'januari': 0, 'februari': 1, 'mars': 2, 'april': 3, 'maj': 4, 'juni': 5, 'juli': 6, 'augusti': 7, 'september': 8, 'oktober': 9, 'november': 10, 'december': 11 };
    const parts = dateStr.trim().match(/^(\d+)\s+(\w+)\s+(\d{1,2}):(\d{2})$/);
    if (!parts) return null;
    const day = parseInt(parts[1]);
    const month = months[parts[2].toLowerCase()];
    if (month === undefined) return null;
    return new Date(2026, month, day, parseInt(parts[3]), parseInt(parts[4]));
}

function isOverdue(dateStr, now) {
    const kickoff = parseMatchDate(dateStr);
    if (!kickoff) return false;
    return (now - kickoff.getTime()) > 2.5 * 60 * 60 * 1000;
}

async function refreshLockStatus() {
    const el = document.getElementById('admin-lock-status');
    const snap = await getDoc(doc(db, "matches", "_settings"));
    const locked = snap.exists() && snap.data().tipsLocked;
    el.textContent = locked ? '🔒 Tipsraderna är LÅSTA.' : '🔓 Tipsraderna är öppna.';
    el.style.background = locked ? '#fce8e6' : '#e8f5e9';
    el.style.color = locked ? '#c62828' : '#2e7d32';
}

async function toggleLock(lock) {
    await setDoc(doc(db, "matches", "_settings"), { tipsLocked: lock }, { merge: true });
    await refreshLockStatus();
}

function renderAdminMatches(letter) {
    const container = document.getElementById('admin-matches');
    let groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);

    if (groupMatches.length === 0) {
        container.innerHTML = '<p style="color: #999;">Inga matcher i denna grupp.</p>';
        return;
    }

    groupMatches.sort((a, b) => {
        const aDone = !!existingResults[a.id];
        const bDone = !!existingResults[b.id];
        if (aDone !== bDone) return aDone ? 1 : -1;
        return (a.date || '').localeCompare(b.date || '');
    });

    container.innerHTML = '';
    groupMatches.forEach(m => {
        const r = existingResults[m.id] || {};
        const done = r.homeScore !== undefined;
        const div = document.createElement('div');
        div.className = 'admin-match-card' + (done ? ' completed' : '');
        div.innerHTML = `
            <span class="match-date">${m.date || ''}</span>
            <span style="flex:1; font-weight:600;">${f(m.homeTeam)}${m.homeTeam}</span>
            <input type="number" min="0" class="score-input" id="adminHome-${m.id}" value="${r.homeScore ?? ''}" placeholder="-">
            <span style="color:#aaa; font-weight:bold;">:</span>
            <input type="number" min="0" class="score-input" id="adminAway-${m.id}" value="${r.awayScore ?? ''}" placeholder="-">
            <span style="flex:1; text-align:right; font-weight:600;">${m.awayTeam}${f(m.awayTeam)}</span>
            ${done ? `<button class="btn-delete-result" data-match-id="${m.id}" title="Ta bort resultat">✕</button>` : ''}`;
        container.appendChild(div);
    });

    // Wire delete buttons
    container.querySelectorAll('.btn-delete-result').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const matchId = btn.dataset.matchId;
            delete existingResults[matchId];
            await setDoc(doc(db, "matches", "_results"), existingResults);
            renderAdminMatches(currentAdminGroup);
            renderGroupButtons();
        });
    });
}

async function saveAdminResults() {
    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${currentAdminGroup}`);
    let saved = 0;
    groupMatches.forEach(m => {
        const hEl = document.getElementById(`adminHome-${m.id}`);
        const aEl = document.getElementById(`adminAway-${m.id}`);
        if (hEl && aEl && hEl.value !== '' && aEl.value !== '') {
            existingResults[m.id] = {
                homeScore: parseInt(hEl.value), awayScore: parseInt(aEl.value),
                homeTeam: m.homeTeam, awayTeam: m.awayTeam, stage: m.stage
            };
            saved++;
        }
    });
    if (!saved) return;
    await setDoc(doc(db, "matches", "_results"), existingResults, { merge: true });
    renderAdminMatches(currentAdminGroup);
    renderGroupButtons();
}

// ─── TEAM RENAME ────────────────────────────────────
function renderTeamRenames() {
    const container = document.getElementById('admin-team-rename');
    // Find teams with "/" in name (undecided qualifiers)
    const undecided = new Set();
    allMatches.forEach(m => {
        if (m.homeTeam?.includes('/')) undecided.add(m.homeTeam);
        if (m.awayTeam?.includes('/')) undecided.add(m.awayTeam);
    });

    if (undecided.size === 0) {
        container.innerHTML = '<p style="color:#999; font-size:14px;">Alla lag är bekräftade.</p>';
        return;
    }

    let html = '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px;">';
    Array.from(undecided).sort().forEach(team => {
        html += `<div style="display:flex; gap:6px; align-items:center;">
            <span style="font-size:13px; min-width:130px; font-weight:600;">${f(team)}${team}</span>
            <span style="color:#aaa;">→</span>
            <input class="rename-input" data-old-name="${team}" value="" placeholder="Nytt namn" style="flex:1; padding:6px; border:1px solid #ddd; border-radius:4px; font-size:13px;">
        </div>`;
    });
    html += '</div>';
    html += '<button class="btn" id="admin-save-renames" style="margin-top:10px; width:100%;">Uppdatera lagnamn</button>';
    container.innerHTML = html;

    document.getElementById('admin-save-renames').addEventListener('click', saveTeamRenames);
}

async function saveTeamRenames() {
    const inputs = document.querySelectorAll('.rename-input');
    const renames = {};
    inputs.forEach(inp => {
        const newName = inp.value.trim();
        if (newName) renames[inp.dataset.oldName] = newName;
    });

    if (Object.keys(renames).length === 0) return;

    // Update all match documents in Firestore
    const matchesSnap = await getDocs(collection(db, "matches"));
    const batch = writeBatch(db);
    let updated = 0;

    matchesSnap.docs.forEach(d => {
        if (d.id.startsWith('_')) return;
        const data = d.data();
        let changed = false;
        const newData = { ...data };
        if (renames[data.homeTeam]) { newData.homeTeam = renames[data.homeTeam]; changed = true; }
        if (renames[data.awayTeam]) { newData.awayTeam = renames[data.awayTeam]; changed = true; }
        if (changed) { batch.set(doc(db, "matches", d.id), newData); updated++; }
    });

    if (updated > 0) {
        await batch.commit();
        // Update local data too
        allMatches.forEach(m => {
            if (renames[m.homeTeam]) m.homeTeam = renames[m.homeTeam];
            if (renames[m.awayTeam]) m.awayTeam = renames[m.awayTeam];
        });
        renderAdminMatches(currentAdminGroup);
        renderTeamRenames();
    }
}

// ─── ADMIN BRACKET BUILDER ──────────────────────────
async function renderAdminBracket() {
    const container = document.getElementById('admin-bracket');
    const bracketSnap = await getDoc(doc(db, "matches", "_bracket"));
    const bracket = bracketSnap.exists() ? bracketSnap.data() : { teams: [], rounds: {} };

    const rounds = ['R32', 'R16', 'KF', 'SF', 'Final'];
    const matchCounts = [16, 8, 4, 2, 1];

    let html = `<div style="overflow-x: auto;">`;
    html += `<div style="display: flex; gap: 10px; min-width: 900px;">`;

    rounds.forEach((round, ri) => {
        const count = matchCounts[ri];
        const roundMatches = bracket.rounds?.[round] || [];

        html += `<div style="flex: 1; min-width: 160px;">`;
        html += `<div style="text-align:center; font-weight:700; font-size:13px; margin-bottom:8px; color: ${ri === 4 ? '#ffc107' : '#333'};">${round}</div>`;

        for (let i = 0; i < count; i++) {
            const match = roundMatches[i] || {};
            html += `<div style="background:#f0f0f0; border-radius:6px; padding:6px; margin-bottom:6px; font-size:12px;">`;
            html += `<div style="display:flex; gap:4px; margin-bottom:3px;">
                <input class="admin-bracket-team" data-round="${round}" data-match="${i}" data-side="1" value="${match.team1 || ''}" placeholder="Lag 1" style="flex:1; padding:4px; border:1px solid #ddd; border-radius:4px; font-size:12px;">
                <input type="number" class="admin-bracket-score" data-round="${round}" data-match="${i}" data-side="1" value="${match.score1 ?? ''}" placeholder="-" style="width:30px; text-align:center; border:1px solid #ddd; border-radius:4px; font-size:12px;">
            </div>`;
            html += `<div style="display:flex; gap:4px;">
                <input class="admin-bracket-team" data-round="${round}" data-match="${i}" data-side="2" value="${match.team2 || ''}" placeholder="Lag 2" style="flex:1; padding:4px; border:1px solid #ddd; border-radius:4px; font-size:12px;">
                <input type="number" class="admin-bracket-score" data-round="${round}" data-match="${i}" data-side="2" value="${match.score2 ?? ''}" placeholder="-" style="width:30px; text-align:center; border:1px solid #ddd; border-radius:4px; font-size:12px;">
            </div>`;
            html += `</div>`;
        }
        html += `</div>`;
    });

    html += `</div></div>`;
    html += `<button class="btn" id="admin-save-bracket" style="margin-top: 15px; width: 100%; background: #ffc107; color: #000;">Spara bracket</button>`;
    container.innerHTML = html;

    document.getElementById('admin-save-bracket').addEventListener('click', () => saveAdminBracket(rounds, matchCounts));
    container.querySelectorAll('.admin-bracket-score').forEach(input => {
        input.addEventListener('change', () => autoAdvanceWinners(rounds, matchCounts));
    });
}

function autoAdvanceWinners(rounds, matchCounts) {
    for (let ri = 0; ri < rounds.length - 1; ri++) {
        const round = rounds[ri], nextRound = rounds[ri + 1], count = matchCounts[ri];
        for (let i = 0; i < count; i++) {
            const t1El = document.querySelector(`.admin-bracket-team[data-round="${round}"][data-match="${i}"][data-side="1"]`);
            const t2El = document.querySelector(`.admin-bracket-team[data-round="${round}"][data-match="${i}"][data-side="2"]`);
            const s1El = document.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${i}"][data-side="1"]`);
            const s2El = document.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${i}"][data-side="2"]`);
            if (!t1El || !t2El || !s1El || !s2El || s1El.value === '' || s2El.value === '') continue;
            const s1 = parseInt(s1El.value), s2 = parseInt(s2El.value);
            const winner = s1 > s2 ? t1El.value : (s2 > s1 ? t2El.value : '');
            if (winner) {
                const nextEl = document.querySelector(`.admin-bracket-team[data-round="${nextRound}"][data-match="${Math.floor(i / 2)}"][data-side="${(i % 2) + 1}"]`);
                if (nextEl) nextEl.value = winner;
            }
        }
    }
}

async function saveAdminBracket(rounds, matchCounts) {
    const bracket = { rounds: {} };
    rounds.forEach((round, ri) => {
        bracket.rounds[round] = [];
        for (let i = 0; i < matchCounts[ri]; i++) {
            const t1 = document.querySelector(`.admin-bracket-team[data-round="${round}"][data-match="${i}"][data-side="1"]`)?.value || '';
            const t2 = document.querySelector(`.admin-bracket-team[data-round="${round}"][data-match="${i}"][data-side="2"]`)?.value || '';
            const s1 = document.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${i}"][data-side="1"]`)?.value;
            const s2 = document.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${i}"][data-side="2"]`)?.value;
            const match = { team1: t1, team2: t2 };
            if (s1 !== '' && s2 !== '' && s1 !== undefined && s2 !== undefined) {
                match.score1 = parseInt(s1); match.score2 = parseInt(s2);
                match.winner = match.score1 > match.score2 ? t1 : (match.score2 > match.score1 ? t2 : '');
            }
            bracket.rounds[round].push(match);
        }
    });
    bracket.teams = (bracket.rounds.R32 || []).flatMap(m => [m.team1, m.team2].filter(Boolean));
    await setDoc(doc(db, "matches", "_bracket"), bracket, { merge: true });
}

export async function checkTipsLocked() {
    const snap = await getDoc(doc(db, "matches", "_settings"));
    return snap.exists() && snap.data().tipsLocked === true;
}
