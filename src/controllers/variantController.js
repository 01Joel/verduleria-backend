const mongoose = require("mongoose");
const Variant = require("../models/Variant");
const Product = require("../models/Product");
const { destroyImage } = require("../services/cloudinaryService");

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function cleanStr(v) {
  return String(v || "").trim();
}

function normalizeUnitSale(v) {
  const u = cleanStr(v).toUpperCase();
  const allowed = ["KG", "ATADO", "UNIDAD", "BANDJ"];
  return allowed.includes(u) ? u : "KG";
}

function normalizeUnitBuy(v) {
  const raw = cleanStr(v);
  if (!raw) return "";
  const u = raw.toUpperCase();
  const allowed = ["KG", "CAJA", "FARDO", "BOLSA", "ATADO", "UNIDAD", "BANDJ"];
  return allowed.includes(u) ? u : "";
}

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  const s = String(v).trim();
  if (!s) return null;

  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function validateUnitBuyAndConversion({ unitBuy, conversion }) {
  // conversion sin unitBuy => inválido
  if (conversion != null && !unitBuy) {
    return "Si defines conversión, primero define unidad de compra (unitBuy)";
  }
  if (conversion != null && !(conversion > 0)) {
    return "Conversión debe ser un número > 0";
  }
  return null;
}

async function createVariant(req, res) {
  try {
    const {
      productId,
      nameVariant,
      unitSale = "KG",
      unitBuy = "",
      conversion = null,
      imageUrl = "",
      imagePublicId = "",
    } = req.body || {};

    if (!productId) return res.status(400).json({ ok: false, message: "productId es requerido" });
    if (!isValidObjectId(productId)) return res.status(400).json({ ok: false, message: "productId inválido" });

    const cleanNameVariant = cleanStr(nameVariant);
    if (!cleanNameVariant) return res.status(400).json({ ok: false, message: "nameVariant es requerido" });

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

    const cleanUnitSale = normalizeUnitSale(unitSale);
    const cleanUnitBuy = normalizeUnitBuy(unitBuy);
    const cleanConversion = toNumberOrNull(conversion);

    const errUC = validateUnitBuyAndConversion({
      unitBuy: cleanUnitBuy,
      conversion: cleanConversion,
    });
    if (errUC) return res.status(400).json({ ok: false, message: errUC });

    const existing = await Variant.findOne({ productId, nameVariant: cleanNameVariant });

    if (existing) {
      if (existing.active === false) {
        existing.active = true;
        existing.unitSale = cleanUnitSale;
        existing.unitBuy = cleanUnitBuy;
        existing.conversion = cleanConversion;

        if (imageUrl) existing.imageUrl = imageUrl;
        if (imagePublicId) existing.imagePublicId = imagePublicId;

        await existing.save();

        return res.status(200).json({ ok: true, variant: existing, reactivated: true });
      }

      return res.status(409).json({ ok: false, message: "Ya existe una variante con ese nombre para este producto" });
    }

    const variant = await Variant.create({
      productId,
      nameVariant: cleanNameVariant,
      unitSale: cleanUnitSale,
      unitBuy: cleanUnitBuy,
      conversion: cleanConversion,
      imageUrl,
      imagePublicId,
    });

    return res.status(201).json({ ok: true, variant });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ ok: false, message: "Ya existe una variante con ese nombre para este producto" });
    }
    return res.status(500).json({ ok: false, message: "Error creando variante" });
  }
}

async function listVariants(req, res) {
  try {
    const { active, productId, q } = req.query;

    const filter = {};

    if (active === "true") filter.active = true;
    if (active === "false") filter.active = false;

    if (productId !== undefined) {
      if (!isValidObjectId(productId)) {
        return res.status(400).json({ ok: false, message: "productId inválido" });
      }
      filter.productId = productId;
    }

    if (q) {
      const term = cleanStr(q);
      if (term) filter.nameVariant = { $regex: term, $options: "i" };
    }

    const variants = await Variant.find(filter)
      .populate("productId", "name category imageUrl imagePublicId active")
      .sort({ nameVariant: 1 });

    return res.json({ ok: true, variants });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Error listando variantes" });
  }
}

async function getVariant(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

    const variant = await Variant.findById(id).populate("productId", "name category active imageUrl");
    if (!variant) return res.status(404).json({ ok: false, message: "Variante no encontrada" });

    return res.json({ ok: true, variant });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Error obteniendo variante" });
  }
}

