import axios, { HttpStatusCode } from 'axios';
import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { Order } from '../models/Order.model';
import { Product } from '../models/Product.model';
import { User } from '../models/User.model';
import { ShippingZone } from '../models/ShippingZone.model';
import { TempCart } from '../models/TempCart.model';
import { AuthRequest } from '../types/AuthRequest';
import { emailService } from '../services/email.service';
import { payphoneService } from '../services/payphone.service';
import { payphoneLinksService } from '../services/payphone-links.service';
import { bbcNotificationService } from '../services/bbc-notification.service';
import { cloudinaryService } from '../services/cloudinary.service';

export const createOrder = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { items, shippingAddress, paymentMethod = 'manual', notes, shippingZoneId, identificationNumber } = req.body;

    if (!items || !items.length || !shippingAddress) {
      res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'Items y dirección de envío son requeridos' });
      return;
    }

    let subtotal = 0;
    const resolvedItems = [];

    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product || !product.isActive) {
        res.status(HttpStatusCode.BadRequest).send({ success: false, message: `Producto no disponible: ${item.product}` });
        return;
      }
      if (product.stock < item.quantity) {
        res.status(HttpStatusCode.BadRequest).send({ success: false, message: `Stock insuficiente para: ${product.name}` });
        return;
      }
      const itemPrice = item.price > 0 ? item.price : product.price;
      subtotal += itemPrice * item.quantity;
      resolvedItems.push({
        product: product._id,
        name: product.name,
        image: product.mainImage,
        quantity: item.quantity,
        price: itemPrice,
        ...(item.sizeName && { sizeName: item.sizeName }),
      });
      await Product.findByIdAndUpdate(product._id, { $inc: { stock: -item.quantity } });
    }

    let shipping = subtotal >= 50 ? 0 : 5;
    let shippingZoneName: string | undefined;

    if (shippingZoneId) {
      const zone = await ShippingZone.findById(shippingZoneId);
      if (zone) {
        shipping = zone.price;
        shippingZoneName = zone.name;
      }
    }

    const total = subtotal + shipping;

    const order = await Order.create({
      user: req.user?.userId,
      items: resolvedItems,
      subtotal,
      shipping,
      tax: 0,
      total,
      shippingAddress,
      paymentMethod,
      notes,
      ...(identificationNumber && { identificationNumber }),
      ...(shippingZoneName && { shippingZoneName }),
    });

    // Fire-and-forget order confirmation email
    const buyer = await User.findById(req.user?.userId).select('name email');
    if (buyer) {
      emailService.sendOrderConfirmation(buyer.email, buyer.name, String(order._id), total).catch(() => { });
    }

    res.status(HttpStatusCode.Created).send({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

export const getMyOrders = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orders = await Order.find({ user: req.user?.userId }).sort({ createdAt: -1 });
    res.send({ success: true, data: orders });
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user?.userId });
    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Orden no encontrada' });
      return;
    }
    res.send({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

export const getAllOrders = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.accountType !== 'admin' && req.user?.accountType !== 'owner') {
      res.status(HttpStatusCode.Forbidden).send({ success: false, message: 'Sin permisos' });
      return;
    }

    const { status, dateFrom, dateTo, sort = '-createdAt', limit = '200', search, source, page } = req.query as Record<string, string>;

    const query: Record<string, unknown> = {};

    if (status) {
      query.status = status.includes(',') ? { $in: status.split(',') } : status;
    }
    if (source === 'web') {
      query.$or = [
        { source: 'web' },
        { source: { $exists: false } },
        { source: '' },
      ];
    } else if (source) {
      query.source = source;
    }

    if (dateFrom || dateTo) {
      const dateFilter: Record<string, Date> = {};
      // Frontend sends UTC ISO strings with proper TZ offset already applied
      if (dateFrom) dateFilter.$gte = new Date(dateFrom);
      if (dateTo) dateFilter.$lte = new Date(dateTo);
      query.createdAt = dateFilter;
    }

    if (search) {
      const matchingUsers = await User.find({ name: { $regex: search, $options: 'i' } }).select('_id');
      const userIds = matchingUsers.map(u => u._id);
      const searchOr = [
        { identificationNumber: { $regex: search, $options: 'i' } },
        { 'shippingAddress.phone': { $regex: search, $options: 'i' } },
        { user: { $in: userIds } },
      ];
      if (query.$or) {
        // Combine with existing $or (from source=web)
        query.$and = [{ $or: query.$or }, { $or: searchOr }];
        delete query.$or;
      } else {
        query.$or = searchOr;
      }
    }

    // Conteos reales por estado (siempre, sin importar el filtro activo)
    const allStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
    const pageSize = parseInt(limit);
    const currentPage = Math.max(1, parseInt(page) || 1);
    const skip = (currentPage - 1) * pageSize;

    const [countResults, totalFiltered, orders] = await Promise.all([
      Promise.all(allStatuses.map(s => Order.countDocuments({ status: s }))),
      Order.countDocuments(query),
      Order.find(query).populate('user', 'name email').sort(sort).skip(skip).limit(pageSize),
    ]);

    const counts: Record<string, number> = {};
    allStatuses.forEach((s, i) => { counts[s] = countResults[i]; });
    const total = countResults.reduce((a, b) => a + b, 0);

    res.send({ success: true, data: orders, counts, total, totalFiltered, page: currentPage, pageSize });
  } catch (error) {
    next(error);
  }
};

export const updateOrderStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.accountType !== 'admin' && req.user?.accountType !== 'owner') {
      res.status(HttpStatusCode.Forbidden).send({ success: false, message: 'Sin permisos' });
      return;
    }
    const { status, paymentStatus, adminNotes, paymentReceiptUrl } = req.body;

    const order = await Order.findById(req.params.id).populate<{ user: { name: string; email: string } }>('user', 'name email');
    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Orden no encontrada' });
      return;
    }

    const previousStatus = order.status;

    if (status) order.status = status;
    if (paymentStatus) order.paymentStatus = paymentStatus;
    if (adminNotes !== undefined) order.notes = adminNotes;
    if (paymentReceiptUrl !== undefined) order.paymentReceiptUrl = paymentReceiptUrl || undefined;
    await order.save();

    // Send status-change email if status actually changed
    if (status && status !== previousStatus && order.user) {
      const buyer = order.user as unknown as { name: string; email: string };
      if (buyer?.email) {
        emailService.sendOrderStatusUpdate(
          buyer.email,
          buyer.name,
          String(order._id),
          order.orderNumber,
          status,
          adminNotes,
        ).catch(() => { });
      }
    }

    res.send({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

export const trackOrderByEmail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.params;
    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'No se encontraron pedidos para este correo.' });
      return;
    }
    const orders = await Order.find({
      user: user._id,
      status: { $in: ['confirmed', 'processing', 'shipped', 'delivered'] },
    }).sort({ createdAt: -1 });

    if (!orders.length) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'No hay pedidos confirmados para este correo.' });
      return;
    }

    res.send({
      success: true,
      data: orders.map((o) => ({
        orderNumber: o.orderNumber,
        status: o.status,
        createdAt: o.createdAt,
        shippingAddress: { city: o.shippingAddress.city, country: o.shippingAddress.country },
        items: o.items.map((i) => ({ name: i.name, quantity: i.quantity })),
        notes: o.notes,
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const trackOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderNumber } = req.params;
    const order = await Order.findOne({
      orderNumber,
      status: { $in: ['confirmed', 'processing', 'shipped', 'delivered'] },
    });

    if (!order) {
      res.status(HttpStatusCode.NotFound).send({
        success: false,
        message: 'Pedido no encontrado. Verifica el número o aún no fue confirmado.',
      });
      return;
    }

    res.send({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        createdAt: order.createdAt,
        shippingAddress: {
          city: order.shippingAddress.city,
          country: order.shippingAddress.country,
        },
        items: order.items.map((i) => ({ name: i.name, quantity: i.quantity })),
        notes: order.notes,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const createPayphoneOrder = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { items, shippingAddress, notes, shippingZoneId, email: bodyEmail, identificationNumber } = req.body;

    if (!items || !items.length || !shippingAddress) {
      res.status(HttpStatusCode.BadRequest).send({
        success: false,
        message: 'Items y dirección de envío son requeridos',
      });
      return;
    }

    let subtotal = 0;
    const resolvedItems = [];

    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product || !product.isActive) {
        res.status(HttpStatusCode.BadRequest).send({
          success: false,
          message: `Producto no disponible: ${item.product}`,
        });
        return;
      }
      if (!product.allowBackorder && product.stock < item.quantity) {
        res.status(HttpStatusCode.BadRequest).send({
          success: false,
          message: `Stock insuficiente para: ${product.name}`,
        });
        return;
      }
      const itemPrice = item.price > 0 ? item.price : product.price;
      subtotal += itemPrice * item.quantity;
      resolvedItems.push({
        product: product._id,
        name: product.name,
        image: product.mainImage,
        quantity: item.quantity,
        price: itemPrice,
        ...(item.sizeName && { sizeName: item.sizeName }),
      });
      await Product.findByIdAndUpdate(product._id, { $inc: { stock: -item.quantity } });
    }

    let shipping = subtotal >= 50 ? 0 : 5;
    let shippingZoneName: string | undefined;

    if (shippingZoneId) {
      const zone = await ShippingZone.findById(shippingZoneId);
      if (zone) {
        shipping = zone.price;
        shippingZoneName = zone.name;
      }
    }

    const total = subtotal + shipping;

    // ── Resolve user (logged-in or guest auto-account) ────────────────────────
    let userId: string;
    let guestTempPassword: string | undefined;
    if (req.user?.userId) {
      userId = req.user.userId;
    } else {
      const email = bodyEmail || shippingAddress?.email;
      if (!email) {
        res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'Email es requerido para continuar' });
        return;
      }
      let guestUser = await User.findOne({ email });
      if (!guestUser) {
        const tempPassword = Math.random().toString(36).slice(-6) + Math.random().toString(36).slice(-4).toUpperCase() + '!';
        const hashed = await bcrypt.hash(tempPassword, 10);
        guestUser = await User.create({
          name: shippingAddress?.name || email.split('@')[0],
          email,
          password: hashed,
          accountType: 'customer',
        });
        guestTempPassword = tempPassword; // stored in order, emailed only after payment confirmed
      }
      userId = String(guestUser._id);
    }

    const clientTransactionId = Date.now().toString();

    const order = await Order.create({
      user: userId,
      items: resolvedItems,
      subtotal,
      shipping,
      tax: 0,
      total,
      shippingAddress,
      paymentMethod: 'payphone',
      notes,
      clientTransactionId,
      ...(identificationNumber && { identificationNumber }),
      ...(shippingZoneName && { shippingZoneName }),
      ...(guestTempPassword && { guestTempPassword }),
    });

    const frontendBase = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const { payWithPayPhone } = await payphoneService.prepareButton({
      amount: Math.round(total * 100),
      amountWithoutTax: Math.round(total * 100),
      clientTransactionId,
      responseUrl: `${frontendBase}/pay-response`,
      cancellationUrl: `${frontendBase}/carrito`,
      reference: `SDV-${String(order._id).slice(-8).toUpperCase()}`,
    });

    res.status(HttpStatusCode.Created).send({
      success: true,
      data: {
        orderId: order._id,
        clientTransactionId,
        payWithPayPhone,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const payphoneWebhook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, clientTransactionID } = req.query as { id?: string; clientTransactionID?: string };

    if (!id) {
      res.status(HttpStatusCode.Ok).send({ success: false, message: 'Missing transaction id' });
      return;
    }

    const result = await payphoneService.verifySale(id);

    const order = await Order.findOne({ clientTransactionId: clientTransactionID });

    if (order) {
      if (result.statusCode === 3) {
        order.paymentStatus = 'paid';
        order.status = 'confirmed';
      } else if (result.statusCode === 2) {
        order.paymentStatus = 'failed';
      }
      await order.save();
    }

    res.status(HttpStatusCode.Ok).send({ success: true });
  } catch (error) {
    res.status(HttpStatusCode.Ok).send({ success: false });
  }
};

export const confirmPayphonePayment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // id = PayPhone transaction ID (number), clientTransactionId = our internal ID
    const { id, clientTransactionId } = req.body as { id?: number | string; clientTransactionId?: string };

    if (!id || !clientTransactionId) {
      res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'id y clientTransactionId son requeridos' });
      return;
    }

    const result = await payphoneService.confirmButton(Number(id), clientTransactionId);

    const order = await Order.findOne({ clientTransactionId });
    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Orden no encontrada' });
      return;
    }

    if (result.approved) {
      order.paymentStatus = 'paid';
      order.status = 'confirmed';
      const buyer = await User.findById(order.user).select('name email');
      if (buyer) {
        // Order confirmation email
        emailService.sendOrderConfirmation(buyer.email, buyer.name, String(order._id), order.total).catch(() => { });
        // Guest account credentials — only sent now (on confirmed payment)
        if (order.guestTempPassword) {
          emailService.sendGuestAccountCreated(buyer.email, buyer.name, order.guestTempPassword).catch(() => { });
          order.guestTempPassword = undefined; // clear after sending
        }
      }
    } else {
      order.paymentStatus = 'failed';
    }
    await order.save();

    res.send({
      success: true,
      data: {
        orderId: order._id,
        paymentStatus: order.paymentStatus,
        approved: result.approved,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const resendOrderEmail = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Orden no encontrada' });
      return;
    }

    // Allow: admin/owner, authenticated order owner, or unauthenticated (orderId is proof)
    const isAdmin = req.user?.accountType === 'admin' || req.user?.accountType === 'owner';
    const isOrderOwner = req.user ? String(order.user) === req.user.userId : false;
    const isGuest = !req.user;

    if (!isAdmin && !isOrderOwner && !isGuest) {
      res.status(HttpStatusCode.Forbidden).send({ success: false, message: 'Sin permisos' });
      return;
    }

    const buyer = await User.findById(order.user).select('name email');
    if (!buyer) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Cliente no encontrado' });
      return;
    }

    await emailService.sendOrderConfirmation(buyer.email, buyer.name, String(order._id), order.total);

    res.send({ success: true, message: `Correo reenviado a ${buyer.email}` });
  } catch (error) {
    next(error);
  }
};

export const resendCredentials = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Orden no encontrada' });
      return;
    }

    const buyer = await User.findById(order.user).select('name email');
    if (!buyer) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Cliente no encontrado' });
      return;
    }

    // Generate new temp password and update user
    const newPassword = Math.random().toString(36).slice(-6) + Math.random().toString(36).slice(-4).toUpperCase() + '!';
    const hashed = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(buyer._id, { password: hashed });

    await emailService.sendGuestAccountCreated(buyer.email, buyer.name, newPassword);

    res.send({ success: true, message: `Credenciales reenviadas a ${buyer.email}` });
  } catch (error) {
    next(error);
  }
};

