const mongoose = require("mongoose");
const DailyPrice = require("../models/DailyPrice");
const PurchaseLot = require("../models/PurchaseLot");
const PurchaseSession = require("../models/PurchaseSession");
const Variant = require("../models/Variant");
const { recalcVariantDailyPrice } = require("../services/pricingService");

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function movementFrom(today, prev) {
  const t = toNum(today);
  const p = toNum(prev);

  if (t == null || p == null) return "NEW";
  if (t > p) return "UP";
  if (t < p) return "DOWN";
  return "SAME";
}

/**
 * GET /daily-prices/admin/purchased?sessionId=...
 * ADMIN: lista mínima + compra real + comparación vs sesión anterior
 */
async function listAdminPurchased(req, res) {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ ok: false, message: "sessionId es requerido" });

  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    return res.status(400).json({ ok: false, message: "sessionId inválido" });
  }

  const session = await PurchaseSession.findById(sessionId).select("dateKey");
  if (!session) return res.status(404).json({ ok: false, message: "Sesión no encontrada" });

  const sid = new mongoose.Types.ObjectId(sessionId);

  // 1) Compra real desde lots (fuente de verdad)
  const lotsAgg = await PurchaseLot.aggregate([
    { $match: { sessionId: sid } },
    {
      $group: {
        _id: "$variantId",
        boughtQty: { $sum: "$qty" },
        boughtTotal: { $sum: { $multiply: ["$qty", "$unitCost"] } },
        lastBoughtAt: { $max: "$boughtAt" },
      },
    },
  ]);

  if (lotsAgg.length === 0) return res.json({ ok: true, prices: [] });

  const variantIds = lotsAgg.map((r) => r._id);

  const purchaseMap = new Map();
  for (const r of lotsAgg) {
    purchaseMap.set(String(r._id), {
      boughtQty: Number(r.boughtQty || 0),
      boughtTotal: Number(r.boughtTotal || 0),
      lastBoughtAt: r.lastBoughtAt || null,
    });
  }

  // 2) DailyPrice de HOY solo para variantes compradas
  const prices = await DailyPrice.find({
    sessionId,
    variantId: { $in: variantIds },
  })
    .populate({
      path: "variantId",
      select: "nameVariant unitSale unitBuy conversion imageUrl imagePublicId updatedAt productId",
      populate: { path: "productId", select: "name imageUrl imagePublicId updatedAt" },
    })
    .sort({ updatedAt: -1 });

  // 3) sesión anterior por dateKey
  const prevSession = await PurchaseSession.findOne({ dateKey: { $lt: session.dateKey } })
    .sort({ dateKey: -1 })
    .select("_id dateKey");

  const prevMap = new Map();
  if (prevSession?._id) {
    const prevPrices = await DailyPrice.find({
      sessionId: prevSession._id,
      variantId: { $in: variantIds },
      salePrice: { $ne: null },
    }).select("variantId salePrice");

    for (const pp of prevPrices) {
      prevMap.set(String(pp.variantId), Number(pp.salePrice));
    }
  }

  // 4) Payload final
  const out = prices.map((p) => {
    const obj = p.toObject();

    const vId =
      obj?.variantId && typeof obj.variantId === "object"
        ? String(obj.variantId._id)
        : String(obj.variantId);

    obj.purchase = purchaseMap.get(vId) || { boughtQty: 0, boughtTotal: 0, lastBoughtAt: null };

    const prevSalePrice = prevMap.has(vId) ? prevMap.get(vId) : null;

    obj.prevSalePrice = prevSalePrice;
    obj.prevDateKey = prevSession?.dateKey || null;

    obj.movement = movementFrom(obj.salePrice, prevSalePrice);

    const t = toNum(obj.salePrice);
    const pr = toNum(prevSalePrice);
    obj.delta = t != null && pr != null ? t - pr : null;

    return obj;
  });

  return res.json({ ok: true, prices: out });
}

/**
 * PATCH /daily-prices/admin/variants/:variantId/conversion
 * body: { sessionId, conversion }
 */
async function updateConversionAndRecalc(req, res) {
  const { variantId } = req.params;
  const { sessionId, conversion } = req.body || {};

  if (!sessionId) return res.status(400).json({ ok: false, message: "sessionId es requerido" });
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    return res.status(400).json({ ok: false, message: "sessionId inválido" });
  }
  if (!mongoose.Types.ObjectId.isValid(variantId)) {
    return res.status(400).json({ ok: false, message: "variantId inválido" });
  }

  let finalConversion = null;
  if (conversion !== null && conversion !== undefined && conversion !== "") {
    const n = Number(String(conversion).replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ ok: false, message: "conversion debe ser > 0 o null" });
    }
    finalConversion = n;
  }

  const v = await Variant.findById(variantId);
  if (!v) return res.status(404).json({ ok: false, message: "Variante no encontrada" });

  v.conversion = finalConversion;
  await v.save();

  const doc = await recalcVariantDailyPrice(sessionId, variantId);

  const populated = await DailyPrice.findById(doc._id).populate({
    path: "variantId",
    select: "nameVariant unitSale unitBuy conversion imageUrl imagePublicId updatedAt productId",
    populate: { path: "productId", select: "name imageUrl imagePublicId updatedAt" },
  });

  // ✅ Mantener compatibilidad: devolvemos { ok, price }
  return res.json({ ok: true, price: populated });
}

module.exports = {
  listAdminPurchased,
  updateConversionAndRecalc,
};

