const mongoose = require("mongoose");
const Promotion = require("../models/Promotion");
const Variant = require("../models/Variant");
const DailyPrice = require("../models/DailyPrice");
const { destroyImage } = require("../services/cloudinaryService");
const { getRoundStep } = require("../services/configService");

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function ceilToStep(value) {
  const v = Number(value);
  if (!isFinite(v)) return null;
  /*const v = Number(value);
  const s = Number(step);

  if (!Number.isFinite(v)) return null;
  if (!Number.isFinite(s) || s <= 0) return v;
  return Math.ceil(v / s) * s;*/
  return Math.floor((v+50)/100)*100;
}

function nowMs() {
  return Date.now();
}

function isActiveByTime(promo, now = new Date()) {
  if (!promo.active) return false;
  const s = promo.startsAt ? new Date(promo.startsAt).getTime() : 0;
  const e = promo.endsAt ? new Date(promo.endsAt).getTime() : 0;
  const t = now.getTime();
  return s <= t && t < e;
}

function validatePromoPayload({ type, percentOff, buyQty, payQty, endsAt }) {
  if (!type || !["PERCENT_OFF", "BOGO"].includes(type)) {
    return "type inválido (PERCENT_OFF | BOGO)";
  }

  const end = new Date(endsAt);
  if (!endsAt || Number.isNaN(end.getTime())) return "endsAt es requerido y debe ser fecha válida";
  if (end.getTime() <= nowMs()) return "endsAt debe ser en el futuro";

  if (type === "PERCENT_OFF") {
    const p = Number(percentOff);
    if (!Number.isFinite(p) || p <= 0 || p >= 95) return "percentOff inválido (1..94)";
  }

  if (type === "BOGO") {
    const b = Number(buyQty);
    const pay = Number(payQty);
    if (!Number.isFinite(b) || !Number.isFinite(pay)) return "buyQty y payQty son requeridos para BOGO";
    if (!Number.isInteger(b) || !Number.isInteger(pay)) return "buyQty y payQty deben ser enteros";
    if (!(b > pay && pay >= 1)) return "Para BOGO debe cumplirse buyQty > payQty >= 1";
  }

  return null;
}

/**
 * Enriquecimiento: calcula precio promo basado en DailyPrice (si LISTO).
 * - baseSalePrice = costFinal * (1 + marginPct)
 * - PERCENT_OFF => promoPrice
 * - BOGO => comboPrice (ej 2x1 => 2 por $X)
 */
async function buildPromoView(promoDoc) {
  const roundStep = await getRoundStep();

  const promo = promoDoc.toObject ? promoDoc.toObject() : promoDoc;

  const daily = await DailyPrice.findOne({
    sessionId: promo.sessionId,
    variantId: promo.variantId,
  }).select("costFinal marginPct salePrice status unitSale");

  // Si no hay precio listo, no se puede calcular promoPrice todavía
  if (!daily || daily.status !== "LISTO" || daily.costFinal == null) {
    return {
      ...promo,
      pricing: {
        status: daily?.status || "PENDIENTE",
        unitSale: daily?.unitSale || null,
        salePrice: daily?.salePrice ?? null, // precio normal
        salePriceBase: null,
        promoPrice: null,
        comboPrice: null,
        roundStep,
      },
      timing: {
        startsAt: promo.startsAt,
        endsAt: promo.endsAt,
        remainingMs: Math.max(0, new Date(promo.endsAt).getTime() - nowMs()),
      },
      isActiveByTime: isActiveByTime(promoDoc, new Date()),
    };
  }

  const baseSalePrice = daily.costFinal * (1 + (daily.marginPct ?? 0.35));

  let promoPrice = null;
  let comboPrice = null;

  if (promo.type === "PERCENT_OFF") {
    const off = Number(promo.percentOff) / 100;
    const promoBase = baseSalePrice * (1 - off);
    promoPrice = ceilToStep(promoBase);
  }

  if (promo.type === "BOGO") {
    // No es un precio unitario; mostramos precio del combo
    const payQty = Number(promo.payQty || 1);
    const comboBase = baseSalePrice * payQty;
    comboPrice = ceilToStep(comboBase);
  }

  return {
    ...promo,
    pricing: {
      status: daily.status,
      unitSale: daily.unitSale,
      salePrice: daily.salePrice, // precio normal (ya redondeado por step si aplicaste patch)
      salePriceBase: baseSalePrice,
      promoPrice,
      comboPrice,
      roundStep,
    },
    timing: {
      startsAt: promo.startsAt,
      endsAt: promo.endsAt,
      remainingMs: Math.max(0, new Date(promo.endsAt).getTime() - nowMs()),
    },
    isActiveByTime: isActiveByTime(promoDoc, new Date()),
  };
}

