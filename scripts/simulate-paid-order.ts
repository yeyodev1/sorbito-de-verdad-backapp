import 'dotenv/config';
import mongoose from 'mongoose';
import { Order } from '../src/models/Order.model';
import { bbcNotificationService } from '../src/services/bbc-notification.service';

async function simulate() {
  const orderId = process.argv[2];
  if (!orderId) {
    console.error('Uso: pnpm ts-node --transpile-only scripts/simulate-paid-order.ts <orderId>');
    process.exit(1);
  }

  await mongoose.connect(process.env.DB_URI!);
  console.log('✅ Conectado a MongoDB');

  const order = await Order.findById(orderId);
  if (!order) {
    console.error('❌ Orden no encontrada:', orderId);
    process.exit(1);
  }

  console.log('📄 Orden:', order.orderNumber, '| Total: $' + order.total);
  console.log('📱 WhatsAppPhone:', order.whatsappPhone || '(none)');
  console.log('📱 ShippingPhone:', order.shippingAddress?.phone || '(none)');

  if (!order.whatsappPhone && !order.shippingAddress?.phone) {
    console.log('⚠️  No hay teléfono — asignando 593995254965');
    order.whatsappPhone = '593995254965';
  }

  order.paymentStatus = 'paid';
  order.status = 'confirmed';
  await order.save();
  console.log('✅ Orden marcada como paid/confirmed');

  console.log('📤 Enviando confirmación WhatsApp...');
  await bbcNotificationService.sendPaidConfirmation(order);
  console.log('✅ Mensaje de confirmación enviado a 593995254965');

  await mongoose.disconnect();
}

simulate().catch(err => {
  console.error('❌ Error:', err?.response?.data || err?.message || err);
  process.exit(1);
});
