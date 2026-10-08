import AppKit
import BetterMDCore
import ImageIO
import SwiftUI

/// 列表里的缩略图：读笔记里第一张图片，缩成小图，按文件和修改时间缓存。
@MainActor
final class Thumbnails {
    static let shared = Thumbnails()

    private var cache: [String: NSImage] = [:]

    /// 某篇笔记的缩略图；没有图片、图片读不出来时返回 nil。
    func image(for note: Note, in store: NoteStore, pixels: CGFloat = 96) async -> NSImage? {
        guard let link = note.parsed.firstImage,
              let path = MarkdownLinks.resolve(link, from: note.folder),
              let file = store.resolveFile(path) else { return nil }
        let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
        let key = "\(file.path)|\(modified.timeIntervalSince1970)|\(pixels)"
        if let hit = cache[key] { return hit }
        let image = await Task.detached(priority: .utility) { Self.downsample(file, pixels: pixels) }.value
        if let image {
            if cache.count > 400 { cache.removeAll() }
            cache[key] = image
        }
        return image
    }

    private nonisolated static func downsample(_ file: URL, pixels: CGFloat) -> NSImage? {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: pixels,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
    }
}

/// 搜索命中的字加底色（不分大小写、全角半角）。
enum Highlight {
    static func text(_ string: String, terms: [String], color: Color) -> AttributedString {
        var result = AttributedString(string)
        guard !terms.isEmpty else { return result }
        let options: String.CompareOptions = [.caseInsensitive, .widthInsensitive, .diacriticInsensitive]
        for term in terms where !term.isEmpty {
            var searchStart = string.startIndex
            while searchStart < string.endIndex,
                  let found = string.range(of: term, options: options, range: searchStart..<string.endIndex) {
                if let lower = AttributedString.Index(found.lowerBound, within: result),
                   let upper = AttributedString.Index(found.upperBound, within: result) {
                    result[lower..<upper].backgroundColor = color
                }
                searchStart = found.upperBound
            }
        }
        return result
    }
}