function emitSession(app, sessionId, event, payload) {
  const io = app.locals.io;
  if (!io) return;
  io.to(`session:${sessionId}`).emit(event, payload);
}

/**
 * POST /promotions
 * Crea o actualiza (upsert) promo para (sessionId, variantId).
 */
async function upsertPromotion(req, res) {
  const {
    sessionId,
    variantId,
    type,
    percentOff = null,
    buyQty = null,
    payQty = null,
    startsAt = null,
    endsAt,
    imageUrl = "",
    imagePublicId = "",
    active = true,
  } = req.body || {};

  if (!sessionId || !variantId) {
    return res.status(400).json({ ok: false, message: "sessionId y variantId son requeridos" });
  }
  if (!isValidObjectId(sessionId) || !isValidObjectId(variantId)) {
    return res.status(400).json({ ok: false, message: "sessionId o variantId inválido" });
  }

  const errMsg = validatePromoPayload({ type, percentOff, buyQty, payQty, endsAt });
  if (errMsg) return res.status(400).json({ ok: false, message: errMsg });

  // Validación adicional: 2x1 no permitido para KG
  const variant = await Variant.findById(variantId).select("unitSale nameVariant productId");
  if (!variant) return res.status(404).json({ ok: false, message: "Variante no encontrada" });

  if (type === "BOGO" && String(variant.unitSale || "KG").toUpperCase() === "KG") {
    return res.status(409).json({ ok: false, message: "BOGO (2x1) no permitido para unitSale=KG" });
  }

  const startDate = startsAt ? new Date(startsAt) : new Date();
  if (Number.isNaN(startDate.getTime())) {
    return res.status(400).json({ ok: false, message: "startsAt inválido" });
  }

  const endDate = new Date(endsAt);

  const update = {
    sessionId,
    variantId,
    type,
    percentOff: type === "PERCENT_OFF" ? Number(percentOff) : null,
    buyQty: type === "BOGO" ? Number(buyQty) : null,
    payQty: type === "BOGO" ? Number(payQty) : null,
    startsAt: startDate,
    endsAt: endDate,
    active: Boolean(active),
    createdBy: req.user?._id || null,
  };

  // Imagen promo opcional
  if (imageUrl !== undefined) update.imageUrl = String(imageUrl || "");
  if (imagePublicId !== undefined) update.imagePublicId = String(imagePublicId || "");

  const promo = await Promotion.findOneAndUpdate(
    { sessionId, variantId },
    { $set: update },
    { upsert: true, new: true }
  )
    .populate({
      path: "variantId",
      select: "nameVariant unitSale productId imageUrl imagePublicId active",
      populate: { path: "productId", select: "name imageUrl imagePublicId active" },
    });

  emitSession(req.app, sessionId, "promotions_updated", { sessionId: String(sessionId) });

  const view = await buildPromoView(promo);
  return res.status(201).json({ ok: true, promotion: promo, view });
}

