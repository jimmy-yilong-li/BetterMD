/* 界面上的图标。都是这里写死的静态图形，不含笔记里的文字。
   线条图标（工具栏、菜单）是 18 格的细线；信封、散页、笔记本取自 macOS 版的图形（Sources/BetterMD/Icons.swift）。 */
const LINE = {
  search: '<circle cx="8" cy="8" r="4.6"/><path d="m11.5 11.5 3.3 3.3"/>',
  clear: '<circle cx="9" cy="9" r="6.2" fill="currentColor" stroke="none" opacity=".32"/><path d="m6.9 6.9 4.2 4.2m0-4.2-4.2 4.2" stroke="var(--list)"/>',
  compose: '<path d="M15 9.6v4.1c0 .9-.7 1.6-1.6 1.6H4.3c-.9 0-1.6-.7-1.6-1.6V4.6c0-.9.7-1.6 1.6-1.6h4.1"/><path d="m13.2 2.5 2.3 2.3-6 6-2.9.6.6-2.9z"/>',
  sidebar: '<rect x="2.2" y="3.2" width="13.6" height="11.6" rx="2.2"/><path d="M6.8 3.2v11.6"/>',
  image: '<rect x="2.2" y="3.4" width="13.6" height="11.2" rx="2"/><circle cx="6.3" cy="7.3" r="1.2"/><path d="m2.6 12.6 3.6-3.3 2.8 2.5 2.3-2 4.2 3.6"/>',
  focus: '<path d="M10.4 3h4.6v4.6M7.6 15H3v-4.6M15 3l-4.9 4.9M3 15l4.9-4.9"/>',
  more: '<circle cx="4.2" cy="9" r="1.15" fill="currentColor" stroke="none"/><circle cx="9" cy="9" r="1.15" fill="currentColor" stroke="none"/><circle cx="13.8" cy="9" r="1.15" fill="currentColor" stroke="none"/>',
  menu: '<path d="M3.2 5h11.6M3.2 9h11.6M3.2 13h11.6"/>',
  chevron: '<path d="m6.8 4.6 4.4 4.4-4.4 4.4"/>',
  plus: '<path d="M9 3.8v10.4M3.8 9h10.4"/>',
  todo: '<rect x="2.8" y="2.8" width="12.4" height="12.4" rx="3.2"/><path d="m5.9 9.2 2.2 2.2 4-4.6"/>',
  tag: '<path d="M7 2.8 5.6 15.2M12.4 2.8 11 15.2M3 6.6h12M2.6 11.4h12"/>',
  trash: '<path d="M3.2 5h11.6M7 5V3.4c0-.4.3-.7.7-.7h2.6c.4 0 .7.3.7.7V5m2.6 0-.6 9c0 .8-.7 1.3-1.4 1.3H6.4c-.7 0-1.4-.5-1.4-1.3l-.6-9M7.4 8v4.4M10.6 8v4.4"/>',
  pin: '<path d="M5 2.6h8v12.8l-4-3.1-4 3.1z"/>',
  move: '<path d="M2.4 5.2c0-.8.6-1.4 1.4-1.4h3l1.5 1.7h5.9c.8 0 1.4.6 1.4 1.4v6c0 .8-.6 1.4-1.4 1.4H3.8c-.8 0-1.4-.6-1.4-1.4z"/><path d="M7.4 10.2h4m-1.5-1.6 1.6 1.6-1.6 1.6"/>',
  reveal: '<path d="M2.4 5.2c0-.8.6-1.4 1.4-1.4h3l1.5 1.7h5.9c.8 0 1.4.6 1.4 1.4v6c0 .8-.6 1.4-1.4 1.4H3.8c-.8 0-1.4-.6-1.4-1.4z"/>',
  copy: '<rect x="6" y="6" width="9" height="9" rx="1.8"/><path d="M3.2 11.6V4.4c0-.8.6-1.4 1.4-1.4h7.2"/>',
  restore: '<path d="M3.4 9a5.6 5.6 0 1 0 1.8-4.1M3 3.2v3h3"/>',
  rename: '<path d="m12.2 3 2.8 2.8-8.2 8.2-3.4.6.6-3.4z"/><path d="m10.6 4.6 2.8 2.8"/>',
  keyboard: '<rect x="1.8" y="4.4" width="14.4" height="9.2" rx="2"/><path d="M4.6 7.4h.01M7.4 7.4h.01M10.2 7.4h.01M13 7.4h.01M4.6 10.4h.01M13 10.4h.01M7 10.4h4"/>',
  folderPlus: '<path d="M2.4 5.2c0-.8.6-1.4 1.4-1.4h3l1.5 1.7h5.9c.8 0 1.4.6 1.4 1.4v6c0 .8-.6 1.4-1.4 1.4H3.8c-.8 0-1.4-.6-1.4-1.4z"/><path d="M9 8.2v4M7 10.2h4"/>',
  sync: '<path d="M14.6 8a5.7 5.7 0 0 0-10-2.9M3.4 10a5.7 5.7 0 0 0 10 2.9"/><path d="M4.4 2.6v2.7h2.7M13.6 15.4v-2.7h-2.7"/>',
  cloud: '<path d="M5.2 14h7.9a3 3 0 0 0 .5-6 4.5 4.5 0 0 0-8.7-.9A3.5 3.5 0 0 0 5.2 14z"/>',
  cloudDone: '<path d="M5.2 14h7.9a3 3 0 0 0 .5-6 4.5 4.5 0 0 0-8.7-.9A3.5 3.5 0 0 0 5.2 14z"/><path d="m6.9 9.9 1.6 1.6 2.8-3"/>',
  cloudOff: '<path d="M5.2 14h7.9a3 3 0 0 0 .5-6 4.5 4.5 0 0 0-8.7-.9A3.5 3.5 0 0 0 5.2 14z"/><path d="m3 3 12 12"/>',
  cloudAlert: '<path d="M5.2 14h7.9a3 3 0 0 0 .5-6 4.5 4.5 0 0 0-8.7-.9A3.5 3.5 0 0 0 5.2 14z"/><path d="M9 7.4v2.6M9 11.9h.01"/>',
  close: '<path d="m4.6 4.6 8.8 8.8m0-8.8-8.8 8.8"/>',
  check: '<path d="m3.8 9.4 3.4 3.4 7-7.6"/>',
  doc: '<path d="M5 2.6h5.4l3.2 3.2v8.8c0 .5-.4.8-.8.8H5c-.5 0-.8-.3-.8-.8V3.4c0-.5.3-.8.8-.8z"/><path d="M10.2 2.8v3.2h3.2"/>',
  mail: '<rect x="2.4" y="4" width="13.2" height="10" rx="1.8"/><path d="m2.9 5.2 6.1 4.8 6.1-4.8"/>',
  // 格式面板
  bold: '<path d="M5.4 3.4h4.2a2.7 2.7 0 0 1 0 5.4H5.4zM5.4 8.8h4.9a2.9 2.9 0 0 1 0 5.8H5.4z" stroke-width="1.8"/>',
  italic: '<path d="M10.6 3.4 7.4 14.6M7.6 3.4h5M5.4 14.6h5"/>',
  strike: '<path d="M12.6 5.4c-.5-1.3-1.9-2-3.6-2-2 0-3.5 1-3.5 2.6 0 1.2.8 2 2.3 2.5M5.2 12.4c.5 1.4 2 2.2 3.8 2.2 2.2 0 3.7-1.1 3.7-2.8 0-.7-.2-1.3-.7-1.8M2.8 9h12.4"/>',
  code: '<path d="m6.2 5.4-3.6 3.6 3.6 3.6M11.8 5.4l3.6 3.6-3.6 3.6"/>',
  link: '<path d="M7.6 10.4a3.2 3.2 0 0 0 4.5 0l2-2a3.2 3.2 0 0 0-4.5-4.5l-.9.9M10.4 7.6a3.2 3.2 0 0 0-4.5 0l-2 2a3.2 3.2 0 0 0 4.5 4.5l.9-.9"/>',
  list: '<path d="M6.8 4.6h8.4M6.8 9h8.4M6.8 13.4h8.4"/><circle cx="3.4" cy="4.6" r=".9" fill="currentColor" stroke="none"/><circle cx="3.4" cy="9" r=".9" fill="currentColor" stroke="none"/><circle cx="3.4" cy="13.4" r=".9" fill="currentColor" stroke="none"/>',
  numbered: '<path d="M7.4 4.6h7.8M7.4 9h7.8M7.4 13.4h7.8M2.8 3.6l1.1-.6v3.6M2.6 11.4c.2-.5.6-.8 1.2-.8.7 0 1.1.4 1.1 1 0 .5-.3.8-.8 1.3l-1.5 1.5h2.5" stroke-width="1.15"/>',
  quote: '<path d="M3.2 3.4v11.2" stroke-width="2"/><path d="M6.8 5.6h8M6.8 9h8M6.8 12.4h5"/>',
  rule: '<path d="M2.6 9h.01M6.8 9h.01M11.2 9h.01M15.4 9h.01" stroke-width="2.2"/>',
  codeBlock: '<rect x="2.2" y="3" width="13.6" height="12" rx="2.2"/><path d="m6.6 7-2 2 2 2M11.4 7l2 2-2 2"/>',
  table: '<rect x="2.2" y="3.2" width="13.6" height="11.6" rx="2"/><path d="M2.2 7.4h13.6M2.2 11.2h13.6M7 3.2v11.6"/>',
  math: '<path d="M13.6 3.6H5l4.2 5.4L5 14.4h8.6"/>',
};

