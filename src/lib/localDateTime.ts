type DateInput = Date | number | string;

export function formatDeviceMessageTime(value: DateInput) {
  return formatDeviceDateTime(value, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatDeviceMessageDateTime(value: DateInput) {
  return formatDeviceDateTime(value, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZoneName: "short",
    year: "numeric",
  });
}

export function formatDeviceTaskDateTime(value: DateInput) {
  return formatDeviceDateTime(value, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZoneName: "short",
  }) || "Unknown";
}

function formatDeviceDateTime(value: DateInput, options: Intl.DateTimeFormatOptions) {
  const date = parseDateInput(value);

  if (!date) {
    return "";
  }

  const timeZone = getDeviceTimeZone();
  const formatterOptions = {
    ...options,
    ...(timeZone ? { timeZone } : {}),
  };

  try {
    return new Intl.DateTimeFormat(undefined, formatterOptions).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
}

function getDeviceTimeZone() {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function parseDateInput(value: DateInput) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
