import Foundation

/// 把整个笔记库从一处搬到另一处。第一次改用 iCloud 云盘时，用它把用户目录下原来的「我的笔记」搬进去。
public enum LibraryMove {
    public enum Outcome: Equatable, Sendable {
        /// 旧位置没有笔记库，不用搬
        case nothingToMove
        /// 搬好了
        case moved
        /// 新位置已经有笔记库：两边都不动，不替你合并；旧位置里还有这么多篇笔记
        case bothExist(leftoverNotes: Int)
        /// 搬不动，旧位置原样留着；附带系统给的原因
        case failed(String)
    }

    /// 整个目录一起搬（包括「附件」「废纸篓」和 .bettermd）。同一块磁盘上搬家就是改名，一步完成，不会搬到一半。
    public static func run(from old: URL, to new: URL) -> Outcome {
        let fm = FileManager.default
        guard fm.fileExists(atPath: old.path) else { return .nothingToMove }
        if fm.fileExists(atPath: new.path) {
            let notes = (fm.enumerator(atPath: old.path)?.allObjects as? [String] ?? [])
                .filter { $0.lowercased().hasSuffix(".md") }
            return .bothExist(leftoverNotes: notes.count)
        }
        do {
            try fm.createDirectory(at: new.deletingLastPathComponent(), withIntermediateDirectories: true)
            try fm.moveItem(at: old, to: new)
            return .moved
        } catch {
            return .failed(error.localizedDescription)
        }
    }
}
