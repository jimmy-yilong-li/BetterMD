import Foundation

/// 绑定：项目里的一个 .md 和「我的笔记」里的一篇双向同步（design.md 第 6.14 节）。同步本身由 VS Code 插件做；
/// App 这边只管两件事：笔记改名、移动、进出废纸篓、文件夹改名时，把登记里的笔记路径跟着改；告诉界面哪篇绑了哪个文件。
/// 登记在「我的笔记/.bettermd/links.json」，插件也读写它，所以每次改都先读磁盘上最新的，改完马上写回，不在内存里留一份去覆盖。
public struct LibraryLinks: Sendable {
    public struct Link: Codable, Hashable, Sendable {
        public var id: String
        /// 笔记的路径，相对「我的笔记」
        public var note: String
        /// 项目里那个文件的绝对路径
        public var file: String
    }

    private struct Registry: Codable {
        var links: [Link]
    }

    public let root: URL

    public init(root: URL) {
        self.root = root
    }

    private var registry: URL { root.appendingPathComponent(".bettermd/links.json") }

    /// 全部绑定；没有或读不出来时是空的。
    public func all() -> [Link] {
        guard let data = try? Data(contentsOf: registry),
              let decoded = try? JSONDecoder().decode(Registry.self, from: data) else { return [] }
        return decoded.links
    }

    /// 笔记路径 → 绑定
    public func byNote() -> [String: Link] {
        Dictionary(all().map { ($0.note, $0) }, uniquingKeysWith: { first, _ in first })
    }

    /// 一篇笔记从 old 挪到 new（改名、移动、进出废纸篓）。没绑的不动，也不写文件。
    public func noteMoved(from old: String, to new: String) throws {
        try rewrite { $0 == old ? new : $0 }
    }

    /// 文件夹 old 改名成 new：里面的笔记路径一起改。
    public func folderRenamed(from old: String, to new: String) throws {
        try rewrite { path in path.hasPrefix(old + "/") ? new + path.dropFirst(old.count) : path }
    }

    private func rewrite(_ swap: (String) -> String) throws {
        guard let data = try? Data(contentsOf: registry),
              var decoded = try? JSONDecoder().decode(Registry.self, from: data) else { return }
        var changed = false
        for i in decoded.links.indices {
            let new = swap(decoded.links[i].note)
            if new != decoded.links[i].note {
                decoded.links[i].note = new
                changed = true
            }
        }
        guard changed else { return }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(decoded).write(to: registry, options: .atomic)
    }
}
