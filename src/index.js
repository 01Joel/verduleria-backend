require("dotenv").config();
process.env.TZ = process.env.TZ || "America/Argentina/Buenos_Aires";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const http = require("http");
const { Server } = require("socket.io");

const connectDB = require("./config/db");
const initCloudinary = require("./config/cloudinary");
const buildImageUploader = require("./middlewares/uploadImage");
const buildUploadRoutes = require("./routes/uploadRoutes");
const authRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const variantRoutes = require("./routes/variantRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const purchaseSessionRoutes = require("./routes/purchaseSessionRoutes");
const purchaseLotRoutes = require("./routes/purchaseLotRoutes");
const purchaseLotWeighRoutes = require("./routes/purchaseLotWeighRoutes");
const configRoutes = require("./routes/configRoutes");
const dailyPriceRoutes = require("./routes/dailyPriceRoutes");
const promotionRoutes = require("./routes/promotionRoutes");
const publicPromotionRoutes = require("./routes/publicPromotionRoutes");
const publicSessionRoutes = require("./routes/publicSessionRoutes");
const userRoutes = require("./routes/userRoutes");


function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Falta variable de entorno: ${name}`);
}

async function bootstrap() {
  // Validaciones mínimas
  requireEnv("MONGO_URI");
  requireEnv("JWT_SECRET");
  requireEnv("CORS_ORIGIN");
  requireEnv("CLOUDINARY_CLOUD_NAME");
  requireEnv("CLOUDINARY_API_KEY");
  requireEnv("CLOUDINARY_API_SECRET");

  const app = express();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: { origin: process.env.CORS_ORIGIN, credentials: true },
  
  });
  app.locals.io = io;
  io.on("connection", (socket) => {
    socket.on("session:join", ({ sessionId }) => {
      if (sessionId) socket.join(`session:${sessionId}`);
    });
    socket.on("session:leave", ({ sessionId }) => {
      if (sessionId) socket.leave(`session:${sessionId}`);
    });
  });

  // Middlewares base
  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("dev"));

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // Ruta raíz (opcional) para que no veas 404 al entrar a /
  app.get("/", (req, res) => {
    res.json({ ok: true, service: "verduleria-backend", hint: "/api/v1/health" });
  });

  // Health check
  app.get("/api/v1/health", (req, res) => {
    res.json({
      ok: true,
      service: "verduleria-backend",
      time: new Date().toISOString(),
      tz: process.env.TZ,
    });
  });

  // Inicializar Cloudinary + uploader
  const cloudinary = initCloudinary();
  const uploader = buildImageUploader(cloudinary);

  // Rutas
  app.use("/api/v1/uploads", buildUploadRoutes(uploader));
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/products", productRoutes);
  app.use("/api/v1/variants", variantRoutes);
  app.use("/api/v1/suppliers", supplierRoutes);
  app.use("/api/v1/purchase-sessions", purchaseSessionRoutes);
  app.use("/api/v1/purchase-lots", purchaseLotRoutes);
  app.use("/api/v1/purchase-lots", purchaseLotWeighRoutes);
  app.use("/api/v1/config", configRoutes);
  app.use("/api/v1/daily-prices", dailyPriceRoutes);
  app.use("/api/v1/promotions", promotionRoutes);
  app.use("/api/v1/public", publicPromotionRoutes);
  app.use("/api/v1/public", publicSessionRoutes);
  app.use("/api/v1/users", userRoutes);

  // Socket básico (luego lo extendemos para sesiones)
  io.on("connection", (socket) => {
    console.log("🔌 Socket conectado:", socket.id);
    socket.on("disconnect", () => console.log("🔌 Socket desconectado:", socket.id));
  });

  // Middleware de errores (incluye Multer)
  app.use((err, req, res, next) => {
    if (err && err.name === "MulterError") {
      return res.status(400).json({
        ok: false,
        message: `Error de upload: ${err.message}`,
      });
    }
    return res.status(500).json({
      ok: false,
      message: err?.message || "Error interno",
    });
  });

  // Conectar DB y levantar server
  await connectDB();

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`🚀 API corriendo en http://localhost:${PORT}`));
}

bootstrap().catch((err) => {
  console.error("❌ Error al iniciar:", err.message);
  process.exit(1);
});