export const getPaymentStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user?.userId });
    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Orden no encontrada' });
      return;
    }
    res.send({
      success: true,
      data: {
        paymentStatus: order.paymentStatus,
        status: order.status,
        payphoneTransactionId: order.payphoneTransactionId,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const createGuestOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      customerEmail,
      items,
      shippingAddress,
      paymentMethod = 'transfer',
      notes,
      identificationNumber,
      shippingZoneName,
      shipping: bodyShipping,
      source,
    } = req.body;

    if (!customerEmail) {
      res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'customerEmail es requerido' });
      return;
    }
    if (!items || !items.length || !shippingAddress) {
      res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'Items y dirección de envío son requeridos' });
      return;
    }

    let user = await User.findOne({ email: customerEmail.toLowerCase() });
    let isNewGuest = false;
    let tempPassword: string | undefined;

    if (!user) {
      isNewGuest = true;
      tempPassword =
        Math.random().toString(36).slice(-6) + Math.random().toString(36).slice(-4).toUpperCase() + '!';
      user = await User.create({
        name: shippingAddress.name || customerEmail.split('@')[0],
        email: customerEmail.toLowerCase(),
        password: tempPassword,
        role: 'customer',
      });
    }

    let subtotal = 0;
    const resolvedItems = [];

    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product || !product.isActive) {
        res.status(HttpStatusCode.BadRequest).send({ success: false, message: `Producto no disponible: ${item.product}` });
        return;
      }
      if (product.stock < item.quantity) {
        res.status(HttpStatusCode.BadRequest).send({ success: false, message: `Stock insuficiente para: ${product.name}` });
        return;
      }
      const itemPrice = item.price > 0 ? item.price : product.price;
      subtotal += itemPrice * item.quantity;
      resolvedItems.push({
        product: product._id,
        name: product.name,
        image: product.mainImage,
        quantity: item.quantity,
        price: itemPrice,
        ...(item.sizeName && { sizeName: item.sizeName }),
      });
      await Product.findByIdAndUpdate(product._id, { $inc: { stock: -item.quantity } });
    }

    const shipping = bodyShipping !== undefined ? bodyShipping : subtotal >= 50 ? 0 : 5;
    const total = subtotal + shipping;

    const order = await Order.create({
      user: user._id,
      items: resolvedItems,
      subtotal,
      shipping,
      tax: 0,
      total,
      shippingAddress,
      paymentMethod,
      notes,
      ...(identificationNumber && { identificationNumber }),
      ...(shippingZoneName && { shippingZoneName }),
      ...(source && { source }),
      ...(source === 'whatsapp_bot' && shippingAddress?.phone && { whatsappPhone: shippingAddress.phone }),
      ...(isNewGuest && tempPassword && { guestTempPassword: tempPassword }),
    });

    emailService.sendOrderConfirmation(user.email, user.name, String(order._id), total).catch(() => { });

    if (isNewGuest && tempPassword) {
      emailService.sendGuestAccountCreated(user.email, user.name, tempPassword).catch(() => { });
      await Order.findByIdAndUpdate(order._id, { $unset: { guestTempPassword: 1 } });
    }

    res.status(HttpStatusCode.Created).send({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

// ── Payphone Link de Pago ─────────────────────────────────────────────────
function buildClientTransactionId(orderNumber: string): string {
  // <=15 chars, base36 timestamp + short order suffix
  const ts = Date.now().toString(36).toUpperCase();
  const tail = orderNumber.replace(/[^0-9A-Z]/gi, '').slice(-4);
  return ('SDV' + ts + tail).slice(0, 15);
}

export const createPayphoneLink = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Orden no encontrada' });
      return;
    }
    if (order.paymentStatus === 'paid') {
      res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'Orden ya pagada' });
      return;
    }

    const amountCents = Math.round(order.total * 100);
    const taxCents = Math.round((order.tax || 0) * 100);
    const amountWithoutTaxCents = amountCents - taxCents;

    const clientTransactionId = order.clientTransactionId || buildClientTransactionId(order.orderNumber);

    const webhookBase = process.env.WEBHOOK_PUBLIC_BASE || '';
    const urlRedirect = webhookBase
      ? `${webhookBase}/api/webhook/payphone-link`
      : undefined;

    const { paymentLink, expiresAt } = await payphoneLinksService.createPaymentLink({
      amountCents,
      taxCents,
      amountWithoutTaxCents,
      reference: `Orden ${order.orderNumber}`,
      clientTransactionId,
      expireInHours: 24,
      urlRedirect,
      webhookUrl: urlRedirect,
    });

    order.payphoneLinkUrl = paymentLink;
    order.payphoneLinkExpiresAt = expiresAt;
    order.clientTransactionId = clientTransactionId;
    order.paymentMethod = 'payphone';
    await order.save();

    res.send({
      success: true,
      data: {
        paymentLink,
        expiresAt,
        orderNumber: order.orderNumber,
        total: order.total,
        clientTransactionId,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const payphoneLinkWebhook = async (req: Request, res: Response, next: NextFunction) => {
  // ALWAYS return 200 — Payphone retries on non-2xx
  try {
    const body = req.body || {};
    const query = req.query || {};
    const configuredWebhookUrl = `${process.env.WEBHOOK_PUBLIC_BASE || 'WEBHOOK_PUBLIC_BASE_NOT_SET'}/api/webhook/payphone-link`;

    // Payphone Notificación Externa shape (best-effort lookup across known field names)
    const transactionId =
      body.transactionId || body.id || body.payphoneTransactionId || query.id || query.transactionId;
    const clientTransactionId =
      body.clientTransactionId || body.clientTxId || query.clientTransactionId || query.clientTransactionID;
    const statusCodeRaw =
      body.statusCode ?? body.status ?? body.transactionStatus ?? query.statusCode;

    console.log('\n🔔 [PayphoneLinkWebhook] incoming');
    console.log(JSON.stringify({
      method: req.method,
      configuredWebhookUrl,
      headers: {
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent'],
        'x-forwarded-for': req.headers['x-forwarded-for'],
      },
      body,
      query,
      extracted: {
        transactionId,
        clientTransactionId,
        statusCodeRaw,
      },
    }, null, 2));

    if (!clientTransactionId) {
      console.log('[PayphoneLinkWebhook] missing clientTransactionId — acknowledging without processing');
      res.status(HttpStatusCode.Ok).send({ success: false, message: 'missing clientTransactionId' });
      return;
    }

    const order = await Order.findOne({ clientTransactionId: String(clientTransactionId) });
    if (!order) {
      console.log('[PayphoneLinkWebhook] order not found for clientTransactionId:', String(clientTransactionId));
      res.status(HttpStatusCode.Ok).send({ success: false, message: 'order not found' });
      return;
    }

    const numericStatus = typeof statusCodeRaw === 'number' ? statusCodeRaw : parseInt(String(statusCodeRaw), 10);
    const stringStatus = typeof statusCodeRaw === 'string' ? statusCodeRaw.toLowerCase() : '';
    const isApproved =
      numericStatus === 3 ||
      stringStatus === 'approved' ||
      stringStatus === 'paid' ||
      stringStatus === 'success';
    const isFailed =
      numericStatus === 2 ||
      stringStatus === 'cancelled' ||
      stringStatus === 'failed' ||
      stringStatus === 'rejected';

    console.log('[PayphoneLinkWebhook] resolved status:', JSON.stringify({
      orderNumber: order.orderNumber,
      clientTransactionId: order.clientTransactionId,
      numericStatus,
      stringStatus,
      isApproved,
      isFailed,
      currentPaymentStatus: order.paymentStatus,
      currentOrderStatus: order.status,
    }, null, 2));

    if (isApproved) {
      order.paymentStatus = 'paid';
      order.status = 'confirmed';
      if (transactionId) order.payphoneTransactionId = String(transactionId);
      await order.save();

      console.log('[PayphoneLinkWebhook] approved order:', JSON.stringify({
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        source: order.source,
        whatsappPhone: order.whatsappPhone,
        shippingPhone: order.shippingAddress?.phone,
        clientTransactionId: order.clientTransactionId,
        transactionId,
        numericStatus,
        stringStatus,
      }));

      // Outbound WhatsApp confirmation — para TODAS las órdenes con teléfono
      bbcNotificationService.sendPaidConfirmation(order).catch(err =>
        console.error('[PayphoneLinkWebhook] sendPaidConfirmation error:', err)
      );

      // Email confirmation (best-effort)
      try {
        const user = await User.findById(order.user);
        if (user?.email) {
          emailService.sendOrderConfirmation(user.email, user.name, String(order._id), order.total).catch(() => { });
        }
      } catch { }
    } else if (isFailed) {
      order.paymentStatus = 'failed';
      if (transactionId) order.payphoneTransactionId = String(transactionId);
      await order.save();
      console.log('[PayphoneLinkWebhook] marked order as failed:', JSON.stringify({
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        transactionId,
      }, null, 2));
    } else {
      console.log('[PayphoneLinkWebhook] unrecognized status payload, order left unchanged');
    }

    console.log('[PayphoneLinkWebhook] ack response: {"success":true}');
    res.status(HttpStatusCode.Ok).send({ success: true });
  } catch (error) {
    console.error('[PayphoneLinkWebhook] error:', error);
    res.status(HttpStatusCode.Ok).send({ success: false });
  }
};

// Parse pipe-format raw message from WhatsApp bot:
// "PAGAR|nombre|email|telefono|cedula|direccion|ciudad|productos|precioTotal"
// or "confirmo compra|nombre|email|telefono|cedula|direccion|ciudad|productos|precioTotal"
function parseRawMessage(raw: string): Record<string, any> | null {
  if (!raw || typeof raw !== 'string') return null;
  // Normalize: find trigger and slice from there
  const re = /\b(PAGAR|confirmar\s+pedido|confirmo\s+mi\s+compra|confirmo\s+compra)\b\s*\|/i;
  const match = raw.match(re);
  if (!match) return null;
  const idx = raw.indexOf(match[0]);
  const cleaned = raw.slice(idx).trim();
  // Replace trigger with normalized form for split
  const normalized = cleaned.replace(re, 'TRIGGER|');
  const parts = normalized.split('|').map(p => p.trim());
  if (parts.length < 9) return null;
  const total = parseFloat(parts[8].replace(/[^0-9.]/g, ''));
  if (!total || total <= 0) return null;
  // Optional 10th field: shipping cost
  const shipping = parts.length > 9 ? parseFloat(parts[9].replace(/[^0-9.]/g, '')) || 0 : 0;
  const productsPrice = Math.max(0, total - shipping);
  return {
    customerName: parts[1],
    customerEmail: parts[2],
    phone: parts[3].replace(/[^0-9+]/g, ''),
    identificationNumber: parts[4],
    address: parts[5],
    city: parts[6],
    items: [{ name: parts[7], price: productsPrice, quantity: 1 }],
    shipping,
  };
}

// ── Heuristic extraction from cliente WhatsApp message ───────────────────
// Use \b word boundaries to avoid matching inside other words (e.g., 'us' inside 'tus')
const SHIPPING_RULES: Array<{ countries: RegExp[]; price: number; cities?: RegExp[] }> = [
  { countries: [/\becuador\b/i], price: 0, cities: [/\bquito\b/i, /\bguayaquil\b/i, /\bcuenca\b/i, /\bmanta\b/i, /\bloja\b/i, /\bambato\b/i, /\bmachala\b/i, /\bportoviejo\b/i, /\bsanto\s+domingo\b/i, /\briobamba\b/i, /\bibarra\b/i, /\besmeraldas\b/i, /\bla\s+garzota\b/i] },
  { countries: [/\bestados\s+unidos\b/i, /\busa\b/i, /\beeuu\b/i, /\bunited\s+states\b/i, /\bcanad[aá]\b/i, /\bcanada\b/i, /\bmiami\b/i, /\bnew\s+york\b/i], price: 48 },
  { countries: [/\bespa[ñn]a\b/i, /\bspain\b/i, /\bfrancia\b/i, /\bfrance\b/i, /\balemania\b/i, /\bgermany\b/i, /\bitalia\b/i, /\bitaly\b/i, /\bportugal\b/i, /\bpa[ií]ses\s+bajos\b/i, /\bholanda\b/i, /\bnetherlands\b/i, /\bb[eé]lgica\b/i, /\bbelgium\b/i, /\bsuiza\b/i, /\bswitzerland\b/i, /\baustria\b/i, /\bsuecia\b/i, /\bsweden\b/i, /\bnoruega\b/i, /\bnorway\b/i, /\bdinamarca\b/i, /\bdenmark\b/i, /\bfinlandia\b/i, /\bfinland\b/i, /\bpolonia\b/i, /\bpoland\b/i, /\bgrecia\b/i, /\bgreece\b/i, /\breino\s+unido\b/i, /\bunited\s+kingdom\b/i, /\beuropa\b/i, /\bmadrid\b/i, /\bbarcelona\b/i], price: 58 },
];

function normalizeLocationValue(value: string | undefined | null): string {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

async function resolveShippingQuote(city?: string | null, country?: string | null) {
  const normalizedCity = normalizeLocationValue(city);
  const normalizedCountry = normalizeLocationValue(country);
  const zones = await ShippingZone.find({ isActive: true }).sort({ price: 1 });

  for (const rule of SHIPPING_RULES) {
    const countryMatch = normalizedCountry && rule.countries.some((re) => re.test(normalizedCountry));
    const cityMatch = normalizedCity && rule.cities?.some((re) => re.test(normalizedCity));
    if (countryMatch || cityMatch) {
      const matchedZone = zones.find((zone) => {
        const zoneCountries = (zone.countries || []).map((entry) => normalizeLocationValue(entry));
        return zone.price === rule.price || (normalizedCountry && zoneCountries.includes(normalizedCountry));
      });
      if (matchedZone) {
        return {
          shipping: matchedZone.price,
          shippingZoneName: matchedZone.name,
          estimatedDays: matchedZone.estimatedDays,
          feeLabel: matchedZone.price === 0 ? 'Sin fee de courier' : `Fee de courier: $${matchedZone.price}`,
        };
      }
      return {
        shipping: rule.price,
        shippingZoneName: normalizedCountry || normalizedCity || 'Zona de envío',
        estimatedDays: '',
        feeLabel: rule.price === 0 ? 'Sin fee de courier' : `Fee de courier: $${rule.price}`,
      };
    }
  }

  const zoneByCountry = zones.find((zone) =>
    (zone.countries || []).map((entry) => normalizeLocationValue(entry)).includes(normalizedCountry)
  );
  if (zoneByCountry) {
    return {
      shipping: zoneByCountry.price,
      shippingZoneName: zoneByCountry.name,
      estimatedDays: zoneByCountry.estimatedDays,
      feeLabel: zoneByCountry.price === 0 ? 'Sin fee de courier' : `Fee de courier: $${zoneByCountry.price}`,
    };
  }

  return {
    shipping: 0,
    shippingZoneName: normalizedCountry || normalizedCity ? 'Por confirmar' : 'No definida',
    estimatedDays: '',
    feeLabel: 'Fee de courier por confirmar',
  };
}

const PRODUCT_KEYWORDS = [
  { match: /(?:bosc[aá]n)/i, name: 'Taza Boscán' },
  { match: /(?:moni)/i, name: 'Taza La Moni' },
  { match: /(?:logo\s*color)/i, name: 'Taza Logo Color' },
  { match: /(?:logo\s*invisible)/i, name: 'Taza Logo Invisible' },
  { match: /(?:colecci[oó]n\s*completa|los?\s*4\s*modelos?|los?\s*cuatro\s*modelos?)/i, name: 'Colección Completa', price: 80 },
];

function extractFromMessage(message: string): Partial<ITempCartData> {
  const m = (message || '').trim();
  const lower = m.toLowerCase();
  const out: Partial<ITempCartData> = {};

  // Email — use word boundary before local part to avoid prefix letters like "ndiego@..."
  const email = m.match(/(?:^|[\s,;:|<>"'(\[])([a-z0-9._+-]+@[a-z0-9-]+\.[a-z0-9.-]+)/i);
  if (email) out.customerEmail = email[1].toLowerCase();

  // Cédula 10 dig or RUC 13 dig (not preceded by + and not too long)
  const idMatch = m.match(/\b\d{10}(\d{3})?\b/g);
  if (idMatch) out.identificationNumber = idMatch[0];

  // Phone 10 dig starting with 0 or 9, or +593
  const phoneMatch = m.match(/(?:\+?593|0)\d{9}/);
  if (phoneMatch) out.phone = phoneMatch[0];

  // City + country detection — use word boundary regex to avoid false positives
  for (const rule of SHIPPING_RULES) {
    for (const re of rule.countries) {
      const cm = m.match(re);
      if (cm) {
        out.country = cm[0].toLowerCase();
        out.shippingCost = rule.price;
        break;
      }
    }
    if (rule.cities) {
      for (const cityRe of rule.cities) {
        const cm = m.match(cityRe);
        if (cm) {
          out.city = cm[0].replace(/\b\w/g, l => l.toUpperCase());
          out.country = out.country || 'ecuador';
          out.shippingCost = out.shippingCost ?? rule.price;
          break;
        }
      }
    }
  }

  // Products + count + size-based pricing
  const products: string[] = [];
  let subtotal = 0;
  let count = 0;
  const hasXXL = /\bxxl\b/i.test(m);
  for (const pk of PRODUCT_KEYWORDS) {
    if (pk.match.test(m)) {
      const qtyRe = new RegExp(`(\\d{1,3})\\s*(?:tazas?\\s+)?(?:de\\s+)?${pk.match.source}`, 'i');
      const qm = m.match(qtyRe);
      const qty = qm && qm[1] ? parseInt(qm[1]) : 1;
      // Base price ($25 for tazas, $80 for colección)
      let price = pk.price ?? 25;
      let sizeLabel = '';
      // XXL upgrade: $25 → $49 only for individual tazas (not Colección which is Estándar only)
      if (hasXXL && !pk.match.source.includes('colecci')) {
        price = 49;
        sizeLabel = ' XXL';
      } else if (pk.price === 80) {
        sizeLabel = ' Estándar';
      } else {
        sizeLabel = ' Estándar';
      }
      products.push(`${qty} ${pk.name}${sizeLabel}`);
      subtotal += qty * price;
      count += qty;
    }
  }
  if (products.length) {
    out.productDescription = products.join(' + ');
    out.productsCount = count;
    out.productSubtotal = subtotal;
  }

  // Address — multiple patterns:
  // 1) "Dir: X" / "Dirección: X" from bot summary
  const dirLabel = m.match(/(?:^|\n)\s*(?:[•\-*·]\s*)?(?:dir|direcci[oó]n|address)\s*[:\-]\s*([^\n•]+)/i);
  if (dirLabel) out.address = dirLabel[1].trim().replace(/\s*,\s*[A-ZÁÉÍÓÚÑa-záéíóúñ]+\s*$/, '');
  if (!out.address) {
    // 2) Line that mentions calle/mz/villa/avenida/cdla
    const addressRe = /([a-záéíóúñ0-9 .,#-]*(calle|mz|manzana|villa|vll|avenida|av\.?|cdla|ciudadela|residencial|garzota)[a-záéíóúñ0-9 .,#-]+)/i;
    const am = m.match(addressRe);
    if (am) out.address = am[1].trim();
  }

  // Name detection — multiple patterns:
  // 1) "Nombre: X" / "Nombre completo: X" (from bot summary)
  // 2) "soy X" / "me llamo X" / "mi nombre es X"
  // 3) Standalone line with 2-4 capitalized words and no other patterns
  let nameCandidate: string | undefined;
  const labelMatch = m.match(/(?:^|\n)\s*(?:[•\-*·]\s*)?(?:nombre(?:\s+completo)?|name)\s*[:\-]\s*([A-ZÁÉÍÓÚÑa-záéíóúñ][A-ZÁÉÍÓÚÑa-záéíóúñ\s'’.-]{1,50}?)\s*(?:[•\-\n·,]|$)/i);
  if (labelMatch) nameCandidate = labelMatch[1].trim();
  if (!nameCandidate) {
    const introMatch = m.match(/\b(?:soy|me\s+llamo|mi\s+nombre\s+es)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ][A-ZÁÉÍÓÚÑa-záéíóúñ\s'’.-]{2,40}?)(?:[,.\n]|$)/i);
    if (introMatch) nameCandidate = introMatch[1].trim();
  }
  if (!nameCandidate) {
    // Standalone short message that looks like a name (2-4 words, alphabetic only)
    // Strip chat prefixes like "Cliente:", "User:", "Yo:", "Tu:" from each line
    const lines = m.split(/\n+/).map(l => {
      let s = l.trim();
      s = s.replace(/^(?:cliente|client|usuario|user|yo|tu|tú|me|customer)\s*[:\-]\s*/i, '');
      s = s.replace(/^[•\-*·]\s*/, '');
      return s.trim();
    }).filter(Boolean);
    for (const line of lines) {
      // Match: 2-4 words, only letters and accents
      if (/^[A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+){1,3}$/.test(line) && line.length >= 5 && line.length <= 50) {
        const lower = line.toLowerCase();
        const isExcluded = /\b(boscan|boscán|moni|logo|coleccion|colección|taza|tazas|quito|guayaquil|cuenca|manta|loja|ecuador|usa|canada|canadá|españa|estados\s+unidos|hola|gracias|listo|ok|si|no|confirmar|confirmo|pago|pagar|comprar|envio|envío|estandar|estándar|xxl|invisible|color|completa|cliente|bot|usuario|nombre|email|correo|cedula|cédula|direccion|dirección|ciudad|productos|envio|envío|total)\b/i;
        if (!isExcluded.test(lower)) {
          nameCandidate = line.replace(/\s+/g, ' ');
          break;
        }
      }
    }
  }
  if (nameCandidate) {
    // Cleanup, title-case
    out.customerName = nameCandidate.replace(/\s+/g, ' ').trim();
  }

  return out;
}

interface ITempCartData {
  customerName?: string;
  customerEmail?: string;
  phone?: string;
  identificationNumber?: string;
  address?: string;
  city?: string;
  country?: string;
  mapsUrl?: string;
  paymentMethod?: string;
  productDescription?: string;
  productsCount?: number;
  productSubtotal?: number;
  shippingCost?: number;
  total?: number;
}

// ── WhatsApp Bot — BRAIN endpoint ─────────────────────────────────────────
// Single entry point: receives rawMessage + phone + history → decides response.
// Returns { message } for BBC to send back to client.

async function buildCatalogText(): Promise<string> {
  const products = await Product.find({ isActive: true }).sort({ price: 1 });
  if (!products.length) return '🚧 Estamos reponiendo stock. Vuelve en un momento ☕';
  const iconFor = (n: string) => {
    const l = n.toLowerCase();
    if (l.includes('boscán') || l.includes('boscan')) return '👨‍💼';
    if (l.includes('moni')) return '👩‍🦰';
    if (l.includes('logo color')) return '🎨';
    if (l.includes('logo invisible')) return '🪄';
    if (l.includes('colecci')) return '🎁';
    return '☕';
  };
  const lines = products.map((p, i) => {
    const sizes = Array.isArray((p as any).sizes) ? (p as any).sizes : [];
    let sizesText = '';
    if (sizes.length) {
      const sp = sizes.map((s: any) => {
        const n = s.name || s;
        const pr = s.price ?? p.price;
        const ic = /xxl/i.test(n) ? '🍺' : '☕';
        return `${ic} ${n} $${pr}`;
      });
      sizesText = `\n   ${sp.join('  •  ')}`;
    } else sizesText = ` — $${p.price}`;
    return `${i + 1}. ${iconFor(p.name)} *${p.name}*${sizesText}`;
  });
  return '☕💛 *Catálogo Sorbito de Verdad*\n━━━━━━━━━━━━━━━━━━━━━\n\n' +
    lines.join('\n\n') +
    '\n\n━━━━━━━━━━━━━━━━━━━━━\n✨ Dime cuál(es) quieres y en qué tamaño 🚀';
}

async function buildShippingText(): Promise<string> {
  const zones = await ShippingZone.find({ isActive: true }).sort({ price: 1 });
  if (!zones.length) return 'Consulta el costo de envío con un asesor.';
  const ic = (n: string) => {
    const l = n.toLowerCase();
    if (l.includes('ecuador')) return '🇪🇨';
    if (l.includes('estados') || l.includes('canad')) return '🇺🇸';
    if (l.includes('europa')) return '🇪🇺';
    return '🌍';
  };
  const lines = zones.map(z => {
    const pl = z.price === 0 ? '🆓 *GRATIS*' : `💵 *$${z.price}*`;
    const c = (z as any).countries?.slice(0, 3).join(', ') || '';
    const d = (z as any).estimatedDays || '';
    return `${ic(z.name)} *${z.name}*\n   ${pl}${d ? `  •  ⏱️ ${d}` : ''}\n   📍 ${c}`;
  });
  return '📦💛 *Costos de envío*\n━━━━━━━━━━━━━━━━━━━━━\n\n' +
    lines.join('\n\n') +
    '\n\n━━━━━━━━━━━━━━━━━━━━━\n✨ Dime de qué país/ciudad escribes ☕';
}

function detectIntent(lastMsg: string, history: string): BrainResponse['intent'] {
  const l = (lastMsg || '').toLowerCase();
  // Catalog: explicit catalog/products request
  if (/\b(cat[aá]logo|productos|qu[eé]\s+venden|qu[eé]\s+tienen|qu[eé]\s+modelos|tazas\s+disponibles|mostr[aá]rme|ver\s+(?:opciones|tazas|catalogo|productos|fotos|im[aá]genes)|ense[ñn]ar|opciones\s+disponibles)\b/i.test(l)) {
    return 'catalog';
  }
  // Shipping: explicit shipping question
  if (/\b(env[ií]o|env[ií]os|shipping|delivery|cu[aá]nto\s+(?:cobran|cuesta)\s+(?:el\s+)?env[ií]o|costo\s+(?:de\s+)?env[ií]o|a\s+d[oó]nde\s+env[ií]an|tiempo\s+de\s+entrega)\b/i.test(l)) {
    return 'shipping';
  }
  // Checkout: confirmation phrases — must come after seeing a summary in history
  const summaryShown = /tu\s+pedido|resumen|total\s*:?\s*\$|📋/i.test(history);
  const confirmRe = /\b(s[ií]|ok|confirm[oa]r?|confirmo|listo|vamos|dale|pagar|paga|pago|pagamos|env[ií]a\s+(?:el\s+)?link|dame\s+(?:el\s+)?link|genera\s+(?:el\s+)?link|todo\s+bien|perfecto|est[aá]\s+bien|adelante)\b/i;
  if (summaryShown && confirmRe.test(l)) {
    return 'checkout';
  }
  // Also: explicit "quiero pagar" anywhere
  if (/\b(quiero\s+pagar|finalizar\s+(?:el\s+)?pedido|generar\s+link|comprar\s+ya)\b/i.test(l)) {
    return 'checkout';
  }
  // Search order: consultar estado de pedido
  if (/\b(consultar\s+pedido|estado\s+(?:de\s+)?(?:mi\s+)?pedido|rastrear|track(?:ing)?\s+order|d[oó]nde\s+(?:est[aá]|va)\s+(?:mi\s+)?pedido|c[uú]al\s+es\s+el\s+estado|qu[eé]\s+pas[oó]\s+con\s+mi\s+(?:pedido|orden)|search_order|buscar\s+(?:mi\s+)?(?:pedido|orden)|ver\s+(?:mi\s+)?pedido|pedido\s+(\d+|SDV))\b/i.test(l)) {
    return 'search_order';
  }
  return 'chat';
}

interface BrainResponse {
  reply: string;
  intent: 'catalog' | 'shipping' | 'checkout' | 'transfer' | 'search_order' | 'chat';
  data: {
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    id?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    country?: string | null;
    mapsUrl?: string | null;
    paymentMethod?: 'payphone' | 'transfer' | null;
    products?: Array<{ name: string; size?: string; qty: number; price: number }>;
    subtotal?: number;
    shipping?: number;
    total?: number;
  };
  readyToCheckout: boolean;
  missingData?: string[];
}

type BotRoute = 'catalog' | 'shipping' | 'checkout' | 'transfer' | 'search_order' | 'conversation';

interface BotDecision {
  success: true;
  route: BotRoute;
  flow: BotRoute;
  nextFlow: BotRoute;
  intent: BrainResponse['intent'];
  readyToCheckout: boolean;
  shouldRedirect: boolean;
  missingData: string[];
  targetEndpoint: string;
  data: BrainResponse['data'];
  checkoutPayload?: Record<string, unknown>;
  transferPayload?: Record<string, unknown>;
  source: 'gemini' | 'heuristic';
}

type BotHistoryMessage = { role: 'user' | 'assistant'; content: string };

function normalizeMessageRole(value: unknown): 'user' | 'assistant' {
  const role = String(value || '').toLowerCase();
  return role === 'assistant' || role === 'model' || role === 'bot' || role === 'system' ? 'assistant' : 'user';
}

function normalizeMessageContent(value: any): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      })
      .join('\n')
      .trim();
  }
  if (typeof value?.text === 'string') return value.text.trim();
  if (typeof value?.content === 'string') return value.content.trim();
  if (typeof value?.message === 'string') return value.message.trim();
  if (typeof value?.body === 'string') return value.body.trim();
  if (typeof value?.value === 'string') return value.value.trim();
  return '';
}

function extractHistoryArray(input: any): any[] {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.messages)) return input.messages;
  if (Array.isArray(input?.history)) return input.history;
  if (Array.isArray(input?.conversation)) return input.conversation;
  if (Array.isArray(input?.data)) return input.data;
  return [];
}

function parseHistoryMessages(history: unknown): BotHistoryMessage[] {
  const messages: BotHistoryMessage[] = [];
  if (!history) return messages;

  const appendMessages = (arr: any[]) => {
    for (const item of arr.slice(-25)) {
      const role = normalizeMessageRole(item?.role ?? item?.sender ?? item?.type);
      const content = normalizeMessageContent(item?.content ?? item?.parts ?? item?.text ?? item);
      if (content) messages.push({ role, content });
    }
  };

  if (Array.isArray(history) || typeof history === 'object') {
    const arr = extractHistoryArray(history);
    if (arr.length) {
      appendMessages(arr);
      return messages;
    }
  }

  const raw = String(history).trim();
  if (!raw || /^\{\{.*\}\}$/.test(raw)) return messages;

  try {
    const parsed = JSON.parse(raw);
    const arr = extractHistoryArray(parsed);
    if (arr.length) {
      appendMessages(arr);
      return messages;
    }
  } catch {
    // Plain text fallback handled below.
  }

  messages.push({ role: 'user', content: raw.slice(-6000) });
  return messages;
}

function getHistoryText(history: unknown): string {
  const messages = parseHistoryMessages(history);
  if (messages.length) {
    return messages
      .map((message) => `${message.role === 'assistant' ? 'Asistente' : 'Cliente'}: ${message.content}`)
      .join('\n')
      .slice(-12000);
  }
  return typeof history === 'string' ? history.slice(-12000) : '';
}

function getLatestUserMessage(history: unknown): string {
  const messages = parseHistoryMessages(history);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user' && messages[index].content.trim()) {
      return messages[index].content.trim();
    }
  }
  return '';
}

function logBotDebugBlock(title: string, payload: unknown) {
  console.log(`\n${title}\n${JSON.stringify(payload, null, 2)}\n`);
}

function buildFriendlyCheckoutMissingMessage(missing: string[], variant: 'link' | 'payment' = 'payment') {
  const labels: Record<string, string> = {
    nombre: '🙋 tu *nombre completo*',
    correo: '📧 tu *correo electrónico*',
    teléfono: '📱 tu *celular o teléfono*',
    cédula: '🪪 tu *cédula o RUC*',
    dirección: '🏠 tu *dirección completa*',
    ciudad: '🌆 tu *ciudad*',
    país: '🌍 tu *país*',
    productos: '☕ qué *producto(s)* quieres',
    'ubicación Google Maps': '📍 tu *ubicación de Google Maps*',
  };
  const itemsText = missing.map((item) => `• ${labels[item] || item}`).join('\n');
  const actionText = variant === 'link' ? 'tu link de pago' : 'el pago';

  return (
    `☕💛 ¡Ya casi lo tenemos! Antes de enviarte ${actionText} me falta confirmar:\n\n` +
    `${itemsText}\n\n` +
    `Envíamelo por aquí y con gusto seguimos enseguida ✨`
  );
}

function getCheckoutHistoryCandidates(rawBody: Record<string, any>): unknown[] {
  return [
    rawBody.history,
    rawBody.history2,
    rawBody.history3,
    rawBody.history4,
    rawBody.history5,
    rawBody.history6,
    rawBody.history7,
    rawBody.conversation,
    rawBody.messages,
    rawBody.ctx_history,
  ].filter(Boolean);
}

function getCheckoutHistoryText(rawBody: Record<string, any>): string {
  const chunks = getCheckoutHistoryCandidates(rawBody)
    .map((candidate) => getHistoryText(candidate))
    .filter((text) => text && text.trim().length > 0);
  return chunks.join('\n').slice(-12000);
}

function getCheckoutLatestUserMessage(rawBody: Record<string, any>): string {
  for (const candidate of getCheckoutHistoryCandidates(rawBody)) {
    const latest = getLatestUserMessage(candidate);
    if (latest) return latest;
  }
  return '';
}

function mapBrainDataToCheckoutFields(data: BrainResponse['data'] | undefined): Partial<ITempCartData> {
  if (!data) return {};
  const products = Array.isArray(data.products) ? data.products : [];
  const productDescription = products.length
    ? products.map((product) => `${product.qty} ${product.name}${product.size ? ` ${product.size}` : ''}`).join(' + ')
    : undefined;

  return {
    customerName: data.name || [data.firstName, data.lastName].filter(Boolean).join(' ') || undefined,
    customerEmail: data.email || undefined,
    phone: data.phone || undefined,
    identificationNumber: data.id || undefined,
    address: data.address || undefined,
    city: data.city || undefined,
    country: data.country || undefined,
    productDescription,
    productsCount: products.reduce((sum, product) => sum + (product.qty || 0), 0) || undefined,
    productSubtotal: typeof data.subtotal === 'number' ? data.subtotal : undefined,
    shippingCost: typeof data.shipping === 'number' ? data.shipping : undefined,
    total: typeof data.total === 'number' ? data.total : undefined,
  };
}

function mapCheckoutPayloadToParsed(checkoutPayload: Record<string, any> | undefined | null): Record<string, any> | null {
  if (!checkoutPayload || typeof checkoutPayload !== 'object') return null;
  const items = Array.isArray(checkoutPayload.items) ? checkoutPayload.items : [];
  return {
    customerName: checkoutPayload.customerName,
    customerEmail: checkoutPayload.customerEmail,
    phone: checkoutPayload.phone,
    identificationNumber: checkoutPayload.identificationNumber,
    address: checkoutPayload.address,
    city: checkoutPayload.city,
    country: checkoutPayload.country,
    mapsUrl: checkoutPayload.mapsUrl,
    items,
    shipping: checkoutPayload.shipping || 0,
    shippingZoneName: checkoutPayload.shippingZoneName,
  };
}

function mapCheckoutPayloadToTempCartData(checkoutPayload: Record<string, any> | undefined | null): Partial<ITempCartData> {
  if (!checkoutPayload || typeof checkoutPayload !== 'object') return {};
  const items = Array.isArray(checkoutPayload.items) ? checkoutPayload.items : [];
  const firstItem = items[0] || {};
  return {
    customerName: checkoutPayload.customerName,
    customerEmail: checkoutPayload.customerEmail,
    phone: checkoutPayload.phone,
    identificationNumber: checkoutPayload.identificationNumber,
    address: checkoutPayload.address,
    city: checkoutPayload.city,
    country: checkoutPayload.country,
    mapsUrl: checkoutPayload.mapsUrl,
    paymentMethod: checkoutPayload.paymentMethod,
    productDescription: firstItem.name,
    productsCount: firstItem.quantity || undefined,
    productSubtotal: typeof firstItem.price === 'number' ? firstItem.price * (firstItem.quantity || 1) : undefined,
    shippingCost: typeof checkoutPayload.shipping === 'number' ? checkoutPayload.shipping : undefined,
    total: typeof firstItem.price === 'number'
      ? (firstItem.price * (firstItem.quantity || 1)) + (checkoutPayload.shipping || 0)
      : undefined,
  };
}

async function storeCheckoutContext(phone: string, checkoutPayload?: Record<string, any>) {
  if (!phone || !checkoutPayload) return;
  const normalizedPhone = String(phone).replace(/[^0-9+]/g, '');
  if (!normalizedPhone) return;
  const tempData = mapCheckoutPayloadToTempCartData(checkoutPayload);
  await TempCart.findOneAndUpdate(
    { phone: normalizedPhone },
    { $set: { phone: normalizedPhone, data: tempData } },
    { upsert: true, new: true }
  );
}

function buildCheckoutPayload(data: BrainResponse['data'], fallbackPhone: string) {
  const products = Array.isArray(data.products) && data.products.length ? data.products : [];
  const productDesc = products.map(p => `${p.qty} ${p.name}${p.size ? ' ' + p.size : ''}`).join(' + ');
  const subtotal = data.subtotal ?? products.reduce((s, p) => s + (p.price || 0) * (p.qty || 1), 0);
  const fullName = data.name || [data.firstName, data.lastName].filter(Boolean).join(' ');

  return {
    customerName: fullName,
    customerEmail: data.email,
    phone: data.phone || fallbackPhone,
    identificationNumber: data.id,
    address: data.address,
    city: data.city,
    country: data.country,
    mapsUrl: data.mapsUrl,
    paymentMethod: data.paymentMethod,
    items: [{ name: productDesc, price: subtotal, quantity: 1 }],
    shipping: data.shipping ?? 0,
    shippingZoneName: data.country || undefined,
  };
}

function hasGoogleMapsLink(history: unknown): boolean {
  const text = getHistoryText(history);
  if (!text) return false;
  return /(https?:\/\/)?(www\.)?(maps\.app\.goo\.gl|goo\.gl\/maps|google\.[^/\s]+\/maps|maps\.google\.[^/\s]+)/i.test(text);
}

function inferPaymentMethod(...sources: Array<unknown>): 'payphone' | 'transfer' | null {
  const normalizedSources = sources
    .map((source) => (typeof source === 'string' ? source : getHistoryText(source)))
    .filter(Boolean)
    .map((source) => String(source).toLowerCase());

  const payphoneRegex = /tarjeta|payphone|link de pago|pago con tarjeta|visa|mastercard|cr[eé]dito|deb[ií]to/;
  const transferRegex = /transfer|transferencia|dep[oó]sito|deposito|banco|produbanco/;

  for (const text of normalizedSources) {
    if (payphoneRegex.test(text)) return 'payphone';
    if (transferRegex.test(text)) return 'transfer';
  }

  const text = normalizedSources.join('\n');
  if (!text) return null;
  if (payphoneRegex.test(text)) return 'payphone';
  if (transferRegex.test(text)) return 'transfer';
  return null;
}

function enforceCheckoutRequirements(result: BrainResponse, history: unknown, rawMessage = ''): BrainResponse {
  const missingData = Array.isArray(result.missingData) ? [...result.missingData] : [];
  const hasMaps = hasGoogleMapsLink(history);
  const inferredPaymentMethod = inferPaymentMethod(result.data?.paymentMethod, rawMessage, history);
  const hasPaymentMethod = inferredPaymentMethod === 'payphone' || inferredPaymentMethod === 'transfer';

  if (!hasMaps && !missingData.includes('ubicación Google Maps')) {
    missingData.push('ubicación Google Maps');
  }
  if (!hasPaymentMethod && !missingData.includes('método de pago')) {
    missingData.push('método de pago');
  }

  return {
    ...result,
    data: {
      ...(result.data || {}),
      paymentMethod: inferredPaymentMethod,
    },
    readyToCheckout: Boolean(result.readyToCheckout && hasMaps && hasPaymentMethod),
    missingData,
  };
}

function routeFromBrainResult(result: BrainResponse, fallbackPhone: string, source: BotDecision['source']): BotDecision {
  let route: BotRoute = 'conversation';
  if (result.intent === 'catalog') route = 'catalog';
  if (result.intent === 'shipping') route = 'shipping';
  if (result.intent === 'search_order') route = 'search_order';
  if (result.readyToCheckout && result.data?.paymentMethod === 'transfer') route = 'transfer';
  if (result.readyToCheckout && result.data?.paymentMethod === 'payphone') route = 'checkout';

  const targetEndpointByRoute: Record<BotRoute, string> = {
    catalog: '/api/orders/whatsapp-bot/catalog',
    shipping: '/api/orders/whatsapp-bot/shipping-info',
    checkout: '/api/orders/whatsapp-bot/checkout',
    transfer: '/api/orders/whatsapp-bot/transfer',
    search_order: '/api/orders/whatsapp-bot/search-order',
    conversation: '/api/orders/whatsapp-bot/assistant',
  };

  const decision: BotDecision = {
    success: true,
    route,
    flow: route,
    nextFlow: route,
    intent: result.intent,
    readyToCheckout: !!result.readyToCheckout,
    shouldRedirect: route !== 'conversation',
    missingData: result.missingData || [],
    targetEndpoint: targetEndpointByRoute[route],
    data: result.data || {},
    source,
  };

  if (route === 'checkout') {
    decision.checkoutPayload = buildCheckoutPayload(result.data || {}, fallbackPhone);
  }
  if (route === 'transfer') {
    decision.transferPayload = buildCheckoutPayload(result.data || {}, fallbackPhone);
  }

  return decision;
}

function buildHeuristicDecision(rawMessage: string, history: string): BrainResponse {
  const lower = `${history}\n${rawMessage}`.toLowerCase();
  const paymentMethod =
    /transfer|transferencia|dep[oó]sito|deposito|banco|produbanco/.test(lower)
      ? 'transfer'
      : /tarjeta|payphone|link de pago|pago con tarjeta/.test(lower)
        ? 'payphone'
        : null;
  return {
    reply: '',
    intent: paymentMethod === 'transfer' ? 'transfer' : detectIntent(rawMessage, history),
    data: { paymentMethod },
    readyToCheckout: false,
    missingData: [],
  };
}

async function callGeminiBrain(userMsg: string, history: string, phone: string): Promise<BrainResponse | null> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) {
    console.warn('[brain] No GEMINI_API_KEY configured, using heuristics only');
    return null;
  }
  try {
    // Fetch catalog + shipping for system context
    const products = await Product.find({ isActive: true });
    const zones = await ShippingZone.find({ isActive: true });

    const catalogText = products.map(p => {
      const sizes = (p as any).sizes || [];
      const sizeStr = sizes.length
        ? sizes.map((s: any) => `${s.name || s} $${s.price ?? p.price}`).join(' / ')
        : `$${p.price}`;
      return `- ${p.name}: ${sizeStr}`;
    }).join('\n');

    const shippingText = zones.map(z => {
      const c = (z as any).countries?.join(', ') || '';
      return `- ${z.name} (${c}): ${z.price === 0 ? 'GRATIS' : '$' + z.price}`;
    }).join('\n');

    const systemPrompt = `Eres "Sorbi", asistente de ventas WhatsApp de Sorbito de Verdad — tazas artesanales del canal de Andersson Boscán y La Moni.

CATÁLOGO REAL (NO inventes precios fuera de esta lista):
${catalogText}

ZONAS DE ENVÍO:
${shippingText}

DATOS MÍNIMOS para generar link PayPhone:
1. Nombre (firstName)
2. Apellido (lastName)
3. Correo (email)
4. Celular/teléfono (phone)
5. Cédula 10 dig o RUC 13 dig (id)
6. Dirección completa (address)
7. Ciudad (city)
8. País (country)
9. Producto(s) con tamaño (products)
10. Un link de Google Maps en el historial (mapsUrl)
11. Método de pago elegido: "payphone" o "transfer" (paymentMethod)

TU TAREA: Analiza SIEMPRE el historial + último mensaje. Decide el intent, responde con amabilidad y extrae todos los datos que el cliente haya dado.

INTENTS:
- "catalog": cliente pide ver catálogo, productos, tazas, opciones, fotos, qué venden
- "shipping": cliente pregunta costos envío, delivery, a dónde envían, tiempos
- "transfer": cliente dice que quiere pagar por transferencia bancaria
- "checkout": cliente confirma su compra con "sí", "confirmo", "ok", "pagar", "listo", "vamos", "dale", etc. — Y previamente recibió un resumen del pedido
- "search_order": cliente quiere saber el estado de su pedido, rastrear, tracking, consultar, "dónde está mi pedido", "cómo va mi pedido", "ver mi pedido"
- "chat": cualquier otra cosa (saludos, preguntas, selección de productos, dar datos)

CRÍTICO — REGLAS PARA readyToCheckout:
- readyToCheckout=true SOLO si están completos los 11 datos mínimos, incluyendo producto(s), Y en el historial aparece un link de Google Maps, Y ya está claro si pagará con tarjeta/link (paymentMethod=payphone) o transferencia (paymentMethod=transfer), Y el cliente ya dijo que quiere comprar/pagar/confirmar o acaba de completar el último dato solicitado.
- Si falta algún dato, readyToCheckout=false y missingData lista qué falta en español ("nombre", "apellido", "correo", "teléfono", "cédula", "dirección", "ciudad", "país", "productos", "ubicación Google Maps", "método de pago")
- Si intent es catalog/shipping/search_order/chat (no confirmación), readyToCheckout=false
- Si el cliente quiere ver productos, intent="catalog" y reply="".
- Si el cliente pregunta envío, intent="shipping" y reply="".
- Si el cliente elige transferencia, intent="transfer".
- Si ya hay producto(s) y todos los datos, calcula subtotal con el catálogo real, envío con la zona real, total=subtotal+shipping.

TONO Sorbi (para campo "reply"):
- Cálido, ecuatoriano, tutea ("tú")
- Mensajes cortos (máx 4 líneas)
- Emojis ☕ 💛
- NUNCA escales a humano
- NUNCA inventes productos/precios fuera del catálogo
- NUNCA digas "ya generé link" — el sistema lo hace si readyToCheckout=true

REPLY según intent:
- catalog/shipping: deja reply vacío "" — el sistema reemplaza con el listado dinámico
- checkout + readyToCheckout=true: deja reply vacío "" — el sistema genera link
- checkout + readyToCheckout=false: reply pide DATO FALTANTE específico con tono Sorbi
- search_order: deja reply vacío "" — el sistema busca el pedido con los datos que haya (teléfono, email)
- chat: respuesta conversacional natural pidiendo siguiente paso o el siguiente dato faltante

RESPONDE ESTRICTAMENTE EN JSON, sin texto antes ni después:
{
  "reply": "texto a enviar al cliente",
  "intent": "catalog|shipping|checkout|transfer|search_order|chat",
  "data": {
    "name": "Diego Reyes" | null,
    "firstName": "Diego" | null,
    "lastName": "Reyes" | null,
    "email": "..." | null,
    "id": "0954227641" | null,
    "phone": "${phone}",
    "address": "..." | null,
    "city": "..." | null,
    "country": "Ecuador" | null,
    "mapsUrl": "https://maps.app.goo.gl/..." | null,
    "paymentMethod": "payphone" | "transfer" | null,
    "products": [{"name":"Taza Boscán","size":"XXL","qty":1,"price":49}] | [],
    "subtotal": 49,
    "shipping": 0,
    "total": 49
  },
  "readyToCheckout": true|false,
  "missingData": ["nombre","correo"]
}`;

    const messages = parseHistoryMessages(history);
    if (!messages.length || messages[messages.length - 1].role !== 'user' || messages[messages.length - 1].content !== userMsg) {
      messages.push({ role: 'user', content: userMsg });
    }

    const model = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').replace(/^models\//, '');
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const r = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1500,
          responseMimeType: 'application/json',
        },
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 25000 }
    );

    const text = r.data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as BrainResponse;
    return parsed;
  } catch (e: any) {
    console.error('[Gemini] err:', e?.response?.data || e?.message);
    return null;
  }
}

