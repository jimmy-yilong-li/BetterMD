import Foundation

/// 每个测试一个独立的临时目录。
enum TempDir {
    static func make() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("bettermd-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}

extension URL {
    /// 在这个目录下写一个文件（中间目录自动建好）。
    func write(_ text: String, to relative: String) throws {
        let target = appendingPathComponent(relative)
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: target)
    }

    func read(_ relative: String) throws -> String {
        try String(contentsOf: appendingPathComponent(relative), encoding: .utf8)
    }

    func exists(_ relative: String) -> Bool {
        FileManager.default.fileExists(atPath: appendingPathComponent(relative).path)
    }
}