async function listPromotions(req, res) {
  const { sessionId, active, includeExpired } = req.query;

  if (!sessionId) return res.status(400).json({ ok: false, message: "sessionId es requerido" });
  if (!isValidObjectId(sessionId)) return res.status(400).json({ ok: false, message: "sessionId inválido" });

  const filter = { sessionId };

  if (active === "true") filter.active = true;
  if (active === "false") filter.active = false;

  // Por defecto, ocultamos expiradas cuando active=true, salvo includeExpired=true
  const now = new Date();
  if (includeExpired !== "true") {
    filter.endsAt = { $gt: now };
  }

  const promos = await Promotion.find(filter)
    .populate({
      path: "variantId",
      select: "nameVariant unitSale productId imageUrl imagePublicId active",
      populate: { path: "productId", select: "name imageUrl imagePublicId active" },
    })
    .sort({ endsAt: 1 });

  const views = [];
  for (const p of promos) {
    // eslint-disable-next-line no-await-in-loop
    views.push(await buildPromoView(p));
  }

  return res.json({ ok: true, promotions: promos, views });
}

async function getPromotion(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

  const promo = await Promotion.findById(id).populate({
    path: "variantId",
    select: "nameVariant unitSale productId imageUrl imagePublicId active",
    populate: { path: "productId", select: "name imageUrl imagePublicId active" },
  });

  if (!promo) return res.status(404).json({ ok: false, message: "Promoción no encontrada" });

  const view = await buildPromoView(promo);
  return res.json({ ok: true, promotion: promo, view });
}

async function updatePromotion(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

  const promo = await Promotion.findById(id);
  if (!promo) return res.status(404).json({ ok: false, message: "Promoción no encontrada" });

  const {
    type,
    percentOff,
    buyQty,
    payQty,
    startsAt,
    endsAt,
    active,
  } = req.body || {};

  const next = {
    type: type ?? promo.type,
    percentOff: percentOff ?? promo.percentOff,
    buyQty: buyQty ?? promo.buyQty,
    payQty: payQty ?? promo.payQty,
    endsAt: endsAt ?? promo.endsAt,
  };

  const errMsg = validatePromoPayload(next);
  if (errMsg) return res.status(400).json({ ok: false, message: errMsg });

  if (startsAt !== undefined) {
    const s = new Date(startsAt);
    if (Number.isNaN(s.getTime())) return res.status(400).json({ ok: false, message: "startsAt inválido" });
    promo.startsAt = s;
  }

  promo.type = next.type;

  if (promo.type === "PERCENT_OFF") {
    promo.percentOff = Number(next.percentOff);
    promo.buyQty = null;
    promo.payQty = null;
  } else {
    // BOGO
    const variant = await Variant.findById(promo.variantId).select("unitSale");
    const unitSale = String(variant?.unitSale || "KG").toUpperCase();
    if (unitSale === "KG") return res.status(409).json({ ok: false, message: "BOGO (2x1) no permitido para unitSale=KG" });

    promo.buyQty = Number(next.buyQty);
    promo.payQty = Number(next.payQty);
    promo.percentOff = null;
  }

  promo.endsAt = new Date(next.endsAt);

  if (active !== undefined) promo.active = Boolean(active);

  await promo.save();

  const populated = await Promotion.findById(promo._id).populate({
    path: "variantId",
    select: "nameVariant unitSale productId imageUrl imagePublicId active",
    populate: { path: "productId", select: "name imageUrl imagePublicId active" },
  });

  emitSession(req.app, String(promo.sessionId), "promotions_updated", { sessionId: String(promo.sessionId) });

  const view = await buildPromoView(populated);
  return res.json({ ok: true, promotion: populated, view });
}

async function activatePromotion(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

  const promo = await Promotion.findByIdAndUpdate(id, { active: true }, { new: true });
  if (!promo) return res.status(404).json({ ok: false, message: "Promoción no encontrada" });

  emitSession(req.app, String(promo.sessionId), "promotions_updated", { sessionId: String(promo.sessionId) });

  const populated = await Promotion.findById(id).populate({
    path: "variantId",
    select: "nameVariant unitSale productId imageUrl imagePublicId active",
    populate: { path: "productId", select: "name imageUrl imagePublicId active" },
  });
  const view = await buildPromoView(populated);

  return res.json({ ok: true, promotion: populated, view });
}