const SORBI_SYSTEM_PROMPT = `Eres "Sorbi", asistente de ventas WhatsApp de Sorbito de Verdad — tazas artesanales del canal de Andersson Boscán y La Moni.

TONO: Cálido, ecuatoriano, tutea ("tú"). Mensajes cortos (máx 4 líneas). Emojis ☕ 💛. NUNCA escalas a humanos.

REGLA #1 — NO tienes catálogo memorizado:
- Si el cliente pregunta por productos, precios, catálogo, tazas, dile que escriba "ver catálogo" y el sistema lo muestra automáticamente.
- Si pregunta por envío, dile que escriba "envío".
- NUNCA inventes precios ni productos.

DATOS MÍNIMOS para generar link de pago:
1. Nombre
2. Apellido
3. Correo
4. Celular/teléfono
5. Cédula (10 dig) o RUC (13 dig)
6. Dirección (calle, número, referencia)
7. Ciudad
8. País
9. Producto + tamaño

FLUJO:
1) Saluda. Ofrece mostrar catálogo.
2) Confirma taza + tamaño elegido.
3) Pregunta ciudad/país (si quiere ver costos envío, dile "escribe envío").
4) Pide los datos faltantes en limpio, uno o varios, sin escalar a humano.
5) Cuando tengas TODOS los datos, muestra resumen:

📋 *Tu pedido*
• Nombre: [nombre]
• Email: [email]
• Teléfono: [phone]
• Cédula: [cédula]
• Dir: [dirección], [ciudad], [país]
• Productos: [qty + nombre] = $[subtotal]
• Envío: [zona] = $[envío]
• *TOTAL: $[total]*

Para finalizar dime: *"sí confirmar"* ☕

PROHIBICIONES:
- NO inventes catálogo/precios.
- NO digas "ya generé link". El sistema lo hace, no tú.
- NO escales a humano.
- NO invites a confirmar SIN tener los 6 datos.

OBJETIVO: capturar los 6 datos, mostrar resumen, esperar afirmación del cliente.`;

