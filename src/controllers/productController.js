const mongoose = require("mongoose");
const Product = require("../models/Product");
const { destroyImage } = require("../services/cloudinaryService");

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function normalizeName(name) {
  return String(name || "").trim();
}

async function createProduct(req, res) {
  try {
    const { name, category = "", imageUrl = "", imagePublicId = "" } = req.body || {};
    const cleanName = normalizeName(name);
    if (!cleanName) return res.status(400).json({ ok: false, message: "name es requerido" });

    const cleanCategory = String(category || "").trim();

    // Si existe (activo o inactivo) con el mismo nombre exacto:
    const existing = await Product.findOne({ name: cleanName });

    if (existing) {
      // Si estaba inactivo, lo reactivamos (política recomendada para baja lógica)
      if (existing.active === false) {
        existing.active = true;
        existing.category = cleanCategory;
        // si mandaron imagen en create, la aplicamos
        if (imageUrl) existing.imageUrl = imageUrl;
        if (imagePublicId) existing.imagePublicId = imagePublicId;
        await existing.save();

        return res.status(200).json({ ok: true, product: existing, reactivated: true });
      }

      return res.status(409).json({ ok: false, message: "Ya existe un producto con ese nombre" });
    }

    const product = await Product.create({
      name: cleanName,
      category: cleanCategory,
      imageUrl,
      imagePublicId,
    });

    return res.status(201).json({ ok: true, product });
  } catch (err) {
    // Duplicado por índice unique
    if (err?.code === 11000) {
      return res.status(409).json({ ok: false, message: "Ya existe un producto con ese nombre" });
    }
    return res.status(500).json({ ok: false, message: "Error creando producto" });
  }
}

async function listProducts(req, res) {
  try {
    const { active, q, category } = req.query;

    const filter = {};

    if (active === "true") filter.active = true;
    if (active === "false") filter.active = false;

    if (category) filter.category = String(category).trim();

    if (q) {
      // Búsqueda simple por nombre (case-insensitive)
      const term = String(q).trim();
      if (term) filter.name = { $regex: term, $options: "i" };
    }

    const products = await Product.find(filter).sort({ name: 1 });
    return res.json({ ok: true, products });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Error listando productos" });
  }
}

async function getProduct(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

    return res.json({ ok: true, product });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Error obteniendo producto" });
  }
}

async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

    const { name, category } = req.body || {};
    const update = {};

    if (name !== undefined) {
      const cleanName = normalizeName(name);
      if (!cleanName) return res.status(400).json({ ok: false, message: "name no puede estar vacío" });

      // evitar colisión con otro producto
      const other = await Product.findOne({ name: cleanName, _id: { $ne: id } });
      if (other) return res.status(409).json({ ok: false, message: "Ya existe un producto con ese nombre" });

      update.name = cleanName;
    }

    if (category !== undefined) update.category = String(category || "").trim();

    const product = await Product.findByIdAndUpdate(id, update, { new: true });
    if (!product) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

    return res.json({ ok: true, product });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ ok: false, message: "Ya existe un producto con ese nombre" });
    }
    return res.status(500).json({ ok: false, message: "Error actualizando producto" });
  }
}

async function setProductImage(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

    // aceptamos publicId o imagePublicId por compatibilidad
    const { imageUrl = "", publicId = "", imagePublicId = "" } = req.body || {};
    const finalPublicId = publicId || imagePublicId;

    if (!imageUrl || !finalPublicId) {
      return res.status(400).json({ ok: false, message: "imageUrl y publicId son requeridos" });
    }

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

    if (product.imagePublicId) await destroyImage(product.imagePublicId);

    product.imageUrl = imageUrl;
    product.imagePublicId = finalPublicId;
    await product.save();

    return res.json({ ok: true, product });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Error actualizando imagen" });
  }
}

async function removeProductImage(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

    if (product.imagePublicId) await destroyImage(product.imagePublicId);

    product.imageUrl = "";
    product.imagePublicId = "";
    await product.save();

    return res.json({ ok: true, product });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Error eliminando imagen" });
  }
}

async function bajaProduct(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

    const product = await Product.findByIdAndUpdate(id, { active: false }, { new: true });
    if (!product) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

    return res.json({ ok: true, product });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Error dando de baja producto" });
  }
}

async function altaProduct(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ ok: false, message: "id inválido" });

    const product = await Product.findByIdAndUpdate(id, { active: true }, { new: true });
    if (!product) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

    return res.json({ ok: true, product });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Error dando de alta producto" });
  }
}

module.exports = {
  createProduct,
  listProducts,
  getProduct,
  updateProduct,
  setProductImage,
  removeProductImage,
  bajaProduct,
  altaProduct,
};