/** 一个线条图标（18×18，跟着文字颜色）。 */
function lineIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 18 18');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon', `icon-${name}`);
  svg.innerHTML = LINE[name] ?? '';
  return svg;
}

const OBJECTS = {
  // 「我的笔记」：朱砂封面的笔记本
  notebook: ['0 0 16 16', '<rect x="2.6" y="1.6" width="11" height="12.8" rx="1.7" fill="var(--accent)"/><path d="M4.3 1.6v12.8" stroke="#000" stroke-opacity=".22" stroke-width="1.2"/><path d="M11.2 1.6v12.8" stroke="#000" stroke-opacity=".3" stroke-width=".9"/><rect x="6.1" y="4.3" width="3.9" height="2.3" rx=".5" fill="#fff" fill-opacity=".78"/>'],
  // 「未分类」：一张微微倾斜、折了角的散页
  sheet: ['0 0 18 18', '<g transform="rotate(-7 9 9)"><path d="M4.8 2.4h6.4l3.2 3.2v9.6c0 .55-.45 1-1 1H4.8c-.55 0-1-.45-1-1V3.4c0-.55.45-1 1-1z" fill="var(--letter)" stroke="var(--env-edge)" stroke-width=".6"/><path d="M11.2 2.4v2.6c0 .33.27.6.6.6h2.6z" fill="var(--flap-top)" stroke="var(--env-edge)" stroke-width=".5"/><path d="M6 8.4h6.2M6 10.4h6.2M6 12.4h4" stroke="var(--env-seam)" stroke-width=".7" stroke-linecap="round" fill="none"/></g>'],
  // 文件夹：牛皮纸信封，封口压一枚朱砂火漆印。加上 .open 时封盖翻起、火漆印消失、信纸探出来（动画在 app.css）
  envelope: ['0 0 18 18', '<path class="env-back" d="M1.6 6.9h14.8L9.9 2.2c-.54-.4-1.26-.4-1.8 0z" fill="url(#g-flap)" stroke="var(--env-edge)" stroke-width=".55"/>'
    + '<g class="env-sheet"><rect x="3.4" y="3.4" width="11.2" height="8.6" rx=".7" fill="var(--letter)" stroke="var(--env-edge)" stroke-width=".4"/><path d="M5.2 5.3h7.6M5.2 7h5.4" stroke="var(--env-seam)" stroke-width=".6" stroke-linecap="round" fill="none"/></g>'
    + '<rect x="1.4" y="6.6" width="15.2" height="9.8" rx="1.5" fill="url(#g-envelope)" stroke="var(--env-edge)" stroke-width=".55"/>'
    + '<path d="M1.9 15.9 9 11.2l7.1 4.7" stroke="var(--env-seam)" stroke-width=".55" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
    + '<path class="env-flap" d="M1.6 6.9h14.8l-6.5 4.8c-.54.4-1.26.4-1.8 0z" fill="url(#g-flap)" stroke="var(--env-edge)" stroke-width=".55"/>'
    + '<g class="env-seal"><circle cx="9" cy="11.3" r="2.05" fill="var(--accent)"/><circle cx="9" cy="11.3" r="1.25" fill="none" stroke="#000" stroke-opacity=".22" stroke-width=".45"/><circle cx="8.35" cy="10.65" r=".55" fill="#fff" fill-opacity=".5"/></g>'],
};

/** 拟物的图标：notebook、sheet、envelope。 */
function objectIcon(name) {
  const [box, body] = OBJECTS[name];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', box);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon', 'icon-object', `icon-${name}`);
  svg.innerHTML = body;
  return svg;
}

window.lineIcon = lineIcon;
window.objectIcon = objectIcon;
