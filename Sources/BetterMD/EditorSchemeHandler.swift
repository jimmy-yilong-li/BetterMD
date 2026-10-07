import BetterMDCore
import Foundation
import UniformTypeIdentifiers
import WebKit

/// 编辑器网页用的 bettermd:// 协议：
/// - `bettermd://editor/…`：编辑器网页本身（editor/dist，打包时放进 App）；
/// - `bettermd://library/…`：「我的笔记」里的文件，也就是正文里的图片。
@MainActor
final class EditorSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "bettermd"
    static let pageURL = URL(string: "bettermd://editor/index.html")!

    private let library: @MainActor () -> NoteStore?

    init(library: @escaping @MainActor () -> NoteStore?) {
        self.library = library
    }

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url, let file = file(for: url), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let headers = ["Content-Type": Self.mimeType(of: file), "Content-Length": String(data.count), "Cache-Control": "no-store"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}

    private func file(for url: URL) -> URL? {
        let path = url.path(percentEncoded: false).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        switch url.host() {
        case "editor": return EditorAssets.file(path)
        case "library": return library()?.resolveFile(path)
        default: return nil
        }
    }

    static func mimeType(of file: URL) -> String {
        switch file.pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        default: return UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}

/// 打包好的编辑器网页在哪里。
enum EditorAssets {
    /// App 包里的 Resources/Editor；用 swift run 直接跑时，用源码旁边的 editor/dist。
    static let directory: URL = {
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("Editor"),
           FileManager.default.fileExists(atPath: bundled.appendingPathComponent("index.html").path) {
            return bundled
        }
        return URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("editor/dist")
    }()

    static func file(_ path: String) -> URL? {
        let parts = path.split(separator: "/").map(String.init)
        guard !parts.isEmpty, !parts.contains(where: { $0 == ".." || $0 == "." }) else { return nil }
        let url = directory.appendingPathComponent(parts.joined(separator: "/"))
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }
}
