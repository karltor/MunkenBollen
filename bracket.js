import { db, auth } from './config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f } from './wizard.js'; // Återanvänd flaggorna

export async function initBracket() {
    const userId = auth.currentUser.uid;
    const tipsRef = collection(db, "users", userId, "tips");
    const tipsSnap = await getDocs(tipsRef);
    
    if(tipsSnap.empty) {
        document.getElementById('bracket-container').innerHTML = "<p>Du måste tippa hela gruppspelet först för att låsa upp slutspelet!</p>";
        return;
    }

    const userTips = tipsSnap.docs.map(d => d.data());
    const groupWinners = calculateUserStandings(userTips);
    
    renderR32Bracket(groupWinners);
}

// Räkna ut 1:an och 2:an baserat på ANVÄNDARENS sparade tips
function calculateUserStandings(tips) {
    let standings = { A:[], B:[], C:[], D:[], E:[], F:[], G:[], H:[], I:[], J:[], K:[], L:[] };
    
    // Samma logik som vanligt, men vi kollar på 'tips'-datan
    tips.forEach(m => {
        const groupLetter = m.stage.replace('Grupp ', '');
        if(!standings[groupLetter]) return;

        [m.homeTeam, m.awayTeam].forEach(team => {
            if (!standings[groupLetter].find(t => t.name === team)) standings[groupLetter].push({ name: team, pts: 0, gd: 0, gf: 0 });
        });

        let ht = standings[groupLetter].find(t => t.name === m.homeTeam);
        let at = standings[groupLetter].find(t => t.name === m.awayTeam);
        
        ht.gf += m.homeScore; at.gf += m.awayScore;
        ht.gd += (m.homeScore - m.awayScore); at.gd += (m.awayScore - m.homeScore);
        
        if (m.homeScore > m.awayScore) ht.pts += 3;
        else if (m.homeScore < m.awayScore) at.pts += 3;
        else { ht.pts++; at.pts++; }
    });

    let qualifiers = {};
    Object.keys(standings).forEach(letter => {
        standings[letter].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
        if(standings[letter].length > 0) {
            qualifiers[`1${letter}`] = standings[letter][0].name; // T.ex. "1A": "Mexiko"
            qualifiers[`2${letter}`] = standings[letter][1].name; // T.ex. "2A": "Sydkorea"
        }
    });
    
    return qualifiers; // Returnerar ett lexikon med 1A, 2A, 1B osv.
}

function renderR32Bracket(q) {
    // FIFAs officiella bracket för Sextondelsfinaler (R32)
    // 3:orna (3A/B/C) är komplexa. Vi lägger in "Bästa 3:a" som platshållare i detta steg.
    const matchups = [
        [q['2A'], q['2B']], [q['1C'], q['2F']], [q['1E'], "3:a (A/B/C)"], [q['1F'], q['2C']],
        [q['2E'], q['2I']], [q['1I'], "3:a (C/D/F)"], [q['1A'], "3:a (C/E/F)"], [q['1L'], "3:a (E/H/I)"],
        [q['1G'], "3:a (A/E/H)"], [q['1D'], "3:a (B/E/F)"], [q['1H'], q['2J']], [q['2K'], q['2L']],
        [q['1B'], "3:a (E/F/G)"], [q['2D'], q['2G']], [q['1J'], q['2H']], [q['1K'], "3:a (D/E/I)"]
    ];

    let html = `<div style="display:grid; grid-template-columns: 1fr 1fr; gap: 20px;">`;
    
    matchups.forEach((match, i) => {
        const team1 = match[0] || "TBD"; const team2 = match[1] || "TBD";
        html += `
            <div style="background:#262646; padding:10px; border-radius:8px; border:1px solid #3d3d6b;">
                <div class="bracket-slot" onclick="advanceTeam(this)">${f(team1)}${team1}</div>
                <div style="text-align:center; color:#aaa; font-size:12px; margin:-5px 0;">VS</div>
                <div class="bracket-slot" onclick="advanceTeam(this)">${f(team2)}${team2}</div>
            </div>
        `;
    });
    
    html += `</div>`;
    document.getElementById('bracket-container').innerHTML = html;
}

// Görs global för klickbarheten (Ska byggas ut för att flytta lagen till åttondel)
window.advanceTeam = function(element) {
    // Vi markerar vinnaren grön!
    const parent = element.parentElement;
    parent.querySelectorAll('.bracket-slot').forEach(el => el.classList.remove('winner'));
    element.classList.add('winner');
}
