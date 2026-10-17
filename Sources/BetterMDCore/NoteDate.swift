import Foundation

/// 列表里的时间：今天“今天 10:24”，昨天“昨天 19:05”，今年“10月3日”，更早“2025年10月3日”。
public enum NoteDate {
    public static func label(for date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        // 不用 DateFormatter：列表每画一行都要算一次，每次新建一个格式器很贵
        let c = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        let time = String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
        if calendar.isDate(date, inSameDayAs: now) { return "今天 " + time }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
           calendar.isDate(date, inSameDayAs: yesterday) {
            return "昨天 " + time
        }
        let monthDay = "\(c.month ?? 1)月\(c.day ?? 1)日"
        return calendar.isDate(date, equalTo: now, toGranularity: .year) ? monthDay : "\(c.year ?? 0)年" + monthDay
    }
}
