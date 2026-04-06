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
  resendCredentials,
} from '../controllers/order.controller';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.middleware';

const orderRouter = Router();

// ── Public routes (no auth required) ────────────────────────────────────────
orderRouter.get('/track/by-email/:email', trackOrderByEmail);
orderRouter.get('/track/:orderNumber', trackOrder);
orderRouter.post('/payphone', optionalAuthMiddleware, createPayphoneOrder);
orderRouter.post('/confirm-payment', optionalAuthMiddleware, confirmPayphonePayment);
orderRouter.post('/:id/resend-email', optionalAuthMiddleware, resendOrderEmail);
orderRouter.post('/:id/resend-credentials', resendCredentials);

// ── Protected routes ─────────────────────────────────────────────────────────
orderRouter.use(authMiddleware);

orderRouter.post('/', createOrder);
orderRouter.get('/my-orders', getMyOrders);
orderRouter.get('/admin', getAllOrders);
orderRouter.get('/:id/payment-status', getPaymentStatus);
orderRouter.get('/:id', getOrderById);
orderRouter.patch('/:id/status', updateOrderStatus);

export default orderRouter;
