const Supplier = require("../models/Supplier");

async function createSupplier(req, res) {
  const { nickname, name = "", lastname = "" } = req.body || {};
  if (!nickname) return res.status(400).json({ ok: false, message: "nickname es requerido" });

  const supplier = await Supplier.create({
    nickname: String(nickname).trim().toLowerCase(),
    name: String(name || "").trim(),
    lastname: String(lastname || "").trim(),
  });

  return res.status(201).json({ ok: true, supplier });
}

async function listSuppliers(req, res) {
  const { active } = req.query;
  const filter = {};
  if (active === "true") filter.active = true;
  if (active === "false") filter.active = false;

  const suppliers = await Supplier.find(filter).sort({ nickname: 1 });
  return res.json({ ok: true, suppliers });
}

async function getSupplier(req, res) {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) return res.status(404).json({ ok: false, message: "Proveedor no encontrado" });
  return res.json({ ok: true, supplier });
}

async function updateSupplier(req, res) {
  const { nickname, name, lastname } = req.body || {};
  const update = {};

  if (nickname !== undefined) update.nickname = String(nickname).trim().toLowerCase();
  if (name !== undefined) update.name = String(name || "").trim();
  if (lastname !== undefined) update.lastname = String(lastname || "").trim();

  const supplier = await Supplier.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!supplier) return res.status(404).json({ ok: false, message: "Proveedor no encontrado" });

  return res.json({ ok: true, supplier });
}

async function bajaSupplier(req, res) {
  const supplier = await Supplier.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!supplier) return res.status(404).json({ ok: false, message: "Proveedor no encontrado" });
  return res.json({ ok: true, supplier });
}

async function altaSupplier(req, res) {
  const supplier = await Supplier.findByIdAndUpdate(req.params.id, { active: true }, { new: true });
  if (!supplier) return res.status(404).json({ ok: false, message: "Proveedor no encontrado" });
  return res.json({ ok: true, supplier });
}

module.exports = {
  createSupplier,
  listSuppliers,
  getSupplier,
  updateSupplier,
  bajaSupplier,
  altaSupplier,
};
