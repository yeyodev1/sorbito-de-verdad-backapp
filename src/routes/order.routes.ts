import { Router } from 'express';
import {
  createOrder,
  createGuestOrder,
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
  createPayphoneLink,
  whatsappBotCheckout,
  whatsappBotCartUpdate,
  whatsappBotCatalog,
  whatsappBotShippingInfo,
  whatsappBotBrain,
  whatsappBotAssistant,
  whatsappBotTransfer,
  whatsappBotTransferReceipt,
  whatsappBotSearchOrder,
} from '../controllers/order.controller';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.middleware';

const orderRouter = Router();

// ── Public routes (no auth required) ────────────────────────────────────────
orderRouter.get('/track/by-email/:email', trackOrderByEmail);
orderRouter.get('/track/:orderNumber', trackOrder);
orderRouter.post('/guest', createGuestOrder);
orderRouter.get('/whatsapp-bot/checkout', whatsappBotCheckout);
orderRouter.post('/whatsapp-bot/checkout', whatsappBotCheckout);
orderRouter.post('/whatsapp-bot/cart-update', whatsappBotCartUpdate);
orderRouter.post('/whatsapp-bot/catalog', whatsappBotCatalog);
orderRouter.get('/whatsapp-bot/catalog', whatsappBotCatalog);
orderRouter.post('/whatsapp-bot/shipping-info', whatsappBotShippingInfo);
orderRouter.get('/whatsapp-bot/shipping-info', whatsappBotShippingInfo);
orderRouter.post('/whatsapp-bot/brain', whatsappBotBrain);
orderRouter.post('/whatsapp-bot/assistant', whatsappBotAssistant);
orderRouter.post('/whatsapp-bot/transfer', whatsappBotTransfer);
orderRouter.get('/whatsapp-bot/transfer-receipt', whatsappBotTransferReceipt);
orderRouter.post('/whatsapp-bot/transfer-receipt', whatsappBotTransferReceipt);
orderRouter.post('/whatsapp-bot/search-order', whatsappBotSearchOrder);
orderRouter.get('/whatsapp-bot/search-order', whatsappBotSearchOrder);
orderRouter.post('/:id/payphone-link', createPayphoneLink);
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
