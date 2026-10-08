import BetterMDCore
import SwiftUI

/// 列表里的一篇笔记：宋体标题、两行摘要、时间和位置；有图片时右边一张缩略图，置顶时右上角挂书签丝带。
/// 选中的笔记在浅色模式下像从一叠纸里抽出来的一张卡片。搜索时摘要显示命中的那一段，命中的字加底色。
struct NoteRow: View {
    let note: Note
    let location: String?
    let terms: [String]
    let selected: Bool
    /// 上面画不画分隔线（选中的卡片和它下面一篇之间不画）
    let separator: Bool

    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @State private var hovering = false
    @State private var thumbnail: NSImage?

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 0) {
                Text(Highlight.text(note.title, terms: terms, color: Ink.highlight))
                    .font(Ink.serif(14.5, bold: true))
                    .foregroundStyle(Ink.text)
                    .lineLimit(1)
                Group {
                    if summary.isEmpty {
                        Text("空白笔记").foregroundStyle(Ink.text3)
                    } else {
                        Text(Highlight.text(summary, terms: terms, color: Ink.highlight)).foregroundStyle(Ink.text2)
                    }
                }
                .font(.system(size: 12.5))
                .lineSpacing(2)
                .lineLimit(2)
                .padding(.top, 3)
                HStack(spacing: 8) {
                    Text(NoteDate.label(for: note.modified)).monospacedDigit()
                    if let location {
                        HStack(spacing: 3) {
                            Image(systemName: note.folder.isEmpty ? "doc" : "envelope").font(.system(size: 9.5))
                            Text(location).lineLimit(1)
                        }
                    }
                }
                .font(.system(size: 11.5))
                .foregroundStyle(Ink.text3)
                .padding(.top, 5)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let thumbnail {
                Image(nsImage: thumbnail)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 46, height: 46)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Ink.separator, lineWidth: 0.5))
            }
        }
        .padding(EdgeInsets(top: 11, leading: 10, bottom: 10, trailing: 10))
        .background(background)
        .overlay(alignment: .topTrailing) {
            if note.isPinned && !note.isTrashed { RibbonView().padding(.trailing, 18) }
        }
        .overlay(alignment: .top) {
            if separator { Rectangle().fill(Ink.separator).frame(height: 0.5).padding(.horizontal, 10) }
        }
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .task(id: thumbnailKey) { thumbnail = await Thumbnails.shared.image(for: note, in: model.store) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    @ViewBuilder private var background: some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        if selected && scheme == .light {
            // 抽出来的一张纸：纸色 + 细边 + 下方的软投影
            shape.fill(Ink.paper)
                .shadow(color: Color(red: 40 / 255, green: 25 / 255, blue: 10 / 255).opacity(0.22), radius: 5, y: 3)
                .overlay(shape.strokeBorder(Ink.separator, lineWidth: 0.5))
        } else if selected {
            shape.fill(Ink.selection)
        } else if hovering {
            shape.fill(Ink.hover)
        }
    }

    /// 缩略图跟着第一张图片的地址走；正文其他地方变了不用重新读图。
    private var thumbnailKey: String { (note.parsed.firstImage ?? "") + "|" + note.folder }

    /// 搜索时摘要显示正文里命中的那一段（标题单独显示，不算；Markdown 符号去掉）；只有标题命中就显示普通摘要。
    private var summary: String {
        NoteText.searchSnippet(of: note.text, terms: terms) ?? note.parsed.preview
    }
}
