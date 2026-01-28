const { DateTime } = require("luxon");

const TZ_AR = "America/Argentina/Buenos_Aires";

function toDateKeyAR(jsDate) {
  return DateTime.fromJSDate(jsDate, { zone: TZ_AR }).toFormat("yyyy-LL-dd");
}

function tomorrowStartAR() {
  return DateTime.now().setZone(TZ_AR).plus({ days: 1 }).startOf("day").toJSDate();
}

function parseDateKeyToStartAR(dateKey) {
  // dateKey: "YYYY-MM-DD"
  return DateTime.fromFormat(dateKey, "yyyy-LL-dd", { zone: TZ_AR }).startOf("day").toJSDate();
}

module.exports = { TZ_AR, toDateKeyAR, tomorrowStartAR, parseDateKeyToStartAR };
