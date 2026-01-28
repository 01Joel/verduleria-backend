const PurchaseLot = require("../models/PurchaseLot");
const { recalcVariantDailyPrice } = require("../services/pricingService");

async function weighLot(req, res) {
  const { lotId } = req.params;
  const { netWeightKg } = req.body || {};

  const w = Number(netWeightKg);
  if (!(w > 0)) return res.status(400).json({ ok: false, message: "netWeightKg debe ser > 0" });

  const lot = await PurchaseLot.findById(lotId);
  if (!lot) return res.status(404).json({ ok: false, message: "Lote no encontrado" });

  if (lot.buyUnit !== "CAJA") {
    return res.status(409).json({ ok: false, message: "Este lote no es CAJA; no requiere pesaje" });
  }

  lot.netWeightKg = w;
  lot.weighedAt = new Date();
  await lot.save();

  const daily = await recalcVariantDailyPrice(lot.sessionId, lot.variantId);

  // Emitir por socket (si el frontend ya está en room session:<id>)
  const io = req.app.locals.io;
  if (io) {
    io.to(`session:${lot.sessionId}`).emit("daily_price_updated", {
      sessionId: String(lot.sessionId),
      variantId: String(lot.variantId),
      dailyPrice: daily,
    });
  }

  return res.json({ ok: true, lot, dailyPrice: daily });
}

module.exports = { weighLot };