/*const mongoose = require("mongoose");
const PurchaseLot = require("../models/PurchaseLot");
const Variant = require("../models/Variant");
const DailyPrice = require("../models/DailyPrice");
const { recalcVariantDailyPrice } = require("../services/pricingService");

// GET /daily-prices/admin/purchased?sessionId=...
async function listAdminPurchased(req, res) {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ ok: false, message: "sessionId es requerido" });
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    return res.status(400).json({ ok: false, message: "sessionId inválido" });
  }

  // 1) compras reales por variante
  const lotsAgg = await PurchaseLot.aggregate([
    { $match: { sessionId: new mongoose.Types.ObjectId(sessionId) } },
    {
      $group: {
        _id: "$variantId",
        boughtQty: { $sum: "$qty" },
        boughtTotal: { $sum: { $multiply: ["$qty", "$unitCost"] } },
        lastBoughtAt: { $max: "$boughtAt" },
      },
    },
    { $sort: { lastBoughtAt: -1 } },
  ]);

  if (lotsAgg.length === 0) return res.json({ ok: true, prices: [] });

  const variantIds = lotsAgg.map((r) => r._id);

  // 2) traer variantes + producto (incluye conversion, unitBuy, unitSale)
  const variants = await Variant.find({ _id: { $in: variantIds } })
    .select("productId nameVariant unitSale unitBuy conversion imageUrl imagePublicId updatedAt active")
    .populate("productId", "name imageUrl imagePublicId updatedAt active");

  const vMap = new Map();
  variants.forEach((v) => vMap.set(String(v._id), v));

  // 3) recalcular daily price AUTO (o respetar MANUAL)
  //    y devolver fila mínima
  const out = [];
  for (const row of lotsAgg) {
    const v = vMap.get(String(row._id));
    if (!v) continue;

    // eslint-disable-next-line no-await-in-loop
    const dp = await recalcVariantDailyPrice(sessionId, v._id);

    // puede ser null si algo raro (pero en general existirá)
    const salePrice = dp?.salePrice ?? null;

    out.push({
      _id: dp?._id || `${sessionId}:${String(v._id)}`,
      sessionId,
      variantId: v,
      purchase: {
        boughtQty: Number(row.boughtQty || 0),
        boughtTotal: Number(row.boughtTotal || 0),
        lastBoughtAt: row.lastBoughtAt || null,
      },
      unitSale: dp?.unitSale || v.unitSale || "KG",
      salePrice,
      status: dp?.status || "PENDIENTE",
    });
  }

  return res.json({ ok: true, prices: out });
}

// PATCH /daily-prices/admin/variants/:variantId/conversion
// body: { sessionId, conversion }
async function updateConversionAndRecalc(req, res) {
  const { variantId } = req.params;
  const { sessionId, conversion } = req.body || {};

  if (!sessionId) return res.status(400).json({ ok: false, message: "sessionId es requerido" });
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    return res.status(400).json({ ok: false, message: "sessionId inválido" });
  }
  if (!mongoose.Types.ObjectId.isValid(variantId)) {
    return res.status(400).json({ ok: false, message: "variantId inválido" });
  }

  const variant = await Variant.findById(variantId).select("unitBuy conversion unitSale productId nameVariant");
  if (!variant) return res.status(404).json({ ok: false, message: "Variante no encontrada" });

  const n = conversion === null || conversion === "" ? null : Number(String(conversion).replace(",", "."));
  if (n != null && (!Number.isFinite(n) || n <= 0)) {
    return res.status(400).json({ ok: false, message: "Conversión debe ser un número > 0" });
  }
  if (n != null && !String(variant.unitBuy || "").trim()) {
    return res.status(400).json({ ok: false, message: "La variante no tiene unitBuy definido" });
  }

  variant.conversion = n;
  await variant.save();

  // recalcular
  const dp = await recalcVariantDailyPrice(sessionId, variantId);

  // recomprar resumen de compra (para refrescar fila sin recargar todo)
  const agg = await PurchaseLot.aggregate([
    { $match: { sessionId: new mongoose.Types.ObjectId(sessionId), variantId: new mongoose.Types.ObjectId(variantId) } },
    {
      $group: {
        _id: "$variantId",
        boughtQty: { $sum: "$qty" },
        boughtTotal: { $sum: { $multiply: ["$qty", "$unitCost"] } },
        lastBoughtAt: { $max: "$boughtAt" },
      },
    },
  ]);

  const vPop = await Variant.findById(variantId)
    .select("productId nameVariant unitSale unitBuy conversion imageUrl imagePublicId updatedAt active")
    .populate("productId", "name imageUrl imagePublicId updatedAt active");

  const purchase = agg?.[0]
    ? {
        boughtQty: Number(agg[0].boughtQty || 0),
        boughtTotal: Number(agg[0].boughtTotal || 0),
        lastBoughtAt: agg[0].lastBoughtAt || null,
      }
    : { boughtQty: 0, boughtTotal: 0, lastBoughtAt: null };

  return res.json({
    ok: true,
    price: {
      _id: dp?._id || `${sessionId}:${variantId}`,
      sessionId,
      variantId: vPop,
      purchase,
      unitSale: dp?.unitSale || vPop?.unitSale || "KG",
      salePrice: dp?.salePrice ?? null,
      status: dp?.status || "PENDIENTE",
    },
  });
}

module.exports = {
  listAdminPurchased,
  updateConversionAndRecalc,
};
*/