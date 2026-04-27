#!/usr/bin/env swift
// Fast calendar read for calendar_fetch.py (EventKit). Run via:
//   swift calendar_eventkit.swift START_UNIX END_UNIX [FILTER_SUBSTRING]
// Optional: swiftc calendar_eventkit.swift -o calendar_eventkit -framework EventKit
import EventKit
import Foundation

let args = CommandLine.arguments
guard args.count >= 3 else {
    fputs("usage: calendar_eventkit START_UNIX END_UNIX [FILTER]\n", stderr)
    exit(2)
}

guard let startTs = TimeInterval(args[1]), let endTs = TimeInterval(args[2]) else {
    exit(2)
}
let filter = args.count > 3 ? args[3].lowercased() : ""

let store = EKEventStore()
let group = DispatchGroup()
group.enter()
var accessOK = false

if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents { granted, _ in
        accessOK = granted
        group.leave()
    }
} else {
    store.requestAccess(to: .event) { granted, _ in
        accessOK = granted
        group.leave()
    }
}
group.wait()

guard accessOK else {
    fputs("CALENDAR_ACCESS_DENIED\n", stderr)
    exit(1)
}

let start = Date(timeIntervalSince1970: startTs)
let end = Date(timeIntervalSince1970: endTs)
let allCalendars = store.calendars(for: .event)
let calendars: [EKCalendar]
if filter.isEmpty {
    calendars = allCalendars
} else {
    let matched = allCalendars.filter { $0.title.lowercased().contains(filter) }
    if matched.isEmpty {
        exit(0)
    }
    calendars = matched
}

let pred = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
var events = store.events(matching: pred)
events.sort {
    if $0.isAllDay != $1.isAllDay { return $0.isAllDay && !$1.isAllDay }
    if $0.startDate != $1.startDate { return $0.startDate < $1.startDate }
    return ($0.title ?? "") < ($1.title ?? "")
}

var localCal = Calendar.current
localCal.timeZone = TimeZone.current

func strip(_ s: String) -> String {
    s
        .replacingOccurrences(of: "\t", with: " ")
        .replacingOccurrences(of: "\r", with: " ")
        .replacingOccurrences(of: "\n", with: " ")
}

for e in events {
    let allDay = e.isAllDay
    guard let s = e.startDate, let en = e.endDate else { continue }
    let sy = localCal.component(.year, from: s)
    let sm = localCal.component(.month, from: s)
    let sd = localCal.component(.day, from: s)
    let sh = localCal.component(.hour, from: s)
    let smin = localCal.component(.minute, from: s)
    let ey = localCal.component(.year, from: en)
    let em = localCal.component(.month, from: en)
    let ed = localCal.component(.day, from: en)
    let eh = localCal.component(.hour, from: en)
    let emin = localCal.component(.minute, from: en)
    let ad = allDay ? "true" : "false"
    let title = strip(e.title ?? "")
    let cname = strip(e.calendar.title)
    print(
        "\(ad)\t\(sy)\t\(sm)\t\(sd)\t\(sh)\t\(smin)\t\(ey)\t\(em)\t\(ed)\t\(eh)\t\(emin)\t\(cname)\t\(title)"
    )
}
