// Desenho das cartas, naipes e ícones (SVG).
import { SUIT_INFO } from '../../shared/engine.js';
import { RANK_ORDER, SPECIAL_TIPS, SUIT_ORDER, el } from './core.js';

// ---------- cartas ----------

// Naipes desenhados num quadrado 100×100, usados por <use> nas cartas (não dependem da fonte nem viram emoji).
document.body.insertAdjacentHTML(
  'afterbegin',
  `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <symbol id="suit-H" viewBox="0 0 100 100"><path fill="currentColor" d="M50 94C22 68 3 52 3 30 3 14 15 4 29 4c10 0 17 6 21 15 4-9 11-15 21-15 14 0 26 10 26 26 0 22-19 38-47 64z"/></symbol>
    <symbol id="suit-D" viewBox="0 0 100 100"><path fill="currentColor" d="M50 1 86 50 50 99 14 50z"/></symbol>
    <symbol id="suit-S" viewBox="0 0 100 100"><path fill="currentColor" d="M50 2C40 24 5 40 5 63c0 13 10 22 22 22 9 0 16-4 20-11-1 11-5 18-14 24h34c-9-6-13-13-14-24 4 7 11 11 20 11 12 0 22-9 22-22C95 40 60 24 50 2z"/></symbol>
    <symbol id="suit-C" viewBox="0 0 100 100"><g fill="currentColor"><circle cx="50" cy="27" r="21"/><circle cx="26" cy="60" r="21"/><circle cx="74" cy="60" r="21"/><path d="M42 40h16v20H42z"/><path d="M47 62c-1 15-5 26-15 36h36c-10-10-14-21-15-36z"/></g></symbol>
    <symbol id="star" viewBox="0 0 24 24"><path fill="currentColor" d="m12 1.8 3 6.9 7.5.7-5.7 5 1.7 7.3L12 17.9l-6.5 3.8 1.7-7.3-5.7-5 7.5-.7z"/></symbol>
    <symbol id="jester" viewBox="0 0 100 100"><g stroke="#1d1d28" stroke-width="2.5" stroke-linejoin="round">
      <path fill="#d0102a" d="M24 72C18 54 10 42 6 30c14 2 26 14 30 30z"/><path fill="#d0102a" d="M76 72c6-18 14-30 18-42-14 2-26 14-30 30z"/>
      <path fill="#2aa7d8" d="M28 72C30 44 40 22 50 8c10 14 20 36 22 64z"/>
      <rect fill="#f5c43a" x="20" y="70" width="60" height="14" rx="4"/>
      <path fill="#d0102a" d="M34 77l4-4 4 4-4 4zM46 77l4-4 4 4-4 4zM58 77l4-4 4 4-4 4z"/>
      <circle fill="#f5c43a" cx="6" cy="30" r="5"/><circle fill="#f5c43a" cx="50" cy="8" r="5"/><circle fill="#f5c43a" cx="94" cy="30" r="5"/>
    </g></symbol>
    <symbol id="i-plus" viewBox="0 0 24 24"><rect x="10" y="3" width="4" height="18" rx="2"/><rect x="3" y="10" width="18" height="4" rx="2"/></symbol>
    <symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="7.5" r="4"/><path d="M1.5 20.5c0-4.1 3.4-7.5 7.5-7.5s7.5 3.4 7.5 7.5V21h-15z"/><circle cx="17.5" cy="8.5" r="3"/><path d="M17.6 13c2.8.3 4.9 3 4.9 6V21h-4.3v-.5c0-2.9-1.1-5.5-2.9-7.3.7-.2 1.5-.3 2.3-.2z"/></symbol>
    <symbol id="i-book" viewBox="0 0 24 24"><path d="M2 5c0-1.1.9-2 2-2h4c1.9 0 3 1 3 2.8V21c-.7-1-1.8-1.5-3-1.5H4c-1.1 0-2-.9-2-2zM22 5c0-1.1-.9-2-2-2h-4c-1.9 0-3 1-3 2.8V21c.7-1 1.8-1.5 3-1.5h4c1.1 0 2-.9 2-2z"/></symbol>
    <symbol id="i-back" viewBox="0 0 24 24"><path d="M10.3 3.8a1.7 1.7 0 0 1 0 2.4L6.8 9.8H20a2.2 2.2 0 0 1 0 4.4H6.8l3.5 3.6a1.7 1.7 0 0 1-2.4 2.4l-6-6.2a2.7 2.7 0 0 1 0-4l6-6.2a1.7 1.7 0 0 1 2.4 0z"/></symbol>
    <symbol id="i-bot" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 1.5a1.5 1.5 0 0 1 1.5 1.5v2H16a4 4 0 0 1 4 4v.5h.5A1.5 1.5 0 0 1 22 11v4a1.5 1.5 0 0 1-1.5 1.5H20v.5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-.5h-.5A1.5 1.5 0 0 1 2 15v-4a1.5 1.5 0 0 1 1.5-1.5H4V9a4 4 0 0 1 4-4h2.5V3A1.5 1.5 0 0 1 12 1.5zM9 10.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></symbol>
    <symbol id="i-volume" viewBox="0 0 24 24"><path d="M3 9.5c0-.8.7-1.5 1.5-1.5H7l4.4-3.7c.7-.6 1.6-.1 1.6.8v13.8c0 .9-.9 1.4-1.6.8L7 16H4.5c-.8 0-1.5-.7-1.5-1.5z"/><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M16.3 8.8a4.5 4.5 0 0 1 0 6.4M19.2 5.9a8.6 8.6 0 0 1 0 12.2"/></symbol>
    <symbol id="i-mute" viewBox="0 0 24 24"><path d="M3 9.5c0-.8.7-1.5 1.5-1.5H7l4.4-3.7c.7-.6 1.6-.1 1.6.8v13.8c0 .9-.9 1.4-1.6.8L7 16H4.5c-.8 0-1.5-.7-1.5-1.5z"/><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="m16.5 9.5 5 5M21.5 9.5l-5 5"/></symbol>
    <symbol id="i-pause" viewBox="0 0 24 24"><rect x="5" y="4" width="5" height="16" rx="1.5"/><rect x="14" y="4" width="5" height="16" rx="1.5"/></symbol>
    <symbol id="i-play" viewBox="0 0 24 24"><path d="M7 5.2c0-1.2 1.3-1.9 2.3-1.3l10.4 6.8c.9.6.9 2 0 2.6L9.3 20.1c-1 .6-2.3-.1-2.3-1.3z"/></symbol>
    <symbol id="i-chat" viewBox="0 0 24 24"><path d="M12 2.5c5.5 0 10 3.8 10 8.5s-4.5 8.5-10 8.5c-1.1 0-2.2-.2-3.2-.4l-4.6 2.6c-.8.4-1.6-.3-1.4-1.1l1.1-3.9C2.8 15.1 2 13.1 2 11c0-4.7 4.5-8.5 10-8.5z"/></symbol>
    <symbol id="i-refresh" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M19.5 9.5A8 8 0 0 0 5 7.5M4.5 14.5A8 8 0 0 0 19 16.5"/><path d="M21 3.5v6.2c0 .6-.5 1-1 1h-6.2c-.9 0-1.3-1.1-.7-1.7l6.2-6.2c.6-.6 1.7-.2 1.7.7zM3 20.5v-6.2c0-.6.5-1 1-1h6.2c.9 0 1.3 1.1.7 1.7l-6.2 6.2c-.6.6-1.7.2-1.7-.7z"/></symbol>
    <symbol id="i-chevron" viewBox="0 0 24 24"><path d="M4.2 9.3a1.8 1.8 0 0 1 2.5-2.5l5.3 5.3 5.3-5.3a1.8 1.8 0 0 1 2.5 2.5l-6.5 6.5a1.8 1.8 0 0 1-2.6 0z"/></symbol>
    <symbol id="i-check" viewBox="0 0 24 24"><path d="M3.8 12.3a1.8 1.8 0 0 1 2.6 0l3.1 3.1 8.1-8.9a1.8 1.8 0 0 1 2.7 2.4l-9.4 10.3a1.8 1.8 0 0 1-2.6.1l-4.5-4.5a1.8 1.8 0 0 1 0-2.5z"/></symbol>
    <symbol id="i-x" viewBox="0 0 24 24"><path d="M5.2 5.2a1.8 1.8 0 0 1 2.5 0l4.3 4.3 4.3-4.3a1.8 1.8 0 0 1 2.5 2.5L14.5 12l4.3 4.3a1.8 1.8 0 0 1-2.5 2.5L12 14.5l-4.3 4.3a1.8 1.8 0 0 1-2.5-2.5L9.5 12 5.2 7.7a1.8 1.8 0 0 1 0-2.5z"/></symbol>
    <symbol id="i-wifi-off" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M8.5 15.8a5 5 0 0 1 7 0M5 12.3a10 10 0 0 1 5-2.6M19 12.3a10 10 0 0 0-2-1.4M2 8.6a15 15 0 0 1 4-2.5M22 8.6A15 15 0 0 0 11 5M3 3l18 18"/><circle cx="12" cy="19.5" r="1.8"/></symbol>
    <symbol id="i-trophy" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M7 2h10a1 1 0 0 1 1 1v.5h2.5A1.5 1.5 0 0 1 22 5v1.5a5 5 0 0 1-4.6 5 6 6 0 0 1-3.9 3.3V18H16a1.5 1.5 0 0 1 1.5 1.5V22h-11v-2.5A1.5 1.5 0 0 1 8 18h2.5v-3.2a6 6 0 0 1-3.9-3.3A5 5 0 0 1 2 6.5V5a1.5 1.5 0 0 1 1.5-1.5H6V3a1 1 0 0 1 1-1zM4.5 6v.5a2.5 2.5 0 0 0 1.6 2.3A6 6 0 0 1 6 8V6zm15 0H18v2c0 .3 0 .5-.1.8a2.5 2.5 0 0 0 1.6-2.3z"/></symbol>
    <symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="7.5" r="4.5"/><path d="M3.5 21c0-4.7 3.8-8.5 8.5-8.5s8.5 3.8 8.5 8.5v.5h-17z"/></symbol>
    <symbol id="i-pencil" viewBox="0 0 24 24"><path d="M16.6 2.6a2.2 2.2 0 0 1 3.1 0l1.7 1.7a2.2 2.2 0 0 1 0 3.1L9.2 19.6l-5.6 1.7c-.6.2-1.1-.4-.9-.9l1.7-5.6z"/></symbol>
    <symbol id="i-dice" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm2 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm-4 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm-4 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></symbol>
    <symbol id="i-image" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm4 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5.5 18.5h13l-4.5-6-3.2 4-2-2.2z"/></symbol>
    <symbol id="i-droplet" viewBox="0 0 24 24"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></symbol>
    <symbol id="i-shirt" viewBox="0 0 24 24"><path d="M20.4 3.5 16 2a4 4 0 0 1-8 0L3.6 3.5a2 2 0 0 0-1.3 2.2l.6 3.5a1 1 0 0 0 1 .8H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.2a1 1 0 0 0 1-.8l.6-3.5a2 2 0 0 0-1.4-2.2z"/></symbol>
    <symbol id="i-scissors" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M6 2.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM6 14.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M20 4 8.5 15.5M14.5 14.5 20 20M8.5 8.5 12 12"/></symbol>
    <symbol id="i-smile" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM8.8 7.8a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zm6.4 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM7.3 13.5c.8 2.1 2.6 3.5 4.7 3.5s3.9-1.4 4.7-3.5z"/></symbol>
    <symbol id="i-crown" viewBox="0 0 24 24"><path fill="currentColor" stroke="#1d1d28" stroke-width="1.5" stroke-linejoin="round" d="M2.5 18 4 7l5 4.5L12 4l3 7.5L20 7l1.5 11z"/></symbol>
    <!-- reações rápidas (shared/reactions.js): carinhas no traço dos avatares -->
    <symbol id="r-boa" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="#ffc83d" stroke="#1d1d28" stroke-width="2.4"/><path d="M11.5 17.5Q14 14 16.5 17.5" fill="none" stroke="#1d1d28" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M23.5 17.5Q26 14 28.5 17.5" fill="none" stroke="#1d1d28" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.5 22.5H28.5Q27.5 32 20 32Q12.5 32 11.5 22.5Z" fill="#7a1a22" stroke="#1d1d28" stroke-width="2.2" stroke-linejoin="round"/><path d="M15 29.6Q20 27 25 29.6Q23 31.6 20 31.6Q17 31.6 15 29.6Z" fill="#ff6f8a"/><circle cx="10.5" cy="24" r="3" fill="#ff5a6e" opacity=".35"/><circle cx="29.5" cy="24" r="3" fill="#ff5a6e" opacity=".35"/></symbol>
    <symbol id="r-haha" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="#ffc83d" stroke="#1d1d28" stroke-width="2.4"/><path d="M11 14.5L16 17L11 19.5" fill="none" stroke="#1d1d28" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M29 14.5L24 17L29 19.5" fill="none" stroke="#1d1d28" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 22H29.5Q28.5 33.5 20 33.5Q11.5 33.5 10.5 22Z" fill="#7a1a22" stroke="#1d1d28" stroke-width="2.2" stroke-linejoin="round"/><path d="M11 22.2H29V25H11Z" fill="#fff"/><path d="M5.5 18.5Q3 23 5.5 25Q8 23 5.5 18.5Z" fill="#59c3ff" stroke="#1d1d28" stroke-width="1.3"/><path d="M34.5 18.5Q32 23 34.5 25Q37 23 34.5 18.5Z" fill="#59c3ff" stroke="#1d1d28" stroke-width="1.3"/></symbol>
    <symbol id="r-ops" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="#ffc83d" stroke="#1d1d28" stroke-width="2.4"/><circle cx="14" cy="17" r="2.4" fill="#1d1d28"/><circle cx="26" cy="17" r="2.4" fill="#1d1d28"/><path d="M15 27.5Q18 25 21 27Q23.5 28.6 26 26.5" fill="none" stroke="#1d1d28" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M31.5 5.5Q28 11 31.5 13Q35 11 31.5 5.5Z" fill="#59c3ff" stroke="#1d1d28" stroke-width="1.4" stroke-linejoin="round"/></symbol>
    <symbol id="r-grr" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="#ff7a59" stroke="#1d1d28" stroke-width="2.4"/><path d="M9.5 12.5L17 16" fill="none" stroke="#1d1d28" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M30.5 12.5L23 16" fill="none" stroke="#1d1d28" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="14.5" cy="19" r="2" fill="#1d1d28"/><circle cx="25.5" cy="19" r="2" fill="#1d1d28"/><rect x="12" y="24.5" width="16" height="6" rx="2" fill="#fff" stroke="#1d1d28" stroke-width="2"/><path d="M16 24.8V30.2M20 24.8V30.2M24 24.8V30.2" fill="none" stroke="#1d1d28" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></symbol>
    <symbol id="r-uau" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="#ffc83d" stroke="#1d1d28" stroke-width="2.4"/><path d="M10 11Q13.5 8.5 17 10.5" fill="none" stroke="#1d1d28" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M23 10.5Q26.5 8.5 30 11" fill="none" stroke="#1d1d28" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="14" cy="17.5" r="4.2" fill="#fff" stroke="#1d1d28" stroke-width="1.8"/><circle cx="26" cy="17.5" r="4.2" fill="#fff" stroke="#1d1d28" stroke-width="1.8"/><circle cx="14" cy="18" r="2.1" fill="#1d1d28"/><circle cx="26" cy="18" r="2.1" fill="#1d1d28"/><ellipse cx="20" cy="28" rx="3.6" ry="4.4" fill="#7a1a22" stroke="#1d1d28" stroke-width="2"/></symbol>
    <symbol id="r-vai" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="#ffc83d" stroke="#1d1d28" stroke-width="2.4"/><path d="M10.5 17.5A3.5 3.5 0 0 0 17.5 17.5Z" fill="#fff" stroke="#1d1d28" stroke-width="1.6"/><path d="M22.5 17.5A3.5 3.5 0 0 0 29.5 17.5Z" fill="#fff" stroke="#1d1d28" stroke-width="1.6"/><path d="M14.2 17.5A2 2 0 0 0 17.4 17.5Z" fill="#1d1d28"/><path d="M26.2 17.5A2 2 0 0 0 29.4 17.5Z" fill="#1d1d28"/><path d="M10 17.5H18M22 17.5H30" fill="none" stroke="#1d1d28" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.5 27H25" fill="none" stroke="#1d1d28" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="32" cy="32" r="6.5" fill="#fff" stroke="#1d1d28" stroke-width="2"/><path d="M32 28.8V32L34.2 33.6" fill="none" stroke="#1d1d28" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>
    <symbol id="r-silas" viewBox="0 0 40 40"><g transform="rotate(-14 20 20)"><circle cx="20" cy="20" r="17" fill="#ffc83d" stroke="#1d1d28" stroke-width="2.4"/><path d="M10.5 16.5Q13.5 12.5 16.5 16.5" fill="none" stroke="#1d1d28" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="26" cy="15.5" r="4.6" fill="#fff" stroke="#1d1d28" stroke-width="1.8"/><circle cx="27.3" cy="14.3" r="2.2" fill="#1d1d28"/><path d="M10.5 22H29.5Q28.5 32.5 20 32.5Q11.5 32.5 10.5 22Z" fill="#7a1a22" stroke="#1d1d28" stroke-width="2.2" stroke-linejoin="round"/><path d="M11 22.2H29V24.6H11Z" fill="#fff"/><path d="M18.5 28.5Q23.5 27 26 29.5Q27.5 35.5 22.8 36.2Q18.8 36.6 18.5 31Z" fill="#ff6f8a" stroke="#1d1d28" stroke-width="1.8" stroke-linejoin="round"/><path d="M22.4 30.2V33.6" fill="none" stroke="#d94a64" stroke-width="1.3" stroke-linecap="round"/><circle cx="9.5" cy="24.5" r="2.8" fill="#ff5a6e" opacity=".35"/></g></symbol>
  </defs></svg>`,
);

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// Ícones de interface (sprite acima): icon('bot') -> <svg class="icon"><use href="#i-bot"/></svg>.
export function icon(name, className = '') {
  const node = svg('svg', {
    class: `icon ${className}`.trim(),
    'aria-hidden': 'true',
  });
  node.append(svg('use', { href: `#i-${name}` }));
  return node;
}

