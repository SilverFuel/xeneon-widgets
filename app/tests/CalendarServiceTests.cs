using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class CalendarServiceTests
{
    [Test]
    public void ParseIcs_ExpandsRecurringEventsAfterTheirOriginalStart()
    {
        const string ics = """
            BEGIN:VCALENDAR
            BEGIN:VEVENT
            UID:daily-check-in
            DTSTART:20260709T130000Z
            RRULE:FREQ=DAILY;COUNT=3
            SUMMARY:Daily check-in
            LOCATION:Desk
            END:VEVENT
            END:VCALENDAR
            """;

        var entries = CalendarService.ParseIcs(ics, new DateTimeOffset(2026, 7, 10, 8, 0, 0, TimeSpan.FromHours(-4)));

        Assert.That(entries, Has.Count.EqualTo(2));
        Assert.That(entries.Select(entry => entry.Title), Is.All.EqualTo("Daily check-in"));
        Assert.That(entries.Select(entry => entry.Detail), Is.All.EqualTo("Desk"));
    }
}
