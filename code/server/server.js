/* eslint-disable no-console */
const express = require('express');

const app = express();
const { resolve } = require('path');
// Replace if using a different env file or config
require('dotenv').config({ path: './.env' });
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const allitems = {};
const fs = require('fs');

app.use(express.static(process.env.STATIC_DIR));

app.use(
  express.json(
    {
      // Should use middleware or a function to compute it only when
      // hitting the Stripe webhook endpoint.
      verify: (req, res, buf) => {
        if (req.originalUrl.startsWith('/webhook')) {
          req.rawBody = buf.toString();
        }
      },
    },
  ),
);
app.use(cors({ origin: true }));

// const asyncMiddleware = fn => (req, res, next) => {
//   Promise.resolve(fn(req, res, next)).catch(next);
// };

app.post("/webhook", async (req, res) => {
  // TODO: Integrate Stripe
});

// Routes
app.get('/', (req, res) => {
  try {
    const path = resolve(`${process.env.STATIC_DIR}/index.html`);
    if (!fs.existsSync(path)) throw Error();
    res.sendFile(path);
  } catch (error) {
    const path = resolve('./public/static-file-error.html');
    res.sendFile(path);
  }
});

// Fetch the Stripe publishable key
//
// Example call:
// curl -X GET http://localhost:4242/config \
//
// Returns: a JSON response of the pubblishable key
//   {
//        key: <STRIPE_PUBLISHABLE_KEY>
//   }
app.get("/config", (req, res) => {
  res.send({key: process.env.STRIPE_PUBLISHABLE_KEY})
});

app.post('/create-client', async (req, res) => {
  const { name, email, firstLesson } = req.body;
  const customers = await stripe.customers.list({ email });
  if (customers.data.length !== 0) {
    return res.sendStatus(409)
  }
  const newCustomer = await stripe.customers.create({ email, name, metadata: { first_lesson: firstLesson } });
  res.send({ customerId:  newCustomer.id});
})

app.get('/create-setup-intent', async (req, res) => {
  const setupIntent = await stripe.setupIntents.create();
  res.send({ clientSecret: setupIntent.client_secret });
})

// Milestone 1: Signing up
// Shows the lesson sign up page.
app.get('/lessons', (req, res) => {
  try {
    const path = resolve(`${process.env.STATIC_DIR}/lessons.html`);
    if (!fs.existsSync(path)) throw Error();
    res.sendFile(path);
  } catch (error) {
    const path = resolve('./public/static-file-error.html');
    res.sendFile(path);
  }
});

app.post('/lessons', async (req, res) => {
  try {
    const { id, paymentMethodId } = req.body;
    const customer = await stripe.customers.retrieve(id)
    if (customer === undefined) {
      return res.sendStatus(404)
    }
    const { data} = await stripe.customers.listPaymentMethods(
        id
    );
    await Promise.all(data.map(async paymentMethod => {
      await stripe.paymentMethods.detach(paymentMethod.id)
    }))

    await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });
    await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: paymentMethodId } });

    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    res.send({
      lastFour: paymentMethod.card.last4
    })
  } catch (error) {
    const path = resolve('./public/static-file-error.html');
    res.sendFile(path);
  }
});

// TODO: Integrate Stripe

// Milestone 2: '/schedule-lesson'
// Authorize a payment for a lesson
//
// Parameters:
// customer_id: id of the customer
// amount: amount of the lesson in cents
// description: a description of this lesson
//
// Example call:
// curl -X POST http://localhost:4242/schedule-lesson \
//  -d customer_id=cus_GlY8vzEaWTFmps \
//  -d amount=4500 \
//  -d description='Lesson on Feb 25th'
//
// Returns: a JSON response of one of the following forms:
// For a successful payment, return the Payment Intent:
//   {
//        payment: <payment_intent>
//    }
//
// For errors:
//  {
//    error:
//       code: the code returned from the Stripe error if there was one
//       message: the message returned from the Stripe error. if no payment method was
//         found for that customer return an msg 'no payment methods found for <customer_id>'
//    payment_intent_id: if a payment intent was created but not successfully authorized
// }
app.post("/schedule-lesson", async (req, res) => {
  const { customer_id, amount, description } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: 'usd',
      customer: customer_id,
      description: description,
      metadata: {
        type: 'lessons-payment'
      },
      payment_method_types: ['card'],
      capture_method: 'manual',
    });

    const scheduleLessonResponse = await stripe.paymentIntents.confirm(paymentIntent.id, {
      payment_method: 'pm_card_visa '
    });

    res.status(200).json({payment: scheduleLessonResponse});
  } catch (e) {
    res.status(400).json(  {
    error:
        {
          code: e.code,
          message: `No such customer: '${customer_id}'`,
          payment_intent_id: "if a payment intent was created but not successfully authorized"
        }
    }
  );}});


