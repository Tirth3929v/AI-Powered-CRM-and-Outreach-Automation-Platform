/** Parse local input and require an actual future calendar date. */
export function isFutureSchedule(value, now = Date.now()) {
  if (!value || typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return false
  const [, y, mo, d, h, mi] = match.map(Number)
  const date = new Date(y, mo - 1, d, h, mi)
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h && date.getMinutes() === mi && date.getTime() > now
}
