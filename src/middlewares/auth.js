const User = require("../models/User");
const { verifyToken } = require("../utils/jwt");

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [type, token] = header.split(" ");

    if (type !== "Bearer" || !token) {
      return res.status(401).json({ ok: false, message: "No autorizado (falta token)" });
    }

    const decoded = verifyToken(token);

    const user = await User.findById(decoded.sub).select("-passwordHash");
    if (!user || !user.active) {
      return res.status(401).json({ ok: false, message: "Usuario inválido o inactivo" });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: "Token inválido o expirado" });
  }
}

module.exports = auth;
