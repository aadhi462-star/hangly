// Screenly window-surfaces helper.
// Prints the rectangles of normal on-screen app windows (front to back) as one
// JSON line whenever they change, so characters can stand on window tops.
// Only geometry is read: no window titles, no contents, no screenshots, and no
// Screen Recording permission is needed. Exits when stdin closes (app quit).
import CoreGraphics
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)
let ownPid = CommandLine.arguments.count > 1 ? Int(CommandLine.arguments[1]) ?? -1 : -1

DispatchQueue.global().async {
    while readLine() != nil {}
    exit(0)
}

var last = ""
let timer = DispatchSource.makeTimerSource(queue: .main)
timer.schedule(deadline: .now(), repeating: .milliseconds(250))
timer.setEventHandler {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return }
    var rects: [String] = []
    for w in list {
        guard (w[kCGWindowLayer as String] as? Int) == 0,
              let pid = w[kCGWindowOwnerPID as String] as? Int, pid != ownPid,
              ((w[kCGWindowAlpha as String] as? Double) ?? 1) > 0.05,
              let id = w[kCGWindowNumber as String] as? Int,
              let b = w[kCGWindowBounds as String] as? [String: Double],
              let x = b["X"], let y = b["Y"], let width = b["Width"], let height = b["Height"],
              width >= 120, height >= 60 else { continue }
        rects.append("{\"id\":\(id),\"x\":\(Int(x)),\"y\":\(Int(y)),\"w\":\(Int(width)),\"h\":\(Int(height))}")
    }
    let line = "[" + rects.joined(separator: ",") + "]"
    if line != last {
        last = line
        print(line)
    }
}
timer.resume()
dispatchMain()
