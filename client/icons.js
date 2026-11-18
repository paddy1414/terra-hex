// Original resource icons (SVG). Used by the interface and painted onto harbour signs.
export const RES_COLORS = {
  wood: '#3f7d3a', brick: '#b5532f', sheep: '#8dbb4c', wheat: '#e0b33c', ore: '#7d8794', any: '#c99a3b',
  paper: '#4f8f5a', cloth: '#c9a227', coin: '#3e6fb0', gold: '#e0a419'
};
export const RES_NAMES = { wood: 'Wood', brick: 'Brick', sheep: 'Sheep', wheat: 'Wheat', ore: 'Ore', paper: 'Paper', cloth: 'Cloth', coin: 'Coin' };
export const TRACK_COLORS = { trade: '#d9b23a', politics: '#3e6fb0', science: '#4f9a5a' };
export const TERRAIN_NAMES = {
  gold: 'Gold field', sea: 'Open sea',
  forest: 'Forest', hills: 'Hills', pasture: 'Pasture', fields: 'Fields', mountains: 'Mountains', desert: 'Desert'
};

const SVG = {
  wood: `<g><path d="M32 6 L50 32 H40 L54 50 H10 L24 32 H14 Z" fill="#2f6b34"/><path d="M32 6 L50 32 H40 L54 50 H32 Z" fill="#245a2b"/><rect x="28" y="50" width="8" height="9" rx="1" fill="#6b4426"/></g>`,
  brick: `<g><rect x="6" y="34" width="24" height="12" rx="1.5" fill="#b5532f"/><rect x="34" y="34" width="24" height="12" rx="1.5" fill="#a2462a"/><rect x="18" y="20" width="24" height="12" rx="1.5" fill="#c4643c"/><rect x="6" y="48" width="24" height="10" rx="1.5" fill="#9a4225"/><rect x="34" y="48" width="24" height="10" rx="1.5" fill="#b5532f"/><path d="M20 22h20M8 36h20M36 36h20" stroke="#e08a63" stroke-width="1.6" opacity=".7"/></g>`,
  sheep: `<g><ellipse cx="32" cy="54" rx="24" ry="5" fill="#7fae46"/><g stroke="#4a3b2c" stroke-width="2.2"><ellipse cx="30" cy="36" rx="20" ry="13" fill="#e9e5d8"/><circle cx="16" cy="30" r="8" fill="#e9e5d8"/><circle cx="28" cy="25" r="9" fill="#f1eee4"/><circle cx="41" cy="27" r="8" fill="#e9e5d8"/></g><path d="M20 34c3-3 7-3 10 0M30 40c3-3 7-3 10 0" stroke="#b9b3a2" stroke-width="2" fill="none" stroke-linecap="round"/><ellipse cx="51" cy="33" rx="7" ry="8" fill="#2f2723"/><circle cx="53" cy="31" r="1.6" fill="#fff"/><rect x="18" y="45" width="4.5" height="10" rx="1.5" fill="#2f2723"/><rect x="36" y="45" width="4.5" height="10" rx="1.5" fill="#2f2723"/></g>`,

  wheat: `<g stroke="#9a6d14" stroke-width="2.4" stroke-linecap="round"><path d="M32 58 V20"/><path d="M32 58 L22 26"/><path d="M32 58 L42 26"/></g><g fill="#e5b83f"><ellipse cx="32" cy="14" rx="4.5" ry="9"/><ellipse cx="21" cy="21" rx="4" ry="8" transform="rotate(-18 21 21)"/><ellipse cx="43" cy="21" rx="4" ry="8" transform="rotate(18 43 21)"/></g><path d="M24 44 h16" stroke="#7a5310" stroke-width="3" stroke-linecap="round"/>`,
  ore: `<g><path d="M8 52 L20 26 L32 34 L40 14 L56 52 Z" fill="#6f7884"/><path d="M40 14 L56 52 H40 L36 30 Z" fill="#5a6270"/><path d="M20 26 L32 34 L26 52 H8 Z" fill="#828c98"/><path d="M30 44 l5-7 5 7 -5 6z" fill="#8fd0e8"/><path d="M44 40 l3-4 3 4 -3 4z" fill="#b6e6f5"/></g>`,
  paper: `<g><path d="M14 12h30a6 6 0 0 1 6 6v30a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6z" fill="#f4ecd2"/><path d="M14 12a6 6 0 0 0-6 6v4h12v-4a6 6 0 0 0-6-6z" fill="#d9cba3"/><path d="M22 24h20M22 31h20M22 38h14" stroke="#6b5a3a" stroke-width="2.6" stroke-linecap="round"/><circle cx="44" cy="46" r="5" fill="#4f8f5a"/></g>`,
  cloth: `<g><path d="M10 18l22-8 22 8v28l-22 8-22-8z" fill="#e2bf4a"/><path d="M10 18l22 8 22-8M32 26v28" stroke="#9c7a18" stroke-width="2.4" fill="none"/><path d="M16 24l10 4M16 32l10 4M16 40l10 4" stroke="#fff3c4" stroke-width="2" opacity=".8"/></g>`,
  coin: `<g><ellipse cx="32" cy="42" rx="20" ry="8" fill="#2e558a"/><rect x="12" y="30" width="40" height="12" fill="#3e6fb0"/><ellipse cx="32" cy="30" rx="20" ry="8" fill="#6b9be0"/><ellipse cx="32" cy="30" rx="12" ry="4.5" fill="none" stroke="#dbe8ff" stroke-width="2"/><ellipse cx="32" cy="22" rx="14" ry="5.5" fill="#86b0ec" opacity=".9"/></g>`,
  gold: `<g><path d="M10 44l10-14h14l8 14z" fill="#e0a419"/><path d="M26 44l10-16h12l8 16z" fill="#f2c94a"/><path d="M18 30l8-10h10l6 10z" fill="#ffd970"/><path d="M14 52h40" stroke="#9c6a10" stroke-width="3" stroke-linecap="round"/><circle cx="46" cy="16" r="3" fill="#fff6c8"/><circle cx="16" cy="18" r="2" fill="#fff6c8"/></g>`,
  any: `<g><circle cx="32" cy="32" r="22" fill="none" stroke="#c99a3b" stroke-width="4"/><text x="32" y="41" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="26" fill="#c99a3b">?</text></g>`
};

export function iconSvg(type, size = 28) {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">${SVG[type] || ''}</svg>`;
}
export function iconDataUrl(type) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 64 64">${SVG[type]}</svg>`);
}
