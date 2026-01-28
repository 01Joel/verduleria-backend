function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, message: "No autorizado" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, message: "No tienes permisos" });
    }
    next();
  };
}

module.exports = requireRole;
