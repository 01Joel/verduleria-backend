const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI no está definido en .env");

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  console.log("✅ Conectado a MongoDB Atlas");
}

module.exports = connectDB;
