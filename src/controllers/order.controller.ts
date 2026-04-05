import { HttpStatusCode } from 'axios';
import { Request, Response, NextFunction } from 'express';
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
    if (req.user?.accountType !== 'admin') {
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
    if (req.user?.accountType !== 'admin') {
      res.status(HttpStatusCode.Forbidden).send({ success: false, message: 'Sin permisos' });
      return;
    }
    const { status, paymentStatus } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { ...(status && { status }), ...(paymentStatus && { paymentStatus }) },
      { new: true }
    );
    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Orden no encontrada' });
      return;
    }
    res.send({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

export const createPayphoneOrder = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { items, shippingAddress, notes, shippingZoneId } = req.body;

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
      if (product.stock < item.quantity) {
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

    const clientTransactionId = Date.now().toString();

    const order = await Order.create({
      user: req.user?.userId,
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
    });

    const frontendOrigin = req.headers.origin as string | undefined
      ?? process.env.FRONTEND_URL
      ?? 'http://localhost:5173';
    const responseUrl = `${frontendOrigin}/pago/pendiente?orderId=${order._id}`;

    const { payWithCard } = await payphoneService.prepareButton({
      amount: Math.round(total * 100),
      amountWithoutTax: Math.round(subtotal * 100),
      clientTransactionId,
      responseUrl,
    });

    res.status(HttpStatusCode.Created).send({
      success: true,
      data: {
        orderId: order._id,
        clientTransactionId,
        payWithCard,
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

export const verifyPayphonePayment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { payphoneTransactionId, orderId } = req.body as { payphoneTransactionId?: string; orderId?: string };

    if (!payphoneTransactionId || !orderId) {
      res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'payphoneTransactionId y orderId son requeridos' });
      return;
    }

    const result = await payphoneService.verifySale(payphoneTransactionId);
    const order = await Order.findOne({ _id: orderId, user: req.user?.userId });

    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Orden no encontrada' });
      return;
    }

    if (result.statusCode === 3) {
      order.paymentStatus = 'paid';
      order.status = 'confirmed';
    } else if (result.statusCode === 2) {
      order.paymentStatus = 'failed';
    }
    await order.save();

    res.send({ success: true, data: { paymentStatus: order.paymentStatus, status: order.status } });
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
