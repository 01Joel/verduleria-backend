const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");

function buildImageUploader(cloudinary) {
  const storage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => ({
      folder: "verduleria",
      resource_type: "image",
      format: "webp",
      public_id: `${Date.now()}-${file.originalname}`.replace(/\s+/g, "-"),
      transformation: [{ width: 1200, height: 1200, crop: "limit" }],
    }),
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
      const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
      cb(ok ? null : new Error("Formato inválido (solo jpg/png/webp)"), ok);
    },
  });
}

module.exports = buildImageUploader;