async function deactivatePromotion(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

  const promo = await Promotion.findByIdAndUpdate(id, { active: false }, { new: true });
  if (!promo) return res.status(404).json({ ok: false, message: "Promoción no encontrada" });

  emitSession(req.app, String(promo.sessionId), "promotions_updated", { sessionId: String(promo.sessionId) });

  return res.json({ ok: true, promotion: promo });
}

/**
 * Imagen promo: misma convención que Product/Variant.
 * PATCH /promotions/:id/image => { imageUrl, publicId } o { imageUrl, imagePublicId }
 * DELETE /promotions/:id/image
 */
async function setPromotionImage(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

  const { imageUrl = "", publicId = "", imagePublicId = "" } = req.body || {};
  const finalPublicId = publicId || imagePublicId;

  if (!imageUrl || !finalPublicId) {
    return res.status(400).json({ ok: false, message: "imageUrl y publicId son requeridos" });
  }

  const promo = await Promotion.findById(id);
  if (!promo) return res.status(404).json({ ok: false, message: "Promoción no encontrada" });

  if (promo.imagePublicId) await destroyImage(promo.imagePublicId);

  promo.imageUrl = imageUrl;
  promo.imagePublicId = finalPublicId;
  await promo.save();

  emitSession(req.app, String(promo.sessionId), "promotions_updated", { sessionId: String(promo.sessionId) });

  return res.json({ ok: true, promotion: promo });
}

async function removePromotionImage(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

  const promo = await Promotion.findById(id);
  if (!promo) return res.status(404).json({ ok: false, message: "Promoción no encontrada" });

  if (promo.imagePublicId) await destroyImage(promo.imagePublicId);

  promo.imageUrl = "";
  promo.imagePublicId = "";
  await promo.save();

  emitSession(req.app, String(promo.sessionId), "promotions_updated", { sessionId: String(promo.sessionId) });

  return res.json({ ok: true, promotion: promo });
}

/**
 * PUBLIC: lista promos activas por sesión (para pantalla grande).
 * GET /public/sessions/:sessionId/promotions
 */
async function listPublicPromotions(req, res) {
  const { sessionId } = req.params;
  if (!isValidObjectId(sessionId)) return res.status(400).json({ ok: false, message: "sessionId inválido" });

  const now = new Date();

  const promos = await Promotion.find({
    sessionId,
    active: true,
    startsAt: { $lte: now },
    endsAt: { $gt: now },
  })
    .populate({
      path: "variantId",
      select: "nameVariant unitSale productId imageUrl imagePublicId active",
      populate: { path: "productId", select: "name imageUrl imagePublicId active" },
    })
    .sort({ endsAt: 1 });

  const views = [];
  for (const p of promos) {
    // eslint-disable-next-line no-await-in-loop
    views.push(await buildPromoView(p));
  }

  return res.json({ ok: true, views });
}
/**
 * VENDEDOR/ADMIN: lista promos activas por sesión (para caja).
 * GET /promotions/vendor?sessionId=...
 */
async function listVendorPromotions(req, res) {
  const { sessionId } = req.query;

  if (!sessionId) return res.status(400).json({ ok: false, message: "sessionId es requerido" });
  if (!isValidObjectId(sessionId)) return res.status(400).json({ ok: false, message: "sessionId inválido" });

  const now = new Date();

  const promos = await Promotion.find({
    sessionId,
    active: true,
    startsAt: { $lte: now },
    endsAt: { $gt: now },
  })
    .populate({
      path: "variantId",
      select: "nameVariant unitSale productId imageUrl imagePublicId active",
      populate: { path: "productId", select: "name imageUrl imagePublicId active" },
    })
    .sort({ endsAt: 1 });

  const views = [];
  for (const p of promos) {
    // eslint-disable-next-line no-await-in-loop
    views.push(await buildPromoView(p));
  }

  return res.json({ ok: true, views });
}


module.exports = {
  upsertPromotion,
  listPromotions,
  getPromotion,
  updatePromotion,
  activatePromotion,
  deactivatePromotion,
  setPromotionImage,
  removePromotionImage,
  listPublicPromotions,
  listVendorPromotions,
};