// Milestone 2: '/complete-lesson-payment'
// Capture a payment for a lesson.
//
// Parameters:
// amount: (optional) amount to capture if different than the original amount authorized
//
// Example call:
// curl -X POST http://localhost:4242/complete_lesson_payment \
//  -d payment_intent_id=pi_XXX \
//  -d amount=4500
//
// Returns: a JSON response of one of the following forms:
//
// For a successful payment, return the payment intent:
//   {
//        payment: <payment_intent>
//    }
//
// for errors:
//  {
//    error:
//       code: the code returned from the error
//       message: the message returned from the error from Stripe
// }
//
app.post("/complete-lesson-payment", async (req, res) => {
  const { payment_intent_id, amount } = req.body;
  try {
    const paymentCapturedIntent = await stripe.paymentIntents.capture(payment_intent_id, {...(amount && {amount_to_capture: amount})})
    res.status(200).json({payment: paymentCapturedIntent});
  } catch (e) {
    res.status(400).json({     error:
          {
            code: e.code,
            message: e.message,
          } });
  }
});

// Milestone 2: '/refund-lesson'
// Refunds a lesson payment.  Refund the payment from the customer (or cancel the auth
// if a payment hasn't occurred).
// Sets the refund reason to 'requested_by_customer'
//
// Parameters:
// payment_intent_id: the payment intent to refund
// amount: (optional) amount to refund if different than the original payment
//
// Example call:
// curl -X POST http://localhost:4242/refund-lesson \
//   -d payment_intent_id=pi_XXX \
//   -d amount=2500
//
// Returns
// If the refund is successfully created returns a JSON response of the format:
//
// {
//   refund: refund.id
// }
//
// If there was an error:
//  {
//    error: {
//        code: e.error.code,
//        message: e.error.message
//      }
//  }
app.post("/refund-lesson", async (req, res) => {
  const { payment_intent_id, amount } = req.body;
  try {
    const refund = await stripe.refunds.create({
      payment_intent: payment_intent_id,
      ...(amount && { amount })
    });

    res.status(200).json({ refund: refund.id });
  } catch (e) {
    res.status(400).json({ error:           {
        code: e.code,
        message: e.message,
      } });
  }
});

