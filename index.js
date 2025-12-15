const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT
const stripe = require('stripe')(process.env.STRIPE_SECRET);

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
        const productsCollection = db.collection('products')
        const orderCollection = db.collection('order')

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
            if (session.payment_status === 'paid') {
                const id = session.metadata.orderId;
                const query = { _id: new ObjectId(id) }
                const update = {
                    $set: {
                        payment_status: 'paid'
                    }
                }

                const result = await orderCollection.updateOne(query, update);
                res.send(result);
            }

            res.send({ success: false });
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