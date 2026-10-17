// BetterMD 的 VS Code 插件：用 BetterMD 的编辑器（和 App 里是同一个，源码在 editor/）打开 .md 文件。
// 文件还是 VS Code 的文本文档：编辑器里每改一次，插件把改动写进文档，停一会儿自动保存；
// 文档在外面变了（BetterMD App 存了、git 切了分支），插件把新内容送进编辑器。
// 打开的是「我的笔记」里的笔记时，App 和 VS Code 改的是同一个文件，两边自然同步。
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('./lib.js');
const library = require('./library.js');
const binding = require('./binding.js');
const links = require('./links.js');

const VIEW_TYPE = 'bettermd.editor';

function activate(context) {
  const tree = library.register(context);
  binding.register(context, tree);
  const provider = new Provider(context, tree);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      // 切到别的标签再回来时不重新加载网页（光标、撤销记录都还在）
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    // 编辑器有焦点时，⌘B 这类键由编辑器处理，VS Code 自己的那份（收起侧栏等）绑到这个什么都不做的命令上
    vscode.commands.registerCommand('bettermd.noop', () => {}),
    vscode.commands.registerCommand('bettermd.showSource', uri => openWith(uri, 'default')),
    vscode.commands.registerCommand('bettermd.openInBetterMD', uri => openWith(uri, VIEW_TYPE)),
    vscode.commands.registerCommand('bettermd.insertFile', () => provider.active?.insertFiles()),
  );
}

/** 换一种方式打开当前文件：'default' 是 VS Code 的文本编辑器（看源码）。 */
function openWith(uri, viewType) {
  const target = uri instanceof vscode.Uri ? uri : vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri;
  if (target) vscode.commands.executeCommand('vscode.openWith', target, viewType);
}

class Provider {
  constructor(context, tree) {
    this.context = context;
    this.tree = tree;
    /** 现在在前台的那个编辑器（⇧⌘V 插入文件要知道往哪篇里插） */
    this.active = null;
  }

  resolveCustomTextEditor(document, panel) {
    const session = new Session(this.context, document, panel, this.tree?.root);
    const track = () => {
      if (panel.active) this.active = session;
      else if (this.active === session) this.active = null;
      if (!panel.active && session.focused) session.setFocus(false, false); // 切到别的标签了
    };
    track();
    panel.onDidChangeViewState(track);
    panel.onDidDispose(() => {
      if (this.active === session) this.active = null;
      session.dispose();
    });
  }
}

