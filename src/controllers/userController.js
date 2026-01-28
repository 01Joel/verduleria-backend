const bcrypt = require("bcrypt");
const User = require("../models/User");

function normalizeUsername(u) {
  return String(u || "").toLowerCase().trim();
}

async function listUsers(req, res) {
  const { role, active, q } = req.query;

  const filter = {};
  if (role) filter.role = role;
  if (active === "true") filter.active = true;
  if (active === "false") filter.active = false;

  if (q) {
    const term = normalizeUsername(q);
    filter.username = { $regex: term, $options: "i" };
  }

  const users = await User.find(filter)
    .select("username role active createdAt updatedAt")
    .sort({ createdAt: -1 });

  return res.json({ ok: true, users });
}

async function createVendor(req, res) {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ ok: false, message: "username y password son requeridos" });
  }

  const uname = normalizeUsername(username);
  if (uname.length < 3) {
    return res.status(400).json({ ok: false, message: "username muy corto (min 3)" });
  }
  if (String(password).length < 4) {
    return res.status(400).json({ ok: false, message: "password muy corto (min 4)" });
  }

  const exists = await User.findOne({ username: uname });
  if (exists) {
    return res.status(409).json({ ok: false, message: "Ese username ya existe" });
  }

  const passwordHash = await bcrypt.hash(String(password), 10);

  const user = await User.create({
    username: uname,
    passwordHash,
    role: "VENDEDOR",
    active: true,
  });

  return res.status(201).json({
    ok: true,
    user: { id: user._id, username: user.username, role: user.role, active: user.active },
  });
}

async function updateUser(req, res) {
  const { id } = req.params;
  const { username, active } = req.body || {};

  const user = await User.findById(id);
  if (!user) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });

  // No permitimos cambiar role por seguridad en esta versión
  const update = {};

  if (username !== undefined) {
    const uname = normalizeUsername(username);
    if (uname.length < 3) return res.status(400).json({ ok: false, message: "username muy corto (min 3)" });

    const exists = await User.findOne({ username: uname, _id: { $ne: user._id } });
    if (exists) return res.status(409).json({ ok: false, message: "Ese username ya existe" });

    update.username = uname;
  }

  if (active !== undefined) update.active = Boolean(active);

  const updated = await User.findByIdAndUpdate(id, update, { new: true })
    .select("username role active createdAt updatedAt");

  return res.json({ ok: true, user: updated });
}

async function bajaUser(req, res) {
  const { id } = req.params;

  const user = await User.findById(id);
  if (!user) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });

  // Evitar que el ADMIN se auto-deactive por accidente (opcional)
  if (user.role === "ADMIN") {
    return res.status(409).json({ ok: false, message: "No se puede dar de baja un ADMIN desde aquí" });
  }

  user.active = false;
  await user.save();

  return res.json({ ok: true, user: { id: user._id, username: user.username, role: user.role, active: user.active } });
}

async function altaUser(req, res) {
  const { id } = req.params;

  const user = await User.findById(id);
  if (!user) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });

  user.active = true;
  await user.save();

  return res.json({ ok: true, user: { id: user._id, username: user.username, role: user.role, active: user.active } });
}

async function resetPassword(req, res) {
  const { id } = req.params;
  const { password } = req.body || {};

  if (!password || String(password).length < 4) {
    return res.status(400).json({ ok: false, message: "password inválido (min 4)" });
  }

  const user = await User.findById(id);
  if (!user) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });

  const passwordHash = await bcrypt.hash(String(password), 10);
  user.passwordHash = passwordHash;
  await user.save();

  return res.json({ ok: true, message: "Password actualizado" });
}

module.exports = {
  listUsers,
  createVendor,
  updateUser,
  bajaUser,
  altaUser,
  resetPassword,
};