export const whatsappBotBrain = async (req: Request, res: Response) => {
  try {
    const normalizedHistory = getHistoryText(req.body?.history);
    const rawMessage = String(req.body?.rawMessage || getLatestUserMessage(req.body?.history) || '').trim();
    const phone = String(req.body?.phone || '').replace(/[^0-9+]/g, '');
    const history = normalizedHistory;
    const historyMessages = parseHistoryMessages(req.body?.history);

    logBotDebugBlock('🧠 [brain] incoming', {
      bodyKeys: Object.keys(req.body || {}),
      phone,
      rawMessage,
      historyMessages: historyMessages.length,
      historyPreview: history.slice(-1500),
      rawBody: req.body || {},
    });

    // Router endpoint: JSON only. It never writes customer-facing copy.
    const geminiResult = await callGeminiBrain(rawMessage, history, phone);
    const enforcedGeminiResult = geminiResult ? enforceCheckoutRequirements(geminiResult, history, rawMessage) : null;
    logBotDebugBlock('✨ [brain] geminiResult', geminiResult);
    logBotDebugBlock('🛡️ [brain] enforcedGeminiResult', enforcedGeminiResult);

    if (enforcedGeminiResult) {
      const responsePayload = routeFromBrainResult(enforcedGeminiResult, phone, 'gemini');
      if (responsePayload.route === 'checkout' || responsePayload.route === 'transfer') {
        await storeCheckoutContext(phone, (responsePayload.checkoutPayload || responsePayload.transferPayload) as Record<string, any>);
      }
      logBotDebugBlock('🚀 [brain] response', responsePayload);
      res.status(HttpStatusCode.Ok).send(responsePayload);
      return;
    }

    const heuristicPayload = routeFromBrainResult(
      enforceCheckoutRequirements(buildHeuristicDecision(rawMessage, history), history, rawMessage),
      phone,
      'heuristic'
    );
    if (heuristicPayload.route === 'checkout' || heuristicPayload.route === 'transfer') {
      await storeCheckoutContext(phone, (heuristicPayload.checkoutPayload || heuristicPayload.transferPayload) as Record<string, any>);
    }
    logBotDebugBlock('🪄 [brain] heuristicResponse', heuristicPayload);
    res.status(HttpStatusCode.Ok).send(heuristicPayload);
  } catch (error: any) {
    console.error('[brain] error:', error?.message || error);
    const fallbackPayload = {
      success: true,
      route: 'conversation',
      flow: 'conversation',
      nextFlow: 'conversation',
      intent: 'chat',
      readyToCheckout: false,
      shouldRedirect: false,
      missingData: [],
      targetEndpoint: '/api/orders/whatsapp-bot/assistant',
      data: {},
      source: 'heuristic',
    };
    logBotDebugBlock('🆘 [brain] fallbackResponse', fallbackPayload);
    res.status(HttpStatusCode.Ok).send(fallbackPayload);
  }
};

