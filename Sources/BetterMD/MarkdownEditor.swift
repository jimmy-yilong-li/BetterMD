import AppKit
import BetterMDCore
import SwiftUI
import WebKit

/// 所见即所得的 Markdown 编辑器：WKWebView 里跑 CodeMirror（网页源码在 editor/）。
/// 这里只负责把笔记放进网页、把改动收回来；怎么显示全在网页里。
struct MarkdownEditor: NSViewRepresentable {
    let model: AppModel
    let note: Note?
    /// 刚新建的笔记：打开时选中标题，接着就能打字。
    let selectTitle: Bool
    let handle: EditorHandle

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(EditorSchemeHandler { [weak model] in model?.store }, forURLScheme: EditorSchemeHandler.scheme)
        config.userContentController.addScriptMessageHandler(context.coordinator, contentWorld: .page, name: Coordinator.channel)
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        webView.underPageBackgroundColor = Paper.nsColor
        webView.allowsMagnification = false
        webView.isInspectable = true
        context.coordinator.webView = webView
        handle.webView = webView
        webView.load(URLRequest(url: EditorSchemeHandler.pageURL))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        handle.webView = webView
        context.coordinator.show(note, selectTitle: selectTitle)
    }

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Coordinator.channel, contentWorld: .page)
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
        static let channel = "bettermd"

        /// 网页里现在放着的笔记；和要显示的一模一样就不用再发。
        struct Shown: Equatable {
            var id: Note.ID
            var text: String
            var dir: String
            var readOnly: Bool
            /// 标题下面那行小字：修改时间、所在文件夹
            var modified: String
            var folder: String
        }

        let model: AppModel
        weak var webView: WKWebView?
        private var ready = false
        private var shown: Shown?
        /// 收到的最大改动编号。放内容进网页时带上它：网页里如果有更新的改动还没送到，就不会被这份内容盖掉。
        private var lastSeq = 0
        /// 网页还没准备好时要显示的笔记，准备好以后补上。
        private var wanted: (note: Note?, selectTitle: Bool) = (nil, false)

        init(model: AppModel) {
            self.model = model
        }

        func show(_ note: Note?, selectTitle: Bool) {
            wanted = (note, selectTitle)
            guard ready, let webView else { return }
            guard let note else {
                if shown != nil {
                    shown = nil
                    webView.evaluateJavaScript("window.bettermd.clear()")
                }
                return
            }
            // 废纸篓里的笔记只读；图片的相对路径按原来的文件夹算（进废纸篓时正文没改）
            let folderLabel = note.folder.isEmpty ? "未分类" : note.folder.replacingOccurrences(of: "/", with: " / ")
            let next = Shown(id: note.id, text: note.text, dir: note.folder, readOnly: note.isTrashed,
                             modified: NoteDate.label(for: note.modified), folder: folderLabel)
            guard next != shown else { return }
            let opening = next.id != shown?.id
            shown = next
            let options: [String: Any] = [
                "dir": next.dir, "readOnly": next.readOnly, "selectTitle": opening && selectTitle, "seq": lastSeq,
                "meta": ["modified": next.modified, "folder": next.folder],
            ]
            webView.callAsyncJavaScript(
                "window.bettermd.setDocument(id, text, options)",
                arguments: ["id": note.id.uuidString, "text": note.text, "options": options],
                in: nil, in: .page
            ) { [weak self] result in
                // 网页没能放进这篇笔记：忘掉“已经放进去了”，下次界面刷新时重放；同时告诉用户
                guard case .failure(let error) = result, let self, self.shown?.id == next.id else { return }
                self.shown = nil
                self.model.lastError = "编辑器没能打开这篇笔记：\(error.localizedDescription)"
            }
            if opening && selectTitle { webView.window?.makeFirstResponder(webView) }
        }

        // MARK: 网页发来的消息

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                                   replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
            let body = message.body as? [String: Any] ?? [:]
            let id = (body["id"] as? String).flatMap(UUID.init(uuidString:))
            switch body["type"] as? String {
            case "ready":
                ready = true
                shown = nil
                lastSeq = 0
                show(wanted.note, selectTitle: wanted.selectTitle)
            case "change":
                if let seq = body["seq"] as? Int { lastSeq = max(lastSeq, seq) }
                if let id, let text = body["text"] as? String {
                    if shown?.id == id { shown?.text = text }
                    model.updateText(text, for: id)
                }
            case "attach":
                if let id, let name = body["name"] as? String,
                   let data = (body["data"] as? String).flatMap({ Data(base64Encoded: $0) }),
                   let link = model.addAttachment(data, fileName: name, mimeType: body["mime"] as? String, for: id) {
                    replyHandler(["link": link], nil)
                    return
                }
            case "open":
                open(url: body["url"] as? String, path: body["path"] as? String)
            case "tag":
                if let name = body["name"] as? String { model.scope = .tag(name) }
            case "exitFocus":
                NotificationCenter.default.post(name: .toggleFocusMode, object: false)
            default:
                break
            }
            replyHandler(nil, nil)
        }

        /// ⌘ 点链接：网址交给浏览器等默认程序；「我的笔记」里的笔记直接打开，别的文件用默认程序打开。
        private func open(url: String?, path: String?) {
            if let url, let target = URL(string: url), let scheme = target.scheme?.lowercased(),
               !["javascript", "file", "data"].contains(scheme) {
                NSWorkspace.shared.open(target)
            } else if let path, let file = model.store.resolveFile(path) {
                let standard = file.standardizedFileURL
                if let note = model.notes.first(where: { model.store.url(for: $0.path).standardizedFileURL == standard }) {
                    model.scope = .all
                    model.query = ""
                    model.select(note.id)
                } else {
                    NSWorkspace.shared.open(file)
                }
            }
        }

        // MARK: 导航：只许加载编辑器网页本身

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            decisionHandler(navigationAction.request.url == EditorSchemeHandler.pageURL ? .allow : .cancel)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            ready = false
            shown = nil
            webView.load(URLRequest(url: EditorSchemeHandler.pageURL))
        }
    }
}

