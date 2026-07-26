// Swift source for bin/CalendarHelper.app (built by bin/build-calendar-helper.sh).
// Reads today's and tomorrow's events from EventKit and prints JSON to stdout.
//
// Why a compiled app: the previous JXA applet could never show the macOS 26
// permission prompt. Its completion-handler call returned an instant denial
// without ever reaching tccd (TCC stayed at notDetermined), so the Settings
// pane listed nothing to toggle. The native requestFullAccessToEvents call
// from a bundle carrying NSCalendarsFullAccessUsageDescription prompts
// properly, once, as "CalendarHelper". Output contract is unchanged:
// {"events":[...]} on success, {"error":"denied"} or {"error":"request-failed"}.
import Foundation
import EventKit

func emit(_ s: String) { print(s) }

let store = EKEventStore()
let status = EKEventStore.authorizationStatus(for: .event)

if status == .notDetermined {
    var granted = false
    var done = false
    store.requestFullAccessToEvents { g, _ in
        granted = g
        done = true
    }
    // Generous window: this branch only runs on the very first grant, while
    // a human is looking at the prompt. Determined statuses skip it entirely.
    let deadline = Date().addingTimeInterval(120)
    while !done && Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
    }
    if !granted {
        emit("{\"error\":\"denied\"}")
        exit(0)
    }
} else if status != .fullAccess {
    emit("{\"error\":\"denied\"}")
    exit(0)
}

let cal = Calendar.current
let startOfDay = cal.startOfDay(for: Date())
let end = startOfDay.addingTimeInterval(2 * 86400)
let pred = store.predicateForEvents(withStart: startOfDay, end: end, calendars: nil)
let events = store.events(matching: pred)
let fmt = ISO8601DateFormatter()
var out: [[String: Any]] = []
for ev in events {
    out.append([
        "title": ev.title ?? "",
        "start": fmt.string(from: ev.startDate),
        "end": fmt.string(from: ev.endDate),
        "allDay": ev.isAllDay,
        "calendar": ev.calendar?.title ?? "",
        "location": ev.location ?? "",
    ])
}
guard let data = try? JSONSerialization.data(withJSONObject: ["events": out]),
      let json = String(data: data, encoding: .utf8) else {
    emit("{\"error\":\"request-failed\"}")
    exit(0)
}
emit(json)
