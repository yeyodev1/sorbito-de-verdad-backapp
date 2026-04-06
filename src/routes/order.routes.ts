import { Router } from 'express';
import {
  createOrder,
  getMyOrders,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
  createPayphoneOrder,
  getPaymentStatus,
  confirmPayphonePayment,
  trackOrder,
  trackOrderByEmail,
  resendOrderEmail,
} from '../controllers/order.controller';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.middleware';

const orderRouter = Router();

// ── Public routes (no auth required) ────────────────────────────────────────
orderRouter.get('/track/by-email/:email', trackOrderByEmail);
orderRouter.get('/track/:orderNumber', trackOrder);
orderRouter.post('/payphone', optionalAuthMiddleware, createPayphoneOrder);
orderRouter.post('/confirm-payment', optionalAuthMiddleware, confirmPayphonePayment);

// ── Protected routes ─────────────────────────────────────────────────────────
orderRouter.use(authMiddleware);

orderRouter.post('/', createOrder);
orderRouter.get('/my-orders', getMyOrders);
orderRouter.get('/admin', getAllOrders);
orderRouter.get('/:id/payment-status', getPaymentStatus);
orderRouter.post('/:id/resend-email', resendOrderEmail);
orderRouter.get('/:id', getOrderById);
orderRouter.patch('/:id/status', updateOrderStatus);

export default orderRouter;
