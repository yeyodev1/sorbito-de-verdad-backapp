import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../src/models/User.model';
import { Order } from '../src/models/Order.model';

const EMAIL = process.argv[2] || 'diegorele13@gmail.com';

async function deleteUserData() {
  await mongoose.connect(process.env.DB_URI!);
  console.log('✅ Conectado a MongoDB');

  const user = await User.findOne({ email: EMAIL.toLowerCase() });
  if (!user) {
    console.log(`⚠️  No se encontró usuario con email: ${EMAIL}`);
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`👤 Usuario encontrado: ${user.name} (${user.email}) - ID: ${user._id}`);

  const orders = await Order.find({ user: user._id });
  console.log(`📦 Órdenes encontradas: ${orders.length}`);

  if (orders.length > 0) {
    const result = await Order.deleteMany({ user: user._id });
    console.log(`🗑️  Órdenes eliminadas: ${result.deletedCount}`);
  }

  console.log('✅ Datos eliminados exitosamente');
  await mongoose.disconnect();
  process.exit(0);
}

deleteUserData().catch(err => {
  console.error('❌ Error:', err?.message || err);
  process.exit(1);
});