/** 一个标签页里的一篇笔记。 */
class Session {
  constructor(context, document, panel, libraryRoot = null) {
    this.document = document;
    this.panel = panel;
    this.id = document.uri.toString();
    this.isFile = document.uri.scheme === 'file';
    const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    /** root：图片这类相对链接能用到的最上一层；dir：这篇所在的文件夹（相对 root） */
    this.place = this.isFile ? lib.placeOf(document.uri.fsPath, folders) : null;
    // 绑定了一篇笔记的项目文件：两边正文一样，图片这类相对链接是按笔记的位置写的，按笔记的位置找、存附件
    this.link = this.isFile && libraryRoot && !this.place?.inLibrary ? links.linkForFile(libraryRoot, document.uri.fsPath) : null;
    if (this.link) {
      this.place = { root: libraryRoot, dir: path.posix.dirname(this.link.note).replace(/^\.$/, ''), inLibrary: true };
    }
    /** 编辑器发来的改动的最大编号（放内容进编辑器时带上，规则见 editor/src/main.js 的 setDocument） */
    this.lastSeq = 0;
    /** 编辑器里现在的正文（最后一次收到或送进去的） */
    this.editorText = null;
    /** 编辑器手里那一版的来历：打开时送进去的，或者编辑器最后发来的。编辑器拒收送进去的另一版时拿它判断那一版是不是别处改的 */
    this.editorBase = null;
    /** 文档在插件上一次写进去（或送进编辑器）以后的样子。写之前对一下：变了就是外面改过 */
    this.docText = null;
    /** 还没写完的改动有几次；写的过程中文档会变，那些变化是自己的，不用送回编辑器 */
    this.pending = 0;
    this.chain = Promise.resolve();
    this.saveTimer = null;

    const media = vscode.Uri.joinPath(context.extensionUri, 'media', 'editor');
    const roots = [media];
    if (this.place) roots.push(vscode.Uri.file(this.place.root));
    panel.webview.options = { enableScripts: true, localResourceRoots: roots };
    panel.webview.html = this.html(media);

    this.disposables = [
      panel.webview.onDidReceiveMessage(message => this.receive(message)),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document === document && event.contentChanges.length) this.documentChanged();
      }),
    ];
  }

  dispose() {
    clearTimeout(this.saveTimer);
    if (this.focused) this.setFocus(false, false);
    // 关标签时还有没存的改动：开着自动保存就直接存下，不弹“要不要保存”
    if (this.document.isDirty && this.autoSave) this.document.save();
    this.disposables.forEach(d => d.dispose());
  }

  get autoSave() {
    return vscode.workspace.getConfiguration('bettermd').get('autoSave', true);
  }

  html(media) {
    const webview = this.panel.webview;
    const src = name => webview.asWebviewUri(vscode.Uri.joinPath(media, name));
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data: blob:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`, // CodeMirror 会往页面里插 <style>
      `font-src ${webview.cspSource}`,
      `script-src ${webview.cspSource}`,
    ].join('; ');
    return `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${src('editor.css')}">
</head>
<body>
<div id="editor"></div>
<script src="${src('editor.js')}"></script>
</body>
</html>`;
  }

  /** 调用编辑器网页里的 window.bettermd.fn(...args)。 */
  call(fn, ...args) {
    this.panel.webview.postMessage({ type: 'call', fn, args });
  }

  async receive(message) {
    let value = null;
    try {
      switch (message.type) {
        case 'ready':
          // 网页重新加载过（重新加载网页视图、标签拖到新窗口）：编号从头算，编辑器手里那一版也重新算（和 App 一样）
          this.lastSeq = 0;
          this.editorBase = null;
          if (this.place) this.call('setLibraryBase', this.panel.webview.asWebviewUri(vscode.Uri.file(this.place.root)).toString());
          this.push();
          break;
        case 'change':
          this.fromEditor(message.text, message.seq, message.overrode === true);
          break;
        case 'attach':
          value = this.saveAttachment(Buffer.from(message.data, 'base64'), message.name, message.mime);
          break;
        case 'open':
          this.open(message.url, message.path);
          break;
        case 'tag':
          vscode.commands.executeCommand('workbench.action.findInFiles', { query: '#' + message.name, triggerSearch: true });
          break;
        case 'focus':
          this.setFocus(message.editor === true, message.find === true);
          break;
      }
    } catch (error) {
      vscode.window.showErrorMessage(`BetterMD：${error.message}`);
    }
    // 每条消息都答复，编辑器那边等答复的 Promise 才不会一直挂着
    if (message.requestId) this.panel.webview.postMessage({ type: 'reply', requestId: message.requestId, value });
  }

  /** 把文档的内容放进编辑器。编辑器里如果有更新的改动还没送到（编号对不上），它会保留自己的、再发一遍。 */
  push() {
    const text = lib.normalize(this.document.getText());
    this.editorText = text;
    this.docText = text;
    if (this.editorBase === null) this.editorBase = text;
    const stat = this.isFile ? fs.statSync(this.document.uri.fsPath, { throwIfNoEntry: false }) : null;
    this.call('setDocument', this.id, text, {
      dir: this.place?.dir ?? '',
      readOnly: !this.isFile || this.document.isClosed,
      seq: this.lastSeq,
      meta: { modified: lib.dateLabel(stat?.mtime ?? new Date()), folder: this.folderLabel() },
    });
  }

  /** 标题下面那行小字里的位置：笔记库里的写文件夹（根目录是「未分类」），别处写工作区和文件夹。 */
  folderLabel() {
    if (this.link) return `和笔记「${this.link.note.replace(/\.md$/i, '').split('/').join(' / ')}」同步`;
    if (!this.place) return '';
    const { root, dir, inLibrary } = this.place;
    if (inLibrary) return dir ? dir.split('/').join(' / ') : '未分类';
    return [path.basename(root), ...dir.split('/').filter(Boolean)].join(' / ');
  }

  /**
   * 编辑器里改了：写进文档。连着改好几次时，每次都按最新的正文写，中间的自然跳过。
   * overrode：编辑器拒收了送进去的另一版（它有更新的字没送到、输入法在拼字），重发了自己的。
   * 那一版要是编辑器没见过的（别处改的），先放进一个新标签留着，不能悄悄丢掉。
   */
  fromEditor(text, seq, overrode = false) {
    if (overrode) {
      const rejected = lib.normalize(this.document.getText());
      if (rejected !== text && this.editorBase !== null && rejected !== this.editorBase) this.keepRejected(rejected);
    }
    this.editorBase = text;
    this.lastSeq = Math.max(this.lastSeq, seq ?? 0);
    this.editorText = text;
    this.pending++;
    this.chain = this.chain
      .then(() => this.applyLatest())
      .catch(error => vscode.window.showErrorMessage(`BetterMD 没能写进文件：${error.message}`))
      .finally(() => {
        this.pending--;
        // 写的过程中文档在外面也被改过：把文档现在的样子再对一遍
        if (this.pending === 0 && lib.normalize(this.document.getText()) !== this.editorText) this.push();
      });
  }

  async applyLatest() {
    // 写的同时文档在外面变了（版本对不上），VS Code 会拒收这次修改：按文档现在的样子重算再写，最多试 5 次
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = lib.normalize(this.document.getText());
      // 上次写完以后文档在外面又被改过（插件还没来得及把它送进编辑器）：照编辑器的写会把它抹掉，先留一份
      if (this.docText !== null && current !== this.docText && current !== this.editorText) this.keepRejected(current);
      this.docText = current;
      const target = this.editorText;
      const edit = lib.minimalEdit(current, target);
      if (!edit) return;
      const start = lib.positionAt(current, edit.from);
      const end = lib.positionAt(current, edit.to);
      const workspaceEdit = new vscode.WorkspaceEdit();
      workspaceEdit.replace(this.document.uri, new vscode.Range(start.line, start.character, end.line, end.character), edit.text);
      if (await vscode.workspace.applyEdit(workspaceEdit)) {
        this.docText = target;
        this.scheduleSave();
        return;
      }
    }
    // 一直写不进去：多半是只读的文件。编辑器里的字留着，告诉用户一次
    if (!this.warnedReadOnly) {
      this.warnedReadOnly = true;
      vscode.window.showWarningMessage(`「${path.basename(this.document.uri.fsPath)}」写不进去（可能是只读的文件），这里打的字还没存下。`);
    }
  }

  /** 编辑器网页报来焦点在哪：快捷键只在焦点真的在编辑器里时才拦（侧栏里的 Claude Code 这类网页不受影响）。 */
  setFocus(editor, find) {
    this.focused = editor;
    vscode.commands.executeCommand('setContext', 'bettermd.editorFocused', editor);
    vscode.commands.executeCommand('setContext', 'bettermd.findFocused', editor && find);
  }

  /** 文档在外面变了（App 存了、git、别的编辑器）：送进编辑器。自己写进去的改动不算。 */
  documentChanged() {
    if (this.pending > 0) return; // 自己的改动还没写完；写完时会再对一遍
    if (lib.normalize(this.document.getText()) === this.editorText) return;
    this.push();
  }

  /** 别处改的、被编辑器里的改动盖掉的那一版：放进旁边一个新标签（没存的文档），并告诉用户。 */
  async keepRejected(text) {
    const name = path.basename(this.document.uri.fsPath || this.document.uri.path);
    const copy = await vscode.workspace.openTextDocument({ language: 'markdown', content: text });
    await vscode.window.showTextDocument(copy, { preview: false, viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    vscode.window.showWarningMessage(`「${name}」在别处也改过。编辑器里的改动照常保存；别处的那一版放在旁边的新标签里，需要的话自己合并。`);
  }

  scheduleSave() {
    if (!this.autoSave) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 600);
  }

  /**
   * 自动保存。这个标签在前台时用“保存但不格式化”：插件自己调 document.save() 算手动保存，
   * 会触发保存时格式化、保存时修正（Prettier、markdownlint、删末尾空行），正在打的字会被改掉。
   */
  async save() {
    if (!this.document.isDirty) return;
    if (this.panel.active) await vscode.commands.executeCommand('workbench.action.files.saveWithoutFormatting');
    else await this.document.save();
  }

  /**
   * 粘贴、拖进来的文件存到哪：「我的笔记」里的笔记存进「附件」（和 App 一样）；别处的 .md 存进旁边的 assets/。
   * 返回 { link }：从这篇笔记所在的文件夹指过去的相对链接。
   */
  saveAttachment(data, fileName, mime) {
    if (!this.place) throw new Error('这篇不是本机上的文件，不能存附件');
    const { root, dir, inLibrary } = this.place;
    const folder = inLibrary ? lib.ATTACHMENTS : [dir, 'assets'].filter(Boolean).join('/');
    const folderPath = path.join(root, ...folder.split('/'));
    fs.mkdirSync(folderPath, { recursive: true });
    const name = lib.attachmentName(fileName, mime, new Date(), n => fs.existsSync(path.join(folderPath, n)));
    fs.writeFileSync(path.join(folderPath, name), data, { flag: 'wx' });
    return { link: lib.relativeLink(dir, `${folder}/${name}`) };
  }

  /** ⇧⌘V：选图片或文件，复制一份到附件里，插在光标处。 */
  async insertFiles() {
    const picked = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: '插入' });
    if (!picked?.length) return;
    const items = [];
    for (const uri of picked) {
      const name = path.basename(uri.fsPath);
      const mime = /\.(png|jpe?g|gif|webp|heic|heif|tiff?|bmp|svg|avif)$/i.test(name) ? 'image/*' : '';
      const { link } = this.saveAttachment(fs.readFileSync(uri.fsPath), name, mime);
      items.push({ link, name, image: mime !== '' });
    }
    this.call('insertAttachments', items);
  }

  /** ⌘ 点链接：网址交给浏览器；指向别的 .md 就在 VS Code 里打开；别的文件用系统默认的程序打开。 */
  open(url, linkPath) {
    if (url) {
      const target = vscode.Uri.parse(url);
      if (['http', 'https', 'mailto'].includes(target.scheme)) vscode.env.openExternal(target);
      return;
    }
    if (!linkPath || !this.place) return;
    // 本机的文件都在 VS Code 里打开（.md 用 BetterMD，图片、PDF 用 VS Code 自己的预览）：
    // 交给系统打开的话，链接指着 .command、.app 就会直接运行（克隆来的仓库里的链接不可信）
    const file = vscode.Uri.file(path.join(this.place.root, ...linkPath.split('/')));
    vscode.commands.executeCommand('vscode.open', file);
  }
}

module.exports = { activate, deactivate() {}, Session };