export const whatsappBotAssistant = async (req: Request, res: Response) => {
  try {

    console.log('history: ', req.body.history)
    const normalizedHistory = getHistoryText(req.body?.history);
    const rawMessage = String(req.body?.rawMessage || getLatestUserMessage(req.body?.history) || '').trim();
    const phone = String(req.body?.phone || '').replace(/[^0-9+]/g, '');
    const history = normalizedHistory;

    console.log('[assistant] historyMessages:', parseHistoryMessages(req.body?.history).length, 'rawMessagePresent:', Boolean(rawMessage), 'bodyKeys:', Object.keys(req.body || {}));

    const geminiResult = await callGeminiBrain(rawMessage, history, phone);
    const enforcedGeminiResult = geminiResult ? enforceCheckoutRequirements(geminiResult, history, rawMessage) : null;
    if (enforcedGeminiResult?.intent === 'catalog') {
      res.status(HttpStatusCode.Ok).send({ success: true, message: await buildCatalogText(), _intent: 'catalog' });
      return;
    }
    if (enforcedGeminiResult?.intent === 'shipping') {
      res.status(HttpStatusCode.Ok).send({ success: true, message: await buildShippingText(), _intent: 'shipping' });
      return;
    }
    if (enforcedGeminiResult?.readyToCheckout) {
      res.status(HttpStatusCode.Ok).send({
        success: true,
        message: enforcedGeminiResult.data?.paymentMethod === 'transfer'
          ? buildTransferReadyMessage(enforcedGeminiResult.data)
          : '☕💛 Ya tengo todo listo. Te paso al pago seguro para generar tu link.',
        _intent: enforcedGeminiResult.data?.paymentMethod === 'transfer' ? 'transfer_ready' : 'checkout_ready',
      });
      return;
    }
    if (enforcedGeminiResult?.reply && enforcedGeminiResult.reply.trim()) {
      res.status(HttpStatusCode.Ok).send({ success: true, message: enforcedGeminiResult.reply, _intent: enforcedGeminiResult.intent, missingData: enforcedGeminiResult.missingData || [] });
      return;
    }

    const heuristic = detectIntent(rawMessage, history);
    if (heuristic === 'catalog') {
      res.status(HttpStatusCode.Ok).send({ success: true, message: await buildCatalogText(), _intent: 'catalog_heuristic' });
      return;
    }
    if (heuristic === 'shipping') {
      res.status(HttpStatusCode.Ok).send({ success: true, message: await buildShippingText(), _intent: 'shipping_heuristic' });
      return;
    }
    if (heuristic === 'search_order') {
      res.status(HttpStatusCode.Ok).send({
        success: true,
        message: '☕💛 Claro, dime tu *número de teléfono* o *correo electrónico* para consultar tu pedido.',
        _intent: 'search_order_heuristic',
      });
      return;
    }

    const lower = rawMessage.toLowerCase();
    let fallback = '☕💛 Cuéntame más — ¿quieres ver el *catálogo*, los *costos de envío*, o ya tienes claro qué taza quieres?';
    if (/^(hola|buenas|hey|hi|holi)/i.test(lower)) {
      fallback = '¡Hola! ☕💛 Soy *Sorbi* de Sorbito de Verdad.\n\n¿Te muestro las tacitas? Solo escribe *"ver catálogo"* ✨';
    } else if (/gracias|listo/i.test(lower)) {
      fallback = '¡De nada! ☕💛 ¿Algo más en lo que te pueda ayudar?';
    }
    res.status(HttpStatusCode.Ok).send({ success: true, message: fallback, _intent: 'chat_fallback' });
  } catch (error: any) {
    console.error('[assistant] error:', error?.message || error);
    res.status(HttpStatusCode.Ok).send({
      success: false,
      message: '☕💛 Disculpa, tuve un pequeño problema. ¿Puedes intentar de nuevo?'
    });
  }
};

// ── WhatsApp Bot — Catalog endpoint ───────────────────────────────────────
export const whatsappBotCatalog = async (req: Request, res: Response) => {
  try {
    const products = await Product.find({ isActive: true }).sort({ price: 1 });
    if (!products.length) {
      res.status(HttpStatusCode.Ok).send({ success: true, message: '🚧 Estamos reponiendo stock. Vuelve en un momento ☕' });
      return;
    }
    // Icon mapping by product name keywords
    const iconFor = (name: string) => {
      const n = name.toLowerCase();
      if (n.includes('boscán') || n.includes('boscan')) return '👨‍💼';
      if (n.includes('moni')) return '👩‍🦰';
      if (n.includes('logo color')) return '🎨';
      if (n.includes('logo invisible')) return '🪄';
      if (n.includes('colecci')) return '🎁';
      return '☕';
    };
    const lines = products.map((p, i) => {
      const sizes = Array.isArray((p as any).sizes) ? (p as any).sizes : [];
      let sizesText = '';
      if (sizes.length) {
        const sizeParts = sizes.map((s: any) => {
          const name = s.name || s;
          const price = s.price ?? p.price;
          const sizeIcon = /xxl/i.test(name) ? '🍺' : '☕';
          return `${sizeIcon} ${name} $${price}`;
        });
        sizesText = `\n   ${sizeParts.join('  •  ')}`;
      } else {
        sizesText = ` — $${p.price}`;
      }
      return `${i + 1}. ${iconFor(p.name)} *${p.name}*${sizesText}`;
    });
    const message =
      '☕💛 *Catálogo Sorbito de Verdad*\n' +
      '━━━━━━━━━━━━━━━━━━━━━\n\n' +
      lines.join('\n\n') +
      '\n\n━━━━━━━━━━━━━━━━━━━━━\n' +
      '✨ Dime cuál(es) quieres y en qué tamaño y armamos tu pedido 🚀';
    res.status(HttpStatusCode.Ok).send({ success: true, message });
  } catch (error: any) {
    console.error('[whatsappBotCatalog] error:', error?.message || error);
    res.status(HttpStatusCode.Ok).send({ success: false, message: '❌ No pude cargar el catálogo. Intenta de nuevo en un momento.' });
  }
};

// ── WhatsApp Bot — Shipping zones endpoint ────────────────────────────────
export const whatsappBotShippingInfo = async (req: Request, res: Response) => {
  try {
    const city = String(req.body?.city || req.query?.city || '').trim();
    const country = String(req.body?.country || req.query?.country || '').trim();
    if (city || country) {
      const quote = await resolveShippingQuote(city, country);
      res.status(HttpStatusCode.Ok).send({
        success: true,
        city,
        country,
        shipping: quote.shipping,
        shippingZoneName: quote.shippingZoneName,
        estimatedDays: quote.estimatedDays,
        feeLabel: quote.feeLabel,
        message: quote.shipping === 0
          ? `Para ${city || country}, no se suma fee de courier.`
          : `Para ${city || country}, se suma ${quote.feeLabel.toLowerCase()}.`,
      });
      return;
    }

    const zones = await ShippingZone.find({ isActive: true }).sort({ price: 1 });
    if (!zones.length) {
      res.status(HttpStatusCode.Ok).send({ success: true, message: 'Consulta el costo de envío con un asesor.' });
      return;
    }
    const iconForZone = (name: string) => {
      const n = name.toLowerCase();
      if (n.includes('ecuador')) return '🇪🇨';
      if (n.includes('estados') || n.includes('canad')) return '🇺🇸';
      if (n.includes('europa')) return '🇪🇺';
      return '🌍';
    };
    const lines = zones.map(z => {
      const priceLabel = z.price === 0 ? '🆓 *GRATIS*' : `💵 *$${z.price}*`;
      const countries = (z as any).countries?.slice(0, 3).join(', ') || '';
      const days = (z as any).estimatedDays || '';
      return `${iconForZone(z.name)} *${z.name}*\n   ${priceLabel}${days ? `  •  ⏱️ ${days}` : ''}\n   📍 ${countries}`;
    });
    const message =
      '📦💛 *Costos de envío*\n' +
      '━━━━━━━━━━━━━━━━━━━━━\n\n' +
      lines.join('\n\n') +
      '\n\n━━━━━━━━━━━━━━━━━━━━━\n' +
      '✨ Dime de qué país/ciudad escribes y confirmamos tu envío ☕';
    res.status(HttpStatusCode.Ok).send({ success: true, message });
  } catch (error: any) {
    console.error('[whatsappBotShippingInfo] error:', error?.message || error);
    res.status(HttpStatusCode.Ok).send({ success: false, message: '❌ No pude cargar zonas de envío.' });
  }
};

export const whatsappBotCartUpdate = async (req: Request, res: Response) => {
  try {
    const phone = String(req.body?.phone || '').replace(/[^0-9+]/g, '');
    const message = String(req.body?.message || '');
    if (!phone) {
      res.status(HttpStatusCode.Ok).send({ success: false });
      return;
    }
    const extracted = extractFromMessage(message);
    const existing = await TempCart.findOne({ phone });
    const merged: any = { ...(existing?.data || {}), ...extracted };
    if (merged.productSubtotal !== undefined) {
      merged.total = (merged.productSubtotal || 0) + (merged.shippingCost || 0);
    }
    await TempCart.findOneAndUpdate(
      { phone },
      { $set: { phone, data: merged } },
      { upsert: true, new: true }
    );
    res.status(HttpStatusCode.Ok).send({ success: true });
  } catch (error: any) {
    console.error('[cartUpdate] error:', error?.message || error);
    res.status(HttpStatusCode.Ok).send({ success: false });
  }
};