// Milestone 3: Managing account info
// Displays the account update page for a given customer
app.post("/account-update/:customer_id", async (req, res) => {
    const { customer_id } = req.params;
    const { name, email, /*payment_method_id*/ } = req.body;

    try {
      const existingCustomers = await stripe.customers.list({ email });
      const isDuplicateEmail = existingCustomers.data.some(c => c.id !== customer_id);

      if (isDuplicateEmail) {
        return res.status(400).json({ error: 'Customer email already exists!' });
      }

      //await stripe.paymentMethods.attach(payment_method_id, { customer: customer_id });

      await stripe.customers.update(customer_id, {
        name,
        email,
        /*invoice_settings: { default_payment_method: payment_method_id },*/
      });

      const customer = await stripe.customers.retrieve(customer_id);
      res.json({
        updatedName: customer.name,
        updatedEmail: customer.email,
        /*payment_method: customer.invoice_settings.default_payment_method,*/
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

app.get("/payment-method/:customer_id", async (req, res) => {
  const { customer_id } = req.params;

  try {
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customer_id,
      type: 'card',
    });

    if (paymentMethods.data.length > 0) {
      const customer = await stripe.customers.retrieve(customer_id);
      const card = paymentMethods.data[0].card;

      const result = {
        customer: {
          id: customer.id,
          email: customer.email,
          name: customer.name,
        },
        card: {
          exp_month: card.exp_month,
          exp_year: card.exp_year,
          last4: card.last4,
        }
      };

      res.json(result);
    } else {
      res.status(404).json({ error: 'No payment methods found for this customer.' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


app.post("/update-payment-details/:customer_id", async (req, res) => {
  // TODO: Update the customer's payment details
});

// Handle account updates
app.post("/account-update", async (req, res) => {
  // TODO: Handle updates to any of the customer's account details
});

// Milestone 3: '/delete-account'
// Deletes a customer object if there are no uncaptured payment intents for them.
//
// Parameters:
//   customer_id: the id of the customer to delete
//
// Example request
//   curl -X POST http://localhost:4242/delete-account/:customer_id \
//
// Returns 1 of 3 responses:
// If the customer had no uncaptured charges and was successfully deleted returns the response:
//   {
//        deleted: true
//   }
//
// If the customer had uncaptured payment intents, return a list of the payment intent ids:
//   {
//     uncaptured_payments: ids of any uncaptured payment intents
//   }
//
// If there was an error:
//  {
//    error: {
//        code: e.error.code,
//        message: e.error.message
//      }
//  }
//
app.post("/delete-account/:customer_id", async (req, res) => {
  const { customer_id } = req.params;

  try {
    const paymentIntents = await stripe.paymentIntents.list({
      customer: customer_id,
      limit: 100,
    });

    const uncapturedPayments = paymentIntents.data.filter(pi => pi.status === 'requires_capture');

    if (uncapturedPayments.length > 0) {
      const uncapturedIds = uncapturedPayments.map(pi => pi.id);
      return res.json({ uncaptured_payments: uncapturedIds });
    }

    // Delete the customer if all payments are captured
    await stripe.customers.del(customer_id);
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/// Milestone 4: '/calculate-lesson-total'
// Returns the total amounts for payments for lessons, ignoring payments
// for videos and concert tickets, ranging over the last 36 hours.
app.get('/calculate-lesson-total', async (req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000); // текущее время в секундах
    const thirtySixHoursAgo = now - (36 * 60 * 60); // 36 часов назад

    // Получаем список платежей за последние 36 часов
    const charges = await stripe.charges.list({
      created: {
        gte: thirtySixHoursAgo,  // платежи, созданные после этого времени
        lte: now  // до текущего момента
      },
      limit: 200,  // можно увеличить лимит, если нужно больше данных
    });

    let totalRevenue = 0;  // Общая сумма без учета сборов
    let totalFees = 0;     // Сумма сборов, которые Stripe удержал
    let netRevenue = 0;    // Чистая выручка (выручка минус сборы)

    // Проходим по всем полученным платежам
    for (const charge of charges.data) {
      // Только успешные платежи, игнорируем неудачные или в процессе
      if (charge.status === 'succeeded') {
        totalRevenue += charge.amount;  // Добавляем сумму платежа

        // Проверяем, есть ли связанные транзакции для сбора информации о сборах
        if (charge.balance_transaction) {
          const balanceTransaction = await stripe.balanceTransactions.retrieve(charge.balance_transaction);
          totalFees += balanceTransaction.fee;  // Добавляем сборы (try, )
          netRevenue += (charge.amount - balanceTransaction.fee);  // Чистая сумма
        } else {
          // Если нет транзакции, считаем, что не было сборовя
          netRevenue += charge.amount;
        }
      }
    }

    // Отправляем ответ с расчетами
    res.json({
      payment_total: totalRevenue,
      fee_total: totalFees,
      net_total: netRevenue
    });
  } catch (error) {
    // Обработка ошибок
    res.status(500).json({ error: error.message });
  }
});

// Milestone 4: '/find-customers-with-failed-payments'
// Returns any customer who meets the following conditions:
// The last attempt to make a payment for that customer failed.
// The payment method associated with that customer is the same payment method used
// for the failed payment, in other words, the customer has not yet supplied a new payment method.
//
// Example request: curl -X GET http://localhost:4242/find-customers-with-failed-payments
//
// Returns a JSON response with information about each customer identified and
// their associated last payment
// attempt and, info about the payment method on file.
// [
//   {
//     customer: {
//       id: customer.id,
//       email: customer.email,
//       name: customer.name,
//     },
//     payment_intent: {
//       created: created timestamp for the payment intent
//       description: description from the payment intent
//       status: the status of the payment intent
//       error: the reason that the payment attempt was declined
//     },
//     payment_method: {
//       last4: last four of the card stored on the customer
//       brand: brand of the card stored on the customer
//     }
//   },
//   {},
//   {},
// ]

app.get('/find-customers-with-failed-payments', async (req, res) => {
  try {
    const currentTime = Math.floor(Date.now() / 1000);
    const last36Hours = currentTime - 36 * 60 * 60;

    const paymentIntents = await stripe.paymentIntents.list({
      created: { gte: last36Hours },
      limit: 1,
    });

    const failedPayments = [];

    for (const paymentIntent of paymentIntents.data) {
      const customerId = paymentIntent.customer;
      const paymentMethodId = paymentIntent.payment_method;


      const failedStatus = ['requires_payment_method', 'requires_capture', 'canceled'];
      if (failedStatus.includes(paymentIntent.status)) {


        const customer = await stripe.customers.retrieve(customerId);
        const { data} = await stripe.paymentMethods.list({
          customer: customerId,
          type: 'card',
          limit: 1, // Берем только последний метод
        });


        failedPayments.push({
          customer: {
            id: customerId,
            name: customer.name,
            email: customer.email,
          },
          payment_method: {
            brand: data[0].card.brand,
            last4: data[0].card.last4,
          },
          payment_intent: {
            status: 'failed',
            error: paymentIntent.last_payment_error?.code || 'generic_decline',
          },
        });
      }
    }

    res.json(failedPayments);
  } catch (error) {
    console.error('Error fetching failed payments:', error);
    res.status(500).json({ error: 'Unable to fetch failed payments' });
  }
});

function errorHandler(err, req, res, next) {
  res.status(500).send({ error: { message: err.message } });
}

app.use(errorHandler);

app.listen(4242, () => console.log(`Node server listening on port http://localhost:${4242}`));
