const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const crypto = require("crypto");

const admin = require("firebase-admin");

// const serviceAccount = require("./gtracker24-firebase-adminsdk.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


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

const verifyFBToken = async (req, res, next) => {
    console.log('Headers in the middleWare:', req.headers.authorization);

    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).send({ message: 'Unauthorized Access' });
    }

    try {
        const idToken = token.split(' ')[1]
        const decoded = await admin.auth().verifyIdToken(idToken);
        console.log('Decoded in the token: ', decoded);

        req.decoded_email = decoded.email;
        next();
    }
    catch {
        return res.status(401).send({ message: 'Unauthorized Access' });
    }

}

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
        // await client.connect();

        const db = client.db("gTrackerDB");
        const productsCollection = db.collection('products');
        const orderCollection = db.collection('order');
        const paymentCollection = db.collection('payments');
        const userCollection = db.collection('users');

        // Middleware with database Access 
        const verifyAdmin = async (req, res, next) => {

            const email = req.decoded_email;
            const query = { email };
            const user = await userCollection.findOne(query);

            if (!user || user.role !== 'admin') {
                return res.status(401).send({ message: 'forbidden access' })
            }

            next();
        }

        const verifyManager = async (req, res, next) => {

            const email = req.decoded_email;
            const query = { email };
            const user = await userCollection.findOne(query);

            if (!user || user.role !== 'manager') {
                return res.status(401).send({ message: 'forbidden access' })
            }

            next();
        }

        app.get('/users', verifyFBToken, async (req, res) => {

            const searchText = req.query.searchText;
            const query = {
            }

            if (searchText) {
                query.$or = [
                    { displayName: { $regex: searchText, $options: 'i' } },
                    { email: { $regex: searchText, $options: 'i' } }
                ]
            }

            const cursor = userCollection.find(query).sort({ createdAt: -1 }).limit(5);
            const result = await cursor.toArray();
            res.send(result);
        })

        app.get('/users/:id', async (req, res) => {

        })

        app.get('/users/:email/role', async (req, res) => {
            const email = req.params.email;
            const query = { email };
            const user = await userCollection.findOne(query);
            res.send({ role: user?.role || 'user' })
        })

        app.post('/users', async (req, res) => {
            const user = req.body;

            user.status = 'pending';
            user.createdAt = new Date();

            const email = user.email;
            const userExists = await userCollection.findOne({ email })

            if (userExists) {
                return res.send({ message: "User Exists." })
            }

            const result = await userCollection.insertOne(user);
            res.send(result);
        })

        app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const roleInfo = req.body
            const query = { _id: new ObjectId(id) };

            const updateDoc = {
                $set: {
                    role: roleInfo.role
                }
            }

            const result = await userCollection.updateOne(query, updateDoc);

            res.send(result);
        })

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
            const searchText = req.query.searchText;
            const query = {};

            const { email } = req.query;
            if (email) {
                query.email = email;
            }

            if (searchText) {
                query.$or = [
                    { name: { $regex: searchText, $options: 'i' } },
                    { category: { $regex: searchText, $options: 'i' } }
                ]
            }

            const options = { sort: { createdAt: -1 } }

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

        app.post('/all-products', async (req, res) => {
            const product = req.body;
            product.createdAt = new Date();
            product.showHome = false;
            const result = await productsCollection.insertOne(product);
            res.send(result);
        })

        app.patch('/all-products/:id', async (req, res) => {
            const id = req.params.id;
            const productInfo = req.body
            const query = { _id: new ObjectId(id) };

            const updateDoc = {
                $set: {
                    name: productInfo.name,
                    largeDescription: productInfo.largeDescription,
                    category: productInfo.category,
                    price: productInfo.price,
                    availableQuantity: productInfo.availableQuantity,
                    minimumOrder: productInfo.minimumOrder,
                    video: productInfo.video,
                    paymentOptions: productInfo.paymentOptions,
                    creator: productInfo.photoURL,
                    creatorEmail: productInfo.email,
                    createdBy: productInfo.displayName
                }
            }

            const result = await productsCollection.updateOne(query, updateDoc);
            res.send(result);
        })

        app.delete('/all-products/:id', async (req, res) => {
            const id = req.params.id;

            const query = { _id: new ObjectId(id) };
            const result = await productsCollection.deleteOne(query);
            res.send(result);
        })

        // Order API 
        app.get('/order', async (req, res) => {
            const query = {};

            const { email, status } = req.query;
            if (email) {
                query.email = email;
            }
            if (status) {
                query.status = status;
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
            order.status = 'pending';

            const result = await orderCollection.insertOne(order);
            res.send(result)
        })

        app.patch('/order/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const status = req.body.status;
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const updateDoc = {
                $set: {
                    status: status
                }
            }
            const result = await orderCollection.updateOne(query, updateDoc);
            res.send(result);
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
                        status: 'pending',
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


                const resultPayment = await paymentCollection.insertOne(paymentHistory);

                return res.send({ success: true, trackingId: trackingId, transactionId: session.payment_intent, modifyParcel: result, paymentInfo: resultPayment })

            }

            return res.send({ success: false });
        })


        // Payment Related Api 
        app.get('/payments', verifyFBToken, async (req, res) => {
            const email = req.query.email;
            const query = {}

            // console.log('Headers: ', req.headers);

            if (email) {
                query.customerEmail = email

                // Check email address 
                if (email !== req.decoded_email) {
                    return res.status(403).send({ message: "Forbidden Access" })
                }
            }

            const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
            const result = await cursor.toArray();
            res.send(result);
        })

        // // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.listen(port, () => {
    console.log(`Server is Running on Port: ${port}`);
})