export const whatsappBotTransfer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body: any = req.body || {};
    const {
      customerEmail,
      customerName,
      phone,
      items,
      address,
      city,
      country,
      notes,
      identificationNumber,
      shippingZoneName,
      shipping: bodyShipping,
      mapsUrl,
    } = body;

    const missing: string[] = [];
    if (!customerEmail) missing.push('correo');
    if (!customerName) missing.push('nombre');
    if (!phone) missing.push('teléfono');
    if (!identificationNumber) missing.push('cédula');
    if (!items || !Array.isArray(items) || !items.length) missing.push('productos');
    if (!address) missing.push('dirección');
    if (!city) missing.push('ciudad');
    if (!country) missing.push('país');
    if (!mapsUrl) missing.push('ubicación Google Maps');
    if (missing.length) {
      const labels: Record<string, string> = {
        nombre: '🙋 tu *nombre completo*',
        correo: '📧 tu *correo electrónico*',
        teléfono: '📱 tu *celular o teléfono*',
        cédula: '🪪 tu *cédula o RUC*',
        dirección: '🏠 tu *dirección completa*',
        ciudad: '🌆 tu *ciudad*',
        país: '🌍 tu *país*',
        productos: '☕ qué *producto(s)* quieres',
        'ubicación Google Maps': '📍 tu *ubicación de Google Maps*',
      };
      const itemsText = missing.map((item) => `• ${labels[item] || item}`).join('\n');
      const friendlyMsg =
        `☕💛 ¡Ya casi lo tenemos! Antes de enviarte el pago me falta confirmar:\n\n` +
        `${itemsText}\n\n` +
        `Envíamelo por aquí y con gusto seguimos enseguida ✨`;
      res.status(HttpStatusCode.Ok).send({ success: false, message: friendlyMsg, missingData: missing });
      return;
    }

    let user = await User.findOne({ email: String(customerEmail).toLowerCase() });
    let isNewGuest = false;
    let tempPassword: string | undefined;
    if (!user) {
      isNewGuest = true;
      tempPassword =
        Math.random().toString(36).slice(-6) + Math.random().toString(36).slice(-4).toUpperCase() + '!';
      user = await User.create({
        name: customerName || String(customerEmail).split('@')[0],
        email: String(customerEmail).toLowerCase(),
        password: tempPassword,
        role: 'customer',
      });
    }

    const activeProducts = await Product.find({ isActive: true });
    const fallbackProduct = activeProducts[0];
    if (!fallbackProduct) {
      res.status(HttpStatusCode.Ok).send({ success: false, message: '❌ No hay productos activos en catálogo.' });
      return;
    }

    function findProductByName(rawName: string) {
      const n = rawName.toLowerCase();
      const tokens = ['boscan', 'boscán', 'moni', 'logo color', 'logo invisible', 'logo', 'coleccion', 'colección', 'completa'];
      const matched = tokens.find(t => n.includes(t));
      if (!matched) return fallbackProduct;
      const found = activeProducts.find(p => {
        const pn = (p.name || '').toLowerCase();
        if (matched.includes('boscan') || matched.includes('boscán')) return pn.includes('boscán') || pn.includes('boscan');
        if (matched === 'moni') return pn.includes('moni');
        if (matched === 'logo color') return pn.includes('logo color');
        if (matched === 'logo invisible') return pn.includes('logo invisible');
        if (matched.includes('coleccion') || matched.includes('colección') || matched === 'completa') return pn.includes('colección') || pn.includes('coleccion');
        if (matched === 'logo') return pn.includes('logo');
        return false;
      });
      return found || fallbackProduct;
    }

    let subtotal = 0;
    const resolvedItems: any[] = [];
    for (const item of items) {
      const qty = Number(item.quantity) || 1;
      const product = item.product ? await Product.findById(item.product) : findProductByName(String(item.name || ''));
      if (!product || !product.isActive) {
        res.status(HttpStatusCode.BadRequest).send({ success: false, message: `Producto no disponible: ${item.product || item.name}` });
        return;
      }
      const price = Number(item.price) > 0 ? Number(item.price) : product.price;
      subtotal += price * qty;
      resolvedItems.push({
        product: product._id,
        name: item.name || product.name,
        image: product.mainImage || '',
        quantity: qty,
        price,
        ...(item.sizeName && { sizeName: item.sizeName }),
      });
      await Product.findByIdAndUpdate(product._id, { $inc: { stock: -qty } });
    }

    const shippingQuote = bodyShipping !== undefined
      ? { shipping: Number(bodyShipping), shippingZoneName: shippingZoneName || country || 'Por confirmar', feeLabel: Number(bodyShipping) > 0 ? `Fee de courier: $${Number(bodyShipping)}` : 'Sin fee de courier', estimatedDays: '' }
      : await resolveShippingQuote(city, country);
    const shippingCost = Number(shippingQuote.shipping) || 0;
    const total = subtotal + shippingCost;

    const order = await Order.create({
      user: user._id,
      items: resolvedItems,
      subtotal,
      shipping: shippingCost,
      tax: 0,
      total,
      shippingAddress: {
        name: customerName || user.name,
        phone,
        street: address,
        city,
        country,
        mapsUrl,
      },
      paymentMethod: 'transfer',
      paymentStatus: 'pending',
      ...(notes && { notes }),
      ...(identificationNumber && { identificationNumber }),
      ...(shippingZoneName || shippingQuote.shippingZoneName ? { shippingZoneName: shippingZoneName || shippingQuote.shippingZoneName } : {}),
      source: 'whatsapp_bot',
      whatsappPhone: phone,
      ...(isNewGuest && tempPassword && { guestTempPassword: tempPassword }),
      transferVerification: {
        status: 'pending_review',
        summary: 'Pendiente de comprobante de transferencia',
      },
    });

    res.status(HttpStatusCode.Created).send({
      success: true,
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      total,
      message: `${buildTransferInstructionsMessage(order.orderNumber, total)}\n\n${shippingQuote.feeLabel}.`,
      transferInstructions: {
        region: 'Ecuador continental',
        bank: 'Produbanco',
        accountType: 'Cta. Cte.',
        accountNumber: '27059016030',
        accountHolder: 'Casa de Papel SAS',
        ruc: '0993385430001',
      },
      courierFee: shippingCost,
      courierFeeLabel: shippingQuote.feeLabel,
    });
  } catch (error) {
    next(error as any);
  }
};

export const whatsappBotTransferReceipt = async (req: Request, res: Response) => {
  try {
    console.log('req.body: ', req.body)
    const input = req.method === 'GET' ? req.query : req.body;
    const raw = input || {};

    console.log('[whatsappBotTransferReceipt] ALL input keys:', Object.keys(raw));
    console.log('[whatsappBotTransferReceipt] raw input:', JSON.stringify(raw).slice(0, 500));

    // Aceptar múltiples nombres de campo para la imagen
    const urlTempFile = String(
      (raw as any).urlTempFile
      || (raw as any).tempFile
      || (raw as any).fileUrl
      || (raw as any).imageUrl
      || (raw as any).mediaUrl
      || (raw as any).url
      || (raw as any).data?.urlTempFile
      || (raw as any).data?.url
      || (raw as any).data?.imageUrl
      || (raw as any).data?.mediaUrl
      || ''
    ).trim();

    let phone = String(
      (raw as any).phone
      || (raw as any).whatsappPhone
      || (raw as any).telefono
      || (raw as any).data?.phone
      || ''
    ).replace(/[^0-9+]/g, '');

    const orderId = String(
      (raw as any).orderId
      || (raw as any).order_id
      || (raw as any).id
      || (raw as any).data?.orderId
      || ''
    );

    const aiImage = (raw as any).aiImage || (raw as any).data?.aiImage || undefined;

    // ── Extract from history (conversation context) ──────────────────────────
    // IMPORTANT: only use USER messages for extraction, NOT assistant messages
    // (assistant messages contain AI image analysis with irrelevant phone numbers)
    let userMessagesText = '';
    let extractedFromHistory: { phone?: string; email?: string } = {};
    let extractedFromHistoryFull = '';
    let orderNumberFromHistory = '';

    if ((raw as any).history || (raw as any).conversation || (raw as any).messages) {
      const messages = parseHistoryMessages(
        (raw as any).history || (raw as any).conversation || (raw as any).messages
      );
      const userParts = messages
        .filter(m => m.role === 'user')
        .map(m => m.content)
        .filter(Boolean);
      userMessagesText = userParts.join('\n').slice(-12000);
      extractedFromHistory = extractPhoneOrEmail(userMessagesText);
      extractedFromHistoryFull = getCheckoutHistoryText(raw as Record<string, any>);

      // Try to extract order number (SDV-XXXXXXX) from the FULL conversation
      const orderNumMatch = extractedFromHistoryFull.match(/\b(SDV-[A-Z0-9]+)\b/i);
      if (orderNumMatch) orderNumberFromHistory = orderNumMatch[1].toUpperCase();

      console.log('[whatsappBotTransferReceipt] history extracted:', {
        userMessagesLength: userMessagesText.length,
        extractedFromHistory,
        orderNumberFromHistory: orderNumberFromHistory || null,
      });
    }

    // ── Use history-extracted data as fallback ────────────────────────────────
    if (!phone && extractedFromHistory.phone) {
      phone = normalizeWhatsappPhone(extractedFromHistory.phone);
    }

    console.log('[whatsappBotTransferReceipt] extracted:', {
      orderId: orderId || null,
      urlTempFile: urlTempFile ? `${urlTempFile.slice(0, 80)}...` : null,
      phone: phone || null,
      aiImage: aiImage ? `${String(aiImage).slice(0, 150)}...` : null,
      hasHistory: Boolean(userMessagesText),
    });

    if (!urlTempFile) {
      res.status(HttpStatusCode.Ok).send({
        success: false,
        message: req.method === 'GET'
          ? '📸 Este endpoint recibe el comprobante por POST. Envíame urlTempFile y, si puedes, también phone u orderId para revisar tu transferencia.'
          : '📸 Todavía no recibo la imagen del comprobante. Envíamela por favor y con gusto revisamos tu transferencia 🙌',
      });
      return;
    }

    // ── Order search: orderId > orderNumber > email > phone ───────────────────
    let order = orderId ? await Order.findById(orderId) : null;
    if (!order && orderNumberFromHistory) {
      order = await Order.findOne({ orderNumber: orderNumberFromHistory, paymentMethod: 'transfer' }).sort({ createdAt: -1 });
      console.log('[whatsappBotTransferReceipt] search by orderNumber:', orderNumberFromHistory, order ? 'found' : 'not found');
    }
    if (!order && extractedFromHistory.email) {
      const userByEmail = await User.findOne({ email: extractedFromHistory.email });
      if (userByEmail) {
        order = await Order.findOne({ user: userByEmail._id, paymentMethod: 'transfer', paymentStatus: 'pending' }).sort({ createdAt: -1 });
        console.log('[whatsappBotTransferReceipt] search by email:', extractedFromHistory.email, order ? 'found' : 'not found');
        // Also try any status (not just pending) — receipt might arrive after timeout
        if (!order) {
          order = await Order.findOne({ user: userByEmail._id, paymentMethod: 'transfer' }).sort({ createdAt: -1 });
          console.log('[whatsappBotTransferReceipt] search by email (any status):', extractedFromHistory.email, order ? 'found' : 'not found');
        }
      } else {
        // User might not exist yet — try to find order by email in shippingAddress
        order = await Order.findOne({ 'shippingAddress.name': { $regex: extractedFromHistory.email.split('@')[0], $options: 'i' }, paymentMethod: 'transfer' }).sort({ createdAt: -1 });
      }
    }
    if (!order && phone) {
      const normalized = normalizeWhatsappPhone(String(phone));
      order = await Order.findOne({
        paymentMethod: 'transfer',
        paymentStatus: 'pending',
        $or: [
          { whatsappPhone: normalized },
          { whatsappPhone: String(phone) },
          { 'shippingAddress.phone': normalized },
          { 'shippingAddress.phone': String(phone) },
        ],
      }).sort({ createdAt: -1 });
    }
    // ── Last resort: search by customer name from history ─────────────────────
    if (!order && userMessagesText) {
      const fromMsg = extractFromMessage(userMessagesText);
      if (fromMsg.customerName) {
        order = await Order.findOne({ 'shippingAddress.name': { $regex: fromMsg.customerName, $options: 'i' }, paymentMethod: 'transfer' }).sort({ createdAt: -1 });
        console.log('[whatsappBotTransferReceipt] search by name:', fromMsg.customerName, order ? 'found' : 'not found');
      }
    }
    // ── Auto-crear orden si no existe ─────────────────────────────────────────
    if (!order) {
      console.log('[whatsappBotTransferReceipt] orden no encontrada — intentando crear desde los datos disponibles');

      // ── Extraer datos del historial (solo mensajes de usuario) ──────────────
      let historyName = '';
      let historyEmail = '';
      let historyAddress = '';
      let historyCity = '';
      let historyCountry = '';
      let historyProducts = '';
      let historyIdentification = '';
      if (userMessagesText) {
        const extracted = extractFromMessage(userMessagesText);
        historyName = extracted.customerName || '';
        historyEmail = extracted.customerEmail || '';
        historyAddress = extracted.address || '';
        historyCity = extracted.city || '';
        historyCountry = extracted.country || '';
        historyProducts = extracted.productDescription || '';
        historyIdentification = extracted.identificationNumber || '';
        console.log('[whatsappBotTransferReceipt] extracted from history:', { historyName, historyEmail, historyProducts });
      }

      // Intentar recuperar datos desde TempCart (conversación guardada por el brain)
      let tempCartData: Record<string, any> = {};
      if (phone) {
        const cart = await TempCart.findOne({ phone });
        if (cart?.data) {
          tempCartData = cart.data as Record<string, any>;
          console.log('[whatsappBotTransferReceipt] datos recuperados de TempCart:', JSON.stringify(tempCartData).slice(0, 500));
        }
      }

      const customerName = String(
        (raw as any).customerName || (raw as any).name
        || (raw as any).data?.customerName || (raw as any).data?.name
        || tempCartData.customerName || tempCartData.name
        || historyName
        || ''
      ).trim();
      const customerEmail = String(
        (raw as any).customerEmail || (raw as any).email
        || (raw as any).data?.customerEmail || (raw as any).data?.email
        || tempCartData.customerEmail || tempCartData.email
        || historyEmail
        || ''
      ).toLowerCase().trim();
      const identificationNumber = String(
        (raw as any).identificationNumber || (raw as any).cedula || (raw as any).id
        || (raw as any).data?.identificationNumber
        || tempCartData.identificationNumber || tempCartData.id
        || historyIdentification
        || ''
      );
      const address = String(
        (raw as any).address || (raw as any).direccion
        || (raw as any).data?.address
        || tempCartData.address
        || historyAddress
        || ''
      );
      const city = String(
        (raw as any).city || (raw as any).ciudad
        || (raw as any).data?.city
        || tempCartData.city
        || historyCity
        || ''
      );
      const country = String(
        (raw as any).country || (raw as any).pais
        || (raw as any).data?.country
        || tempCartData.country
        || historyCountry
        || ''
      );
      const productDescription = String(
        tempCartData.productDescription || tempCartData.items?.[0]?.name
        || historyProducts
        || ''
      );
      const productSubtotal = Number(tempCartData.productSubtotal || 0);
      const productsCount = Number(tempCartData.productsCount || 1);

      const itemsRaw = (
        (raw as any).items
        || (raw as any).data?.items
        || (raw as any).checkoutPayload?.items
        || (raw as any).transferPayload?.items
        || (productDescription ? [{ name: productDescription, price: productSubtotal || 25, quantity: productsCount }] : [])
      );

      const shippingVal = Number(
        (raw as any).shipping || (raw as any).data?.shipping
        || tempCartData.shippingCost || 0
      );
      const shippingZoneName = String(
        (raw as any).shippingZoneName || (raw as any).data?.shippingZoneName
        || tempCartData.shippingZoneName || country || ''
      );
      const mapsUrl = String(
        (raw as any).mapsUrl || (raw as any).data?.mapsUrl
        || tempCartData.mapsUrl || ''
      );

      if (!customerEmail || !customerName || !Array.isArray(itemsRaw) || !itemsRaw.length) {
        console.log('[whatsappBotTransferReceipt] datos insuficientes:', { customerName, customerEmail, itemsCount: Array.isArray(itemsRaw) ? itemsRaw.length : 'no-array', tieneTempCart: Object.keys(tempCartData).length > 0 });
        res.status(HttpStatusCode.Ok).send({
          success: false,
          message: '🔍 No pude encontrar una orden pendiente de transferencia asociada a este comprobante. No te preocupes, un asesor pronto te ayudará a confirmarla 💛',
        });
        return;
      }

      // Crear o buscar usuario
      let user = await User.findOne({ email: customerEmail });
      if (!user) {
        const tempPassword = Math.random().toString(36).slice(-6) + Math.random().toString(36).slice(-4).toUpperCase() + '!';
        user = await User.create({
          name: customerName,
          email: customerEmail,
          password: tempPassword,
          role: 'customer',
        });
      }

      // Resolver productos
      const activeProducts = await Product.find({ isActive: true });
      const fallback = activeProducts[0];
      const resolvedItems: any[] = [];
      let subtotal = 0;

      for (const item of (Array.isArray(itemsRaw) ? itemsRaw : [])) {
        const qty = Number(item.quantity) || 1;
        let product: any = null;
        if (item.product) {
          product = await Product.findById(item.product);
        } else if (activeProducts.length) {
          const pn = String(item.name || '').toLowerCase();
          product = activeProducts.find(p => pn.includes(p.name.toLowerCase())) || fallback;
        }
        if (!product) continue;
        const price = Number(item.price) > 0 ? Number(item.price) : product.price;
        subtotal += price * qty;
        resolvedItems.push({
          product: product._id,
          name: item.name || product.name,
          image: product.mainImage || '',
          quantity: qty,
          price,
          ...(item.sizeName && { sizeName: item.sizeName }),
        });
      }

      if (!resolvedItems.length) {
        console.log('[whatsappBotTransferReceipt] no se pudieron resolver productos');
        res.status(HttpStatusCode.Ok).send({
          success: false,
          message: '☕ No pude procesar los productos de tu orden. Un asesor te ayudará a confirmarla con gusto 💛',
        });
        return;
      }

      order = await Order.create({
        user: user._id,
        items: resolvedItems,
        subtotal,
        shipping: shippingVal,
        tax: 0,
        total: subtotal + shippingVal,
        shippingAddress: {
          name: customerName,
          phone: phone || '',
          street: address,
          city: city || 'Por confirmar',
          country: country || 'Por confirmar',
          ...(mapsUrl && { mapsUrl }),
        },
        paymentMethod: 'transfer',
        paymentStatus: 'pending',
        source: 'whatsapp_bot',
        whatsappPhone: phone || '',
        ...(identificationNumber && { identificationNumber }),
        transferVerification: {
          status: 'pending_review',
          summary: 'Pendiente de comprobante de transferencia',
        },
      });

      console.log('[whatsappBotTransferReceipt] orden auto-creada:', {
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        total: order.total,
      });
    }

    const upload = await cloudinaryService.uploadFromUrl(String(urlTempFile), 'sorbito-de-verdad/payment-receipts');
    let analysis: any = null;
    try {
      analysis = await callGeminiReceiptAnalysis(upload.secure_url, order, aiImage as string | undefined);
    } catch (geminiError: any) {
      console.error('[whatsappBotTransferReceipt] Gemini analysis crashed:', geminiError?.message || geminiError);
    }
    if (!analysis) {
      analysis = { isTransferReceipt: true, amountMatches: false, destinationMatches: false, imageLooksValid: false, summary: '⚠️ Error al analizar comprobante. Queda pendiente de revisión manual.' };
    }
    const looksConsistent = Boolean(
      analysis.isTransferReceipt &&
      analysis.amountMatches &&
      analysis.destinationMatches &&
      analysis.imageLooksValid
    );

    order.paymentReceiptUrl = upload.secure_url;
    order.transferVerification = {
      status: looksConsistent ? 'validated' : 'mismatch',
      summary: analysis.summary || '',
      detectedAmount: analysis.detectedAmount,
      detectedDestination: analysis.detectedDestination,
      analyzedAt: new Date(),
    };
    if (looksConsistent) {
      order.paymentStatus = 'paid';
      order.status = 'confirmed';
    }
    await order.save();

    const message = looksConsistent
      ? `✅💛 ¡Gracias por enviar tu comprobante! La transferencia de tu pedido *${order.orderNumber}* quedó registrada y el pago fue confirmado 🎉 Ha sido un gusto atenderte ☕`
      : '📋💛 Gracias por enviarnos el comprobante. Detectamos una pequeña anomalía en el monto, la cuenta o la imagen, pero no te preocupes — un asesor revisará tu pedido pronto para confirmar la transferencia. Todo está seguro 🔒✨';

    if (order.whatsappPhone || order.shippingAddress?.phone) {
      bbcNotificationService.sendWhatsApp(order.whatsappPhone || order.shippingAddress.phone, message).catch((err) =>
        console.error('[whatsappBotTransferReceipt] sendWhatsApp error:', err)
      );
    }

    console.log('[whatsappBotTransferReceipt] resultado validación:', {
      orderNumber: order.orderNumber,
      looksConsistent,
      detectedAmount: analysis.detectedAmount,
      detectedDestination: analysis.detectedDestination,
      summary: analysis.summary,
      aiImage: aiImage ? `${String(aiImage).slice(0, 200)}...` : null,
    });

    res.status(HttpStatusCode.Ok).send({
      success: looksConsistent,
      orderNumber: order.orderNumber,
      receiptUrl: upload.secure_url,
      validation: {
        looksConsistent,
        amountMatches: analysis.amountMatches,
        destinationMatches: analysis.destinationMatches,
        imageLooksValid: analysis.imageLooksValid,
        detectedAmount: analysis.detectedAmount,
        detectedDestination: analysis.detectedDestination,
        detectedBank: analysis.detectedBank,
        detectedAccountHolder: analysis.detectedAccountHolder,
        summary: analysis.summary,
      },
      message,
    });
  } catch (error: any) {
    console.error('[whatsappBotTransferReceipt] error:', error?.response?.data || error?.message || error);
    res.status(HttpStatusCode.Ok).send({
      success: false,
      message: '🔍 No pude validar el comprobante en este momento, pero no te preocupes — un asesor revisará tu pedido pronto. ¡Gracias por tu paciencia! 💛🙌',
    });
  }
};

