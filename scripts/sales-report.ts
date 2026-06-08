import mongoose from 'mongoose';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env') });

const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
const PAYMENT_METHODS = ['payphone', 'transfer', 'cash', 'unknown'];
const SOURCES = ['whatsapp', 'web', 'unknown'];

interface OrderItem {
  productId: string;
  name: string;
  size: string;
  price: number;
  quantity: number;
}

interface Order {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingZone: string;
  shippingCost: number;
  items: OrderItem[];
  subtotal: number;
  total: number;
  paymentMethod: string;
  payphoneTransactionId: string;
  payphoneReference: string;
  status: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

async function runReport() {
  const mongoUri = process.env.DB_URI || 'mongodb://localhost:27017/sorbito-de-verdad';

  console.log('🔌 Conectando a MongoDB...\n');
  await mongoose.connect(mongoUri);

  const db = mongoose.connection.db!;
  const orders = await db.collection('orders').find({}).sort({ createdAt: 1 }).toArray() as Order[];

  console.log(`📊 ÓRDENES ENCONTRADAS: ${orders.length}\n`);
  console.log('=' .repeat(80));

  // ─── RESUMEN GENERAL ───
  const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
  const totalShipping = orders.reduce((sum, o) => sum + (o.shippingCost || 0), 0);
  const avgOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;

  console.log('\n📦 RESUMEN GENERAL');
  console.log('-'.repeat(40));
  console.log(`  Total de órdenes:      ${orders.length}`);
  console.log(`  Ingresos totales:      $${totalRevenue.toLocaleString('es-CO', { minimumFractionDigits: 0 })}`);
  console.log(`  Envíos totales:        $${totalShipping.toLocaleString('es-CO', { minimumFractionDigits: 0 })}`);
  console.log(`  Ticket promedio:       $${avgOrderValue.toLocaleString('es-CO', { minimumFractionDigits: 0 })}`);

  // ─── POR ESTADO ───
  console.log('\n📋 ÓRDENES POR ESTADO');
  console.log('-'.repeat(40));
  const byStatus: Record<string, { count: number; revenue: number }> = {};
  for (const status of ORDER_STATUSES) {
    byStatus[status] = { count: 0, revenue: 0 };
  }
  for (const o of orders) {
    const s = o.status || 'unknown';
    if (!byStatus[s]) byStatus[s] = { count: 0, revenue: 0 };
    byStatus[s].count++;
    byStatus[s].revenue += o.total || 0;
  }
  for (const [status, data] of Object.entries(byStatus)) {
    const pct = orders.length > 0 ? ((data.count / orders.length) * 100).toFixed(1) : '0.0';
    console.log(`  ${status.padEnd(12)} ${String(data.count).padStart(4)} órdenes   $${data.revenue.toLocaleString('es-CO', { minimumFractionDigits: 0 }).padStart(10)} (${pct}%)`);
  }

  // ─── POR FUENTE ───
  console.log('\n📱 ÓRDENES POR FUENTE');
  console.log('-'.repeat(40));
  const bySource: Record<string, { count: number; revenue: number }> = {};
  for (const o of orders) {
    const src = o.source || 'unknown';
    if (!bySource[src]) bySource[src] = { count: 0, revenue: 0 };
    bySource[src].count++;
    bySource[src].revenue += o.total || 0;
  }
  for (const [src, data] of Object.entries(bySource)) {
    const pct = orders.length > 0 ? ((data.count / orders.length) * 100).toFixed(1) : '0.0';
    console.log(`  ${src.padEnd(12)} ${String(data.count).padStart(4)} órdenes   $${data.revenue.toLocaleString('es-CO', { minimumFractionDigits: 0 }).padStart(10)} (${pct}%)`);
  }

  // ─── POR MÉTODO DE PAGO ───
  console.log('\n💳 ÓRDENES POR MÉTODO DE PAGO');
  console.log('-'.repeat(40));
  const byPayment: Record<string, { count: number; revenue: number }> = {};
  for (const o of orders) {
    const pm = o.paymentMethod || 'unknown';
    if (!byPayment[pm]) byPayment[pm] = { count: 0, revenue: 0 };
    byPayment[pm].count++;
    byPayment[pm].revenue += o.total || 0;
  }
  for (const [pm, data] of Object.entries(byPayment)) {
    const pct = orders.length > 0 ? ((data.count / orders.length) * 100).toFixed(1) : '0.0';
    console.log(`  ${pm.padEnd(12)} ${String(data.count).padStart(4)} órdenes   $${data.revenue.toLocaleString('es-CO', { minimumFractionDigits: 0 }).padStart(10)} (${pct}%)`);
  }

  // ─── PRODUCTOS MÁS VENDIDOS ───
  console.log('\n🏆 TOP PRODUCTOS MÁS VENDIDOS');
  console.log('-'.repeat(40));
  const productMap: Record<string, { name: string; totalQty: number; totalRevenue: number; sizes: Record<string, number> }> = {};
  for (const o of orders) {
    for (const item of o.items || []) {
      if (!productMap[item.productId]) {
        productMap[item.productId] = { name: item.name, totalQty: 0, totalRevenue: 0, sizes: {} };
      }
      productMap[item.productId].totalQty += item.quantity || 1;
      productMap[item.productId].totalRevenue += (item.price || 0) * (item.quantity || 1);
      const size = item.size || 'unknown';
      productMap[item.productId].sizes[size] = (productMap[item.productId].sizes[size] || 0) + (item.quantity || 1);
    }
  }
  const topProducts = Object.entries(productMap)
    .sort((a, b) => b[1].totalQty - a[1].totalQty)
    .slice(0, 20);
  for (const [pid, data] of topProducts) {
    console.log(`  ${data.name} (${pid.slice(-6)})`);
    console.log(`    Cantidad: ${data.totalQty}  |  Revenue: $${data.totalRevenue.toLocaleString('es-CO', { minimumFractionDigits: 0 })}`);
    const sizeStr = Object.entries(data.sizes).map(([s, q]) => `${s}=${q}`).join(', ');
    console.log(`    Tamanos: ${sizeStr}`);
  }

  // ─── ZONAS DE ENVÍO ───
  console.log('\n🚚 ÓRDENES POR ZONA DE ENVÍO');
  console.log('-'.repeat(40));
  const byZone: Record<string, { count: number; revenue: number; shippingCost: number }> = {};
  for (const o of orders) {
    const zone = o.shippingZone || 'unknown';
    if (!byZone[zone]) byZone[zone] = { count: 0, revenue: 0, shippingCost: 0 };
    byZone[zone].count++;
    byZone[zone].revenue += o.total || 0;
    byZone[zone].shippingCost += o.shippingCost || 0;
  }
  for (const [zone, data] of Object.entries(byZone).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${zone.padEnd(20)} ${String(data.count).padStart(4)} órdenes   Revenue: $${data.revenue.toLocaleString('es-CO', { minimumFractionDigits: 0 })}   Envíos: $${data.shippingCost.toLocaleString('es-CO', { minimumFractionDigits: 0 })}`);
  }

  // ─── EVOLUCIÓN MENSUAL ───
  console.log('\n📅 EVOLUCIÓN MENSUAL');
  console.log('-'.repeat(40));
  const monthly: Record<string, { count: number; revenue: number; orders: string[] }> = {};
  for (const o of orders) {
    const d = new Date(o.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!monthly[key]) monthly[key] = { count: 0, revenue: 0, orders: [] };
    monthly[key].count++;
    monthly[key].revenue += o.total || 0;
    monthly[key].orders.push(o._id.toString());
  }
  for (const [month, data] of Object.entries(monthly).sort()) {
    console.log(`  ${month}  ${String(data.count).padStart(4)} órdenes   $${data.revenue.toLocaleString('es-CO', { minimumFractionDigits: 0 })}`);
  }

  // ─── CLIENTES TOP ───
  console.log('\n👤 TOP CLIENTES');
  console.log('-'.repeat(40));
  const customerMap: Record<string, { name: string; email: string; phone: string; count: number; total: number }> = {};
  for (const o of orders) {
    const key = o.customerEmail || o.customerPhone || o.customerName || 'unknown';
    if (!customerMap[key]) {
      customerMap[key] = { name: o.customerName, email: o.customerEmail, phone: o.customerPhone, count: 0, total: 0 };
    }
    customerMap[key].count++;
    customerMap[key].total += o.total || 0;
  }
  const topCustomers = Object.entries(customerMap).sort((a, b) => b[1].total - a[1].total).slice(0, 15);
  for (const [key, data] of topCustomers) {
    console.log(`  ${data.name} (${key})`);
    console.log(`    Telefono: ${data.phone}  |  ${data.count} órdenes  |  $${data.total.toLocaleString('es-CO', { minimumFractionDigits: 0 })}`);
  }

  // ─── ÓRDENES DETALLADAS ───
  console.log('\n📋 LISTA COMPLETA DE ÓRDENES');
  console.log('-'.repeat(80));
  for (const o of orders) {
    const items = (o.items || []).map(i => `${i.quantity}x${i.name}(${i.size})@$${i.price}`).join(', ');
    console.log(`  [${o._id.toString()}] ${new Date(o.createdAt).toISOString().split('T')[0]} | ${o.status.padEnd(12)} | ${(o.source || 'web').padEnd(10)} | ${o.customerName} | ${o.customerPhone || 'N/A'} | Items: ${items || 'N/A'} | Total: $${(o.total || 0).toLocaleString('es-CO', { minimumFractionDigits: 0 })}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ REPORTE COMPLETO');
  await mongoose.disconnect();
}

runReport().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
