const mongoose = require("mongoose");

async function connectDb() {
  const uri = typeof process.env.MONGODB_URI === "string" ? process.env.MONGODB_URI.trim() : "";

  if (!uri) {
    throw new Error("MONGODB_URI is missing.");
  }

  if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
    throw new Error('Invalid MONGODB_URI scheme. Expected "mongodb://" or "mongodb+srv://".');
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    autoIndex: true,
  });

  const usersCollection = mongoose.connection.db.collection("users");
  const indexes = await usersCollection.indexes().catch(() => []);
  const emailIndex = indexes.find((index) => index.name === "email_1");
  const emailIndexNeedsMigration =
    emailIndex &&
    (emailIndex.unique !== true ||
      JSON.stringify(emailIndex.partialFilterExpression || null) !==
        JSON.stringify({ email: { $type: "string", $ne: "" } }));

  if (emailIndexNeedsMigration) {
    await usersCollection.dropIndex("email_1").catch(() => {});
    await usersCollection.createIndex(
      { email: 1 },
      {
        name: "email_1",
        unique: true,
        partialFilterExpression: {
          email: { $type: "string", $ne: "" },
        },
      }
    );
  }

  return mongoose.connection;
}

module.exports = { connectDb };