// ── WhatsApp Bot one-shot checkout: create order + payphone link ──────────
const FORMAT_HELP =
  '☕💛 Ups, parece que se me escapó algún dato de tu pedido.\n\n' +
  'Volvamos un pasito atrás — cuéntame de nuevo:\n' +
  '• Tu nombre completo 🙋\n' +
  '• Tu correo 📧\n' +
  '• Tu celular o teléfono 📱\n' +
  '• Tu cédula o RUC 🪪\n' +
  '• Tu dirección, ciudad y país 🏠\n' +
  '• Qué tacita(s) quieres ☕\n\n' +
  'Apenas tenga todo, te genero tu link de PayPhone al instante ✨';

function buildTransferReadyMessage(data: NonNullable<BrainResponse['data']>): string {
  const lines: string[] = [];
  lines.push('☕💛 Ya tengo todo listo para darte los datos de transferencia y continuar con tu pedido.\n');

  const hasProducts = Array.isArray(data.products) && data.products.length > 0;
  if (hasProducts) {
    lines.push('*🧾 Resumen de tu pedido:*');
    for (const p of data.products!) {
      const size = p.size ? ` (${p.size})` : '';
      lines.push(`• ${p.name}${size} x${p.qty} — *$${p.price.toFixed(2)}*`);
    }
    lines.push('');
  }

  if (typeof data.subtotal === 'number') {
    lines.push(`📦 Subtotal: *$${data.subtotal.toFixed(2)}*`);
  }
  if (typeof data.shipping === 'number' && data.shipping > 0) {
    lines.push(`🚚 Envío: *$${data.shipping.toFixed(2)}*`);
  }
  if (typeof data.total === 'number') {
    lines.push(`💰 *Total a transferir: $${data.total.toFixed(2)}*`);
  }

  lines.push('');
  lines.push('📋 *Datos para la transferencia:*');
  lines.push('🏦 *Produbanco* — Cta. Cte. *27059016030*');
  lines.push('👤 Titular: *Casa de Papel SAS* / RUC 0993385430001\n');
  lines.push('⚠️ Por favor, verifica bien el número de cuenta antes de transferir. Una vez realizado el pago, envíanos el comprobante para confirmar tu pedido.');

  return lines.join('\n');
}

const TRANSFER_BANK_TEXT =
  'Produbanco Cta. Cte. 27059016030\n' +
  'Titular: Casa de Papel SAS\n' +
  'RUC: 0993385430001';

function buildTransferInstructionsMessage(orderNumber: string, total: number) {
  return (
    `🤍 Gracias por elegir *transferencia bancaria*.\n\n` +
    `Tu pedido *${orderNumber}* queda por *$${total.toFixed(2)}* (IVA + envío incluidos).\n\n` +
    `*Ecuador continental*\n${TRANSFER_BANK_TEXT}\n\n` +
    `Cuando envíes la transferencia, mándame la imagen del comprobante y la revisaremos para continuar con tu pedido.`
  );
}

function normalizeWhatsappPhone(phone: string): string {
  let p = String(phone || '').replace(/[^0-9+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.length === 10 && p.startsWith('0')) p = '593' + p.slice(1);
  return p;
}

async function callGeminiReceiptAnalysis(imageUrl: string, order: any, aiImage?: string) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY env var is not set');

  const imageResp = await axios.get<ArrayBuffer>(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
  const mimeType = String(imageResp.headers['content-type'] || 'image/jpeg');
  const base64 = Buffer.from(imageResp.data).toString('base64');
  const model = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').replace(/^models\//, '');

  const aiContext = aiImage ? `\nEl sistema de mensajería ya pre-analizó la imagen y esto fue lo que detectó:\n${aiImage}\n\nUsa esto como referencia adicional, pero confirma visualmente cada dato mirando la imagen.\n` : '';

  const prompt = `Analiza este comprobante de transferencia bancaria y responde SOLO JSON.${aiContext}

Pedido esperado:
- orderNumber: ${order.orderNumber}
- total exacto esperado: ${order.total.toFixed(2)} USD
- cuenta destino exacta: 27059016030
- banco esperado: Produbanco
- titular esperado: Casa de Papel SAS
- ruc esperado: 0993385430001

Debes detectar:
1. si parece realmente un comprobante de transferencia
2. monto detectado
3. cuenta o destino detectado
4. banco detectado
5. titular detectado
6. si el monto coincide exactamente
7. si la cuenta destino coincide claramente
8. si hay señales de imagen borrosa, recortada o dudosa

Responde EXACTAMENTE:
{
  "isTransferReceipt": true,
  "amountMatches": true,
  "destinationMatches": true,
  "imageLooksValid": true,
  "detectedAmount": 54,
  "detectedDestination": "27059016030",
  "detectedBank": "Produbanco",
  "detectedAccountHolder": "Casa de Papel SAS",
  "summary": "explicación breve en español"
}`;

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2000,
      },
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 45000 }
  );

  const text = response.data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
  console.log('[callGeminiReceiptAnalysis] raw response:', text.slice(0, 800));

  // Helper: extraer JSON incluso si está envuelto en ```json ... ``` o truncado
  function extractJSON(raw: string): any {
    // Remove markdown code block markers if present
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    // Try strict parse first
    try { return JSON.parse(cleaned); } catch { }
    // Try finding a complete JSON object { ... }
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { }
    }
    // If truncated (no closing }), inject it and try
    if (cleaned.includes('{') && !cleaned.trim().endsWith('}')) {
      const withClosing = cleaned.substring(cleaned.indexOf('{'));
      try { return JSON.parse(withClosing + (withClosing.endsWith('}') ? '' : '}')); } catch { }
    }
    return null;
  }

  const parsed = extractJSON(text);
  if (!parsed) {
    console.error('[callGeminiReceiptAnalysis] Could not extract JSON for order:', order.orderNumber);
    return {
      isTransferReceipt: true,
      amountMatches: false,
      destinationMatches: false,
      imageLooksValid: false,
      summary: '🔍 No se pudo analizar automáticamente. Queda pendiente de revisión manual.',
    };
  }
  return parsed as {
    isTransferReceipt: boolean;
    amountMatches: boolean;
    destinationMatches: boolean;
    imageLooksValid: boolean;
    detectedAmount?: number;
    detectedDestination?: string;
    detectedBank?: string;
    detectedAccountHolder?: string;
    summary?: string;
  };
}

