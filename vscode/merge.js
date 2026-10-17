// 三方合并：底本（上次同步的内容）、笔记这边、项目这边，按行合并成一份。不依赖 VS Code，测试在 test/merge.test.js。
//
// 规则（design.md 第 6.14 节）：
// - 只有一边改了的地方，用改了的那边；
// - 两边改成一样的，用那个；
// - 两边在同一个地方都新加了内容：两段都留，笔记这边的在前；
// - 两边把同一段改得不一样：用 prefer 那边（后改的那边）；记下来，调用方把输的那边整篇另存一份。

/** 按行拆开；最后一行后面有没有换行也算进去（拼回来一模一样）。 */
const splitLines = text => text.split('\n');

/**
 * 把 a 改成 b 要动哪些地方：返回一串 { a0, a1, b0, b1 }，意思是 a 的 [a0, a1) 行换成 b 的 [b0, b1) 行，按位置排好。
 * 先去掉两头一样的行，中间用最长公共子序列；中间太大（超过 400 万格）就整段当成一处改动，不会卡住。
 */
function diffLines(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const n = endA - start, m = endB - start;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0 || n * m > 4_000_000) return [{ a0: start, a1: endA, b0: start, b1: endB }];
  // lcs[i][j]：a[start+i..endA) 和 b[start+j..endB) 的最长公共子序列长度
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = a[start + i] === b[start + j]
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  const hunks = [];
  let i = 0, j = 0, open = null;
  const close = () => { if (open) { hunks.push(open); open = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      close();
      i++; j++;
    } else {
      if (!open) open = { a0: start + i, a1: start + i, b0: start + j, b1: start + j };
      if (j < m && (i === n || lcs[i * width + j + 1] >= lcs[(i + 1) * width + j])) { j++; open.b1 = start + j; }
      else { i++; open.a1 = start + i; }
    }
  }
  close();
  return hunks;
}

/** 一边（x）在底本的 [from, to) 这一段对应的那几行。hunks 是这一边落在这一段里的改动。 */
function sideLines(base, x, hunks, from, to) {
  const out = [];
  let pos = from;
  for (const h of hunks) {
    out.push(...base.slice(pos, h.a0), ...x.slice(h.b0, h.b1));
    pos = h.a1;
  }
  out.push(...base.slice(pos, to));
  return out;
}

const same = (x, y) => x.length === y.length && x.every((line, k) => line === y[k]);

/**
 * 三方合并。prefer：'note' 或 'file'，两边把同一段改得不一样时用哪边。
 * 返回 { text, conflicts }：conflicts 是这种地方的个数（0 就是干干净净地合上了）。
 */
function merge3(base, note, file, prefer = 'note') {
  const B = splitLines(base), N = splitLines(note), F = splitLines(file);
  const all = [
    ...diffLines(B, N).map(h => ({ ...h, side: 'note' })),
    ...diffLines(B, F).map(h => ({ ...h, side: 'file' })),
  ].sort((x, y) => x.a0 - y.a0 || x.a1 - y.a1);
  const out = [];
  let conflicts = 0;
  let pos = 0;
  let k = 0;
  while (k < all.length) {
    // 一段：从这一处改动开始，把和它挨着、叠着的改动都并进来（同一个起点的也算，比如两边都在这里加了东西）
    const region = [all[k]];
    let from = all[k].a0, to = all[k].a1;
    k++;
    while (k < all.length && (all[k].a0 < to || all[k].a0 === from)) {
      region.push(all[k]);
      to = Math.max(to, all[k].a1);
      k++;
    }
    out.push(...B.slice(pos, from));
    const noteHunks = region.filter(h => h.side === 'note');
    const fileHunks = region.filter(h => h.side === 'file');
    const n = sideLines(B, N, noteHunks, from, to);
    const f = sideLines(B, F, fileHunks, from, to);
    // 只是在这一段前面新加了几行（没动底本）：加的那几行放前面，另一边对这一段的改动照用
    const insertsOnly = hunks => hunks.every(h => h.a0 === from && h.a1 === from);
    const inserted = (x, hunks) => hunks.flatMap(h => x.slice(h.b0, h.b1));
    if (!fileHunks.length) out.push(...n);
    else if (!noteHunks.length) out.push(...f);
    else if (same(n, f)) out.push(...n);
    else if (from === to) out.push(...n, ...f); // 两边都在这里新加了内容：都留，笔记这边的在前
    else if (insertsOnly(noteHunks)) out.push(...inserted(N, noteHunks), ...f);
    else if (insertsOnly(fileHunks)) out.push(...inserted(F, fileHunks), ...n);
    else {
      conflicts++;
      out.push(...(prefer === 'file' ? f : n));
    }
    pos = to;
  }
  out.push(...B.slice(pos));
  return { text: out.join('\n'), conflicts };
}

module.exports = { diffLines, merge3 };
