const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const crypto = require("crypto");

function generateTrackingId() {
    const prefix = "GT"; // GTracker
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const random = crypto.randomBytes(3).toString("hex").toUpperCase();

    return `${prefix}-${date}-${random}`;
}

const app = express();

// Middlewares 

app.use(express.json());
app.use(cors());

// MongoDB uri 
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.mrcc0jp.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

app.get('/', (req, res) => {
    res.send("GTracker Server is running....");
})

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db("gTrackerDB");
        const productsCollection = db.collection('products');
        const orderCollection = db.collection('order');
        const paymentCollection = db.collection('payments');

        // All Apis are here 

        // Products API

        app.get('/products', async (req, res) => {
            const query = {};

            const cursor = productsCollection.find(query).limit(6);
            const result = await cursor.toArray();
            res.send(result);
        })

        app.get('/products/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await productsCollection.findOne(query);
            res.send(result);
        })

        app.post('/products', async (req, res) => {
            const product = req.body;
            const result = await productsCollection.insertOne(product);
            res.send(result);
        })

        // All Products API
        app.get('/all-products', async (req, res) => {
            const query = {};

            const cursor = productsCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        })

        app.get('/all-products/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await productsCollection.findOne(query);
            res.send(result);
        })

        // Order API 
        app.get('/order', async (req, res) => {
            const query = {};

            const { email } = req.query;
            if (email) {
                query.email = email;
            }
            const options = { sort: { createdAt: -1 } }

            const cursor = orderCollection.find(query, options);
            const result = await cursor.toArray();
            res.send(result);
        })

        app.get('/order/:id', async (req, res) => {
            const id = req.params.id;

            const query = { _id: new ObjectId(id) };
            const result = await orderCollection.findOne(query);
            res.send(result);
        })

        app.post('/order', async (req, res) => {
            const order = req.body;

            // Order Created Time 
            order.createdAt = new Date();

            const result = await orderCollection.insertOne(order);
            res.send(result)
        })

        app.delete('/order/:id', async (req, res) => {
            const id = req.params.id;

            const query = { _id: new ObjectId(id) };
            const result = await orderCollection.deleteOne(query);
            res.send(result);
        })

        // Payment Related API 
        app.post('/payment-checkout-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseFloat(paymentInfo.orderPrice) * 100;

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'USD',
                            unit_amount: amount,
                            product_data: {
                                name: `Please Pay for ${paymentInfo.productTitle}`
                            }
                        },
                        quantity: 1,
                    },
                ],
                customer_email: paymentInfo.email,
                mode: 'payment',
                metadata: {
                    orderId: paymentInfo.orderId,
                    productTitle: paymentInfo.productTitle
                },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
            });

            console.log(session);
            res.send({ url: session.url });
        });

        app.patch('/payment-success', async (req, res) => {
            const sessionId = req.query.session_id;

            const session = await stripe.checkout.sessions.retrieve(sessionId);
            console.log('Session Retrieve:', session);

            const trackingId = generateTrackingId();

            const transactionId = session.payment_intent;
            const query = {
                transactionId: transactionId
            }

            const paymentExist = await paymentCollection.findOne(query);
            console.log(paymentExist);
            if (paymentExist) {
                return res.send({
                    message: 'Already exists',
                    transactionId,
                    trackingId: paymentExist.trackingId
                })
            }

            if (session.payment_status === 'paid') {
                const id = session.metadata.orderId;
                const query = { _id: new ObjectId(id) }
                const update = {
                    $set: {
                        payment_status: 'paid',
                        trackingId: trackingId
                    }
                }

                const result = await orderCollection.updateOne(query, update);

                const paymentHistory = {
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    customerEmail: session.customer_email,
                    orderId: session.metadata.orderId,
                    productTitle: session.metadata.productTitle,
                    transactionId: session.payment_intent,
                    paymentStatus: session.payment_status,
                    paidAt: new Date(),
                    trackingId: trackingId
                }

                if (session.payment_status === 'paid') {
                    const resultPayment = await paymentCollection.insertOne(paymentHistory);
                    res.send({ success: true, trackingId: trackingId, transactionId: session.payment_intent, modifyParcel: result, paymentInfo: resultPayment })
                }
            }

            res.send({ success: false });
        })

        
        // Payment Related Api 
        app.get('/payments', async (req, res) => {
            const email = req.query.email;
            const query = {}

            if (email) {
                query.customerEmail = email
            }

            const cursor = paymentCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        })

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.listen(port, () => {
    console.log(`Server is Running on Port: ${port}`);
})