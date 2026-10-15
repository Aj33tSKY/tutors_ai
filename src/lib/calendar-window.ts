export type CalendarWindow = { from: string; to: string };

/** A month with one month either side, including the trailing calendar cells. */
export function calendarWindow(date: Date): CalendarWindow {
  return {
    from: new Date(date.getFullYear(), date.getMonth() - 1, 1).toISOString(),
    to: new Date(date.getFullYear(), date.getMonth() + 2, 1).toISOString(),
  };
}

/** Extra initial buffer avoids a refetch on first render across time zones. */
export function initialCalendarWindow(date: Date): CalendarWindow {
  return {
    from: new Date(date.getFullYear(), date.getMonth() - 2, 1).toISOString(),
    to: new Date(date.getFullYear(), date.getMonth() + 3, 1).toISOString(),
  };
}
