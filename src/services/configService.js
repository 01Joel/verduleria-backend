const Config = require("../models/Config");

async function getMarginPct() {
  const doc = await Config.findOne({ key: "MARGIN_PCT" });
  if (!doc || typeof doc.valueNumber !== "number") return 0.35; // default 35%
  return doc.valueNumber;
}

async function setMarginPct(pct) {
  return Config.findOneAndUpdate(
    { key: "MARGIN_PCT" },
    { $set: { valueNumber: pct } },
    { upsert: true, new: true }
  );
}

// NUEVO: step de redondeo (Argentina sin monedas)
async function getRoundStep() {
  const doc = await Config.findOne({ key: "ROUND_STEP_AR" });
  const step = Number(doc?.valueNumber ?? 50);
  if (!Number.isFinite(step) || step <= 0) return 50;
  return step;
}

async function setRoundStep(step) {
  const s = Number(step);
  if (!Number.isFinite(s) || s <= 0) throw new Error("roundStep inválido");
  return Config.findOneAndUpdate(
    { key: "ROUND_STEP_AR" },
    { $set: { valueNumber: s } },
    { upsert: true, new: true }
  );
}

module.exports = { getMarginPct, setMarginPct, getRoundStep, setRoundStep };
