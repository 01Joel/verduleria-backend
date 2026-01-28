const Config = require("../models/Config");
const DailyPrice = require("../models/DailyPrice");
const PurchaseSession = require("../models/PurchaseSession");

function normalizePct(input) {
  const n = Number(input);
  if (!Number.isFinite(n)) return null;
  if (n > 1) return n / 100;
  return n;
}

function ceilToStep(value, step) {
  const v = Number(value);
  const s = Number(step);

  if (!Number.isFinite(v)) return null;
  if (!Number.isFinite(s) || s <= 0) return v;

  return Math.ceil(v / s) * s;
}

async function setMargin(req, res) {
  const { marginPct } = req.body || {};
  const pct = normalizePct(marginPct);

  if (pct == null || pct <= 0 || pct >= 2) {
    return res.status(400).json({
      ok: false,
      message: "marginPct inválido. Ej: 0.35 o 35",
    });
  }

  // 1) Guardar margen
  await Config.findOneAndUpdate(
    { key: "MARGIN_PCT" },
    { $set: { valueNumber: pct } },
    { upsert: true, new: true }
  );

  // 1.1) Leer step de redondeo (default recomendado: 50)
  const roundDoc = await Config.findOne({ key: "ROUND_STEP_AR" });
  const roundStep = Number(roundDoc?.valueNumber ?? 50);

  // 2) Elegir sesión objetivo
  let session = await PurchaseSession.findOne({ status: "ABIERTA" }).sort({ createdAt: -1 });
  if (!session) session = await PurchaseSession.findOne().sort({ createdAt: -1 });

  if (!session) {
    return res.json({
      ok: true,
      marginPct: pct,
      roundStep,
      message: "Margen guardado, pero no hay sesiones para recalcular",
    });
  }

  // 3) Recalcular salePrice (con unitSale desde Variant)
  const prices = await DailyPrice.find({ sessionId: session._id }).populate("variantId", "unitSale");

  let updatedCount = 0;

  for (const p of prices) {
    if (p.costFinal == null) continue;

    p.marginPct = pct;

    // base sale (sin redondeo)
    const baseSalePrice = p.costFinal * (1 + pct);

    // unitSale viene de Variant
    const unitSale = p.variantId?.unitSale || "KG";

    // Política mínima: step global (AR) aplicable a todas las unidades de venta
    // Si luego querés step por unidad, aquí se ramifica.
    const rounded = ceilToStep(baseSalePrice, roundStep);

    // Guardamos el sugerido redondeado (sin decimales si step es entero)
    p.salePrice = rounded;
    await p.save();
    updatedCount++;
  }

  // 4) Emitir eventos socket
  const io = req.app.locals.io;
  if (io) {
    io.to(`session:${session._id}`).emit("margin_updated", {
      sessionId: String(session._id),
      marginPct: pct,
      roundStep,
    });

    io.to(`session:${session._id}`).emit("daily_prices_recalculated", {
      sessionId: String(session._id),
    });
  }

  return res.json({
    ok: true,
    marginPct: pct,
    roundStep,
    recalculatedSessionId: String(session._id),
    updatedCount,
  });
}

async function getMargin(req, res) {
  const doc = await Config.findOne({ key: "MARGIN_PCT" });
  const pct = doc?.valueNumber ?? 0.35;

  const roundDoc = await Config.findOne({ key: "ROUND_STEP_AR" });
  const roundStep = Number(roundDoc?.valueNumber ?? 50);

  return res.json({ ok: true, marginPct: pct, roundStep });
}

module.exports = { setMargin, getMargin };
