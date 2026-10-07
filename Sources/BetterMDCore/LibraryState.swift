import Foundation

/// 存在「我的笔记/.bettermd/state.json」里的小状态。
public struct LibraryState: Codable, Hashable, Sendable {
    /// 置顶笔记的路径。
    public var pinned: Set<String> = []
    /// 废纸篓里笔记的路径 → 原来所在的文件夹（“”是未分类）。
    public var trashOrigins: [String: String] = [:]
    /// 是否已经放过欢迎笔记。
    public var welcomed = false

    public init() {}

    /// 旧版本的文件里缺了哪个字段，就用默认值。
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pinned = try c.decodeIfPresent(Set<String>.self, forKey: .pinned) ?? []
        trashOrigins = try c.decodeIfPresent([String: String].self, forKey: .trashOrigins) ?? [:]
        welcomed = try c.decodeIfPresent(Bool.self, forKey: .welcomed) ?? false
    }

    /// 一篇笔记从 `old` 变成 `new`（移动、改名、进出废纸篓、置顶）后，更新记录。
    public mutating func record(from old: Note, to new: Note) {
        if old.path != new.path {
            pinned.remove(old.path)
            trashOrigins.removeValue(forKey: old.path)
        }
        if new.isPinned {
            pinned.insert(new.path)
        } else {
            pinned.remove(new.path)
        }
        if new.isTrashed {
            trashOrigins[new.path] = new.originalFolder ?? ""
        } else {
            trashOrigins.removeValue(forKey: new.path)
        }
    }

    /// 文件夹 `old` 改名成 `new` 以后，里面所有路径一起改。
    public mutating func folderRenamed(from old: String, to new: String) {
        let swap = { (path: String) -> String in
            if path == old { return new }
            if path.hasPrefix(old + "/") { return new + String(path.dropFirst(old.count)) }
            return path
        }
        pinned = Set(pinned.map(swap))
        trashOrigins = trashOrigins.mapValues(swap)
    }
}
