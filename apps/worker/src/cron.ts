interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  for (const rawPart of field.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;

    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Invalid cron step: ${part}`);
    }

    let start = min;
    let end = max;
    if (rangePart && rangePart !== "*") {
      if (rangePart.includes("-")) {
        const [s, e] = rangePart.split("-").map(Number);
        if (s === undefined || e === undefined || !Number.isInteger(s) || !Number.isInteger(e)) {
          throw new Error(`Invalid cron range: ${part}`);
        }
        start = s;
        end = e;
      } else {
        const val = Number(rangePart);
        if (!Number.isInteger(val)) {
          throw new Error(`Invalid cron value: ${part}`);
        }
        start = val;
        end = stepPart ? max : val;
      }
    }

    for (let value = start; value <= end; value += step) {
      if (value >= min && value <= max) {
        result.add(value);
      }
    }
  }
  return result;
}

function parseCron(cron: string): CronFields {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Expected 5-field cron expression, received "${cron}"`);
  }
  return {
    minutes: parseField(parts[0]!, 0, 59),
    hours: parseField(parts[1]!, 0, 23),
    daysOfMonth: parseField(parts[2]!, 1, 31),
    months: parseField(parts[3]!, 1, 12),
    daysOfWeek: parseField(parts[4]!, 0, 6),
  };
}

interface ZonedParts {
  minute: number;
  hour: number;
  day: number;
  month: number;
  weekday: number;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  });
  const parts = formatter.formatToParts(date);
  const byType = new Map(parts.map((p) => [p.type, p.value]));
  const rawHour = Number(byType.get("hour") ?? "0");
  return {
    minute: Number(byType.get("minute") ?? "0"),
    hour: rawHour === 24 ? 0 : rawHour,
    day: Number(byType.get("day") ?? "1"),
    month: Number(byType.get("month") ?? "1"),
    weekday: WEEKDAY_MAP[byType.get("weekday") ?? "Sun"] ?? 0,
  };
}

/**
 * Compute the next trigger timestamp (in epoch ms) strictly after `fromDate`.
 */
export function computeNextRunTimestamp(
  scheduleCron: string,
  fromDate: Date = new Date(),
  timeZone: string = "UTC"
): number {
  let fields: CronFields;
  try {
    fields = parseCron(scheduleCron);
  } catch {
    // Fallback to +24h if a user entered a non-standard expression
    return fromDate.getTime() + 24 * 60 * 60 * 1000;
  }

  // Start checking from the next whole minute
  const startMs = Math.floor(fromDate.getTime() / 60_000) * 60_000 + 60_000;
  const maxMinutesToScan = 60 * 24 * 31;

  for (let offset = 0; offset < maxMinutesToScan; offset += 1) {
    const candidateMs = startMs + offset * 60_000;
    const parts = getZonedParts(new Date(candidateMs), timeZone);
    if (
      fields.minutes.has(parts.minute) &&
      fields.hours.has(parts.hour) &&
      fields.daysOfMonth.has(parts.day) &&
      fields.months.has(parts.month) &&
      fields.daysOfWeek.has(parts.weekday)
    ) {
      return candidateMs;
    }
  }

  return fromDate.getTime() + 24 * 60 * 60 * 1000;
}

export function normalizeScheduleInput(schedule: string): string {
  const lower = schedule.trim().toLowerCase();
  if (!lower || lower === "daily" || lower === "8am") {
    return "0 8 * * *";
  }
  if (lower === "hourly") {
    return "0 * * * *";
  }
  if (lower === "weekly") {
    return "0 8 * * 1";
  }
  return schedule.trim();
}
