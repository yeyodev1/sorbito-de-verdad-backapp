import { HttpStatusCode } from 'axios';
import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { Order } from '../models/Order.model';
import { Product } from '../models/Product.model';
import { User } from '../models/User.model';
import { ShippingZone } from '../models/ShippingZone.model';
import { AuthRequest } from '../types/AuthRequest';
import { emailService } from '../services/email.service';
import { payphoneService } from '../services/payphone.service';
import { payphoneLinksService } from '../services/payphone-links.service';
import { bbcNotificationService } from '../services/bbc-notification.service';

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
      emailService.sendOrderConfirmation(buyer.email, buyer.name, String(order._id), total).catch(() => {});
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

    const { status, dateFrom, dateTo, sort = '-createdAt', limit = '200', search, source } = req.query as Record<string, string>;

    const query: Record<string, unknown> = {};

    if (status) query.status = status;
    if (source) query.source = source;

    if (dateFrom || dateTo) {
      const dateFilter: Record<string, Date> = {};
      // Frontend sends UTC ISO strings with proper TZ offset already applied
      if (dateFrom) dateFilter.$gte = new Date(dateFrom);
      if (dateTo)   dateFilter.$lte = new Date(dateTo);
      query.createdAt = dateFilter;
    }

    if (search) {
      const matchingUsers = await User.find({ name: { $regex: search, $options: 'i' } }).select('_id');
      const userIds = matchingUsers.map(u => u._id);
      (query as Record<string, unknown>).$or = [
        { identificationNumber: { $regex: search, $options: 'i' } },
        { 'shippingAddress.phone': { $regex: search, $options: 'i' } },
        { user: { $in: userIds } },
      ];
    }

    // Conteos reales por estado (siempre, sin importar el filtro activo)
    const allStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
    const [countResults, orders] = await Promise.all([
      Promise.all(allStatuses.map(s => Order.countDocuments({ status: s }))),
      Order.find(query).populate('user', 'name email').sort(sort).limit(parseInt(limit)),
    ]);

    const counts: Record<string, number> = {};
    allStatuses.forEach((s, i) => { counts[s] = countResults[i]; });
    const total = countResults.reduce((a, b) => a + b, 0);

    res.send({ success: true, data: orders, counts, total });
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
        ).catch(() => {});
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
        emailService.sendOrderConfirmation(buyer.email, buyer.name, String(order._id), order.total).catch(() => {});
        // Guest account credentials — only sent now (on confirmed payment)
        if (order.guestTempPassword) {
          emailService.sendGuestAccountCreated(buyer.email, buyer.name, order.guestTempPassword).catch(() => {});
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

    emailService.sendOrderConfirmation(user.email, user.name, String(order._id), total).catch(() => {});

    if (isNewGuest && tempPassword) {
      emailService.sendGuestAccountCreated(user.email, user.name, tempPassword).catch(() => {});
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

    const { paymentLink, expiresAt } = await payphoneLinksService.createPaymentLink({
      amountCents,
      taxCents,
      amountWithoutTaxCents,
      reference: `Orden ${order.orderNumber}`,
      clientTransactionId,
      expireInHours: 24,
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

    // Payphone Notificación Externa shape (best-effort lookup across known field names)
    const transactionId =
      body.transactionId || body.id || body.payphoneTransactionId || query.id || query.transactionId;
    const clientTransactionId =
      body.clientTransactionId || body.clientTxId || query.clientTransactionId || query.clientTransactionID;
    const statusCodeRaw =
      body.statusCode ?? body.status ?? body.transactionStatus ?? query.statusCode;

    console.log('[PayphoneLinkWebhook] body:', JSON.stringify(body), 'query:', JSON.stringify(query));

    if (!clientTransactionId) {
      res.status(HttpStatusCode.Ok).send({ success: false, message: 'missing clientTransactionId' });
      return;
    }

    const order = await Order.findOne({ clientTransactionId: String(clientTransactionId) });
    if (!order) {
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

    if (isApproved) {
      order.paymentStatus = 'paid';
      order.status = 'confirmed';
      if (transactionId) order.payphoneTransactionId = String(transactionId);
      await order.save();

      // Outbound WhatsApp confirmation
      if (order.source === 'whatsapp_bot') {
        bbcNotificationService.sendPaidConfirmation(order).catch(err =>
          console.error('[PayphoneLinkWebhook] sendPaidConfirmation error:', err)
        );
      }

      // Email confirmation (best-effort)
      try {
        const user = await User.findById(order.user);
        if (user?.email) {
          emailService.sendOrderConfirmation(user.email, user.name, String(order._id), order.total).catch(() => {});
        }
      } catch {}
    } else if (isFailed) {
      order.paymentStatus = 'failed';
      if (transactionId) order.payphoneTransactionId = String(transactionId);
      await order.save();
    }

    res.status(HttpStatusCode.Ok).send({ success: true });
  } catch (error) {
    console.error('[PayphoneLinkWebhook] error:', error);
    res.status(HttpStatusCode.Ok).send({ success: false });
  }
};

// Parse pipe-format raw message from WhatsApp bot:
// "PAGAR|nombre|email|telefono|cedula|direccion|ciudad|productos|precioTotal"
function parseRawMessage(raw: string): Record<string, any> | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.replace(/^[^P]*PAGAR\s*\|/i, 'PAGAR|').trim();
  const parts = cleaned.split('|').map(p => p.trim());
  if (parts.length < 9 || !/^PAGAR$/i.test(parts[0])) return null;
  const total = parseFloat(parts[8].replace(/[^0-9.]/g, ''));
  if (!total || total <= 0) return null;
  return {
    customerName: parts[1],
    customerEmail: parts[2],
    phone: parts[3].replace(/[^0-9+]/g, ''),
    identificationNumber: parts[4],
    address: parts[5],
    city: parts[6],
    items: [{ name: parts[7], price: total, quantity: 1 }],
  };
}

// ── WhatsApp Bot one-shot checkout: create order + payphone link ──────────
const FORMAT_HELP =
  '❌ Formato incorrecto. Por favor copia y pega exactamente este formato en UN solo mensaje (cambia los valores por los tuyos):\n\n' +
  'PAGAR|NombreCompleto|email@dominio.com|0987654321|1701234567|CalleYNumero Referencia|Ciudad|2 Taza Boscan Estandar|50';

export const whatsappBotCheckout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawBody = req.body || {};
    const isFromBot = !!rawBody.rawMessage;
    const parsed = rawBody.rawMessage ? parseRawMessage(rawBody.rawMessage) : null;

    if (isFromBot && !parsed) {
      res.status(HttpStatusCode.Ok).send({ success: false, message: FORMAT_HELP });
      return;
    }

    const body: any = parsed ? { ...rawBody, ...parsed } : rawBody;
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
      state,
      notes,
      identificationNumber,
      shippingZoneName,
      shipping: bodyShipping,
    } = body;

    const missing: string[] = [];
    if (!customerEmail) missing.push('correo');
    if (!phone) missing.push('teléfono');
    if (!items || !Array.isArray(items) || !items.length) missing.push('productos');
    if (!address) missing.push('dirección');
    if (missing.length) {
      const msg = isFromBot
        ? `❌ Faltan datos (${missing.join(', ')}). ${FORMAT_HELP}`
        : `Faltan datos: ${missing.join(', ')}`;
      res.status(isFromBot ? HttpStatusCode.Ok : HttpStatusCode.BadRequest).send({ success: false, message: msg });
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

    let subtotal = 0;
    const resolvedItems: any[] = [];
    for (const item of items) {
      const qty = Number(item.quantity) || 1;
      if (item.product) {
        const product = await Product.findById(item.product);
        if (!product || !product.isActive) {
          res.status(HttpStatusCode.BadRequest).send({ success: false, message: `Producto no disponible: ${item.product}` });
          return;
        }
        const price = Number(item.price) > 0 ? Number(item.price) : product.price;
        subtotal += price * qty;
        resolvedItems.push({
          product: product._id,
          name: product.name,
          image: product.mainImage,
          quantity: qty,
          price,
          ...(item.sizeName && { sizeName: item.sizeName }),
        });
      } else {
        const name = String(item.name || 'Producto');
        const price = Number(item.price) || 0;
        if (price <= 0) {
          res.status(HttpStatusCode.BadRequest).send({ success: false, message: `Precio inválido para item: ${name}` });
          return;
        }
        subtotal += price * qty;
        resolvedItems.push({ name, image: '', quantity: qty, price });
      }
    }

    const shippingCost = bodyShipping !== undefined ? Number(bodyShipping) : subtotal >= 50 ? 0 : 5;
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
        city: city || '',
        ...(state && { state }),
      },
      paymentMethod: 'payphone',
      ...(notes && { notes }),
      ...(identificationNumber && { identificationNumber }),
      ...(shippingZoneName && { shippingZoneName }),
      source: 'whatsapp_bot',
      whatsappPhone: phone,
      ...(isNewGuest && tempPassword && { guestTempPassword: tempPassword }),
    });

    const clientTransactionId = buildClientTransactionId(order.orderNumber);
    const amountCents = Math.round(total * 100);
    const taxCents = 0;
    const amountWithoutTaxCents = amountCents;

    const { paymentLink, expiresAt } = await payphoneLinksService.createPaymentLink({
      amountCents,
      taxCents,
      amountWithoutTaxCents,
      reference: `Orden ${order.orderNumber}`,
      clientTransactionId,
      expireInHours: 24,
    });

    order.payphoneLinkUrl = paymentLink;
    order.payphoneLinkExpiresAt = expiresAt;
    order.clientTransactionId = clientTransactionId;
    await order.save();

    const message =
      `✅ Pedido ${order.orderNumber} creado por $${total.toFixed(2)}\n\n` +
      `Paga aquí 👇\n${paymentLink}\n\n` +
      `Link válido 24h. Cuando confirmes el pago te aviso por aquí ☕`;

    res.status(HttpStatusCode.Created).send({
      success: true,
      message,
      paymentLink,
      orderNumber: order.orderNumber,
      orderId: String(order._id),
      total,
      expiresAt,
    });
  } catch (error) {
    console.error('[whatsappBotCheckout] error:', error);
    res.status(HttpStatusCode.Ok).send({
      success: false,
      message: '❌ Hubo un problema procesando tu pedido. Por favor intenta de nuevo en un momento o escribe AYUDA.',
    });
  }
};
