const User = require("../models/User");
const { signToken } = require("../utils/jwt");

async function login(req, res) {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ ok: false, message: "username y password son requeridos" });
  }

  const user = await User.findOne({ username: String(username).toLowerCase().trim() });
  if (!user || !user.active) {
    return res.status(401).json({ ok: false, message: "Credenciales inválidas" });
  }

  const ok = await user.comparePassword(password);
  if (!ok) {
    return res.status(401).json({ ok: false, message: "Credenciales inválidas" });
  }

  const token = signToken({ sub: user._id.toString(), role: user.role });

  return res.json({
    ok: true,
    token,
    user: { id: user._id, username: user.username, role: user.role },
  });
}

async function me(req, res) {
  return res.json({ ok: true, user: req.user });
}

module.exports = { login, me };
