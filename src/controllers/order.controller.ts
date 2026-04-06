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

export const createOrder = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { items, shippingAddress, paymentMethod = 'manual', notes, shippingZoneId } = req.body;

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
      subtotal += product.price * item.quantity;
      resolvedItems.push({
        product: product._id,
        name: product.name,
        image: product.mainImage,
        quantity: item.quantity,
        price: product.price,
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
    const orders = await Order.find()
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    res.send({ success: true, data: orders });
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
    const { status, paymentStatus, adminNotes } = req.body;

    const order = await Order.findById(req.params.id).populate<{ user: { name: string; email: string } }>('user', 'name email');
    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Orden no encontrada' });
      return;
    }

    const previousStatus = order.status;

    if (status) order.status = status;
    if (paymentStatus) order.paymentStatus = paymentStatus;
    if (adminNotes !== undefined) order.notes = adminNotes;
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
    const { items, shippingAddress, notes, shippingZoneId, email: bodyEmail } = req.body;

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
      subtotal += product.price * item.quantity;
      resolvedItems.push({
        product: product._id,
        name: product.name,
        image: product.mainImage,
        quantity: item.quantity,
        price: product.price,
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
    if (req.user?.accountType !== 'admin' && req.user?.accountType !== 'owner') {
      res.status(HttpStatusCode.Forbidden).send({ success: false, message: 'Sin permisos' });
      return;
    }

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

    await emailService.sendOrderConfirmation(buyer.email, buyer.name, String(order._id), order.total);

    res.send({ success: true, message: `Correo reenviado a ${buyer.email}` });
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
