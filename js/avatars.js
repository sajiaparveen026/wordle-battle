// Wordle Battle avatars: ONE place that knows every avatar and how to draw it.
//
//  - The 6 classic avatars are plain emoji and are stored exactly as before ("🦊", "🐼", ...).
//  - The 10 new avatars are illustrated badges. They are stored as short codes ("@ninja", "@knight", ...).
//    Every code is 8 characters or fewer, so it fits the existing profile / leaderboard / friends / battle columns
//    (they all allow 1 to 8 characters). No database change is needed, and nobody's saved avatar is touched.
//  - Avatars.inner(value) returns safe HTML for any avatar value. Every screen uses it, so an avatar looks the
//    same in Profile, Friends, battle lobbies, battle screens, Team Zone and the Leaderboard.
(function () {
  "use strict";

  const CLASSIC = [
    { id: "🦊", name: "Fox" }, { id: "🐼", name: "Panda" }, { id: "🐯", name: "Tiger" },
    { id: "🦉", name: "Owl" }, { id: "🐙", name: "Octopus" }, { id: "🚀", name: "Rocket" },
  ];

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- shared art kit (charcoal, silver and golden-yellow, same outline on every character) ----------
  const O = 'stroke="#0C0C0E" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"';
  const SH = "M2 100 Q6 77 34 71 L66 71 Q94 77 98 100Z"; // shoulders, shared by every character
  const grad = (id, stops) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>`;
  const DEFS = "<defs>"
    + '<radialGradient id="bg" cx=".5" cy=".28" r=".85"><stop offset="0" stop-color="#58585F"/><stop offset="1" stop-color="#17171A"/></radialGradient>'
    + grad("sv", [[0, "#F8F8F9"], [0.55, "#C3C3CB"], [1, "#7C7C86"]])   // silver
    + grad("gd", [[0, "#FFE97A"], [0.55, "#FACC15"], [1, "#C98A00"]])   // golden yellow
    + grad("ch", [[0, "#5E5E66"], [1, "#232326"]])                      // charcoal
    + grad("dk", [[0, "#313136"], [1, "#0E0E10"]])                      // deep charcoal
    + grad("sk", [[0, "#F3E8D5"], [1, "#D0C0A4"]])                      // skin
    + grad("iv", [[0, "#FFF7D9"], [1, "#E2C46F"]])                      // ivory (horns)
    + grad("sk2", [[0, "#E3B488"], [1, "#B9814F"]])                     // tan skin
    + grad("sk3", [[0, "#B07A52"], [1, "#74482C"]])                     // deep skin
    + grad("hr", [[0, "#4A4A52"], [1, "#16161A"]])                      // dark hair
    + grad("st", [[0, "#D5D5DC"], [1, "#6E6E7A"]])                      // steel
    + grad("am", [[0, "#FFD36B"], [1, "#E08A00"]])                      // amber fur
    + '<clipPath id="cp"><circle cx="50" cy="50" r="50"/></clipPath></defs>';

  const star = (cx, cy, R, r) => {
    const pts = [];
    for (let i = 0; i < 10; i++) { const a = (-90 + i * 36) * Math.PI / 180, d = i % 2 ? r : R; pts.push((cx + d * Math.cos(a)).toFixed(2) + "," + (cy + d * Math.sin(a)).toFixed(2)); }
    return pts.join(" ");
  };
  // Shared female face (same proportions as the Crown Queen) so the whole set matches.
  const FACE = (skin, iris, lip, noEyes) => `
      <path d="M32 46 Q32 76 50 79 Q68 76 68 46 Q68 28 50 28 Q32 28 32 46Z" fill="url(#${skin})" ${O}/>`
    + (noEyes ? "" : `
      <path d="M38 52.5 Q43 48.5 47.5 52.5 Q43 55 38 52.5Z M62 52.5 Q57 48.5 52.5 52.5 Q57 55 62 52.5Z" fill="#17171A"/>
      <circle cx="42.8" cy="52.2" r="1.8" fill="${iris}"/><circle cx="57.2" cy="52.2" r="1.8" fill="${iris}"/>
      <circle cx="43.5" cy="51.4" r=".7" fill="#fff"/><circle cx="57.9" cy="51.4" r=".7" fill="#fff"/>
      <path d="M37.5 51.5 Q43 47 48 51.5 M62.5 51.5 Q57 47 52 51.5" fill="none" stroke="#17171A" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M37 47.5 Q42 44.5 47 47 M63 47.5 Q58 44.5 53 47" fill="none" stroke="#2A2A2E" stroke-width="1.8" stroke-linecap="round"/>`)
    + `
      <path d="M50 55 L48.4 61 Q50 62.6 51.6 61" fill="none" stroke="#00000044" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M44 67 Q50 64.4 56 67 Q50 72.6 44 67Z" fill="${lip}"/>`;
  const NECK = (skin) => `<rect x="44" y="62" width="12" height="14" fill="url(#${skin})" ${O}/>`;
  const wrap = (body) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="128" height="128">' + DEFS
    + '<g clip-path="url(#cp)"><rect width="100" height="100" fill="url(#bg)"/><circle cx="50" cy="40" r="36" fill="#FACC15" opacity=".1"/>' + body + "</g>"
    + '<circle cx="50" cy="50" r="48.4" fill="none" stroke="#FACC15" stroke-opacity=".9" stroke-width="3.2"/></svg>';

  // ---------- the 10 new characters ----------
  const ART = {
    // Shadow Ninja: dark hood, silver headband with a gold plate, glowing gold eyes, gold scarf tails
    "@ninja": () => `
      <path d="M68 37 L93 27 L85 39 L97 44 L72 47Z" fill="url(#gd)" ${O}/>
      <path d="${SH}" fill="url(#dk)" ${O}/>
      <path d="M33 72 Q50 84 67 72" fill="none" stroke="url(#sv)" stroke-width="3.5" stroke-linecap="round"/>
      <ellipse cx="50" cy="50" rx="29" ry="31" fill="url(#ch)" ${O}/>
      <rect x="23" y="41" width="54" height="16" rx="8" fill="#0E0E10"/>
      <path d="M21 37 Q50 27 79 37 L79 44 Q50 35 21 44Z" fill="url(#sv)" ${O}/>
      <rect x="41" y="29.5" width="18" height="11" rx="2.5" fill="url(#gd)" ${O}/>
      <path d="M50 31.8 L53.4 35 L50 38.2 L46.6 35Z" fill="#0E0E10"/>
      <path d="M29 48.5 L45 44.5 L44.5 52 Q36 54.5 30 51.5Z" fill="url(#gd)"/>
      <path d="M71 48.5 L55 44.5 L55.5 52 Q64 54.5 70 51.5Z" fill="url(#gd)"/>
      <path d="M25 60 Q27 70 36 76" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="2.4" stroke-linecap="round"/>`,

    // Silver Knight: great helm, gold plume and eye slit, gold gorget
    "@knight": () => `
      <path d="M44 17 Q36 -1 58 2 Q80 8 72 33 Q69 15 54 17Z" fill="url(#gd)" ${O}/>
      <path d="${SH}" fill="url(#sv)" ${O}/>
      <path d="M32 72 Q50 85 68 72 L68 79 Q50 92 32 79Z" fill="url(#gd)" ${O}/>
      <path d="M29 32 Q29 14 50 13 Q71 14 71 32 L71 58 Q71 72 50 77 Q29 72 29 58Z" fill="url(#sv)" ${O}/>
      <rect x="33" y="36" width="34" height="9" rx="3" fill="#0E0E10" ${O}/>
      <rect x="37" y="39.4" width="26" height="2.7" rx="1.35" fill="url(#gd)"/>
      <path d="M47.5 45 L52.5 45 L52.5 70 Q50 72.5 47.5 70Z" fill="#9A9AA4"/>
      <g fill="#17171A"><circle cx="39" cy="54" r="1.8"/><circle cx="39" cy="61" r="1.8"/><circle cx="61" cy="54" r="1.8"/><circle cx="61" cy="61" r="1.8"/></g>
      <path d="M33 26 Q36 18 46 16" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2.6" stroke-linecap="round"/>`,

    // Arcane Wizard: charcoal hat with gold band and star, long silver beard, glowing gold eyes
    "@wizard": () => `
      <path d="${SH}" fill="url(#ch)" ${O}/>
      <path d="M35 72 Q50 83 65 72" fill="none" stroke="url(#gd)" stroke-width="3.5" stroke-linecap="round"/>
      <ellipse cx="50" cy="58" rx="17" ry="16" fill="url(#sk)" ${O}/>
      <path d="M32 61 Q30 88 50 98 Q70 88 68 61 Q60 73 50 71 Q40 73 32 61Z" fill="url(#sv)" ${O}/>
      <path d="M38 65 Q44 59 50 65 Q56 59 62 65 Q56 71 50 67 Q44 71 38 65Z" fill="#F6F6F8" ${O}/>
      <ellipse cx="43" cy="56" rx="3.2" ry="2.6" fill="#0E0E10"/><ellipse cx="57" cy="56" rx="3.2" ry="2.6" fill="#0E0E10"/>
      <circle cx="43" cy="56" r="1.6" fill="url(#gd)"/><circle cx="57" cy="56" r="1.6" fill="url(#gd)"/>
      <path d="M37.5 52 Q43 49.5 47.5 52 M52.5 52 Q57 49.5 62.5 52" fill="none" stroke="#F6F6F8" stroke-width="2.6" stroke-linecap="round"/>
      <ellipse cx="50" cy="44" rx="38" ry="6.5" fill="url(#ch)" ${O}/>
      <path d="M50 4 Q52 24 70 43 Q50 49 30 43 Q48 24 50 4Z" fill="url(#dk)" ${O}/>
      <path d="M36 36 Q50 41 64 36 L70 43 Q50 49 30 43Z" fill="url(#gd)" ${O}/>
      <polygon points="${star(50, 26.5, 5.6, 2.4)}" fill="url(#gd)" stroke="#0C0C0E" stroke-width="1.2" stroke-linejoin="round"/>`,

    // Chrome Bot: silver head, dark visor with gold eyes, gold ear caps and antenna
    "@robot": () => `
      <rect x="42" y="66" width="16" height="12" fill="url(#ch)" ${O}/>
      <path d="${SH}" fill="url(#sv)" ${O}/>
      <rect x="37" y="81" width="26" height="15" rx="4.5" fill="url(#dk)" ${O}/>
      <circle cx="50" cy="88.5" r="4.6" fill="url(#gd)"/>
      <path d="M50 25 L50 12" stroke="#9A9AA4" stroke-width="3.6" stroke-linecap="round"/>
      <circle cx="50" cy="9.5" r="5.2" fill="url(#gd)" ${O}/>
      <rect x="11" y="40" width="12" height="21" rx="4.5" fill="url(#gd)" ${O}/>
      <rect x="77" y="40" width="12" height="21" rx="4.5" fill="url(#gd)" ${O}/>
      <rect x="20" y="24" width="60" height="48" rx="16" fill="url(#sv)" ${O}/>
      <rect x="28" y="35" width="44" height="24" rx="10" fill="#0E0E10" ${O}/>
      <circle cx="40" cy="47" r="6.2" fill="url(#gd)"/><circle cx="60" cy="47" r="6.2" fill="url(#gd)"/>
      <circle cx="38" cy="45" r="1.9" fill="#FFF8D0"/><circle cx="58" cy="45" r="1.9" fill="#FFF8D0"/>
      <rect x="37" y="63" width="26" height="4.5" rx="2.2" fill="#2A2A2E"/>
      <path d="M43.5 63 v4.5 M50 63 v4.5 M56.5 63 v4.5" stroke="#8D8D96" stroke-width="1.3"/>`,

    // Viking Raider: ivory horns, iron helm with gold band, big golden braided beard
    "@viking": () => `
      <path d="M30 35 Q14 35 16 16 Q22 27 34 27Z" fill="url(#iv)" ${O}/>
      <path d="M70 35 Q86 35 84 16 Q78 27 66 27Z" fill="url(#iv)" ${O}/>
      <path d="${SH}" fill="url(#ch)" ${O}/>
      <path d="M30 72 Q50 86 70 72 Q66 83 50 87 Q34 83 30 72Z" fill="url(#sv)" ${O}/>
      <path d="M31 44 L69 44 L68 60 Q60 72 50 72 Q40 72 32 60Z" fill="url(#sk)" ${O}/>
      <path d="M29 54 Q27 88 50 98 Q73 88 71 54 Q62 67 50 63 Q38 67 29 54Z" fill="url(#gd)" ${O}/>
      <path d="M41 75 L43 91 M50 78 L50 95 M59 75 L57 91" stroke="#A56F00" stroke-width="1.8" stroke-linecap="round" opacity=".75"/>
      <path d="M37 62 Q44 56 50 62 Q56 56 63 62 Q56 68 50 65 Q44 68 37 62Z" fill="url(#gd)" ${O}/>
      <ellipse cx="42" cy="52" rx="2.5" ry="2.1" fill="#0E0E10"/><ellipse cx="58" cy="52" rx="2.5" ry="2.1" fill="#0E0E10"/>
      <path d="M35.5 46.5 L47 49.5 M64.5 46.5 L53 49.5" stroke="#8A5A00" stroke-width="3" stroke-linecap="round"/>
      <path d="M26 46 Q26 14 50 13 Q74 14 74 46Z" fill="url(#sv)" ${O}/>
      <rect x="26" y="36" width="48" height="9" rx="2" fill="url(#gd)" ${O}/>
      <g fill="#7A5600"><circle cx="33" cy="40.5" r="1.5"/><circle cx="42" cy="40.5" r="1.5"/><circle cx="58" cy="40.5" r="1.5"/><circle cx="67" cy="40.5" r="1.5"/></g>
      <path d="M47 45 L53 45 L52 58 L48 58Z" fill="url(#sv)" ${O}/>
      <path d="M34 28 Q38 19 47 17" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2.6" stroke-linecap="round"/>`,

    // Pirate Captain: dark tricorn with silver skull and gold crossbones, eye patch, gold tooth and earring
    "@pirate": () => `
      <path d="${SH}" fill="url(#ch)" ${O}/>
      <path d="M37 71 Q50 81 63 71 L61 78 Q50 87 39 78Z" fill="url(#gd)" ${O}/>
      <ellipse cx="50" cy="55" rx="21" ry="21" fill="url(#sk)" ${O}/>
      <path d="M47 50 L74 41 M35 49 L25 41" stroke="#0E0E10" stroke-width="2.4" stroke-linecap="round"/>
      <ellipse cx="41" cy="52" rx="6.6" ry="5.6" fill="#0E0E10" ${O}/>
      <ellipse cx="59" cy="52.5" rx="3.6" ry="3.8" fill="#fff"/><circle cx="59" cy="52.8" r="2" fill="#0E0E10"/>
      <path d="M53.5 47 L65 49" stroke="#2A2A2E" stroke-width="2.8" stroke-linecap="round"/>
      <path d="M41 65 Q50 72.5 59 65Z" fill="#0E0E10" ${O}/>
      <path d="M44 65.4 L56 65.4 L55 67.6 L45 67.6Z" fill="#F6F6F8"/><rect x="51.5" y="65.4" width="3.2" height="3.2" fill="url(#gd)"/>
      <circle cx="71.5" cy="59" r="3.3" fill="none" stroke="url(#gd)" stroke-width="2"/>
      <path d="M8 45 Q16 8 50 6 Q84 8 92 45 Q72 36 50 36 Q28 36 8 45Z" fill="url(#dk)" ${O}/>
      <path d="M8 45 Q28 36 50 36 Q72 36 92 45" fill="none" stroke="url(#gd)" stroke-width="3.6" stroke-linecap="round"/>
      <path d="M38.5 31 L61.5 14 M61.5 31 L38.5 14" stroke="url(#gd)" stroke-width="3.2" stroke-linecap="round"/>
      <circle cx="50" cy="21.5" r="7.2" fill="url(#sv)" ${O}/>
      <rect x="46.5" y="25.5" width="7" height="4.2" rx="1.2" fill="url(#sv)" ${O}/>
      <circle cx="47.2" cy="20.5" r="1.8" fill="#0E0E10"/><circle cx="52.8" cy="20.5" r="1.8" fill="#0E0E10"/>`,

    // Iron Samurai: kabuto helmet with gold crest, steel mask with ridges, flared neck guards
    "@samurai": () => `
      <path d="M25 42 L9 63 Q28 68 34 57Z" fill="url(#ch)" ${O}/>
      <path d="M75 42 L91 63 Q72 68 66 57Z" fill="url(#ch)" ${O}/>
      <path d="M11 61 Q27 66 33 56 M89 61 Q73 66 67 56" fill="none" stroke="url(#gd)" stroke-width="2" stroke-linecap="round"/>
      <path d="${SH}" fill="url(#dk)" ${O}/>
      <path d="M30 73 Q50 88 70 73" fill="none" stroke="url(#gd)" stroke-width="3.6" stroke-linecap="round"/>
      <path d="M27 40 L73 40 L71 57 L29 57Z" fill="url(#sk)" ${O}/>
      <path d="M28 52 Q50 46 72 52 L67 74 Q50 86 33 74Z" fill="url(#ch)" ${O}/>
      <path d="M38 58 L40 77 M50 55.5 L50 83 M62 58 L60 77" stroke="#A5A5AE" stroke-width="1.7" stroke-linecap="round" opacity=".85"/>
      <path d="M31.5 47 L46 45.5 L45 50.5 Q38 52 33 50Z" fill="#17171A"/><path d="M68.5 47 L54 45.5 L55 50.5 Q62 52 67 50Z" fill="#17171A"/>
      <circle cx="40.5" cy="48.3" r="1.7" fill="url(#gd)"/><circle cx="59.5" cy="48.3" r="1.7" fill="url(#gd)"/>
      <path d="M47 21 Q34 20 28 9 Q42 8 50 17Z" fill="url(#gd)" ${O}/>
      <path d="M53 21 Q66 20 72 9 Q58 8 50 17Z" fill="url(#gd)" ${O}/>
      <path d="M24 42 Q24 14 50 12 Q76 14 76 42 Q50 36 24 42Z" fill="url(#ch)" ${O}/>
      <path d="M50 14 L50 38 M37 16 Q34 28 32 40 M63 16 Q66 28 68 40" fill="none" stroke="#A5A5AE" stroke-width="1.5" opacity=".75"/>
      <path d="M24 42 Q50 36 76 42" fill="none" stroke="url(#gd)" stroke-width="3.8" stroke-linecap="round"/>
      <circle cx="50" cy="24" r="4" fill="url(#gd)" ${O}/>`,

    // Star Pilot: white helmet, dark visor reflecting a golden ringed planet, gold ear caps and collar
    "@astro": () => `
      <path d="${SH}" fill="url(#sv)" ${O}/>
      <rect x="39" y="82" width="22" height="13" rx="3.5" fill="url(#dk)" ${O}/>
      <circle cx="45.5" cy="88.5" r="2.2" fill="url(#gd)"/><circle cx="54.5" cy="88.5" r="2.2" fill="#C3C3CB"/>
      <path d="M29 70 Q50 81 71 70 L71 77 Q50 88 29 77Z" fill="url(#gd)" ${O}/>
      <circle cx="16" cy="47" r="6.5" fill="url(#gd)" ${O}/><circle cx="84" cy="47" r="6.5" fill="url(#gd)" ${O}/>
      <circle cx="50" cy="46" r="33" fill="url(#sv)" ${O}/>
      <ellipse cx="50" cy="47" rx="24" ry="20" fill="url(#dk)" ${O}/>
      <circle cx="59" cy="54" r="7" fill="url(#gd)"/>
      <ellipse cx="59" cy="54" rx="11" ry="3" transform="rotate(-20 59 54)" fill="none" stroke="#E8E8EE" stroke-width="1.5"/>
      <path d="M33 39 Q38 31 50 29.5" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="3" stroke-linecap="round"/>
      <g fill="#fff"><circle cx="40" cy="55" r="1.2"/><circle cx="46" cy="63" r="1"/><circle cx="68" cy="40" r="1"/></g>
      <path d="M27 29 Q32 19 46 15" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="3.4" stroke-linecap="round"/>`,

    // Golden Dragon: gold scaled head, silver horns, slit-pupil eyes, pale snout with fangs
    "@dragon": () => `
      <path d="M31 35 Q15 29 15 12 Q28 16 41 28Z" fill="url(#sv)" ${O}/>
      <path d="M69 35 Q85 29 85 12 Q72 16 59 28Z" fill="url(#sv)" ${O}/>
      <path d="M26 46 L6 40 L22 58Z" fill="url(#gd)" ${O}/>
      <path d="M74 46 L94 40 L78 58Z" fill="url(#gd)" ${O}/>
      <path d="M27 63 L12 70 L31 74Z" fill="url(#gd)" ${O}/>
      <path d="M73 63 L88 70 L69 74Z" fill="url(#gd)" ${O}/>
      <path d="M30 30 Q50 20 70 30 Q81 46 73 61 Q65 80 50 91 Q35 80 27 61 Q19 46 30 30Z" fill="url(#gd)" ${O}/>
      <path d="M43.5 31 L50 38 L56.5 31 M44.5 40 L50 46 L55.5 40" fill="none" stroke="#B07800" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M27 39 L46 48 L45 40Z" fill="#8A5E00" ${O}/><path d="M73 39 L54 48 L55 40Z" fill="#8A5E00" ${O}/>
      <path d="M31 49 Q40 43 47 50.5 Q40 55 31 49Z" fill="#151517" ${O}/><path d="M69 49 Q60 43 53 50.5 Q60 55 69 49Z" fill="#151517" ${O}/>
      <ellipse cx="40" cy="49.6" rx="1.8" ry="3.7" fill="url(#gd)"/><ellipse cx="60" cy="49.6" rx="1.8" ry="3.7" fill="url(#gd)"/>
      <path d="M36 60 Q50 53 64 60 Q63 75 56.5 83 Q50 89 43.5 83 Q37 75 36 60Z" fill="#FFEFA8" ${O}/>
      <path d="M42 63.5 L47 66 L46 62Z M58 63.5 L53 66 L54 62Z" fill="#1C1C1F" stroke="#1C1C1F" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M44 77 Q50 81 56 77" fill="none" stroke="#1C1C1F" stroke-width="2" stroke-linecap="round"/>
      <path d="M40 72 L43 80 L46 74Z M60 72 L57 80 L54 74Z" fill="#fff" stroke="#0C0C0E" stroke-width="1.4" stroke-linejoin="round"/>`,

    // Crown Queen: gold crown with silver jewels, long silver hair, golden-eyed, gold armour
    "@queen": () => `
      <path d="M27 34 Q13 62 19 95 L41 87 L41 46Z" fill="url(#sv)" ${O}/>
      <path d="M73 34 Q87 62 81 95 L59 87 L59 46Z" fill="url(#sv)" ${O}/>
      <rect x="44" y="62" width="12" height="14" fill="#CDBE9F" ${O}/>
      <path d="${SH}" fill="url(#gd)" ${O}/>
      <path d="M36 72 Q50 85 64 72 L64 100 L36 100Z" fill="url(#dk)" ${O}/>
      <path d="M31 46 Q31 76 50 78 Q69 76 69 46 Q69 28 50 28 Q31 28 31 46Z" fill="url(#sk)" ${O}/>
      <path d="M30 45 Q32 26 50 25 Q68 26 70 45 Q60 34 50 38 Q40 34 30 45Z" fill="url(#sv)" ${O}/>
      <path d="M38 52.5 Q43 48.5 47.5 52.5 Q43 55 38 52.5Z M62 52.5 Q57 48.5 52.5 52.5 Q57 55 62 52.5Z" fill="#17171A"/>
      <circle cx="42.8" cy="52.2" r="1.7" fill="url(#gd)"/><circle cx="57.2" cy="52.2" r="1.7" fill="url(#gd)"/>
      <path d="M37 48 Q42 45 47 47.5 M63 48 Q58 45 53 47.5" fill="none" stroke="#6A6A72" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M50 55 L48.4 61 Q50 62.6 51.6 61" fill="none" stroke="#B3A286" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M44 67 Q50 64.4 56 67 Q50 72.6 44 67Z" fill="#B24B4B"/>
      <circle cx="31.5" cy="61" r="2.5" fill="url(#gd)" ${O}/><circle cx="68.5" cy="61" r="2.5" fill="url(#gd)" ${O}/>
      <path d="M31 31 L33 14 L42 23 L50 8 L58 23 L67 14 L69 31 Q50 25.5 31 31Z" fill="url(#gd)" ${O}/>
      <circle cx="50" cy="19.5" r="2.9" fill="#EDEDF1" stroke="#0C0C0E" stroke-width="1.2"/>
      <circle cx="33" cy="15" r="2" fill="#EDEDF1"/><circle cx="67" cy="15" r="2" fill="#EDEDF1"/>`,

    // ---------- the 6 classic avatars, redrawn in the same style (saved values stay the original emoji) ----------
    "🦊": () => `
      <path d="M22 47 L16 12 L43 31Z" fill="url(#am)" ${O}/><path d="M26 40 L23 21 L36 31Z" fill="#2A2A2E"/>
      <path d="M78 47 L84 12 L57 31Z" fill="url(#am)" ${O}/><path d="M74 40 L77 21 L64 31Z" fill="#2A2A2E"/>
      <path d="M13 49 Q50 18 87 49 Q84 75 50 91 Q16 75 13 49Z" fill="url(#am)" ${O}/>
      <path d="M13 51 Q30 53 42 66 Q47 74 50 74 Q53 74 58 66 Q70 53 87 51 Q84 75 50 91 Q16 75 13 51Z" fill="url(#sv)" ${O}/>
      <path d="M28 49 Q35 43 43 50 Q36 54.5 28 49Z" fill="#17171A"/><path d="M72 49 Q65 43 57 50 Q64 54.5 72 49Z" fill="#17171A"/>
      <circle cx="36" cy="48.4" r="1.5" fill="#fff"/><circle cx="64" cy="48.4" r="1.5" fill="#fff"/>
      <path d="M27 44 L40 41 M73 44 L60 41" fill="none" stroke="#8A4A00" stroke-width="2.4" stroke-linecap="round"/>
      <ellipse cx="50" cy="70" rx="5.6" ry="4" fill="#17171A"/>
      <path d="M50 74 L50 78 M44 80 Q50 84 50 78 Q50 84 56 80" fill="none" stroke="#17171A" stroke-width="2" stroke-linecap="round"/>`,

    "🐼": () => `
      <circle cx="23" cy="27" r="12" fill="url(#dk)" ${O}/><circle cx="77" cy="27" r="12" fill="url(#dk)" ${O}/>
      <ellipse cx="50" cy="56" rx="36" ry="33" fill="url(#sv)" ${O}/>
      <ellipse cx="35" cy="52" rx="8.5" ry="11.5" transform="rotate(22 35 52)" fill="url(#dk)"/>
      <ellipse cx="65" cy="52" rx="8.5" ry="11.5" transform="rotate(-22 65 52)" fill="url(#dk)"/>
      <circle cx="36.5" cy="51" r="3.6" fill="url(#gd)"/><circle cx="63.5" cy="51" r="3.6" fill="url(#gd)"/>
      <circle cx="36.8" cy="51" r="1.8" fill="#0E0E10"/><circle cx="63.2" cy="51" r="1.8" fill="#0E0E10"/>
      <circle cx="35.8" cy="49.8" r=".9" fill="#fff"/><circle cx="62.2" cy="49.8" r=".9" fill="#fff"/>
      <ellipse cx="50" cy="65" rx="5.6" ry="3.8" fill="#17171A"/>
      <path d="M50 68.5 L50 72 M43 74 Q50 79 50 72 Q50 79 57 74" fill="none" stroke="#17171A" stroke-width="2.2" stroke-linecap="round"/>`,

    "🐯": () => `
      <circle cx="24" cy="31" r="11" fill="url(#gd)" ${O}/><circle cx="24" cy="31" r="5.5" fill="#2A2A2E"/>
      <circle cx="76" cy="31" r="11" fill="url(#gd)" ${O}/><circle cx="76" cy="31" r="5.5" fill="#2A2A2E"/>
      <path d="M13 53 Q13 26 50 24 Q87 26 87 53 Q87 79 50 91 Q13 79 13 53Z" fill="url(#gd)" ${O}/>
      <path d="M50 26 L50 38 M42 27 L44 36 M58 27 L56 36 M14 47 L27 51 M14.5 59 L27 59 M19 70 L30 66 M86 47 L73 51 M85.5 59 L73 59 M81 70 L70 66" fill="none" stroke="#17171A" stroke-width="3.2" stroke-linecap="round"/>
      <path d="M28 49 Q35 43 43 49 Q35 54 28 49Z M72 49 Q65 43 57 49 Q65 54 72 49Z" fill="#F6F6F8" stroke="#0C0C0E" stroke-width="1.6" stroke-linejoin="round"/>
      <circle cx="36" cy="48.6" r="3.1" fill="#17171A"/><circle cx="64" cy="48.6" r="3.1" fill="#17171A"/>
      <circle cx="37" cy="47.6" r="1" fill="#fff"/><circle cx="65" cy="47.6" r="1" fill="#fff"/>
      <ellipse cx="50" cy="71" rx="17" ry="12.5" fill="url(#iv)" ${O}/>
      <path d="M43.5 63 L56.5 63 L50 70Z" fill="#17171A" ${O}/>
      <path d="M50 70 L50 75 M43 78 Q50 82.5 50 75 Q50 82.5 57 78" fill="none" stroke="#17171A" stroke-width="2" stroke-linecap="round"/>`,

    "🦉": () => `
      <path d="M21 42 L15 14 L42 29Z" fill="url(#ch)" ${O}/><path d="M79 42 L85 14 L58 29Z" fill="url(#ch)" ${O}/>
      <ellipse cx="50" cy="55" rx="34" ry="36" fill="url(#ch)" ${O}/>
      <ellipse cx="50" cy="80" rx="19" ry="12" fill="url(#st)"/>
      <path d="M40 76 Q44 80 48 76 M52 76 Q56 80 60 76 M45 83 Q50 87 55 83" fill="none" stroke="#2A2A2E" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="35.5" cy="50" r="15" fill="url(#sv)" ${O}/><circle cx="64.5" cy="50" r="15" fill="url(#sv)" ${O}/>
      <circle cx="36" cy="51" r="9" fill="url(#gd)"/><circle cx="64" cy="51" r="9" fill="url(#gd)"/>
      <circle cx="36.5" cy="51.5" r="4.8" fill="#0E0E10"/><circle cx="63.5" cy="51.5" r="4.8" fill="#0E0E10"/>
      <circle cx="34.6" cy="49.4" r="1.7" fill="#fff"/><circle cx="61.6" cy="49.4" r="1.7" fill="#fff"/>
      <path d="M24 38 Q34 30 46 38 M76 38 Q66 30 54 38" fill="none" stroke="#0C0C0E" stroke-width="3" stroke-linecap="round"/>
      <path d="M50 52 L44 62 L50 71 L56 62Z" fill="url(#gd)" ${O}/>`,

    "🐙": () => `
      <g fill="none" stroke-linecap="round">
        <path d="M30 56 Q10 66 18 90 M41 62 Q32 82 41 95 M59 62 Q68 82 59 95 M70 56 Q90 66 82 90" stroke="#0C0C0E" stroke-width="14"/>
        <path d="M30 56 Q10 66 18 90 M41 62 Q32 82 41 95 M59 62 Q68 82 59 95 M70 56 Q90 66 82 90" stroke="#9494A1" stroke-width="9.5"/>
      </g>
      <g fill="#FACC15"><circle cx="16.5" cy="82" r="1.9"/><circle cx="35" cy="84" r="1.9"/><circle cx="65" cy="84" r="1.9"/><circle cx="83.5" cy="82" r="1.9"/></g>
      <path d="M17 50 Q15 10 50 10 Q85 10 83 50 Q83 66 50 68 Q17 66 17 50Z" fill="url(#st)" ${O}/>
      <g fill="#FACC15"><circle cx="50" cy="21" r="3.2"/><circle cx="38" cy="26" r="2.4"/><circle cx="62" cy="26" r="2.4"/></g>
      <ellipse cx="36.5" cy="42" rx="9" ry="10" fill="#F6F6F8" ${O}/><ellipse cx="63.5" cy="42" rx="9" ry="10" fill="#F6F6F8" ${O}/>
      <circle cx="37.5" cy="43" r="5" fill="url(#gd)"/><circle cx="62.5" cy="43" r="5" fill="url(#gd)"/>
      <circle cx="37.8" cy="43" r="2.6" fill="#0E0E10"/><circle cx="62.2" cy="43" r="2.6" fill="#0E0E10"/>
      <circle cx="36.4" cy="41.2" r="1.2" fill="#fff"/><circle cx="61" cy="41.2" r="1.2" fill="#fff"/>
      <path d="M42 57 Q50 63 58 57" fill="none" stroke="#17171A" stroke-width="2.2" stroke-linecap="round"/>`,

    "🚀": () => `
      <g fill="#fff"><circle cx="18" cy="26" r="1.5"/><circle cx="30" cy="12" r="1.1"/><circle cx="84" cy="62" r="1.5"/><circle cx="76" cy="86" r="1.1"/><circle cx="14" cy="70" r="1.2"/></g>
      <polygon points="${star(80, 20, 5.5, 2.3)}" fill="url(#gd)"/><polygon points="${star(20, 50, 4, 1.7)}" fill="#fff" opacity=".85"/>
      <g transform="rotate(38 50 50)">
        <path d="M44 66 Q50 100 56 66 Q50 73 44 66Z" fill="url(#gd)" ${O}/><path d="M47 66 Q50 83 53 66Z" fill="#FFF6C0"/>
        <path d="M34 52 L16 74 L34 70Z" fill="url(#gd)" ${O}/><path d="M66 52 L84 74 L66 70Z" fill="url(#gd)" ${O}/>
        <path d="M50 6 Q72 26 67 64 L33 64 Q28 26 50 6Z" fill="url(#sv)" ${O}/>
        <path d="M50 6 Q61 14 65 28 L35 28 Q39 14 50 6Z" fill="url(#gd)" ${O}/>
        <rect x="41" y="62" width="18" height="7" rx="2" fill="url(#ch)" ${O}/>
        <circle cx="50" cy="44" r="9" fill="url(#gd)" ${O}/><circle cx="50" cy="44" r="6" fill="url(#dk)"/>
        <path d="M46 41 Q48 39 51 39.5" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.8" stroke-linecap="round"/>
      </g>`,

    // ---------- girls ----------
    // Valkyrie: winged silver helm, gold circlet, long gold braids
    "@valk": () => `
      <path d="M29 36 Q15 62 23 93 L42 85 L42 44Z" fill="url(#gd)" ${O}/><path d="M71 36 Q85 62 77 93 L58 85 L58 44Z" fill="url(#gd)" ${O}/>
      ${NECK("sk")}
      <path d="${SH}" fill="url(#sv)" ${O}/><path d="M34 72 Q50 85 66 72 L66 79 Q50 92 34 79Z" fill="url(#gd)" ${O}/>
      ${FACE("sk", "#4F7CAC", "#B24B4B")}
      <path d="M30 46 Q32 28 50 27 Q68 28 70 46 Q60 36 50 40 Q40 36 30 46Z" fill="url(#gd)" ${O}/>
      <path d="M30 37 L10 34 L17 29 L7 24 L18 22 L13 16 L31 26Z" fill="url(#sv)" ${O}/><path d="M70 37 L90 34 L83 29 L93 24 L82 22 L87 16 L69 26Z" fill="url(#sv)" ${O}/>
      <path d="M30 41 Q30 19 50 18 Q70 19 70 41 Q50 32 30 41Z" fill="url(#sv)" ${O}/>
      <path d="M30 41 Q50 32 70 41" fill="none" stroke="url(#gd)" stroke-width="3.4" stroke-linecap="round"/>
      <circle cx="50" cy="31.5" r="3" fill="url(#gd)" ${O}/>`,

    // Elf Archer: pointed ears, silver hair, gold leaf circlet, charcoal cloak
    "@elf": () => `
      <path d="M28 36 Q14 64 21 95 L42 87 L42 44Z" fill="url(#sv)" ${O}/><path d="M72 36 Q86 64 79 95 L58 87 L58 44Z" fill="url(#sv)" ${O}/>
      ${NECK("sk")}
      <path d="${SH}" fill="url(#ch)" ${O}/><path d="M33 72 Q50 86 67 72" fill="none" stroke="url(#gd)" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M50 79 L46 85 L50 91 L54 85Z" fill="url(#gd)" ${O}/>
      <path d="M33 50 L10 40 L32 62Z" fill="url(#sk)" ${O}/><path d="M67 50 L90 40 L68 62Z" fill="url(#sk)" ${O}/>
      ${FACE("sk", "#3E9A66", "#B24B4B")}
      <path d="M30 46 Q32 26 50 25 Q68 26 70 46 Q62 35 50 38 Q38 35 30 46Z" fill="url(#sv)" ${O}/>
      <path d="M31 40 Q50 28 69 40" fill="none" stroke="url(#gd)" stroke-width="2.8" stroke-linecap="round"/>
      <path d="M50 38 Q45 33 50 28 Q55 33 50 38Z" fill="url(#gd)" ${O}/>`,

    // Sorceress: voluminous dark curls, gold star tiara and hoops, charcoal robe
    "@sorc": () => `
      <ellipse cx="50" cy="40" rx="35" ry="31" fill="url(#hr)" ${O}/><circle cx="24" cy="62" r="11" fill="url(#hr)" ${O}/><circle cx="76" cy="62" r="11" fill="url(#hr)" ${O}/>
      ${NECK("sk3")}
      <path d="${SH}" fill="url(#ch)" ${O}/><path d="M36 72 Q50 85 64 72 L64 100 L36 100Z" fill="url(#dk)" ${O}/>
      <path d="M34 72 Q50 86 66 72" fill="none" stroke="url(#gd)" stroke-width="3.4" stroke-linecap="round"/>
      ${FACE("sk3", "#2A1A10", "#9E3F4A")}
      <path d="M31 44 Q34 27 50 26 Q66 27 69 44 Q60 34 50 37 Q40 34 31 44Z" fill="url(#hr)" ${O}/>
      <circle cx="31" cy="64" r="4" fill="none" stroke="url(#gd)" stroke-width="2"/><circle cx="69" cy="64" r="4" fill="none" stroke="url(#gd)" stroke-width="2"/>
      <path d="M34 28 Q50 22 66 28" fill="none" stroke="url(#gd)" stroke-width="2.6" stroke-linecap="round"/>
      <polygon points="${star(50, 22, 7.5, 3.2)}" fill="url(#gd)" stroke="#0C0C0E" stroke-width="1.3" stroke-linejoin="round"/>`,

    // Ace Pilot: flight cap with goggles, tan skin, ponytail, flight jacket
    "@ace": () => `
      <path d="M66 38 Q94 40 86 74 Q82 62 68 58Z" fill="url(#hr)" ${O}/>
      ${NECK("sk2")}
      <path d="${SH}" fill="url(#ch)" ${O}/><path d="M32 72 Q50 82 68 72 L64 79 Q50 87 36 79Z" fill="url(#sv)" ${O}/>
      <path d="M44 90 L56 90" stroke="url(#gd)" stroke-width="4" stroke-linecap="round"/>
      ${FACE("sk2", "#4A3426", "#B24B4B")}
      <path d="M30 48 Q30 18 50 17 Q70 18 70 48 L69 56 L64 48 Q50 36 36 48 L31 56Z" fill="url(#ch)" ${O}/>
      <path d="M31 40 Q50 31 69 40" fill="none" stroke="url(#gd)" stroke-width="3.4" stroke-linecap="round"/>
      <circle cx="41" cy="30" r="6.6" fill="url(#dk)" stroke="#FACC15" stroke-width="2.6"/><circle cx="59" cy="30" r="6.6" fill="url(#dk)" stroke="#FACC15" stroke-width="2.6"/>
      <path d="M38.5 28 Q40 26.5 42 27 M56.5 28 Q58 26.5 60 27" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M47.6 30 L52.4 30" stroke="#FACC15" stroke-width="2.6"/>`,

    // Neon Hacker: hood up, AR visor with glowing gold line, gold-streaked bob
    "@hacker": () => `
      <ellipse cx="50" cy="48" rx="37" ry="39" fill="url(#ch)" ${O}/>
      ${NECK("sk")}
      <path d="${SH}" fill="url(#ch)" ${O}/><path d="M50 74 L50 100" stroke="url(#gd)" stroke-width="3"/>
      <path d="M40 76 L38 94 M60 76 L62 94" stroke="url(#sv)" stroke-width="2.6" stroke-linecap="round"/>
      ${FACE("sk", "#fff", "#B24B4B", true)}
      <path d="M31 48 Q31 26 50 25 Q69 26 69 48 L66 58 Q64 40 50 38 Q36 40 34 58Z" fill="url(#hr)" ${O}/>
      <path d="M44 27 Q40 40 36 50" fill="none" stroke="url(#gd)" stroke-width="3" stroke-linecap="round"/>
      <rect x="31" y="46" width="38" height="12" rx="6" fill="#0E0E10" stroke="url(#gd)" stroke-width="2.2"/>
      <path d="M36 52 L64 52" stroke="url(#gd)" stroke-width="2.6" stroke-linecap="round"/><path d="M39 49.6 L46 49.6" stroke="#fff" stroke-opacity=".8" stroke-width="1.4" stroke-linecap="round"/>`,

    // Shadow Rogue: deep hood, steel face mask with gold trim, gold-lined eyes
    "@rogue": () => `
      <path d="M17 86 Q8 22 50 11 Q92 22 83 86Z" fill="url(#dk)" ${O}/>
      ${NECK("sk2")}
      <path d="${SH}" fill="url(#ch)" ${O}/><circle cx="50" cy="79" r="4.4" fill="url(#gd)" ${O}/>
      <path d="M32 46 Q32 76 50 79 Q68 76 68 46 Q68 28 50 28 Q32 28 32 46Z" fill="url(#sk2)" ${O}/>
      <path d="M36 52 Q43 45 48 51 Q42 55 36 52Z M64 52 Q57 45 52 51 Q58 55 64 52Z" fill="#17171A"/>
      <circle cx="42.5" cy="51.4" r="2" fill="url(#gd)"/><circle cx="57.5" cy="51.4" r="2" fill="url(#gd)"/>
      <path d="M34 50 Q40 43 49 49.5 M66 50 Q60 43 51 49.5" fill="none" stroke="url(#gd)" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M35 44 L47 46 M65 44 L53 46" stroke="#17171A" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M32 58 Q50 53 68 58 Q67 75 50 80 Q33 75 32 58Z" fill="url(#st)" ${O}/>
      <path d="M32 58 Q50 53 68 58" fill="none" stroke="url(#gd)" stroke-width="3" stroke-linecap="round"/>
      <path d="M44 64 L44 74 M50 62 L50 78 M56 64 L56 74" stroke="#4A4A52" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M28 48 Q29 24 50 22 Q71 24 72 48 Q66 33 50 33 Q34 33 28 48Z" fill="url(#dk)" ${O}/>`,

    // Punk Rocker: gold mohawk, heavy liner, studded leather jacket
    "@punk": () => `
      ${NECK("sk")}
      <path d="${SH}" fill="url(#dk)" ${O}/><path d="M36 71 L50 94 L64 71 L58 71 L50 84 L42 71Z" fill="url(#sv)" ${O}/>
      <g fill="url(#sv)" stroke="#0C0C0E" stroke-width="1.2"><circle cx="20" cy="88" r="2.4"/><circle cx="28" cy="82" r="2.4"/><circle cx="80" cy="88" r="2.4"/><circle cx="72" cy="82" r="2.4"/></g>
      <path d="M40 36 L37 15 L46 26 L50 6 L54 26 L63 15 L60 36Z" fill="url(#gd)" ${O}/>
      ${FACE("sk", "#2E2E34", "#8F2F3C")}
      <path d="M32 44 Q32 29 50 29 Q68 29 68 44 Q60 35 50 38 Q40 35 32 44Z" fill="url(#hr)" ${O}/>
      <path d="M36 52 L31 49.5 M64 52 L69 49.5" stroke="#17171A" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="32.5" cy="62" r="2.3" fill="none" stroke="url(#sv)" stroke-width="1.8"/><circle cx="67.5" cy="62" r="2.3" fill="none" stroke="url(#sv)" stroke-width="1.8"/>
      <circle cx="31.5" cy="55" r="1.4" fill="url(#sv)"/><circle cx="68.5" cy="55" r="1.4" fill="url(#sv)"/>`,

    // Pop Idol: gold twin tails with star clips, silver headphones, bright smile
    "@idol": () => `
      <path d="M31 36 Q8 44 12 68 Q15 84 27 78 Q22 62 33 50Z" fill="url(#gd)" ${O}/><path d="M69 36 Q92 44 88 68 Q85 84 73 78 Q78 62 67 50Z" fill="url(#gd)" ${O}/>
      ${NECK("sk2")}
      <path d="${SH}" fill="url(#sv)" ${O}/><polygon points="${star(50, 88, 7, 3)}" fill="url(#gd)" stroke="#0C0C0E" stroke-width="1.2" stroke-linejoin="round"/>
      <path d="M32 46 Q32 76 50 79 Q68 76 68 46 Q68 28 50 28 Q32 28 32 46Z" fill="url(#sk2)" ${O}/>
      <path d="M38 52.5 Q43 48.5 47.5 52.5 Q43 55 38 52.5Z M62 52.5 Q57 48.5 52.5 52.5 Q57 55 62 52.5Z" fill="#17171A"/>
      <circle cx="42.8" cy="52.2" r="1.8" fill="#6A4A2E"/><circle cx="57.2" cy="52.2" r="1.8" fill="#6A4A2E"/>
      <circle cx="43.5" cy="51.4" r=".7" fill="#fff"/><circle cx="57.9" cy="51.4" r=".7" fill="#fff"/>
      <path d="M37.5 51.5 Q43 47 48 51.5 M62.5 51.5 Q57 47 52 51.5" fill="none" stroke="#17171A" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M50 55 L48.4 60 Q50 61.6 51.6 60" fill="none" stroke="#00000044" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M43.5 65.5 Q50 64 56.5 65.5 Q54 73.5 50 73.5 Q46 73.5 43.5 65.5Z" fill="#8F2F3C" ${O}/><path d="M45.6 66.4 Q50 65.6 54.4 66.4 L54 68 Q50 67.4 46 68Z" fill="#fff"/>
      <path d="M30 46 Q32 26 50 25 Q68 26 70 46 Q60 33 50 37 Q40 33 30 46Z" fill="url(#gd)" ${O}/>
      <path d="M30 48 Q29 18 50 17 Q71 18 70 48" fill="none" stroke="#0C0C0E" stroke-width="7.4" stroke-linecap="round"/><path d="M30 48 Q29 18 50 17 Q71 18 70 48" fill="none" stroke="url(#sv)" stroke-width="4" stroke-linecap="round"/>
      <circle cx="30" cy="54" r="7.2" fill="url(#ch)" ${O}/><circle cx="30" cy="54" r="3.2" fill="url(#gd)"/><circle cx="70" cy="54" r="7.2" fill="url(#ch)" ${O}/><circle cx="70" cy="54" r="3.2" fill="url(#gd)"/>
      <polygon points="${star(38, 33, 4.4, 1.9)}" fill="url(#sv)" stroke="#0C0C0E" stroke-width="1" stroke-linejoin="round"/>`,
  };

  const PREMIUM = [
    { id: "@ninja", name: "Shadow Ninja" }, { id: "@knight", name: "Silver Knight" }, { id: "@wizard", name: "Arcane Wizard" },
    { id: "@robot", name: "Chrome Bot" }, { id: "@viking", name: "Viking Raider" }, { id: "@pirate", name: "Pirate Captain" },
    { id: "@samurai", name: "Iron Samurai" }, { id: "@astro", name: "Star Pilot" }, { id: "@dragon", name: "Golden Dragon" },
    { id: "@queen", name: "Crown Queen" },
    { id: "@valk", name: "Valkyrie" }, { id: "@elf", name: "Elf Archer" }, { id: "@sorc", name: "Sorceress" },
    { id: "@ace", name: "Ace Pilot" }, { id: "@hacker", name: "Neon Hacker" }, { id: "@rogue", name: "Shadow Rogue" },
    { id: "@punk", name: "Punk Rocker" }, { id: "@idol", name: "Pop Idol" },
  ];

  const ALL = CLASSIC.concat(PREMIUM);
  const NAMES = {}; ALL.forEach((a) => { NAMES[a.id] = a.name; });
  const cache = {};
  const src = (id) => cache[id] || (ART[id] ? (cache[id] = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(wrap(ART[id]()))) : "");

  window.Avatars = {
    classic: CLASSIC.map((a) => a.id),
    premium: PREMIUM.map((a) => a.id),
    all: ALL.map((a) => a.id),
    isCode: (v) => typeof v === "string" && v.charAt(0) === "@",
    label: (v) => NAMES[v] || "Avatar",
    // Safe HTML for any avatar value: an illustrated image for the new avatars, escaped text (emoji) for the rest.
    // An unknown "@code" (for example one from a newer version) falls back to the fox instead of showing raw text.
    inner(v) {
      if (ART[v]) return `<img class="avx" src="${src(v)}" alt="" draggable="false" decoding="async">`;
      if (this.isCode(v)) return "🦊";
      return esc(v);
    },
  };
})();