/// 编辑器外面的按钮（插入图片）通过它把东西送进网页里的编辑器。
@MainActor
final class EditorHandle {
    struct Attachment {
        var link: String
        var name: String
        var image: Bool
    }

    fileprivate(set) weak var webView: WKWebView?

    /// 格式面板里的按钮：heading、bold、list、table、math……（见 editor/src/main.js 的 FORMATS）
    func format(_ kind: String) {
        guard let webView else { return }
        webView.window?.makeFirstResponder(webView)
        webView.callAsyncJavaScript("window.bettermd.format(kind)", arguments: ["kind": kind], in: nil, in: .page, completionHandler: nil)
    }

    /// 专注模式：编辑区里光标所在的那一段以外都变淡。
    func setFocusMode(_ on: Bool) {
        webView?.callAsyncJavaScript("window.bettermd?.setFocusMode(on)", arguments: ["on": on], in: nil, in: .page, completionHandler: nil)
    }

    /// 在光标处插入附件：图片各占一行直接显示，别的文件写成链接。
    func insert(_ items: [Attachment]) {
        guard let webView, !items.isEmpty else { return }
        let payload: [[String: Any]] = items.map { ["link": $0.link, "name": $0.name, "image": $0.image] }
        webView.window?.makeFirstResponder(webView)
        webView.callAsyncJavaScript("window.bettermd.insertAttachments(items)", arguments: ["items": payload],
                                    in: nil, in: .page, completionHandler: nil)
    }
}

/// 编辑区的纸色（和 editor.css 里的 --paper 一致），网页加载出来之前先铺上，不闪白。
enum Paper {
    @MainActor static let nsColor = NSColor(name: "BetterMDPaper") { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(srgbRed: 0x1A / 255, green: 0x18 / 255, blue: 0x16 / 255, alpha: 1)
            : NSColor(srgbRed: 0xFB / 255, green: 0xF8 / 255, blue: 0xF2 / 255, alpha: 1)
    }
    @MainActor static let color = Color(nsColor: nsColor)
}
