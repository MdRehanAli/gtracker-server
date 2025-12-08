const express = require('express');
const cors = require('cors');
require('dotenv').config();
const port = process.env.PORT

const app = express();

// Middlewares 

app.use(express.json());
app.use(cors());

app.get('/', (req, res) => {
    res.send("GTracker Server is running....");
})

app.listen(port, () => {
    console.log(`Server is Running on Port: ${port}`);
})