async function updateVariant(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

    const { nameVariant, unitSale, productId, unitBuy, conversion } = req.body || {};

    const variant = await Variant.findById(id);
    if (!variant) return res.status(404).json({ ok: false, message: "Variante no encontrada" });

    const update = {};

    if (productId !== undefined) {
      if (!isValidObjectId(productId)) return res.status(400).json({ ok: false, message: "productId inválido" });

      const product = await Product.findById(productId);
      if (!product) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

      update.productId = productId;
    }

    if (nameVariant !== undefined) {
      const cleanNameVariant = cleanStr(nameVariant);
      if (!cleanNameVariant) return res.status(400).json({ ok: false, message: "nameVariant no puede estar vacío" });
      update.nameVariant = cleanNameVariant;
    }

    if (unitSale !== undefined) {
      update.unitSale = normalizeUnitSale(unitSale);
    }

    if (unitBuy !== undefined) {
      update.unitBuy = normalizeUnitBuy(unitBuy);
    }

    // OJO: si conversion viene undefined, no tocamos; si viene null/"" => lo limpiamos
    if (conversion !== undefined) {
      update.conversion = toNumberOrNull(conversion);
    }

    // Validación unitBuy + conversion usando valores finales
    const finalUnitBuy =
      update.unitBuy !== undefined ? update.unitBuy : (variant.unitBuy || "");
    const finalConversion =
      conversion !== undefined ? update.conversion : (variant.conversion ?? null);

    const errUC = validateUnitBuyAndConversion({
      unitBuy: finalUnitBuy,
      conversion: finalConversion,
    });
    if (errUC) return res.status(400).json({ ok: false, message: errUC });

    // Validar colisión unique (productId + nameVariant)
    const finalProductId = update.productId || variant.productId;
    const finalNameVariant = update.nameVariant || variant.nameVariant;

    const other = await Variant.findOne({
      _id: { $ne: id },
      productId: finalProductId,
      nameVariant: finalNameVariant,
    });

    if (other) {
      return res.status(409).json({
        ok: false,
        message: "Ya existe una variante con ese nombre para este producto",
      });
    }

    const updated = await Variant.findByIdAndUpdate(id, update, { new: true })
      .populate("productId", "name category active imageUrl imagePublicId");

    return res.json({ ok: true, variant: updated });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ ok: false, message: "Ya existe una variante con ese nombre para este producto" });
    }
    return res.status(500).json({ ok: false, message: "Error actualizando variante" });
  }
}

async function setVariantImage(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

    const { imageUrl = "", publicId = "", imagePublicId = "" } = req.body || {};
    const finalPublicId = publicId || imagePublicId;

    if (!imageUrl || !finalPublicId) {
      return res.status(400).json({ ok: false, message: "imageUrl y publicId son requeridos" });
    }

    const variant = await Variant.findById(id);
    if (!variant) return res.status(404).json({ ok: false, message: "Variante no encontrada" });

    if (variant.imagePublicId) await destroyImage(variant.imagePublicId);

    variant.imageUrl = imageUrl;
    variant.imagePublicId = finalPublicId;
    await variant.save();

    const populated = await Variant.findById(id).populate("productId", "name category active imageUrl");
    return res.json({ ok: true, variant: populated });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Error actualizando imagen" });
  }
}

async function removeVariantImage(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

    const variant = await Variant.findById(id);
    if (!variant) return res.status(404).json({ ok: false, message: "Variante no encontrada" });

    if (variant.imagePublicId) await destroyImage(variant.imagePublicId);

    variant.imageUrl = "";
    variant.imagePublicId = "";
    await variant.save();

    const populated = await Variant.findById(id).populate("productId", "name category active imageUrl");
    return res.json({ ok: true, variant: populated });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Error eliminando imagen" });
  }
}

async function bajaVariant(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

    const variant = await Variant.findByIdAndUpdate(id, { active: false }, { new: true })
      .populate("productId", "name category active imageUrl");

    if (!variant) return res.status(404).json({ ok: false, message: "Variante no encontrada" });
    return res.json({ ok: true, variant });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Error dando de baja variante" });
  }
}

async function altaVariant(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

    const variant = await Variant.findByIdAndUpdate(id, { active: true }, { new: true })
      .populate("productId", "name category active imageUrl");

    if (!variant) return res.status(404).json({ ok: false, message: "Variante no encontrada" });
    return res.json({ ok: true, variant });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Error dando de alta variante" });
  }
}

module.exports = {
  createVariant,
  listVariants,
  getVariant,
  updateVariant,
  setVariantImage,
  removeVariantImage,
  bajaVariant,
  altaVariant,
};
