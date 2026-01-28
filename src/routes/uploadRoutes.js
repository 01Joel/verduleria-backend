const express = require("express");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");

module.exports = function buildUploadRoutes(uploader) {
  const router = express.Router();

  // Solo ADMIN puede subir imágenes
  router.post(
    "/image",
    auth,
    requireRole("ADMIN"),
    uploader.single("file"),
    (req, res) => {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          message: "No se recibió archivo (usa form-data con key: file)",
        });
      }

      return res.json({
        ok: true,
        imageUrl: req.file.path,
        publicId: req.file.filename,
      });
    }
  );

  return router;
};
