import BetterMDCore
import SwiftUI

/// 列表里的一行：标题、两行摘要、时间和位置。搜索时摘要显示命中的那一段。
struct NoteRow: View {
    let note: Note
    let location: String?
    let query: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                if note.isPinned {
                    Image(systemName: "pin.fill").font(.caption2).foregroundStyle(.tint)
                }
                Text(note.title).font(.headline).lineLimit(1)
            }
            Text(summary)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            HStack(spacing: 8) {
                Text(NoteDate.label(for: note.modified))
                if let location {
                    Label(location, systemImage: "folder").labelStyle(.titleAndIcon)
                }
            }
            .font(.caption)
            .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
    }

    private var summary: String {
        let terms = SearchText.terms(query)
        if !terms.isEmpty, let snippet = SearchText.snippet(of: note.text, terms: terms) { return snippet }
        return note.parsed.preview.isEmpty ? "空白笔记" : note.parsed.preview
    }
}
