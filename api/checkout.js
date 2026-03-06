// api/checkout.js
// THIS IS THE KEY DAVID SENT YOU
const stripe = require('stripe')('sk_test_51T7aEGB9YWRWqBOnfewaL31hksdyb6ZKSsf45ErssZTwSm6OVhr8pi7FpY4CkxaIltJrhfBLF2gyCgvQ69MjidE100PsTRDw9U');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);
    const cart = data.cart;

    const lineItems = cart.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name,
          images: [item.img],
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.qty,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `https://davidmyalk.netlify.app/#success`,
      cancel_url: `https://davidmyalk.netlify.app/#shop`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
