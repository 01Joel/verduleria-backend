const PurchaseLot = require("../models/PurchaseLot");

async function listLots(req, res) {
  const { sessionId, variantId } = req.query;

  const filter = {};
  if (sessionId) filter.sessionId = sessionId;
  if (variantId) filter.variantId = variantId;

  const lots = await PurchaseLot.find(filter)
    .populate({
      path: "variantId",
      select: "nameVariant productId buyUnit unitSale imageUrl",
      populate: { path: "productId", select: "name imageUrl" },
    })
    .populate("supplierId", "nickname")
    .populate("boughtBy", "username")
    .sort({ boughtAt: 1 });

  return res.json({ ok: true, lots });
}

async function patchLotPayment(req, res) {
  const { id } = req.params;
  const { paymentMethod, paymentNote } = req.body || {};

  const allowed = ["EFECTIVO", "MERCADO_PAGO", "NX", "OTRO", null, ""];
  if (paymentMethod !== undefined && !allowed.includes(paymentMethod)) {
    return res.status(400).json({ ok: false, message: "paymentMethod inválido" });
  }

  const update = {};
  if (paymentMethod !== undefined) update.paymentMethod = paymentMethod || null;
  if (paymentNote !== undefined) update.paymentNote = String(paymentNote || "").slice(0, 300);

  const lot = await PurchaseLot.findByIdAndUpdate(id, update, { new: true })
    .populate("supplierId", "nickname")
    .populate({
      path: "variantId",
      select: "nameVariant productId buyUnit unitSale imageUrl",
      populate: { path: "productId", select: "name imageUrl" },
    });

  if (!lot) return res.status(404).json({ ok: false, message: "Lote no encontrado" });

  return res.json({ ok: true, lot });
}

module.exports = { listLots, patchLotPayment };