// Nome com um ícone de robô na frente quando é bot.
export function nameWithBot(className, name, isBot, { top1 = false } = {}) {
  const node = el('div', className);
  if (isBot) node.append(icon('bot'), ' ');
  if (!top1) {
    node.append(name);
    return node;
  }
  // 1º do ranking: o selo fica ao lado e o nome é que encolhe (com reticências) se faltar espaço
  node.classList.add('has-top1');
  node.append(top1Badge(), el('span', 'nm-text', name));
  return node;
}

// Selo "TOP 1": quem está em 1º no ranking de vitórias.
export function top1Badge() {
  const badge = el('span', 'top1-badge', 'TOP 1');
  badge.prepend(icon('trophy'));
  badge.title = '1º lugar no ranking de vitórias';
  return badge;
}

export function suitIcon(suit, className) {
  const icon = svg('svg', {
    class: className,
    viewBox: '0 0 100 100',
    'aria-hidden': 'true',
  });
  icon.append(svg('use', { href: `#suit-${suit}` }));
  return icon;
}

// Disposição clássica dos pips: [coluna, altura de 0 (topo) a 1 (base)]. Os da metade de baixo ficam de ponta-cabeça.
const L = 23.5,
  C = 36,
  R = 48.5;
const PIPS = {
  2: [
    [C, 0],
    [C, 1],
  ],
  3: [
    [C, 0],
    [C, 0.5],
    [C, 1],
  ],
  4: [
    [L, 0],
    [R, 0],
    [L, 1],
    [R, 1],
  ],
  5: [
    [L, 0],
    [R, 0],
    [C, 0.5],
    [L, 1],
    [R, 1],
  ],
  6: [
    [L, 0],
    [R, 0],
    [L, 0.5],
    [R, 0.5],
    [L, 1],
    [R, 1],
  ],
  7: [
    [L, 0],
    [R, 0],
    [C, 0.25],
    [L, 0.5],
    [R, 0.5],
    [L, 1],
    [R, 1],
  ],
  8: [
    [L, 0],
    [R, 0],
    [C, 0.25],
    [L, 0.5],
    [R, 0.5],
    [C, 0.75],
    [L, 1],
    [R, 1],
  ],
  9: [
    [L, 0],
    [R, 0],
    [L, 1 / 3],
    [R, 1 / 3],
    [C, 0.5],
    [L, 2 / 3],
    [R, 2 / 3],
    [L, 1],
    [R, 1],
  ],
  10: [
    [L, 0],
    [R, 0],
    [C, 1 / 6],
    [L, 1 / 3],
    [R, 1 / 3],
    [L, 2 / 3],
    [R, 2 / 3],
    [C, 5 / 6],
    [L, 1],
    [R, 1],
  ],
};

