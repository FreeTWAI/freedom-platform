import '../zod-csp.js';
import { bootAddToCart, bootCartHeaderLink } from './add-to-cart.js';
import { bootCartPage } from './cart-page.js';
import { bootCheckoutPage } from './checkout-page.js';
import { bootOrderAccessPage } from './order-access-page.js';
import { bootOrderPage } from './order-page.js';
import { bootPaymentReturnPage } from './payment-return-page.js';

export { parseQuantityInput } from './order-api.js';

function bootStorefront() {
  const notifyHeader = bootCartHeaderLink();
  bootAddToCart(notifyHeader);
  bootCartPage();
  bootCheckoutPage();
  bootOrderPage();
  bootPaymentReturnPage();
  bootOrderAccessPage();
}

bootStorefront();