export const whatsappBotCheckout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.method === 'GET') {
      res.status(HttpStatusCode.Ok).send({
        success: false,
        message: '☕💛 Este paso recibe el pedido por *POST*. Envíame tus datos del pedido y con gusto te ayudo a generar el pago ✨',
      });
      return;
    }

    const rawBody = req.body || {};
    const isFromBot = !!rawBody.rawMessage || !!rawBody.history;
    let parsed =
      mapCheckoutPayloadToParsed(rawBody.checkoutPayload) ||
      mapCheckoutPayloadToParsed(rawBody.payload) ||
      mapCheckoutPayloadToParsed(rawBody.data ? {
        customerName: rawBody.data.name || [rawBody.data.firstName, rawBody.data.lastName].filter(Boolean).join(' '),
        customerEmail: rawBody.data.email,
        phone: rawBody.data.phone,
        identificationNumber: rawBody.data.id,
        address: rawBody.data.address,
        city: rawBody.data.city,
        country: rawBody.data.country,
        mapsUrl: rawBody.data.mapsUrl,
        shipping: rawBody.data.shipping,
        shippingZoneName: rawBody.data.country,
        items: Array.isArray(rawBody.data.products)
          ? rawBody.data.products.map((product: any) => ({
            name: `${product.qty || 1} ${product.name}${product.size ? ` ${product.size}` : ''}`,
            price: product.price || 0,
            quantity: 1,
          }))
          : [],
      } : null) ||
      (rawBody.rawMessage ? parseRawMessage(rawBody.rawMessage) : null);
    const checkoutHistoryText = getCheckoutHistoryText(rawBody);
    const checkoutLatestUserMessage = getCheckoutLatestUserMessage(rawBody);

    logBotDebugBlock('🧾 [checkout] incoming', {
      bodyKeys: Object.keys(rawBody || {}),
      isFromBot,
      rawMessage: rawBody.rawMessage || null,
      phone: rawBody.phone || null,
      hasCheckoutPayload: Boolean(rawBody.checkoutPayload),
      hasData: Boolean(rawBody.data),
      historyPreview: checkoutHistoryText.slice(-1500),
      rawBody,
    });

    if (!parsed) {
      const normalizedPhone = normalizeWhatsappPhone(String(rawBody.phone || ''));
      let recoveryCart = null;

      if (normalizedPhone) {
        recoveryCart = await TempCart.findOne({ phone: normalizedPhone });
      }

      if (!recoveryCart && !rawBody.rawMessage && !rawBody.history) {
        const recentCarts = await TempCart.find({
          updatedAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) },
        }).sort({ updatedAt: -1 }).limit(2);
        if (recentCarts.length) recoveryCart = recentCarts[0];
      }

      if (recoveryCart) {
        parsed = {
          customerName: recoveryCart.data?.customerName,
          customerEmail: recoveryCart.data?.customerEmail,
          phone: recoveryCart.data?.phone || recoveryCart.phone,
          identificationNumber: recoveryCart.data?.identificationNumber,
          address: recoveryCart.data?.address,
          city: recoveryCart.data?.city,
          country: recoveryCart.data?.country,
          mapsUrl: recoveryCart.data?.mapsUrl,
          items: recoveryCart.data?.productDescription
            ? [{
              name: recoveryCart.data.productDescription,
              price: recoveryCart.data.productSubtotal || 0,
              quantity: recoveryCart.data.productsCount || 1,
            }]
            : [],
          shipping: recoveryCart.data?.shippingCost || 0,
          shippingZoneName: recoveryCart.data?.country,
        };
        logBotDebugBlock('🛟 [checkout] recoveredFromTempCart', {
          requestedPhone: normalizedPhone || null,
          phone: recoveryCart.phone,
          updatedAt: recoveryCart.updatedAt,
          parsed,
        });
      }
    }

    // If isFromBot and no pipe data, ALWAYS try to extract from {{history}} (intent IA already routed here)
    if (isFromBot && !parsed) {
      const fullText = String(rawBody.rawMessage || checkoutLatestUserMessage || '');
      // Always enter — trust BBC intent has already determined this is checkout intent
      if (true) {
        const phone = String(rawBody.phone || '').replace(/[^0-9+]/g, '');
        const history = checkoutHistoryText;
        console.log('[checkout] userMsgs:', parseHistoryMessages(rawBody.history).length, 'totalLen:', history.length, 'rawBody keys:', Object.keys(rawBody));
        let extracted: any = {};
        if (history) {
          extracted = extractFromMessage(history);
        }
        let aiExtracted: any = {};
        if (history) {
          const aiBrain = await callGeminiBrain(fullText || checkoutLatestUserMessage || 'quiero pagar', history, phone);
          aiExtracted = mapBrainDataToCheckoutFields(aiBrain?.data);
          logBotDebugBlock('🤖 [checkout] aiBrain', aiBrain);
        }
        // Also try TempCart cache as backup
        const cart = phone ? await TempCart.findOne({ phone }) : null;
        // Always enter — even without cart/history we'll fallback to FAKE order
        if (true) {
          const d = (cart?.data as any) || {};
          // Merge: history extraction > cart > current message
          const extra = extractFromMessage(fullText);
          const merged = { ...d, ...extracted, ...aiExtracted, ...extra };
          if (extracted.customerName) merged.customerName = extracted.customerName;
          if (extracted.customerEmail) merged.customerEmail = extracted.customerEmail;
          if (extracted.phone) merged.phone = extracted.phone;
          if (extracted.identificationNumber) merged.identificationNumber = extracted.identificationNumber;
          if (extracted.address) merged.address = extracted.address;
          if (extracted.city) merged.city = extracted.city;
          if (extracted.country) merged.country = extracted.country;
          if (extracted.productDescription) {
            merged.productDescription = extracted.productDescription;
            merged.productsCount = extracted.productsCount;
            merged.productSubtotal = extracted.productSubtotal;
          }
          if (aiExtracted.customerName && !merged.customerName) merged.customerName = aiExtracted.customerName;
          if (aiExtracted.customerEmail && !merged.customerEmail) merged.customerEmail = aiExtracted.customerEmail;
          if (aiExtracted.phone && !merged.phone) merged.phone = aiExtracted.phone;
          if (aiExtracted.identificationNumber && !merged.identificationNumber) merged.identificationNumber = aiExtracted.identificationNumber;
          if (aiExtracted.address && !merged.address) merged.address = aiExtracted.address;
          if (aiExtracted.city && !merged.city) merged.city = aiExtracted.city;
          if (aiExtracted.country && !merged.country) merged.country = aiExtracted.country;
          if (aiExtracted.productDescription && !merged.productDescription) {
            merged.productDescription = aiExtracted.productDescription;
            merged.productsCount = aiExtracted.productsCount;
            merged.productSubtotal = aiExtracted.productSubtotal;
          }
          if (extracted.shippingCost !== undefined) merged.shippingCost = extracted.shippingCost;
          if (aiExtracted.shippingCost !== undefined && merged.shippingCost === undefined) merged.shippingCost = aiExtracted.shippingCost;
          if (merged.productSubtotal !== undefined) {
            merged.total = (merged.productSubtotal || 0) + (merged.shippingCost || 0);
          }
          logBotDebugBlock('🧩 [checkout] mergedData', merged);
          const missing: string[] = [];
          if (!merged.customerName) missing.push('nombre');
          if (!merged.customerEmail) missing.push('correo');
          if (!(merged.phone || phone)) missing.push('teléfono');
          if (!merged.identificationNumber) missing.push('cédula');
          if (!merged.address) missing.push('dirección');
          if (!merged.city) missing.push('ciudad');
          if (!merged.country) missing.push('país');
          if (!merged.productDescription) missing.push('productos');
          if (missing.length) {
            console.log('[checkout] missing data — asking client:', missing);
            const friendlyMsg = buildFriendlyCheckoutMissingMessage(missing, 'link');
            res.status(HttpStatusCode.Ok).send({ success: false, message: friendlyMsg, _missing: missing });
            return;
          } else {
            parsed = {
              customerName: merged.customerName,
              customerEmail: merged.customerEmail,
              phone: merged.phone || phone,
              identificationNumber: merged.identificationNumber,
              address: merged.address,
              city: merged.city,
              country: merged.country,
              items: [{ name: merged.productDescription, price: merged.productSubtotal, quantity: 1 }],
              shipping: merged.shippingCost || 0,
            };
            logBotDebugBlock('✅ [checkout] parsedFromHistory', parsed);
          }
        }
      }
    }

    if (isFromBot && !parsed) {
      res.status(HttpStatusCode.Ok).send({ success: false, message: FORMAT_HELP });
      return;
    }

    const body: any = parsed ? { ...rawBody, ...parsed } : rawBody;
    logBotDebugBlock('📦 [checkout] finalBody', body);
    if (parsed && rawBody.phone) {
      body.phone = parsed.phone || String(rawBody.phone).replace(/[^0-9+]/g, '');
    }
    const {
      customerEmail,
      customerName,
      phone,
      items,
      address,
      city,
      country,
      state,
      notes,
      identificationNumber,
      shippingZoneName,
      shipping: bodyShipping,
    } = body;

    const missing: string[] = [];
    if (!customerEmail) missing.push('correo');
    if (!customerName) missing.push('nombre');
    if (!phone) missing.push('teléfono');
    if (!identificationNumber) missing.push('cédula');
    if (!items || !Array.isArray(items) || !items.length) missing.push('productos');
    if (!address) missing.push('dirección');
    if (!city) missing.push('ciudad');
    if (!country) missing.push('país');
    if (missing.length) {
      const msg = buildFriendlyCheckoutMissingMessage(missing, 'link');
      res.status(HttpStatusCode.Ok).send({ success: false, message: msg, missingData: missing });
      return;
    }

    let user = await User.findOne({ email: String(customerEmail).toLowerCase() });
    let isNewGuest = false;
    let tempPassword: string | undefined;
    if (!user) {
      isNewGuest = true;
      tempPassword =
        Math.random().toString(36).slice(-6) + Math.random().toString(36).slice(-4).toUpperCase() + '!';
      user = await User.create({
        name: customerName || String(customerEmail).split('@')[0],
        email: String(customerEmail).toLowerCase(),
        password: tempPassword,
        role: 'customer',
      });
    }

    const activeProducts = await Product.find({ isActive: true });
    const fallbackProduct = activeProducts[0];
    if (!fallbackProduct) {
      res.status(HttpStatusCode.Ok).send({ success: false, message: '❌ No hay productos activos en catálogo.' });
      return;
    }

    function findProductByName(rawName: string) {
      const n = rawName.toLowerCase();
      const tokens = ['boscan', 'boscán', 'moni', 'logo color', 'logo invisible', 'logo', 'coleccion', 'colección', 'completa'];
      const matched = tokens.find(t => n.includes(t));
      if (!matched) return fallbackProduct;
      const found = activeProducts.find(p => {
        const pn = (p.name || '').toLowerCase();
        if (matched.includes('boscan') || matched.includes('boscán')) return pn.includes('boscán') || pn.includes('boscan');
        if (matched === 'moni') return pn.includes('moni');
        if (matched === 'logo color') return pn.includes('logo color');
        if (matched === 'logo invisible') return pn.includes('logo invisible');
        if (matched.includes('coleccion') || matched.includes('colección') || matched === 'completa') return pn.includes('colección') || pn.includes('coleccion');
        if (matched === 'logo') return pn.includes('logo');
        return false;
      });
      return found || fallbackProduct;
    }

    let subtotal = 0;
    const resolvedItems: any[] = [];
    for (const item of items) {
      const qty = Number(item.quantity) || 1;
      let product: any = null;
      if (item.product) {
        product = await Product.findById(item.product);
        if (!product || !product.isActive) {
          res.status(HttpStatusCode.BadRequest).send({ success: false, message: `Producto no disponible: ${item.product}` });
          return;
        }
      } else {
        product = findProductByName(String(item.name || ''));
      }
      const price = Number(item.price) > 0 ? Number(item.price) : product.price;
      subtotal += price * qty;
      resolvedItems.push({
        product: product._id,
        name: item.name || product.name,
        image: product.mainImage || '',
        quantity: qty,
        price,
        ...(item.sizeName && { sizeName: item.sizeName }),
      });
    }

    const shippingQuote = bodyShipping !== undefined
      ? { shipping: Number(bodyShipping), shippingZoneName: shippingZoneName || country || 'Por confirmar', feeLabel: Number(bodyShipping) > 0 ? `Fee de courier: $${Number(bodyShipping)}` : 'Sin fee de courier', estimatedDays: '' }
      : await resolveShippingQuote(city, country);
    const shippingCost = Number(shippingQuote.shipping) || 0;
    const total = subtotal + shippingCost;

    const order = await Order.create({
      user: user._id,
      items: resolvedItems,
      subtotal,
      shipping: shippingCost,
      tax: 0,
      total,
      shippingAddress: {
        name: customerName || user.name,
        phone,
        street: address,
        city,
        country,
        ...(state && { state }),
      },
      paymentMethod: 'payphone',
      ...(notes && { notes }),
      ...(identificationNumber && { identificationNumber }),
      ...(shippingZoneName || shippingQuote.shippingZoneName ? { shippingZoneName: shippingZoneName || shippingQuote.shippingZoneName } : {}),
      source: 'whatsapp_bot',
      whatsappPhone: phone,
      ...(isNewGuest && tempPassword && { guestTempPassword: tempPassword }),
    });

    const clientTransactionId = buildClientTransactionId(order.orderNumber);
    const amountCents = Math.round(total * 100);
    const taxCents = 0;
    const amountWithoutTaxCents = amountCents;

    const webhookBase = process.env.WEBHOOK_PUBLIC_BASE || '';
    const urlRedirect = webhookBase
      ? `${webhookBase}/api/webhook/payphone-link`
      : undefined;

    const { paymentLink, expiresAt } = await payphoneLinksService.createPaymentLink({
      amountCents,
      taxCents,
      amountWithoutTaxCents,
      reference: `Orden ${order.orderNumber}`,
      clientTransactionId,
      expireInHours: 24,
      urlRedirect,
      webhookUrl: urlRedirect,
    });

    order.payphoneLinkUrl = paymentLink;
    order.payphoneLinkExpiresAt = expiresAt;
    order.clientTransactionId = clientTransactionId;

    console.log('[whatsappBotCheckout] saving order with link:', JSON.stringify({
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      payphoneLinkUrl: paymentLink,
      clientTransactionId,
    }));
    await order.save();
    console.log('[whatsappBotCheckout] order saved OK');

    // Clean TempCart for this phone after successful order
    if (phone) {
      TempCart.deleteOne({ phone }).catch(() => { });
    }

    const message =
      `✅💛 *¡Tu pedido está listo!*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🧾 Pedido: ${order.orderNumber}\n` +
      `🚚 ${shippingQuote.feeLabel}\n` +
      `💰 Total: *$${total.toFixed(2)}*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `💳 *Paga aquí 👇*\n${paymentLink}\n\n` +
      `⏰ Link válido por 24h\n` +
      `📲 En cuanto confirmes el pago te aviso por aquí ☕✨`;

    const responsePayload = {
      success: true,
      message,
      paymentLink,
      orderNumber: order.orderNumber,
      orderId: String(order._id),
      total,
      expiresAt,
      debug: {
        source: order.source,
        whatsappPhone: order.whatsappPhone,
        clientTransactionId: order.clientTransactionId,
      },
    };

    console.log('[whatsappBotCheckout] sending response to BBC');
    res.status(HttpStatusCode.Ok).json(responsePayload);
  } catch (error: any) {
    console.error('[whatsappBotCheckout] error:', error?.stack || error?.message || error);
    const detail = error?.response?.data ? JSON.stringify(error.response.data).slice(0, 200) : (error?.message || 'unknown');
    res.status(HttpStatusCode.Ok).send({
      success: false,
      message: `❌ Hubo un problema procesando tu pedido. Detalle técnico: ${detail.slice(0, 200)}. Por favor intenta de nuevo o escribe AYUDA.`,
      _debug: detail,
    });
  }
};

// ── WhatsApp Bot — Search order by phone/email ──────────────────────────
function extractPhoneOrEmail(text: string): { phone?: string; email?: string } {
  const t = String(text || '').trim();
  const result: { phone?: string; email?: string } = {};

  // Email: busca el primer email en el texto
  const emailMatch = t.match(/([a-z0-9._+-]+@[a-z0-9-]+\.[a-z0-9.-]+)/i);
  if (emailMatch) result.email = emailMatch[1].toLowerCase();

  // Phone: +593, 09, 0 seguido de 9 dígitos, o 9 dígitos
  const phoneMatch = t.match(/(?:\+?593)?\s*0?\d{9,10}/);
  if (phoneMatch) {
    let p = phoneMatch[0].replace(/[^0-9+]/g, '');
    if (p.startsWith('+')) p = p.slice(1);
    if (p.length === 10 && p.startsWith('0')) p = '593' + p.slice(1);
    if (p.length >= 10) result.phone = p;
  }

  return result;
}

export const whatsappBotSearchOrder = async (req: Request, res: Response) => {
  try {
    const body = req.method === 'GET' ? req.query : req.body;
    const lastMessage = String(body?.lastMessage || body?.message || body?.rawMessage || body?.phone || body?.email || '').trim();

    // Extraer teléfono o email del texto libre
    const extracted = extractPhoneOrEmail(lastMessage);
    const phone = extracted.phone || '';
    const email = extracted.email || '';

    if (!phone && !email) {
      res.status(HttpStatusCode.Ok).send({
        success: false,
        message: '☕💛 Para consultar tu pedido necesito tu *correo electrónico*. ¿Cuál es tu correo?',
        missingData: ['correo electrónico'],
      });
      return;
    }

    let userQuery: any = {};
    let orderFilter: any = {};

    if (email) {
      const user = await User.findOne({ email });
      if (user) userQuery = { user: user._id };
    }

    if (phone) {
      orderFilter.$or = [
        { whatsappPhone: { $regex: phone.slice(-9) } },
        { 'shippingAddress.phone': { $regex: phone.slice(-9) } },
      ];
    }

    const finalFilter = Object.keys(userQuery).length || Object.keys(orderFilter).length
      ? { ...userQuery, ...orderFilter }
      : {};

    const orders = await Order.find(finalFilter)
      .sort({ createdAt: -1 })
      .limit(2)
      .populate('user', 'name email');

    if (!orders.length) {
      res.status(HttpStatusCode.Ok).send({
        success: false,
        message: `🔍 No encontré pedidos con esos datos. ¿Quizás con otro teléfono o correo?`,
      });
      return;
    }

    const orderLines = orders.map((o, i) => {
      const statusEmoji: Record<string, string> = {
        pending: '⏳',
        confirmed: '✅',
        processing: '🔄',
        shipped: '📦',
        delivered: '🎉',
        cancelled: '❌',
      };
      const paymentEmoji: Record<string, string> = {
        pending: '⏳',
        paid: '✅',
        failed: '❌',
        refunded: '💰',
      };
      return (
        `${i + 1}. *${o.orderNumber}*\n` +
        `   ${statusEmoji[o.status] || '❓'} Estado: ${o.status}\n` +
        `   ${paymentEmoji[o.paymentStatus] || '❓'} Pago: ${o.paymentStatus}\n` +
        `   💰 Total: $${o.total.toFixed(2)}\n` +
        `   📅 ${new Date(o.createdAt).toLocaleDateString('es-EC')}`
      );
    });

    const message =
      `📋 *Tus pedidos*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      orderLines.join('\n\n') +
      `\n\n━━━━━━━━━━━━━━━━━━━━━\n` +
      `💛 ¿Necesitas ayuda con algún pedido?`;

    res.status(HttpStatusCode.Ok).send({
      success: true,
      message,
      data: orders.map(o => ({
        orderNumber: o.orderNumber,
        status: o.status,
        paymentStatus: o.paymentStatus,
        total: o.total,
        createdAt: o.createdAt,
      })),
    });
  } catch (error: any) {
    console.error('[whatsappBotSearchOrder] error:', error?.message || error);
    res.status(HttpStatusCode.Ok).send({
      success: false,
      message: '❌ Tuve un problema buscando tus pedidos. Intenta de nuevo con tu teléfono o correo.',
    });
  }
};