// Pips no mesmo sistema de coordenadas da carta (72×104), então escalam junto com --card-w.
function renderPips(card) {
  const box = svg('svg', { class: 'pips', viewBox: '0 0 72 104' });
  const pip = (x, y, size, flip) => {
    const use = svg('use', {
      href: `#suit-${card.suit}`,
      x: x - size / 2,
      y: y - size / 2,
      width: size,
      height: size,
    });
    if (flip) use.setAttribute('transform', `rotate(180 ${x} ${y})`);
    box.append(use);
  };
  if (card.rank === 'A') pip(C, 52, 26, false);
  else for (const [x, t] of PIPS[card.rank]) pip(x, 21 + t * 62, 14, t > 0.5);
  return box;
}

// Estrela dourada no canto das cartas especiais (SVG, para não virar emoji).
function starMark() {
  const star = svg('svg', {
    class: 'star',
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
  });
  star.append(svg('use', { href: '#star' }));
  return star;
}

export function renderCard(card) {
  const node = el('div', 'card');
  node.dataset.id = card.id;
  if (card.rank === 'JOKER') {
    node.classList.add('joker', 'special');
    const hat = svg('svg', { class: 'pips', viewBox: '0 0 100 100' });
    hat.append(svg('use', { href: '#jester' }));
    node.append(el('span', 'label', 'JOKER'), hat, el('span', 'label bottom', 'JOKER'), starMark());
    return node;
  }
  const suit = SUIT_INFO[card.suit];
  if (suit.color === 'red') node.classList.add('red');
  if (SPECIAL_TIPS[card.rank]) {
    node.classList.add('special');
    node.append(starMark());
  }
  for (const pos of ['tl', 'br']) {
    const corner = el('span', `corner ${pos}`);
    corner.append(el('b', null, card.rank), suitIcon(card.suit));
    node.append(corner);
  }
  if (['J', 'Q', 'K'].includes(card.rank)) {
    const art = el('img', 'face');
    art.src = `/cards/${card.rank}${card.suit}.webp`;
    art.alt = '';
    art.draggable = false;
    node.append(art);
  } else node.append(renderPips(card));
  return node;
}

export function sortHand(hand) {
  return [...hand].sort((a, b) => {
    const sa = a.suit ? SUIT_ORDER[a.suit] : 9;
    const sb = b.suit ? SUIT_ORDER[b.suit] : 9;
    return sa - sb || RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
  });
}
